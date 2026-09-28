import { DestroyRef, Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { CRM_STORAGE_KEYS, LOCAL_STORAGE, SYNCABLE_STORAGE_KEYS } from '@core/tokens/crm-storage.token';
import { ISO8601Date, UUID } from '@core/models/crm.models';
import { generateId } from '@core/utils/uuid';

/** Emitted whenever a durable key is written, either locally or by another tab. */
export interface CrmStorageChange {
  key: string;
  value: unknown;
}

/** Payload broadcast between browser windows sharing the same origin. */
interface SyncEnvelope {
  key: string;
  value: unknown;
  origin: string;
  /**
   * Deletions that apply to `value`.
   *
   * They ride along inside the envelope rather than under a key of their own:
   * `receiveEnvelope` accepts only the four entity collection keys, so a
   * separate tombstone key would be rejected by the allowlist and a peer would
   * never learn that a row is dead.
   */
  tombstones?: Tombstone[];
}

/**
 * A deletion record.
 *
 * Replication is last-writer-wins per id, so a delete would otherwise lose to
 * any stale copy of the row that another window still holds — the record
 * reappears after the user deliberately removed it. A tombstone inverts that:
 * the delete is itself a versioned fact, and it is carried in the same envelope
 * as the data, so every window converges on the deletion.
 */
interface Tombstone {
  readonly id: UUID;
  readonly deletedAt: ISO8601Date;
  readonly version: number;
}

type CrmMigration = (value: unknown) => unknown;

const SYNC_CHANNEL_NAME = 'ng-crm-workspace-sync';
const CURRENT_SCHEMA_VERSION = 1;

const ENTITY_COLLECTION_KEYS: readonly string[] = [
  CRM_STORAGE_KEYS.ACCOUNTS,
  CRM_STORAGE_KEYS.CONTACTS,
  CRM_STORAGE_KEYS.OPPORTUNITIES,
  CRM_STORAGE_KEYS.ACTIVITIES
];

/**
 * Upgrade steps keyed by the schema version they migrate *from*.
 *
 * v0 payloads predate optimistic concurrency: records were stored without a
 * `version` field and could be duplicated. The v0 -> v1 step stamps a version
 * onto every surviving record and drops entries that are not addressable.
 */
const MIGRATIONS: Readonly<Record<number, CrmMigration>> = {
  0: (value: unknown): unknown => {
    if (!Array.isArray(value)) return value;
    const seen = new Set<string>();
    const migrated: unknown[] = [];
    for (const entry of value) {
      if (!isRecord(entry) || typeof entry['id'] !== 'string' || entry['id'].length === 0) {
        continue;
      }
      if (seen.has(entry['id'])) {
        continue;
      }
      seen.add(entry['id']);
      migrated.push({ ...entry, version: readVersion(entry) });
    }
    return migrated;
  }
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function readVersion(record: Record<string, unknown>): number {
  const raw = record['version'];
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : 1;
}

function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      error.code === 22 ||
      error.code === 1014)
  );
}

/**
 * Caps the tombstone registry so a long-lived instance cannot grow without
 * bound.
 *
 * The oldest deletions are dropped first. A pruned tombstone loses only its
 * ability to suppress a resurrection by an id that has been absent for a very
 * long time; the record itself is untouched, and re-deleting the id writes a
 * fresh tombstone. Losing a few thousand old ids is a far better trade than
 * unbounded `localStorage` growth, which eventually surfaces as a failed write
 * and a silently degraded cache.
 */
const MAX_TOMBSTONES = 1000;

function pruneTombstones(registry: Map<UUID, Tombstone>): Tombstone[] {
  if (registry.size <= MAX_TOMBSTONES) {
    return [...registry.values()];
  }
  return [...registry.values()]
    .sort((a, b) => {
      if (a.deletedAt !== b.deletedAt) {
        return a.deletedAt < b.deletedAt ? -1 : 1;
      }
      return a.id < b.id ? -1 : 1;
    })
    .slice(registry.size - MAX_TOMBSTONES);
}

/**
 * Last-writer-wins merge keyed on `id`. Records are compared by `version`;
 * ties keep the value already present in this window so that two tabs writing
 * simultaneously do not ping-pong the same payload back and forth.
 */
function mergeByVersion(current: unknown, incoming: unknown, tombstones: ReadonlyMap<UUID, Tombstone>): unknown {
  if (!Array.isArray(current) || !Array.isArray(incoming)) {
    return incoming;
  }

  const merged = new Map<string, Record<string, unknown>>();
  const order: string[] = [];

  const register = (record: Record<string, unknown>): void => {
    const id = record['id'] as string;

    // A deletion is a versioned fact, not an absence: a stale copy of a deleted
    // row must never be reintroduced, and an equally-versioned copy loses to the
    // tombstone. Only a strictly newer row may clear a tombstone.
    const tombstone = tombstones.get(id);
    if (tombstone && readVersion(record) <= tombstone.version) {
      return;
    }

    const existing = merged.get(id);
    if (!existing) {
      merged.set(id, record);
      order.push(id);
      return;
    }
    if (readVersion(record) > readVersion(existing)) {
      merged.set(id, record);
    }
  };

  for (const entry of current) {
    if (isRecord(entry) && typeof entry['id'] === 'string') register(entry);
  }
  for (const entry of incoming) {
    if (isRecord(entry) && typeof entry['id'] === 'string') register(entry);
  }

  return order.map(id => merged.get(id));
}

/**
 * Durable JSON store for CRM collections.
 *
 * Responsibilities:
 * - read/write JSON payloads with a transparent in-memory overlay that keeps the
 *   application usable when `localStorage` is blocked (`SecurityError`) or full
 *   (`QuotaExceededError`);
 * - migrate stored payloads forward to {@link CURRENT_SCHEMA_VERSION};
 * - replicate writes to other browser windows over `BroadcastChannel`, merging
 *   concurrent edits by entity `version`.
 */
@Injectable({ providedIn: 'root' })
export class CrmStorageService {
  private readonly localStorage = inject(LOCAL_STORAGE);
  private readonly destroyRef = inject(DestroyRef);

  /** Overlay consulted before the physical store, and written to on failure. */
  private readonly memory = new Map<string, string>();
  private readonly changeSubject = new Subject<CrmStorageChange>();
  private readonly instanceId = generateId();
  private channel: BroadcastChannel | null = null;
  private storageBlocked = false;
  private readonly syncableKeys = new Set<string>(SYNCABLE_STORAGE_KEYS);

  public readonly changes$: Observable<CrmStorageChange> = this.changeSubject.asObservable();

  constructor() {
    this.openSyncChannel();
    this.destroyRef.onDestroy(() => {
      this.channel?.close();
      this.channel = null;
    });
  }

  /**
   * Reads and deserializes a key.
   *
   * @returns the parsed value, or `null` when the key is absent, empty or holds
   * unparseable JSON (a corrupt payload is never allowed to crash hydration).
   */
  public load<T>(key: string): T | null {
    const raw = this.readRaw(key);
    if (raw === null || raw === '') {
      return null;
    }
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** Serializes, persists, replicates to sibling windows and notifies subscribers. */
  public save<T>(key: string, data: T): void {
    let serialized: string;
    try {
      serialized = JSON.stringify(data);
    } catch {
      // Circular structures or BigInt payloads are not persistable.
      return;
    }
    if (serialized === undefined) {
      return;
    }

    this.writeRaw(key, serialized);
    this.broadcast(key, data);
    this.changeSubject.next({ key, value: data });
  }

  /**
   * Records a deletion so no window can resurrect the entity.
   *
   * @param version the version the row held at the moment it was deleted. A
   *   row that was already being edited concurrently may legitimately carry a
   *   higher version, and that edit is the deliberate resurrection of the record
   *   rather than an accidental one.
   */
  public recordTombstone(id: UUID, version: number): void {
    if (!isNonEmptyString(id)) {
      return;
    }
    const registry = this.readTombstoneMap();
    const existing = registry.get(id);
    // Keep the strongest deletion: the highest version wins, and at equal
    // version the earliest timestamp, so the record of when it died is stable.
    if (existing && (existing.version > version || (existing.version === version && existing.deletedAt <= new Date().toISOString()))) {
      return;
    }
    registry.set(id, { id, deletedAt: new Date().toISOString(), version });
    this.save(CRM_STORAGE_KEYS.TOMBSTONES, pruneTombstones(registry));
  }

  /** Current deletion registry, keyed by id. */
  public readTombstones(): ReadonlyMap<UUID, Tombstone> {
    return this.readTombstoneMap();
  }

  /** Drops a tombstone, allowing a deliberate re-creation of the id. */
  public clearTombstone(id: UUID): void {
    const registry = this.readTombstoneMap();
    if (!registry.delete(id)) {
      return;
    }
    this.save(CRM_STORAGE_KEYS.TOMBSTONES, pruneTombstones(registry));
  }

  private readTombstoneMap(): Map<UUID, Tombstone> {
    const registry = new Map<UUID, Tombstone>();
    const raw = this.load<unknown>(CRM_STORAGE_KEYS.TOMBSTONES);
    if (!Array.isArray(raw)) {
      return registry;
    }
    for (const entry of raw) {
      if (!isRecord(entry)) {
        continue;
      }
      const id = entry['id'];
      if (!isNonEmptyString(id)) {
        continue;
      }
      registry.set(id, {
        id,
        deletedAt: typeof entry['deletedAt'] === 'string' ? entry['deletedAt'] : new Date(0).toISOString(),
        version: readVersion(entry)
      });
    }
    return registry;
  }

  /**
   * Brings stored payloads up to {@link CURRENT_SCHEMA_VERSION}. Safe to call on
   * every bootstrap: a payload already at the current version is left untouched.
   */
  public migrate(): void {
    const stored = this.load<unknown>(CRM_STORAGE_KEYS.SCHEMA_VERSION);
    let version = typeof stored === 'number' && Number.isFinite(stored) ? Math.floor(stored) : 0;

    if (version >= CURRENT_SCHEMA_VERSION) {
      // Newer schema than this build understands: read-only, never downgrade.
      return;
    }

    while (version < CURRENT_SCHEMA_VERSION) {
      const step = MIGRATIONS[version];
      if (step) {
        for (const key of ENTITY_COLLECTION_KEYS) {
          const current = this.load<unknown>(key);
          if (current === null) {
            continue;
          }
          this.save(key, step(current));
        }
      }
      version += 1;
    }

    this.save(CRM_STORAGE_KEYS.SCHEMA_VERSION, CURRENT_SCHEMA_VERSION);
  }

  /** `true` when the physical store is unusable and the memory overlay is live. */
  public get isUsingMemoryFallback(): boolean {
    return this.storageBlocked || this.memory.size > 0;
  }

  private readRaw(key: string): string | null {
    const overlay = this.memory.get(key);
    if (overlay !== undefined) {
      return overlay;
    }
    if (this.storageBlocked || !this.localStorage) {
      return null;
    }
    try {
      return this.localStorage.getItem(key);
    } catch {
      this.storageBlocked = true;
      return this.memory.get(key) ?? null;
    }
  }

  private writeRaw(key: string, value: string): void {
    this.memory.set(key, value);
    if (!this.localStorage) {
      return;
    }
    try {
      this.localStorage.setItem(key, value);
      // The physical write succeeded: the overlay entry is redundant.
      this.memory.delete(key);
    } catch (error) {
      if (!isQuotaError(error)) {
        this.storageBlocked = true;
      }
      // Keep the overlay entry so the value survives for the session.
    }
  }

  private openSyncChannel(): void {
    if (typeof BroadcastChannel === 'undefined') {
      return;
    }
    try {
      this.channel = new BroadcastChannel(SYNC_CHANNEL_NAME);
      this.channel.onmessage = (event: MessageEvent<SyncEnvelope>) => {
        this.receiveEnvelope(event.data);
      };
    } catch {
      this.channel = null;
    }
  }

  private broadcast(key: string, value: unknown): void {
    if (!this.channel) {
      return;
    }
    const envelope: SyncEnvelope = {
      key,
      value,
      origin: this.instanceId,
      tombstones: [...this.readTombstoneMap().values()]
    };
    try {
      this.channel.postMessage(envelope);
    } catch {
      // A payload that cannot be structured-cloned simply does not replicate.
    }
  }

  private receiveEnvelope(envelope: unknown): void {
    if (!isRecord(envelope)) {
      return;
    }
    const { key, value, origin, tombstones } = envelope as unknown as SyncEnvelope;

    // A message from another browsing context is untrusted input: only the four
    // entity collections may be written, only an array payload is accepted, and
    // only the origin window's own echo is ignored.
    if (!isNonEmptyString(key) || origin === this.instanceId) {
      return;
    }
    if (!this.syncableKeys.has(key) || !Array.isArray(value)) {
      return;
    }

    // The tombstone registry replicates in its own right, so a deletion reaches
    // its peers the moment it is recorded rather than waiting for the next
    // collection write to piggyback it. Peer tombstones are adopted first here
    // so they are already in place when the next row arrives.
    if (key === CRM_STORAGE_KEYS.TOMBSTONES) {
      const absorbed = this.absorbTombstones(value);
      if (!absorbed) {
        return;
      }
      const merged = this.readTombstoneMap();
      const serialized = [...merged.values()];
      this.writeRaw(CRM_STORAGE_KEYS.TOMBSTONES, JSON.stringify(serialized));
      this.changeSubject.next({ key, value: serialized });
      return;
    }

    // Adopt the sender's deletions before merging, so a row this window still
    // holds cannot be reintroduced by the very envelope that carried it.
    this.absorbTombstones(tombstones);
    const merged = mergeByVersion(this.load<unknown>(key), value, this.readTombstoneMap());
    this.writeRaw(key, JSON.stringify(merged));
    this.changeSubject.next({ key, value: merged });
  }

  /**
   * Merges a peer's tombstones into the local registry, keeping the strongest
   * record per id: a later deletion at a higher version wins, and at equal
   * version the earliest timestamp wins so the recorded moment is stable.
   */
  private absorbTombstones(incoming: unknown): boolean {
    if (!Array.isArray(incoming) || incoming.length === 0) {
      return false;
    }
    const registry = this.readTombstoneMap();
    let changed = false;
    for (const entry of incoming) {
      if (!isRecord(entry)) {
        continue;
      }
      const id = entry['id'];
      if (!isNonEmptyString(id)) {
        continue;
      }
      const candidate: Tombstone = {
        id,
        deletedAt: typeof entry['deletedAt'] === 'string' ? entry['deletedAt'] : new Date(0).toISOString(),
        version: readVersion(entry)
      };
      const existing = registry.get(id);
      const isStronger =
        !existing ||
        candidate.version > existing.version ||
        (candidate.version === existing.version && candidate.deletedAt < existing.deletedAt);
      if (isStronger) {
        registry.set(id, candidate);
        changed = true;
      }
    }
    return changed;
  }
}
