import { DestroyRef, Injectable, Signal, WritableSignal, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  Account,
  AccountFormModel,
  Activity,
  ActivityFormModel,
  ActivityStatus,
  ActivityType,
  Address,
  Contact,
  ContactFormModel,
  ConflictError,
  DomainRuleError,
  IndustryType,
  ISODateOnly,
  ISO8601Date,
  Opportunity,
  OpportunityFormModel,
  OpportunityStage,
  OpportunityView,
  PriorityLevel,
  StageTransitionError,
  UUID
} from '@core/models/crm.models';
import { CRM_STORAGE_KEYS } from '@core/tokens/crm-storage.token';
import { CrmStorageChange, CrmStorageService } from '@core/services/crm-storage.service';
import {
  SEED_ACCOUNTS,
  SEED_ACTIVITIES,
  SEED_CONTACTS,
  SEED_OPPORTUNITIES
} from '@core/fixtures/mock-crm-data';
import { generateId } from '@core/utils/uuid';
import {
  applyStageTransition,
  calculateExpectedRevenue,
  deriveForecastCategory,
  stageProbability,
  toLocalDateOnly,
  validateStageTransition
} from '@core/utils/pipeline-calc';

/* -------------------------------------------------------------------------- */
/* Module constants                                                            */
/* -------------------------------------------------------------------------- */

type ActivityEntityType = Activity['entityType'];

const ACCOUNT_RATINGS: readonly Account['rating'][] = ['HOT', 'WARM', 'COLD'];
const INDUSTRY_VALUES: readonly IndustryType[] = Object.values(IndustryType);
const ACTIVITY_TYPES: readonly ActivityType[] = Object.values(ActivityType);
const ACTIVITY_STATUSES: readonly ActivityStatus[] = Object.values(ActivityStatus);
const PRIORITY_VALUES: readonly PriorityLevel[] = Object.values(PriorityLevel);
const STAGE_VALUES: readonly OpportunityStage[] = Object.values(OpportunityStage);
const ACTIVITY_ENTITY_TYPES: readonly ActivityEntityType[] = ['ACCOUNT', 'OPPORTUNITY', 'CONTACT'];

/** Records created from a form that does not collect ownership are unassigned. */
const DEFAULT_OWNER_ID = 'unassigned-owner';
const DEFAULT_OWNER_NAME = 'Unassigned';

/** Fallback instant for a stored record that predates the timestamp fields. */
const BOOTSTRAP_TIMESTAMP: ISO8601Date = new Date().toISOString();

/* -------------------------------------------------------------------------- */
/* Small helpers                                                                */
/* -------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' ? value : null;
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  return typeof value === 'boolean' ? value : null;
}

function readEnum<T extends string>(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly T[]
): T | null {
  const value = record[key];
  if (typeof value !== 'string') {
    return null;
  }
  return allowed.includes(value as T) ? (value as T) : null;
}

/** A missing or malformed timestamp degrades to the bootstrap instant. */
function readTimestamp(record: Record<string, unknown>, key: string): ISO8601Date {
  return readString(record, key) ?? BOOTSTRAP_TIMESTAMP;
}

function readVersion(record: Record<string, unknown>): number {
  const value = record['version'];
  return typeof value === 'number' && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : 1;
}

/**
 * Merges a patch into an entity and drops keys the patch explicitly cleared.
 * `applyStageTransition` signals "no loss reason" with `undefined`, which has to
 * remove the property instead of leaving it present with an `undefined` value.
 */
function applyPatch<T extends object>(current: T, patch: Partial<T>): T {
  const merged: Record<string, unknown> = { ...current, ...patch };
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete merged[key];
    }
  }
  return merged as T;
}

function isTerminalStage(stage: OpportunityStage): boolean {
  return stage === OpportunityStage.CLOSED_WON || stage === OpportunityStage.CLOSED_LOST;
}

/**
 * A new opportunity never keeps a future close date on a terminal stage, and
 * never keeps an empty one: an undated deal can neither be sorted nor filtered.
 */
function normalizeCloseDate(closeDate: string, stage: OpportunityStage, today: ISODateOnly): ISODateOnly {
  const trimmed = closeDate.trim();
  if (trimmed.length === 0) {
    return today;
  }
  return isTerminalStage(stage) && trimmed > today ? today : trimmed;
}

/**
 * `COMPLETED` requires a completion timestamp and every other status forbids
 * one. Re-completing an activity that is already complete keeps its original
 * completion instant rather than pretending the work was performed again.
 */
function resolveCompletedDate(
  current: Activity,
  status: ActivityStatus,
  explicit: ISO8601Date | null | undefined
): ISO8601Date | null {
  if (status !== ActivityStatus.COMPLETED) {
    return null;
  }
  if (explicit !== undefined && explicit !== null) {
    return explicit;
  }
  return current.status === ActivityStatus.COMPLETED && current.completedDate !== null
    ? current.completedDate
    : new Date().toISOString();
}

function activityHasParent(
  activity: Activity,
  accountIds: ReadonlySet<UUID>,
  contactIds: ReadonlySet<UUID>,
  opportunityIds: ReadonlySet<UUID>
): boolean {
  switch (activity.entityType) {
    case 'ACCOUNT':
      return accountIds.has(activity.entityId);
    case 'CONTACT':
      return contactIds.has(activity.entityId);
    case 'OPPORTUNITY':
      return opportunityIds.has(activity.entityId);
  }
}

/* -------------------------------------------------------------------------- */
/* Validation of untrusted persisted payloads                                  */
/* -------------------------------------------------------------------------- */

function toAddress(raw: unknown): Address | null {
  if (!isRecord(raw)) {
    return null;
  }
  const street = readString(raw, 'street');
  const city = readString(raw, 'city');
  const state = readString(raw, 'state');
  const postalCode = readString(raw, 'postalCode');
  const country = readString(raw, 'country');
  if (street === null || city === null || state === null || postalCode === null || country === null) {
    return null;
  }
  return { street, city, state, postalCode, country };
}

function toAccount(record: Record<string, unknown>): Account | null {
  const id = readString(record, 'id');
  const name = readString(record, 'name');
  const accountNumber = readString(record, 'accountNumber');
  const industry = readEnum(record, 'industry', INDUSTRY_VALUES);
  const annualRevenue = readNumber(record, 'annualRevenue');
  const rating = readEnum(record, 'rating', ACCOUNT_RATINGS);
  const billingAddress = toAddress(record['billingAddress']);
  const shippingAddress = toAddress(record['shippingAddress']);
  if (
    id === null ||
    id.length === 0 ||
    name === null ||
    accountNumber === null ||
    industry === null ||
    annualRevenue === null ||
    rating === null ||
    billingAddress === null ||
    shippingAddress === null
  ) {
    return null;
  }
  return {
    id,
    name,
    accountNumber,
    industry,
    annualRevenue,
    phone: readString(record, 'phone') ?? '',
    website: readString(record, 'website') ?? '',
    billingAddress,
    shippingAddress,
    ownerId: readString(record, 'ownerId') ?? DEFAULT_OWNER_ID,
    ownerName: readString(record, 'ownerName') ?? DEFAULT_OWNER_NAME,
    rating,
    version: readVersion(record),
    createdAt: readTimestamp(record, 'createdAt'),
    updatedAt: readTimestamp(record, 'updatedAt')
  };
}

function toContact(record: Record<string, unknown>): Contact | null {
  const id = readString(record, 'id');
  const accountId = readString(record, 'accountId');
  const firstName = readString(record, 'firstName');
  const lastName = readString(record, 'lastName');
  if (
    id === null ||
    id.length === 0 ||
    accountId === null ||
    accountId.length === 0 ||
    firstName === null ||
    lastName === null
  ) {
    return null;
  }
  return {
    id,
    accountId,
    firstName,
    lastName,
    title: readString(record, 'title') ?? '',
    department: readString(record, 'department') ?? '',
    email: readString(record, 'email') ?? '',
    phone: readString(record, 'phone') ?? '',
    mobilePhone: readString(record, 'mobilePhone') ?? '',
    isPrimary: readBoolean(record, 'isPrimary') ?? false,
    leadSource: readString(record, 'leadSource') ?? '',
    version: readVersion(record),
    createdAt: readTimestamp(record, 'createdAt'),
    updatedAt: readTimestamp(record, 'updatedAt')
  };
}

function toOpportunity(record: Record<string, unknown>): Opportunity | null {
  const id = readString(record, 'id');
  const accountId = readString(record, 'accountId');
  const primaryContactId = readString(record, 'primaryContactId');
  const name = readString(record, 'name');
  const stage = readEnum(record, 'stage', STAGE_VALUES);
  const amount = readNumber(record, 'amount');
  if (
    id === null ||
    id.length === 0 ||
    accountId === null ||
    accountId.length === 0 ||
    primaryContactId === null ||
    primaryContactId.length === 0 ||
    name === null ||
    stage === null ||
    amount === null
  ) {
    return null;
  }
  const opportunity: Opportunity = {
    id,
    accountId,
    primaryContactId,
    name,
    stage,
    amount,
    closeDate: readString(record, 'closeDate') ?? BOOTSTRAP_TIMESTAMP.slice(0, 10),
    nextStep: readString(record, 'nextStep') ?? '',
    leadSource: readString(record, 'leadSource') ?? '',
    ownerId: readString(record, 'ownerId') ?? DEFAULT_OWNER_ID,
    ownerName: readString(record, 'ownerName') ?? DEFAULT_OWNER_NAME,
    version: readVersion(record),
    createdAt: readTimestamp(record, 'createdAt'),
    updatedAt: readTimestamp(record, 'updatedAt')
  };
  // A loss reason is only meaningful on a lost deal; drop it everywhere else.
  const lossReason = readString(record, 'lossReason');
  return stage === OpportunityStage.CLOSED_LOST && lossReason !== null
    ? { ...opportunity, lossReason }
    : opportunity;
}

function toActivity(record: Record<string, unknown>): Activity | null {
  const id = readString(record, 'id');
  const entityId = readString(record, 'entityId');
  const entityType = readEnum(record, 'entityType', ACTIVITY_ENTITY_TYPES);
  const type = readEnum(record, 'type', ACTIVITY_TYPES);
  const subject = readString(record, 'subject');
  if (
    id === null ||
    id.length === 0 ||
    entityId === null ||
    entityId.length === 0 ||
    entityType === null ||
    type === null ||
    subject === null
  ) {
    return null;
  }
  return {
    id,
    entityType,
    entityId,
    type,
    subject,
    status: readEnum(record, 'status', ACTIVITY_STATUSES) ?? ActivityStatus.NOT_STARTED,
    priority: readEnum(record, 'priority', PRIORITY_VALUES) ?? PriorityLevel.NORMAL,
    dueDate: readString(record, 'dueDate'),
    completedDate: readString(record, 'completedDate'),
    assignedToId: readString(record, 'assignedToId') ?? DEFAULT_OWNER_ID,
    assignedToName: readString(record, 'assignedToName') ?? DEFAULT_OWNER_NAME,
    notes: readString(record, 'notes') ?? '',
    version: readVersion(record),
    createdAt: readTimestamp(record, 'createdAt'),
    updatedAt: readTimestamp(record, 'updatedAt')
  };
}

/** Parses a persisted collection, dropping malformed entries and duplicate ids. */
function sanitizeCollection<T extends { id: UUID }>(
  raw: unknown,
  coerce: (record: Record<string, unknown>) => T | null
): T[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const result: T[] = [];
  const seen = new Set<UUID>();
  for (const entry of raw) {
    if (!isRecord(entry)) {
      continue;
    }
    const record = coerce(entry);
    if (record === null || seen.has(record.id)) {
      continue;
    }
    seen.add(record.id);
    result.push(record);
  }
  return result;
}

interface PrimaryNormalization {
  readonly contacts: Contact[];
  readonly changed: boolean;
}

/**
 * Restores "at most one primary contact per account" together with the
 * complementary rule that an account which has contacts always has one.
 *
 * Ranking is deterministic: an existing primary wins, otherwise the oldest
 * contact by `createdAt`, with the id as a tie-breaker. Input order is
 * preserved so list views do not reshuffle. Re-normalization deliberately does
 * not bump `version`: the flag is derived state, and a derived change must not
 * outrank a genuinely newer record during the cross-window merge.
 */
function normalizePrimaryContacts(contacts: readonly Contact[]): PrimaryNormalization {
  const buckets = new Map<UUID, Contact[]>();
  for (const contact of contacts) {
    const bucket = buckets.get(contact.accountId);
    if (bucket) {
      bucket.push(contact);
    } else {
      buckets.set(contact.accountId, [contact]);
    }
  }

  const winnerById = new Map<UUID, Contact>();
  for (const bucket of buckets.values()) {
    const ranked = [...bucket].sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) {
        return a.isPrimary ? -1 : 1;
      }
      if (a.createdAt !== b.createdAt) {
        return a.createdAt < b.createdAt ? -1 : 1;
      }
      return a.id < b.id ? -1 : 1;
    });
    ranked.forEach((contact, position) => {
      // Position 0 owns the primary flag; every other position is explicitly
      // demoted, which is what keeps two primaries from coexisting.
      const shouldBePrimary = position === 0;
      winnerById.set(
        contact.id,
        shouldBePrimary === contact.isPrimary ? contact : { ...contact, isPrimary: shouldBePrimary }
      );
    });
  }

  let changed = false;
  const normalized = contacts.map(contact => {
    const winner = winnerById.get(contact.id) ?? contact;
    if (winner.isPrimary !== contact.isPrimary) {
      changed = true;
    }
    return winner;
  });

  return { contacts: normalized, changed };
}

function toOpportunityView(opportunity: Opportunity): OpportunityView {
  return {
    ...opportunity,
    probability: stageProbability(opportunity.stage),
    expectedRevenue: calculateExpectedRevenue(opportunity.amount, opportunity.stage),
    forecastCategory: deriveForecastCategory(opportunity.stage)
  };
}

/* -------------------------------------------------------------------------- */
/* Repository                                                                   */
/* -------------------------------------------------------------------------- */

interface VersionedEntity {
  readonly id: UUID;
  readonly version: number;
  readonly updatedAt: ISO8601Date;
}

interface CollectionDescriptor<T extends VersionedEntity> {
  readonly signal: WritableSignal<readonly T[]>;
  readonly storageKey: string;
  readonly label: string;
}

/**
 * Single source of truth for CRM entities.
 *
 * - State lives in four signals, hydrated synchronously in the constructor, so
 *   the first render already has data and no view flashes a false empty state.
 * - Every mutation validates its invariants *before* touching state, so the
 *   signals always hold a valid domain snapshot.
 * - Writes are persisted through `CrmStorageService` and replicated to sibling
 *   browser windows; incoming collections are re-validated before adoption.
 * - Mutations are optimistic-concurrency checked: the caller passes the version
 *   it read, and a mismatch raises `ConflictError` instead of silently
 *   overwriting a concurrent edit.
 *
 * The service knows nothing about tabs or routing. A deleted record simply
 * disappears from state and the shell reacts to {@link allEntityIds}.
 */
@Injectable({ providedIn: 'root' })
export class CrmRepositoryService {
  private readonly storage = inject(CrmStorageService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly accountsSignal = signal<readonly Account[]>([]);
  private readonly contactsSignal = signal<readonly Contact[]>([]);
  private readonly opportunitiesSignal = signal<readonly Opportunity[]>([]);
  private readonly activitiesSignal = signal<readonly Activity[]>([]);

  private readonly accountsCollection: CollectionDescriptor<Account> = {
    signal: this.accountsSignal,
    storageKey: CRM_STORAGE_KEYS.ACCOUNTS,
    label: 'Account'
  };
  private readonly contactsCollection: CollectionDescriptor<Contact> = {
    signal: this.contactsSignal,
    storageKey: CRM_STORAGE_KEYS.CONTACTS,
    label: 'Contact'
  };
  private readonly opportunitiesCollection: CollectionDescriptor<Opportunity> = {
    signal: this.opportunitiesSignal,
    storageKey: CRM_STORAGE_KEYS.OPPORTUNITIES,
    label: 'Opportunity'
  };
  private readonly activitiesCollection: CollectionDescriptor<Activity> = {
    signal: this.activitiesSignal,
    storageKey: CRM_STORAGE_KEYS.ACTIVITIES,
    label: 'Activity'
  };

  public readonly accounts: Signal<readonly Account[]> = this.accountsSignal.asReadonly();
  public readonly contacts: Signal<readonly Contact[]> = this.contactsSignal.asReadonly();
  public readonly opportunities: Signal<readonly Opportunity[]> = this.opportunitiesSignal.asReadonly();
  public readonly activities: Signal<readonly Activity[]> = this.activitiesSignal.asReadonly();

  /** Opportunities enriched with stage probability, expected revenue and forecast roll-up. */
  public readonly opportunitiesWithDerived: Signal<OpportunityView[]> = computed(() =>
    this.opportunitiesSignal().map(toOpportunityView)
  );

  /**
   * Ids of every record that can back a workspace tab.
   *
   * Activities are excluded on purpose: they are never tab targets, so counting
   * them would only add recomposition work.
   */
  public readonly allEntityIds: Signal<Set<UUID>> = computed(() => {
    const ids = new Set<UUID>();
    for (const account of this.accountsSignal()) {
      ids.add(account.id);
    }
    for (const contact of this.contactsSignal()) {
      ids.add(contact.id);
    }
    for (const opportunity of this.opportunitiesSignal()) {
      ids.add(opportunity.id);
    }
    return ids;
  });

  constructor() {
    this.hydrate();
    this.storage.changes$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(change => this.applyExternalChange(change));
  }

  /* ---------------------------------------------------------------------- */
  /* Reads                                                                    */
  /* ---------------------------------------------------------------------- */

  public account(id: UUID): Account | undefined {
    return this.accountsSignal().find(item => item.id === id);
  }

  public contact(id: UUID): Contact | undefined {
    return this.contactsSignal().find(item => item.id === id);
  }

  public opportunity(id: UUID): Opportunity | undefined {
    return this.opportunitiesSignal().find(item => item.id === id);
  }

  public activity(id: UUID): Activity | undefined {
    return this.activitiesSignal().find(item => item.id === id);
  }

  public contactsForAccount(accountId: UUID): Contact[] {
    return this.contactsSignal()
      .filter(contact => contact.accountId === accountId)
      .slice()
      .sort((a, b) => {
        if (a.isPrimary !== b.isPrimary) {
          return a.isPrimary ? -1 : 1;
        }
        return a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName);
      });
  }

  public primaryContactFor(accountId: UUID): Contact | undefined {
    return this.contactsSignal().find(contact => contact.accountId === accountId && contact.isPrimary);
  }

  public opportunitiesForAccount(accountId: UUID): Opportunity[] {
    return this.opportunitiesSignal()
      .filter(opportunity => opportunity.accountId === accountId)
      .slice()
      .sort((a, b) => (a.closeDate < b.closeDate ? -1 : a.closeDate > b.closeDate ? 1 : 0));
  }

  /**
   * Chronological feed for one record: open work first by due date with undated
   * entries last, then completed work most recent first.
   */
  public activitiesForEntity(entityType: ActivityEntityType, entityId: UUID): Activity[] {
    return this.activitiesSignal()
      .filter(activity => activity.entityType === entityType && activity.entityId === entityId)
      .slice()
      .sort((a, b) => {
        const aDone = a.status === ActivityStatus.COMPLETED;
        const bDone = b.status === ActivityStatus.COMPLETED;
        if (aDone !== bDone) {
          return aDone ? 1 : -1;
        }
        if (aDone && bDone) {
          const aCompleted = a.completedDate ?? a.updatedAt;
          const bCompleted = b.completedDate ?? b.updatedAt;
          return aCompleted < bCompleted ? 1 : aCompleted > bCompleted ? -1 : 0;
        }
        if (a.dueDate === null && b.dueDate !== null) {
          return 1;
        }
        if (a.dueDate !== null && b.dueDate === null) {
          return -1;
        }
        if (a.dueDate === null || b.dueDate === null) {
          return 0;
        }
        return a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0;
      });
  }

  /* ---------------------------------------------------------------------- */
  /* Accounts                                                                 */
  /* ---------------------------------------------------------------------- */

  public createAccount(input: AccountFormModel): Account {
    const now = new Date().toISOString();
    const address: Address = {
      street: input.billingStreet.trim(),
      city: input.billingCity.trim(),
      state: input.billingState.trim(),
      postalCode: input.billingPostalCode.trim(),
      country: input.billingCountry.trim()
    };
    const account: Account = {
      id: generateId(),
      name: input.name.trim(),
      accountNumber: input.accountNumber.trim() || this.nextAccountNumber(),
      industry: input.industry,
      annualRevenue: input.annualRevenue,
      phone: input.phone.trim(),
      website: input.website.trim(),
      billingAddress: { ...address },
      // The creation form collects a single address; shipping starts as a copy
      // and is edited independently afterwards.
      shippingAddress: { ...address },
      ownerId: DEFAULT_OWNER_ID,
      ownerName: DEFAULT_OWNER_NAME,
      rating: input.rating,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.accountsSignal.update(items => [...items, account]);
    this.storage.save(this.accountsCollection.storageKey, this.accountsSignal());
    return account;
  }

  public updateAccount(id: UUID, patch: Partial<Account>, expectedVersion: number): Account {
    return this.updateEntity(this.accountsCollection, id, expectedVersion, current =>
      applyPatch(current, patch)
    );
  }

  /**
   * Cascade delete in the order fixed by the domain: the linked opportunities
   * (and their activities) first, then the contact activities, then the
   * contacts, and finally the account. The account's own activities go with it
   * so no activity is ever left pointing at a deleted parent. Children are
   * filtered in a single pass, so no intermediate state in which an activity
   * outlives its parent is observable to a subscriber.
   */
  public deleteAccount(id: UUID): void {
    this.requireEntity(this.accountsCollection, id);

    const opportunityIds = new Set(
      this.opportunitiesSignal()
        .filter(opportunity => opportunity.accountId === id)
        .map(opportunity => opportunity.id)
    );
    const contactIds = new Set(
      this.contactsSignal()
        .filter(contact => contact.accountId === id)
        .map(contact => contact.id)
    );

    // Step 1 and 2: activities of the account itself, of the linked
    // opportunities, and of the contacts.
    const survivingActivities = this.activitiesSignal().filter(
      activity =>
        !(activity.entityType === 'ACCOUNT' && activity.entityId === id) &&
        !(activity.entityType === 'OPPORTUNITY' && opportunityIds.has(activity.entityId)) &&
        !(activity.entityType === 'CONTACT' && contactIds.has(activity.entityId))
    );
    // Step 1: the opportunities themselves.
    const survivingOpportunities = this.opportunitiesSignal().filter(
      opportunity => opportunity.accountId !== id
    );
    // Step 3: the contacts.
    const survivingContacts = this.contactsSignal().filter(contact => contact.accountId !== id);
    // Step 4: the account.
    const survivingAccounts = this.accountsSignal().filter(account => account.id !== id);

    this.activitiesSignal.set(survivingActivities);
    this.opportunitiesSignal.set(survivingOpportunities);
    this.contactsSignal.set(survivingContacts);
    this.accountsSignal.set(survivingAccounts);

    this.storage.save(this.activitiesCollection.storageKey, survivingActivities);
    this.storage.save(this.opportunitiesCollection.storageKey, survivingOpportunities);
    this.storage.save(this.contactsCollection.storageKey, survivingContacts);
    this.storage.save(this.accountsCollection.storageKey, survivingAccounts);
  }

  /* ---------------------------------------------------------------------- */
  /* Contacts                                                                 */
  /* ---------------------------------------------------------------------- */

  public createContact(input: ContactFormModel): Contact {
    this.requireEntity(this.accountsCollection, input.accountId);
    const now = new Date().toISOString();
    const contact: Contact = {
      id: generateId(),
      accountId: input.accountId,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      title: input.title.trim(),
      department: input.department.trim(),
      email: input.email.trim(),
      phone: input.phone.trim(),
      mobilePhone: input.mobilePhone.trim(),
      isPrimary: input.isPrimary,
      leadSource: input.leadSource.trim(),
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.contactsSignal.update(items => [...items, contact]);
    // The first contact of an account is promoted automatically, and promoting
    // one demotes its siblings, inside this same signal update.
    this.normalizePrimariesForAccount(input.accountId);
    this.storage.save(this.contactsCollection.storageKey, this.contactsSignal());
    return this.contact(contact.id) ?? contact;
  }

  public updateContact(id: UUID, patch: Partial<Contact>, expectedVersion: number): Contact {
    const previous = this.requireEntity(this.contactsCollection, id);
    const updated = this.updateEntity(this.contactsCollection, id, expectedVersion, current => {
      if (patch.accountId !== undefined && patch.accountId !== current.accountId) {
        this.requireEntity(this.accountsCollection, patch.accountId);
      }
      return applyPatch(current, patch);
    });

    const moved = updated.accountId !== previous.accountId;
    let repaired = false;
    if (patch.isPrimary === true) {
      repaired = this.normalizePrimariesForAccount(updated.accountId);
    } else if (moved) {
      // Moving a contact re-runs the invariant on both sides of the move.
      repaired =
        this.normalizePrimariesForAccount(previous.accountId) ||
        this.normalizePrimariesForAccount(updated.accountId);
    }
    if (repaired) {
      this.storage.save(this.contactsCollection.storageKey, this.contactsSignal());
    }
    return this.contact(id) ?? updated;
  }

  /** Promotes or demotes a contact while preserving the account's single primary. */
  public setContactPrimary(id: UUID, isPrimary: boolean, expectedVersion: number): Contact {
    return this.updateContact(id, { isPrimary }, expectedVersion);
  }

  /**
   * Deletes a contact and cascades its activities. Blocked while any
   * opportunity still references the contact as its primary contact: that
   * opportunity has to be repointed or deleted first.
   */
  public deleteContact(id: UUID): void {
    const contact = this.requireEntity(this.contactsCollection, id);
    const referencing = this.opportunitiesSignal().find(
      opportunity => opportunity.primaryContactId === id
    );
    if (referencing) {
      throw new DomainRuleError(
        `Contact ${id} cannot be deleted because opportunity "${referencing.name}" uses it as its primary contact.`
      );
    }

    const survivingActivities = this.activitiesSignal().filter(
      activity => !(activity.entityType === 'CONTACT' && activity.entityId === id)
    );
    this.activitiesSignal.set(survivingActivities);
    this.contactsSignal.set(this.contactsSignal().filter(item => item.id !== id));
    // Removing the primary promotes the oldest remaining contact of the account.
    this.normalizePrimariesForAccount(contact.accountId);

    this.storage.save(this.activitiesCollection.storageKey, survivingActivities);
    this.storage.save(this.contactsCollection.storageKey, this.contactsSignal());
  }

  /* ---------------------------------------------------------------------- */
  /* Opportunities                                                            */
  /* ---------------------------------------------------------------------- */

  public createOpportunity(input: OpportunityFormModel): Opportunity {
    this.assertOpportunityLinkage(input.accountId, input.primaryContactId);
    if (input.stage === OpportunityStage.CLOSED_LOST && !input.lossReason?.trim()) {
      throw new StageTransitionError('Loss reason is mandatory when marking Closed Lost.');
    }

    const account = this.requireEntity(this.accountsCollection, input.accountId);
    const now = new Date().toISOString();
    const opportunity: Opportunity = {
      id: generateId(),
      accountId: input.accountId,
      primaryContactId: input.primaryContactId,
      name: input.name.trim(),
      stage: input.stage,
      amount: input.amount,
      closeDate: normalizeCloseDate(input.closeDate, input.stage, toLocalDateOnly()),
      nextStep: input.nextStep.trim(),
      leadSource: input.leadSource.trim(),
      // A new opportunity starts under the account owner unless reassigned later.
      ownerId: account.ownerId,
      ownerName: account.ownerName,
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    const stored: Opportunity =
      input.stage === OpportunityStage.CLOSED_LOST
        ? { ...opportunity, lossReason: input.lossReason?.trim() }
        : opportunity;

    this.opportunitiesSignal.update(items => [...items, stored]);
    this.storage.save(this.opportunitiesCollection.storageKey, this.opportunitiesSignal());
    return stored;
  }

  /**
   * Generic opportunity patch. A stage change routed through here is validated
   * exactly like {@link updateOpportunityStage}, so the dedicated method cannot
   * be bypassed by sending a patch instead.
   */
  public updateOpportunity(id: UUID, patch: Partial<Opportunity>, expectedVersion: number): Opportunity {
    return this.updateEntity(this.opportunitiesCollection, id, expectedVersion, current => {
      const accountId = patch.accountId ?? current.accountId;
      const primaryContactId = patch.primaryContactId ?? current.primaryContactId;
      this.assertOpportunityLinkage(accountId, primaryContactId);

      if (patch.stage !== undefined && patch.stage !== current.stage) {
        const validation = validateStageTransition(current.stage, patch.stage, patch.lossReason);
        if (!validation.valid) {
          throw new StageTransitionError(validation.reason ?? 'Invalid stage transition.');
        }
      }
      return applyPatch(current, { ...patch, accountId, primaryContactId });
    });
  }

  /**
   * Moves an opportunity through the pipeline, applying the terminal-stage date
   * and loss-reason rules of `applyStageTransition`.
   *
   * @throws StageTransitionError when the target stage is illegal.
   * @throws ConflictError when `expectedVersion` is stale.
   */
  public updateOpportunityStage(
    id: UUID,
    stage: OpportunityStage,
    expectedVersion: number,
    lossReason?: string
  ): Opportunity {
    return this.updateEntity(this.opportunitiesCollection, id, expectedVersion, current => {
      const validation = validateStageTransition(current.stage, stage, lossReason);
      if (!validation.valid) {
        throw new StageTransitionError(validation.reason ?? 'Invalid stage transition.');
      }
      const transition = applyStageTransition(current, stage, toLocalDateOnly(), lossReason);
      return applyPatch(current, transition);
    });
  }

  /** Deletes an opportunity and cascades its activities. */
  public deleteOpportunity(id: UUID): void {
    this.requireEntity(this.opportunitiesCollection, id);

    const survivingActivities = this.activitiesSignal().filter(
      activity => !(activity.entityType === 'OPPORTUNITY' && activity.entityId === id)
    );
    const survivingOpportunities = this.opportunitiesSignal().filter(item => item.id !== id);

    this.activitiesSignal.set(survivingActivities);
    this.opportunitiesSignal.set(survivingOpportunities);

    this.storage.save(this.activitiesCollection.storageKey, survivingActivities);
    this.storage.save(this.opportunitiesCollection.storageKey, survivingOpportunities);
  }

  /* ---------------------------------------------------------------------- */
  /* Activities                                                               */
  /* ---------------------------------------------------------------------- */

  public createActivity(input: ActivityFormModel): Activity {
    this.requireActivityParent(input.entityType, input.entityId);
    const now = new Date().toISOString();
    // A note records something that already happened: it carries no due date and
    // is complete from the moment it is filed.
    const isNote = input.type === ActivityType.NOTE;
    const status = isNote ? ActivityStatus.COMPLETED : input.status;
    const assignedToName = input.assignedToName.trim() || DEFAULT_OWNER_NAME;
    const activity: Activity = {
      id: generateId(),
      entityType: input.entityType,
      entityId: input.entityId,
      type: input.type,
      subject: input.subject.trim(),
      status,
      priority: input.priority,
      dueDate: isNote ? null : input.dueDate,
      completedDate: status === ActivityStatus.COMPLETED ? now : null,
      assignedToId: this.resolveAssigneeId(assignedToName),
      assignedToName,
      notes: input.notes.trim(),
      version: 1,
      createdAt: now,
      updatedAt: now
    };
    this.activitiesSignal.update(items => [...items, activity]);
    this.storage.save(this.activitiesCollection.storageKey, this.activitiesSignal());
    return activity;
  }

  public updateActivity(id: UUID, patch: Partial<Activity>, expectedVersion: number): Activity {
    return this.updateEntity(this.activitiesCollection, id, expectedVersion, current => {
      const next: Partial<Activity> = { ...patch };
      if (patch.status !== undefined) {
        next.completedDate = resolveCompletedDate(current, patch.status, patch.completedDate);
      }
      return applyPatch(current, next);
    });
  }

  /**
   * Sets the activity status and keeps `completedDate` consistent: completing
   * stamps the moment, leaving the completed state clears it.
   */
  public setActivityStatus(id: UUID, status: ActivityStatus, expectedVersion: number): Activity {
    return this.updateEntity(this.activitiesCollection, id, expectedVersion, current => ({
      ...current,
      status,
      completedDate: resolveCompletedDate(current, status, null)
    }));
  }

  /** Check-to-complete toggle used by the activity timeline. */
  public toggleActivityCompletion(id: UUID, completed: boolean, expectedVersion: number): Activity {
    return this.setActivityStatus(
      id,
      completed ? ActivityStatus.COMPLETED : ActivityStatus.IN_PROGRESS,
      expectedVersion
    );
  }

  public deleteActivity(id: UUID): void {
    this.requireEntity(this.activitiesCollection, id);
    const surviving = this.activitiesSignal().filter(item => item.id !== id);
    this.activitiesSignal.set(surviving);
    this.storage.save(this.activitiesCollection.storageKey, surviving);
  }

  /* ---------------------------------------------------------------------- */
  /* Internals                                                                */
  /* ---------------------------------------------------------------------- */

  /**
   * Applies an optimistic-concurrency checked update.
   *
   * The version and timestamp are stamped after the patch, so a caller can never
   * forge them. A stale `expectedVersion` raises `ConflictError` and leaves state
   * untouched.
   */
  private updateEntity<T extends VersionedEntity>(
    collection: CollectionDescriptor<T>,
    id: UUID,
    expectedVersion: number,
    mutator: (current: T) => T
  ): T {
    const current = this.requireEntity(collection, id);
    if (current.version !== expectedVersion) {
      throw new ConflictError(
        `${collection.label} ${id} was modified elsewhere: expected version ${expectedVersion}, found ${current.version}.`
      );
    }
    const patched = mutator(current);
    // The cast re-establishes the generic the spread erases; both extra fields
    // are provably `T`-compatible because `T extends VersionedEntity`.
    const next = {
      ...patched,
      version: current.version + 1,
      updatedAt: new Date().toISOString()
    } as T;

    const nextItems = collection.signal().map(item => (item.id === id ? next : item));
    collection.signal.set(nextItems);
    this.storage.save(collection.storageKey, nextItems);
    return next;
  }

  private requireEntity<T extends VersionedEntity>(collection: CollectionDescriptor<T>, id: UUID): T {
    const found = collection.signal().find(item => item.id === id);
    if (!found) {
      throw new DomainRuleError(`${collection.label} ${id} does not exist.`);
    }
    return found;
  }

  private assertOpportunityLinkage(accountId: UUID, contactId: UUID): void {
    this.requireEntity(this.accountsCollection, accountId);
    const contact = this.requireEntity(this.contactsCollection, contactId);
    if (contact.accountId !== accountId) {
      throw new DomainRuleError(
        `Contact ${contactId} does not belong to account ${accountId}: the primary contact must come from the selected account.`
      );
    }
  }

  private requireActivityParent(entityType: ActivityEntityType, entityId: UUID): void {
    switch (entityType) {
      case 'ACCOUNT':
        this.requireEntity(this.accountsCollection, entityId);
        return;
      case 'CONTACT':
        this.requireEntity(this.contactsCollection, entityId);
        return;
      case 'OPPORTUNITY':
        this.requireEntity(this.opportunitiesCollection, entityId);
        return;
    }
  }

  /**
   * Re-applies the single-primary rule to one account.
   *
   * @returns `true` when the contact collection was rewritten.
   */
  private normalizePrimariesForAccount(accountId: UUID): boolean {
    const all = this.contactsSignal();
    const bucket = all.filter(contact => contact.accountId === accountId);
    const { contacts: normalized, changed } = normalizePrimaryContacts(bucket);
    if (!changed) {
      return false;
    }
    const byId = new Map(normalized.map(contact => [contact.id, contact]));
    this.contactsSignal.set(all.map(contact => byId.get(contact.id) ?? contact));
    return true;
  }

  /** Resolves an assignee name to a known owner id, or the unassigned marker. */
  private resolveAssigneeId(name: string): UUID {
    const owner = this.accountsSignal().find(account => account.ownerName === name);
    return owner ? owner.ownerId : DEFAULT_OWNER_ID;
  }

  private nextAccountNumber(): string {
    const highest = this.accountsSignal().reduce((max, account) => {
      const suffix = Number.parseInt(account.accountNumber.replace(/\D+/g, ''), 10);
      return Number.isFinite(suffix) && suffix > max ? suffix : max;
    }, 1000);
    return `ACC-${highest + 1}`;
  }

  /* ---------------------------------------------------------------------- */
  /* Hydration and cross-window convergence                                  */
  /* ---------------------------------------------------------------------- */

  /**
   * Reads persisted state synchronously. A first run (no collections at all) is
   * seeded; otherwise the stored payload is validated, repaired where it
   * references a missing parent, and written back when the repair changed it.
   */
  private hydrate(): void {
    this.storage.migrate();

    const accounts = this.storage.load<unknown>(CRM_STORAGE_KEYS.ACCOUNTS);
    const contacts = this.storage.load<unknown>(CRM_STORAGE_KEYS.CONTACTS);
    const opportunities = this.storage.load<unknown>(CRM_STORAGE_KEYS.OPPORTUNITIES);
    const activities = this.storage.load<unknown>(CRM_STORAGE_KEYS.ACTIVITIES);
    const isFirstRun =
      accounts === null && contacts === null && opportunities === null && activities === null;

    if (isFirstRun) {
      this.accountsSignal.set([...SEED_ACCOUNTS]);
      this.contactsSignal.set([...SEED_CONTACTS]);
      this.opportunitiesSignal.set([...SEED_OPPORTUNITIES]);
      this.activitiesSignal.set([...SEED_ACTIVITIES]);
      this.persistAll();
      return;
    }

    this.accountsSignal.set(sanitizeCollection(accounts, toAccount));
    this.contactsSignal.set(sanitizeCollection(contacts, toContact));
    this.opportunitiesSignal.set(sanitizeCollection(opportunities, toOpportunity));
    this.activitiesSignal.set(sanitizeCollection(activities, toActivity));
    this.repairRelations();
  }

  /**
   * Adopts a collection written by another browser window, then re-runs the
   * relational repair so a delete in one window cannot leave this window holding
   * a contact whose account is gone.
   */
  private applyExternalChange(change: CrmStorageChange): void {
    switch (change.key) {
      case CRM_STORAGE_KEYS.ACCOUNTS: {
        // This window's own write echoes back with the identical array.
        if (change.value === this.accountsSignal()) {
          return;
        }
        this.accountsSignal.set(sanitizeCollection(change.value, toAccount));
        this.repairRelations();
        return;
      }
      case CRM_STORAGE_KEYS.CONTACTS: {
        if (change.value === this.contactsSignal()) {
          return;
        }
        this.contactsSignal.set(sanitizeCollection(change.value, toContact));
        this.repairRelations();
        return;
      }
      case CRM_STORAGE_KEYS.OPPORTUNITIES: {
        if (change.value === this.opportunitiesSignal()) {
          return;
        }
        this.opportunitiesSignal.set(sanitizeCollection(change.value, toOpportunity));
        this.repairRelations();
        return;
      }
      case CRM_STORAGE_KEYS.ACTIVITIES: {
        if (change.value === this.activitiesSignal()) {
          return;
        }
        this.activitiesSignal.set(sanitizeCollection(change.value, toActivity));
        this.repairRelations();
        return;
      }
      default:
        return;
    }
  }

  /**
   * Drops records whose parent no longer exists and restores the primary-contact
   * invariant. Repairs are persisted immediately so this window's store stays
   * the converged truth instead of drifting from the other window's copy.
   */
  private repairRelations(): void {
    const accountIds = new Set(this.accountsSignal().map(account => account.id));

    const currentContacts = this.contactsSignal();
    const reachableContacts = currentContacts.filter(contact => accountIds.has(contact.accountId));
    const { contacts: normalizedContacts, changed: primariesRepaired } =
      normalizePrimaryContacts(reachableContacts);
    const contactsRepaired = primariesRepaired || normalizedContacts.length !== currentContacts.length;

    const contactIds = new Set(normalizedContacts.map(contact => contact.id));
    const currentOpportunities = this.opportunitiesSignal();
    const survivingOpportunities = currentOpportunities.filter(
      opportunity =>
        accountIds.has(opportunity.accountId) && contactIds.has(opportunity.primaryContactId)
    );

    const opportunityIds = new Set(survivingOpportunities.map(opportunity => opportunity.id));
    const currentActivities = this.activitiesSignal();
    const survivingActivities = currentActivities.filter(activity =>
      activityHasParent(activity, accountIds, contactIds, opportunityIds)
    );

    if (contactsRepaired) {
      this.contactsSignal.set(normalizedContacts);
      this.storage.save(this.contactsCollection.storageKey, normalizedContacts);
    }
    if (survivingOpportunities.length !== currentOpportunities.length) {
      this.opportunitiesSignal.set(survivingOpportunities);
      this.storage.save(this.opportunitiesCollection.storageKey, survivingOpportunities);
    }
    if (survivingActivities.length !== currentActivities.length) {
      this.activitiesSignal.set(survivingActivities);
      this.storage.save(this.activitiesCollection.storageKey, survivingActivities);
    }
  }

  private persistAll(): void {
    this.storage.save(this.accountsCollection.storageKey, this.accountsSignal());
    this.storage.save(this.contactsCollection.storageKey, this.contactsSignal());
    this.storage.save(this.opportunitiesCollection.storageKey, this.opportunitiesSignal());
    this.storage.save(this.activitiesCollection.storageKey, this.activitiesSignal());
  }
}
