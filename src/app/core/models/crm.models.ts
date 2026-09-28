/**
 * Canonical CRM domain schema.
 *
 * Every mutable entity carries a `version` field. The repository increments it
 * on each successful mutation; it is used for stale-write detection in a single
 * tab and for last-writer-wins arbitration across browser tabs.
 */

export type UUID = string;
export type ISO8601Date = string;
/** Calendar date without a time component, formatted as `YYYY-MM-DD`. */
export type ISODateOnly = string;

export enum OpportunityStage {
  PROSPECTING = 'PROSPECTING',
  QUALIFICATION = 'QUALIFICATION',
  NEEDS_ANALYSIS = 'NEEDS_ANALYSIS',
  VALUE_PROPOSITION = 'VALUE_PROPOSITION',
  DECISION_MAKERS = 'DECISION_MAKERS',
  NEGOTIATION = 'NEGOTIATION',
  CLOSED_WON = 'CLOSED_WON',
  CLOSED_LOST = 'CLOSED_LOST'
}

export enum ForecastCategory {
  PIPELINE = 'PIPELINE',
  BEST_CASE = 'BEST_CASE',
  COMMIT = 'COMMIT',
  CLOSED = 'CLOSED',
  OMITTED = 'OMITTED'
}

export enum ActivityType {
  TASK = 'TASK',
  CALL = 'CALL',
  MEETING = 'MEETING',
  EMAIL = 'EMAIL',
  NOTE = 'NOTE'
}

export enum PriorityLevel {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
  CRITICAL = 'CRITICAL'
}

export enum ActivityStatus {
  NOT_STARTED = 'NOT_STARTED',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
  DEFERRED = 'DEFERRED'
}

export enum IndustryType {
  FINANCIAL_SERVICES = 'FINANCIAL_SERVICES',
  HEALTHCARE = 'HEALTHCARE',
  TECHNOLOGY = 'TECHNOLOGY',
  MANUFACTURING = 'MANUFACTURING',
  RETAIL = 'RETAIL',
  ENERGY = 'ENERGY',
  CONSULTING = 'CONSULTING'
}

/**
 * Icon keys registered in `appConfig` and resolved by `<span nz-icon>`.
 *
 * This list and `APP_ICONS` in `app.config.ts` must stay in step: an icon that
 * is registered but absent here cannot be typed as a `SupportedIcon`, and
 * `WorkspaceTabService` sanitises persisted tabs against this list, so a key
 * missing here would also make that tab icon unpersistable.
 */
export const ICON_NAMES = [
  'dashboard',
  'team',
  'dollar',
  'calendar',
  'file-text',
  'plus',
  'search',
  'close',
  'filter',
  'menu',
  'edit',
  'delete',
  'down',
  'check-circle',
  'clock-circle',
  'right'
] as const;

export type SupportedIcon = typeof ICON_NAMES[number];

/** Raised when a mutation targets a record version that is no longer current. */
export class ConflictError extends Error {
  constructor(message = 'Version conflict encountered while updating record.') {
    super(message);
    this.name = 'ConflictError';
  }
}

/** Raised when an opportunity stage transition violates a domain rule. */
export class StageTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageTransitionError';
  }
}

/**
 * Raised when a mutation is well-formed but violates a relational invariant,
 * for example deleting a contact that an opportunity still references.
 *
 * Distinct from `ConflictError`, which reports a stale `version`, and from
 * `StageTransitionError`, which reports an illegal stage change. Callers can
 * therefore discriminate the three failure modes without string matching.
 */
export class DomainRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DomainRuleError';
  }
}

export interface Address {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface Account {
  id: UUID;
  name: string;
  accountNumber: string;
  industry: IndustryType;
  annualRevenue: number;
  phone: string;
  website: string;
  billingAddress: Address;
  shippingAddress: Address;
  ownerId: UUID;
  ownerName: string;
  rating: 'HOT' | 'WARM' | 'COLD';
  version: number;
  createdAt: ISO8601Date;
  updatedAt: ISO8601Date;
}

export interface Contact {
  id: UUID;
  accountId: UUID;
  firstName: string;
  lastName: string;
  title: string;
  department: string;
  email: string;
  phone: string;
  mobilePhone: string;
  isPrimary: boolean;
  leadSource: string;
  version: number;
  createdAt: ISO8601Date;
  updatedAt: ISO8601Date;
}

export interface Opportunity {
  id: UUID;
  accountId: UUID;
  primaryContactId: UUID;
  name: string;
  stage: OpportunityStage;
  amount: number;
  closeDate: ISODateOnly;
  nextStep: string;
  leadSource: string;
  lossReason?: string;
  ownerId: UUID;
  ownerName: string;
  version: number;
  createdAt: ISO8601Date;
  updatedAt: ISO8601Date;
}

export interface OpportunityView extends Opportunity {
  probability: number;
  expectedRevenue: number;
  forecastCategory: ForecastCategory;
}

export interface Activity {
  id: UUID;
  entityType: 'ACCOUNT' | 'OPPORTUNITY' | 'CONTACT';
  entityId: UUID;
  type: ActivityType;
  subject: string;
  status: ActivityStatus;
  priority: PriorityLevel;
  dueDate: ISO8601Date | null;
  completedDate: ISO8601Date | null;
  assignedToId: UUID;
  assignedToName: string;
  notes: string;
  version: number;
  createdAt: ISO8601Date;
  updatedAt: ISO8601Date;
}

export interface WorkspaceTab {
  id: string;
  title: string;
  entityType: 'ACCOUNT' | 'OPPORTUNITY' | 'LIST' | 'DASHBOARD';
  entityId: UUID | null;
  listKey?: 'accounts' | 'opportunities';
  icon: SupportedIcon;
  isDirty: boolean;
  closable: boolean;
  activeSubTabKey: string;
}

export interface FilterCriterion {
  field: string;
  operator: 'equals' | 'contains' | 'greaterThan' | 'lessThan' | 'in' | 'isEmpty' | 'isNotEmpty';
  value?: string | number | boolean | string[] | null;
}

export interface SortCriterion {
  field: string;
  direction: 'asc' | 'desc';
}

export interface EntityQueryOptions {
  pageIndex: number;
  pageSize: number;
  sort: SortCriterion[];
  filters: FilterCriterion[];
}

export interface PaginatedResult<T> {
  items: T[];
  totalCount: number;
  pageIndex: number;
  pageSize: number;
}

export interface AccountFormModel {
  name: string;
  accountNumber: string;
  industry: IndustryType;
  annualRevenue: number;
  phone: string;
  website: string;
  rating: 'HOT' | 'WARM' | 'COLD';
  billingStreet: string;
  billingCity: string;
  billingState: string;
  billingPostalCode: string;
  billingCountry: string;
}

export interface ContactFormModel {
  accountId: UUID;
  firstName: string;
  lastName: string;
  title: string;
  department: string;
  email: string;
  phone: string;
  mobilePhone: string;
  isPrimary: boolean;
  leadSource: string;
}

export interface OpportunityFormModel {
  name: string;
  accountId: UUID;
  primaryContactId: UUID;
  stage: OpportunityStage;
  amount: number;
  closeDate: string;
  nextStep: string;
  leadSource: string;
  lossReason?: string;
}

export interface ActivityFormModel {
  entityType: 'ACCOUNT' | 'OPPORTUNITY' | 'CONTACT';
  entityId: UUID;
  type: ActivityType;
  subject: string;
  status: ActivityStatus;
  priority: PriorityLevel;
  dueDate: string | null;
  assignedToName: string;
  notes: string;
}
