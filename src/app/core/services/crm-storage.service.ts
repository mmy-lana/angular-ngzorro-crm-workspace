import { DestroyRef, Injectable, inject } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { CRM_STORAGE_KEYS, LOCAL_STORAGE } from '@core/tokens/crm-storage.token';
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
 * Last-writer-wins merge keyed on `id`. Records are compared by `version`;
 * ties keep the value already present in this window so that two tabs writing
 * simultaneously do not ping-pong the same payload back and forth.
 */
function mergeByVersion(current: unknown, incoming: unknown): unknown {
  if (!Array.isArray(current) || !Array.isArray(incoming)) {
    return incoming;
  }

  const merged = new Map<string, Record<string, unknown>>();
  const order: string[] = [];

  const register = (record: Record<string, unknown>): void => {
    const id = record['id'] as string;
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
    const envelope: SyncEnvelope = { key, value, origin: this.instanceId };
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
    const { key, value, origin } = envelope as unknown as SyncEnvelope;
    if (typeof key !== 'string' || origin === this.instanceId) {
      return;
    }

    const merged = mergeByVersion(this.load<unknown>(key), value);
    this.writeRaw(key, JSON.stringify(merged));
    this.changeSubject.next({ key, value: merged });
  }
}
