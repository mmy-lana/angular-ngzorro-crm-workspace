/**
 * Seed dataset for the first application bootstrap.
 *
 * Determinism policy
 * ------------------
 * *Identity is fixed.* Every record id is derived from a stable FNV-1a hash of a
 * literal key (`account:1`, `contact:17`, ...), so the same build always
 * produces the same UUIDs. Two browser windows therefore agree on entity ids,
 * which is what makes the cross-window version merge in `CrmStorageService`
 * meaningful, and it keeps the dataset reviewable in a code diff.
 *
 * *Time is relative.* Dates are anchored to the moment this module is first
 * evaluated, so the dashboard always shows live close dates, a mix of overdue
 * and completed work, and a plausible rolling pipeline instead of a snapshot
 * that decays into nonsense.
 *
 * The dataset satisfies the relational invariants of the domain (see
 * `crm.models.ts` §1.3): exactly one primary contact per account, every
 * opportunity whose `primaryContactId` belongs to its own `accountId`, and
 * activity `status` consistent with `completedDate`.
 */

import {
  Account,
  Activity,
  ActivityStatus,
  ActivityType,
  Contact,
  IndustryType,
  ISO8601Date,
  ISODateOnly,
  Opportunity,
  OpportunityStage,
  PriorityLevel,
  UUID
} from '@core/models/crm.models';
import { toLocalDateOnly } from '@core/utils/pipeline-calc';

/* -------------------------------------------------------------------------- */
/* Deterministic identity                                                      */
/* -------------------------------------------------------------------------- */

/** 32-bit FNV-1a. Chosen for stable cross-engine output, not for security. */
function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hexSegment(value: number, length: number): string {
  return (value >>> 0).toString(16).padStart(length, '0').slice(-length);
}

/**
 * Builds an RFC 4122 version 4 shaped identifier from a literal key. The version
 * nibble is `4` and the variant nibble sits in `[89ab]`, matching the output of
 * `generateId()`, so seeded and runtime-generated ids are indistinguishable.
 */
function seedUuid(key: string): UUID {
  const primary = fnv1a(key);
  const secondary = fnv1a(`${key}#variant`);
  return [
    hexSegment(primary, 8),
    hexSegment(primary >>> 7, 4),
    `4${hexSegment(secondary >>> 11, 3)}`,
    `${(((primary >>> 13) & 0x3) | 0x8).toString(16)}${hexSegment(secondary >>> 3, 3)}`,
    hexSegment(primary ^ secondary, 12)
  ].join('-');
}

/* -------------------------------------------------------------------------- */
/* Relative date helpers                                                       */
/* -------------------------------------------------------------------------- */

function shifted(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

/** `YYYY-MM-DD`, `days` in the future when positive. */
function dayOffset(days: number): ISODateOnly {
  return toLocalDateOnly(shifted(days));
}

/** Full ISO-8601 timestamp, `days` in the past when positive. */
function daysAgo(days: number): ISO8601Date {
  return shifted(-days).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Sales owners                                                                */
/* -------------------------------------------------------------------------- */

const OWNER_NAMES: readonly string[] = [
  'Dana Whitfield',
  'Marcus Oyelaran',
  'Priya Raghunathan',
  'Tomas Lindqvist',
  'Aiko Nakamura'
];

function ownerId(index: number): UUID {
  return seedUuid(`owner:${index + 1}`);
}

function requireOwnerName(index: number): string {
  const name = OWNER_NAMES[index];
  if (name === undefined) {
    throw new Error(`Seed owner index ${index} is outside the owner table.`);
  }
  return name;
}

function requireOwnerIndex(index: number): number {
  if (index < 0 || index >= OWNER_NAMES.length) {
    throw new Error(`Seed owner index ${index} is outside the owner table.`);
  }
  return index;
}

/* -------------------------------------------------------------------------- */
/* Accounts                                                                    */
/* -------------------------------------------------------------------------- */

interface AddressSeed {
  readonly street: string;
  readonly city: string;
  readonly state: string;
  readonly postalCode: string;
  readonly country: string;
}

interface AccountSeed {
  readonly name: string;
  readonly accountNumber: string;
  readonly industry: IndustryType;
  readonly annualRevenue: number;
  readonly phone: string;
  readonly website: string;
  readonly domain: string;
  readonly rating: Account['rating'];
  readonly ownerIndex: number;
  readonly billing: AddressSeed;
  readonly shipping: AddressSeed;
  readonly createdDaysAgo: number;
  readonly updatedDaysAgo: number;
}

const ACCOUNT_SEEDS: readonly AccountSeed[] = [
  {
    name: 'Northwind Traders',
    accountNumber: 'ACC-1001',
    industry: IndustryType.RETAIL,
    annualRevenue: 48_500_000,
    phone: '+1-555-0101',
    website: 'https://northwindtraders.example.com',
    domain: 'northwindtraders.example.com',
    rating: 'WARM',
    ownerIndex: 0,
    billing: { street: '1120 Harborview Plaza', city: 'Seattle', state: 'WA', postalCode: '98101', country: 'United States' },
    shipping: { street: '4400 Southbay Logistics Pkwy', city: 'Kent', state: 'WA', postalCode: '98032', country: 'United States' },
    createdDaysAgo: 812,
    updatedDaysAgo: 5
  },
  {
    name: 'Helix Bioscience',
    accountNumber: 'ACC-1002',
    industry: IndustryType.HEALTHCARE,
    annualRevenue: 312_000_000,
    phone: '+1-555-0102',
    website: 'https://helixbioscience.example.com',
    domain: 'helixbioscience.example.com',
    rating: 'HOT',
    ownerIndex: 1,
    billing: { street: '88 Cambridge Research Loop', city: 'Boston', state: 'MA', postalCode: '02142', country: 'United States' },
    shipping: { street: '88 Cambridge Research Loop', city: 'Boston', state: 'MA', postalCode: '02142', country: 'United States' },
    createdDaysAgo: 640,
    updatedDaysAgo: 2
  },
  {
    name: 'Cascade Logistics',
    accountNumber: 'ACC-1003',
    industry: IndustryType.MANUFACTURING,
    annualRevenue: 128_400_000,
    phone: '+1-555-0103',
    website: 'https://cascadelogistics.example.com',
    domain: 'cascadelogistics.example.com',
    rating: 'WARM',
    ownerIndex: 2,
    billing: { street: '700 Willamette Yard Road', city: 'Portland', state: 'OR', postalCode: '97209', country: 'United States' },
    shipping: { street: '3300 Columbia Terminal Way', city: 'Vancouver', state: 'WA', postalCode: '98660', country: 'United States' },
    createdDaysAgo: 455,
    updatedDaysAgo: 21
  },
  {
    name: 'Meridian Capital Partners',
    accountNumber: 'ACC-1004',
    industry: IndustryType.FINANCIAL_SERVICES,
    annualRevenue: 940_000_000,
    phone: '+1-555-0104',
    website: 'https://meridiancapital.example.com',
    domain: 'meridiancapital.example.com',
    rating: 'HOT',
    ownerIndex: 3,
    billing: { street: '1 Liberty Plaza, Floor 41', city: 'New York', state: 'NY', postalCode: '10006', country: 'United States' },
    shipping: { street: '1 Liberty Plaza, Floor 41', city: 'New York', state: 'NY', postalCode: '10006', country: 'United States' },
    createdDaysAgo: 980,
    updatedDaysAgo: 1
  },
  {
    name: 'Vireo Software',
    accountNumber: 'ACC-1005',
    industry: IndustryType.TECHNOLOGY,
    annualRevenue: 27_600_000,
    phone: '+1-555-0105',
    website: 'https://vireosoftware.example.com',
    domain: 'vireosoftware.example.com',
    rating: 'HOT',
    ownerIndex: 0,
    billing: { street: '2250 Bandley Avenue', city: 'Austin', state: 'TX', postalCode: '78701', country: 'United States' },
    shipping: { street: '2250 Bandley Avenue', city: 'Austin', state: 'TX', postalCode: '78701', country: 'United States' },
    createdDaysAgo: 268,
    updatedDaysAgo: 7
  },
  {
    name: 'Ironbark Manufacturing',
    accountNumber: 'ACC-1006',
    industry: IndustryType.MANUFACTURING,
    annualRevenue: 76_900_000,
    phone: '+1-555-0106',
    website: 'https://ironbarkmfg.example.com',
    domain: 'ironbarkmfg.example.com',
    rating: 'COLD',
    ownerIndex: 4,
    billing: { street: '9500 Ironbark Parkway', city: 'Gary', state: 'IN', postalCode: '46402', country: 'United States' },
    shipping: { street: '9500 Ironbark Parkway', city: 'Gary', state: 'IN', postalCode: '46402', country: 'United States' },
    createdDaysAgo: 1290,
    updatedDaysAgo: 96
  },
  {
    name: 'Solstice Health Systems',
    accountNumber: 'ACC-1007',
    industry: IndustryType.HEALTHCARE,
    annualRevenue: 512_000_000,
    phone: '+1-555-0107',
    website: 'https://solsticehealth.example.com',
    domain: 'solsticehealth.example.com',
    rating: 'WARM',
    ownerIndex: 1,
    billing: { street: '600 Meridian Medical Campus', city: 'Nashville', state: 'TN', postalCode: '37232', country: 'United States' },
    shipping: { street: '600 Meridian Medical Campus', city: 'Nashville', state: 'TN', postalCode: '37232', country: 'United States' },
    createdDaysAgo: 705,
    updatedDaysAgo: 3
  },
  {
    name: 'Orion Retail Group',
    accountNumber: 'ACC-1008',
    industry: IndustryType.RETAIL,
    annualRevenue: 205_000_000,
    phone: '+1-555-0108',
    website: 'https://orionretail.example.com',
    domain: 'orionretail.example.com',
    rating: 'WARM',
    ownerIndex: 2,
    billing: { street: '3100 Galleria Corporate Drive', city: 'Dallas', state: 'TX', postalCode: '75244', country: 'United States' },
    shipping: { street: '7750 Trinity Distribution Center', city: 'Fort Worth', state: 'TX', postalCode: '76177', country: 'United States' },
    createdDaysAgo: 530,
    updatedDaysAgo: 11
  },
  {
    name: 'Halcyon Energy',
    accountNumber: 'ACC-1009',
    industry: IndustryType.ENERGY,
    annualRevenue: 1_280_000_000,
    phone: '+1-555-0109',
    website: 'https://halcyonenergy.example.com',
    domain: 'halcyonenergy.example.com',
    rating: 'COLD',
    ownerIndex: 3,
    billing: { street: '1400 Gulfstream Plaza', city: 'Houston', state: 'TX', postalCode: '77002', country: 'United States' },
    shipping: { street: '1800 Bayou Station Road', city: 'Freeport', state: 'TX', postalCode: '77541', country: 'United States' },
    createdDaysAgo: 1610,
    updatedDaysAgo: 143
  },
  {
    name: 'Lumen Consulting',
    accountNumber: 'ACC-1010',
    industry: IndustryType.CONSULTING,
    annualRevenue: 63_500_000,
    phone: '+1-555-0110',
    website: 'https://lumenconsulting.example.com',
    domain: 'lumenconsulting.example.com',
    rating: 'WARM',
    ownerIndex: 4,
    billing: { street: '55 Riverside Exchange', city: 'Chicago', state: 'IL', postalCode: '60606', country: 'United States' },
    shipping: { street: '55 Riverside Exchange', city: 'Chicago', state: 'IL', postalCode: '60606', country: 'United States' },
    createdDaysAgo: 380,
    updatedDaysAgo: 15
  }
];

export const SEED_ACCOUNTS: readonly Account[] = ACCOUNT_SEEDS.map((seed, index) => {
  const owner = requireOwnerIndex(seed.ownerIndex);
  return {
    id: seedUuid(`account:${index + 1}`),
    name: seed.name,
    accountNumber: seed.accountNumber,
    industry: seed.industry,
    annualRevenue: seed.annualRevenue,
    phone: seed.phone,
    website: seed.website,
    billingAddress: { ...seed.billing },
    shippingAddress: { ...seed.shipping },
    ownerId: ownerId(owner),
    ownerName: requireOwnerName(owner),
    rating: seed.rating,
    version: 1,
    createdAt: daysAgo(seed.createdDaysAgo),
    updatedAt: daysAgo(seed.updatedDaysAgo)
  };
});

function requireAccountSeed(index: number): AccountSeed {
  const seed = ACCOUNT_SEEDS[index];
  if (!seed) {
    throw new Error(`Seed account index ${index} is outside the account table.`);
  }
  return seed;
}

/* -------------------------------------------------------------------------- */
/* Contacts                                                                    */
/* -------------------------------------------------------------------------- */

interface ContactSeed {
  /** 1-based index into the account seed table. */
  readonly accountIndex: number;
  readonly firstName: string;
  readonly lastName: string;
  readonly title: string;
  readonly department: string;
  readonly phone: string;
  readonly mobilePhone: string;
  readonly isPrimary: boolean;
  readonly leadSource: string;
  readonly createdDaysAgo: number;
  readonly updatedDaysAgo: number;
}

const CONTACT_SEEDS: readonly ContactSeed[] = [
  { accountIndex: 1, firstName: 'Ada', lastName: 'Whitfield', title: 'Director of Merchandising', department: 'Merchandising', phone: '+1-555-0201', mobilePhone: '+1-555-0301', isPrimary: true, leadSource: 'Existing Customer Expansion', createdDaysAgo: 790, updatedDaysAgo: 4 },
  { accountIndex: 1, firstName: 'Peter', lastName: 'Iverson', title: 'Head of Digital Channels', department: 'Technology', phone: '+1-555-0202', mobilePhone: '+1-555-0302', isPrimary: false, leadSource: 'Webinar', createdDaysAgo: 420, updatedDaysAgo: 12 },
  { accountIndex: 1, firstName: 'Naomi', lastName: 'Clarke', title: 'Procurement Lead', department: 'Procurement', phone: '+1-555-0203', mobilePhone: '+1-555-0303', isPrimary: false, leadSource: 'Outbound Prospecting', createdDaysAgo: 180, updatedDaysAgo: 30 },

  { accountIndex: 2, firstName: 'Samuel', lastName: 'Oyelaran', title: 'VP Clinical Operations', department: 'Clinical', phone: '+1-555-0204', mobilePhone: '+1-555-0304', isPrimary: true, leadSource: 'Industry Conference', createdDaysAgo: 610, updatedDaysAgo: 2 },
  { accountIndex: 2, firstName: 'Ingrid', lastName: 'Halvorsen', title: 'Director of Regulatory Affairs', department: 'Regulatory', phone: '+1-555-0205', mobilePhone: '+1-555-0305', isPrimary: false, leadSource: 'Partner Referral', createdDaysAgo: 330, updatedDaysAgo: 9 },
  { accountIndex: 2, firstName: 'Rafael', lastName: 'Duarte', title: 'Procurement Manager', department: 'Procurement', phone: '+1-555-0206', mobilePhone: '+1-555-0306', isPrimary: false, leadSource: 'Website Inbound', createdDaysAgo: 95, updatedDaysAgo: 26 },

  { accountIndex: 3, firstName: 'Michelle', lastName: 'Tan', title: 'VP Supply Chain', department: 'Operations', phone: '+1-555-0207', mobilePhone: '+1-555-0307', isPrimary: true, leadSource: 'Referral', createdDaysAgo: 440, updatedDaysAgo: 14 },
  { accountIndex: 3, firstName: 'Owen', lastName: 'Braddock', title: 'Fleet Operations Manager', department: 'Fleet', phone: '+1-555-0208', mobilePhone: '+1-555-0308', isPrimary: false, leadSource: 'Trade Show', createdDaysAgo: 210, updatedDaysAgo: 38 },

  { accountIndex: 4, firstName: 'Helena', lastName: 'Vasquez', title: 'Chief Risk Officer', department: 'Risk', phone: '+1-555-0209', mobilePhone: '+1-555-0309', isPrimary: true, leadSource: 'Partner Referral', createdDaysAgo: 955, updatedDaysAgo: 1 },
  { accountIndex: 4, firstName: 'Jonathan', lastName: 'Pike', title: 'Director of Investments', department: 'Investments', phone: '+1-555-0210', mobilePhone: '+1-555-0310', isPrimary: false, leadSource: 'Existing Customer Expansion', createdDaysAgo: 500, updatedDaysAgo: 19 },
  { accountIndex: 4, firstName: 'Anika', lastName: 'Sharma', title: 'Compliance Lead', department: 'Compliance', phone: '+1-555-0211', mobilePhone: '+1-555-0311', isPrimary: false, leadSource: 'Webinar', createdDaysAgo: 150, updatedDaysAgo: 44 },

  { accountIndex: 5, firstName: 'Ethan', lastName: 'Brooks', title: 'Chief Technology Officer', department: 'Engineering', phone: '+1-555-0212', mobilePhone: '+1-555-0312', isPrimary: true, leadSource: 'Outbound Prospecting', createdDaysAgo: 255, updatedDaysAgo: 3 },
  { accountIndex: 5, firstName: 'Yolanda', lastName: 'Marco', title: 'VP Product', department: 'Product', phone: '+1-555-0213', mobilePhone: '+1-555-0313', isPrimary: false, leadSource: 'Website Inbound', createdDaysAgo: 120, updatedDaysAgo: 17 },

  { accountIndex: 6, firstName: 'Sandra', lastName: 'Kovacs', title: 'Plant Director', department: 'Manufacturing', phone: '+1-555-0214', mobilePhone: '+1-555-0314', isPrimary: true, leadSource: 'Referral', createdDaysAgo: 1180, updatedDaysAgo: 88 },
  { accountIndex: 6, firstName: 'Devin', lastName: 'Aloisi', title: 'Procurement Analyst', department: 'Procurement', phone: '+1-555-0215', mobilePhone: '+1-555-0315', isPrimary: false, leadSource: 'Trade Show', createdDaysAgo: 260, updatedDaysAgo: 91 },

  { accountIndex: 7, firstName: 'Rachel', lastName: 'Adeyemi', title: 'Chief Medical Officer', department: 'Medical Affairs', phone: '+1-555-0216', mobilePhone: '+1-555-0316', isPrimary: true, leadSource: 'Industry Conference', createdDaysAgo: 690, updatedDaysAgo: 3 },
  { accountIndex: 7, firstName: 'Colin', lastName: 'Farrow', title: 'VP Nursing Operations', department: 'Nursing', phone: '+1-555-0217', mobilePhone: '+1-555-0317', isPrimary: false, leadSource: 'Referral', createdDaysAgo: 300, updatedDaysAgo: 23 },
  { accountIndex: 7, firstName: 'Bianca', lastName: 'Russo', title: 'Director of Patient Experience', department: 'Operations', phone: '+1-555-0218', mobilePhone: '+1-555-0318', isPrimary: false, leadSource: 'Webinar', createdDaysAgo: 85, updatedDaysAgo: 34 },

  { accountIndex: 8, firstName: 'Gerald', lastName: 'Hu', title: 'Head of Store Operations', department: 'Retail Operations', phone: '+1-555-0219', mobilePhone: '+1-555-0319', isPrimary: true, leadSource: 'Existing Customer Expansion', createdDaysAgo: 515, updatedDaysAgo: 10 },
  { accountIndex: 8, firstName: 'Leila', lastName: 'Haddad', title: 'Senior Buyer', department: 'Sourcing', phone: '+1-555-0220', mobilePhone: '+1-555-0320', isPrimary: false, leadSource: 'Trade Show', createdDaysAgo: 275, updatedDaysAgo: 29 },
  { accountIndex: 8, firstName: 'Victor', lastName: 'Nunes', title: 'Category Manager', department: 'Merchandising', phone: '+1-555-0221', mobilePhone: '+1-555-0321', isPrimary: false, leadSource: 'Partner Referral', createdDaysAgo: 140, updatedDaysAgo: 48 },

  { accountIndex: 9, firstName: 'Douglas', lastName: 'Fairbanks', title: 'VP Field Operations', department: 'Operations', phone: '+1-555-0222', mobilePhone: '+1-555-0322', isPrimary: true, leadSource: 'Outbound Prospecting', createdDaysAgo: 1500, updatedDaysAgo: 139 },
  { accountIndex: 9, firstName: 'Camila', lastName: 'Ortiz', title: 'Health, Safety & Environment Manager', department: 'HSE', phone: '+1-555-0223', mobilePhone: '+1-555-0323', isPrimary: false, leadSource: 'Referral', createdDaysAgo: 820, updatedDaysAgo: 140 },

  { accountIndex: 10, firstName: 'Hassan', lastName: 'Karim', title: 'Managing Partner', department: 'Leadership', phone: '+1-555-0224', mobilePhone: '+1-555-0324', isPrimary: true, leadSource: 'Partner Referral', createdDaysAgo: 365, updatedDaysAgo: 14 },
  { accountIndex: 10, firstName: 'Nadia', lastName: 'Sokolov', title: 'Engagement Lead', department: 'Advisory', phone: '+1-555-0225', mobilePhone: '+1-555-0325', isPrimary: false, leadSource: 'Webinar', createdDaysAgo: 200, updatedDaysAgo: 41 }
];

export const SEED_CONTACTS: readonly Contact[] = CONTACT_SEEDS.map((seed, index) => {
  const account = SEED_ACCOUNTS[seed.accountIndex - 1];
  if (!account) {
    throw new Error(`Seed contact ${index + 1} references missing account ${seed.accountIndex}.`);
  }
  const domain = requireAccountSeed(seed.accountIndex - 1).domain;
  return {
    id: seedUuid(`contact:${index + 1}`),
    accountId: account.id,
    firstName: seed.firstName,
    lastName: seed.lastName,
    title: seed.title,
    department: seed.department,
    email: `${seed.firstName}.${seed.lastName}@${domain}`.toLowerCase(),
    phone: seed.phone,
    mobilePhone: seed.mobilePhone,
    isPrimary: seed.isPrimary,
    leadSource: seed.leadSource,
    version: 1,
    createdAt: daysAgo(seed.createdDaysAgo),
    updatedAt: daysAgo(seed.updatedDaysAgo)
  };
});

/* -------------------------------------------------------------------------- */
/* Opportunities                                                               */
/* -------------------------------------------------------------------------- */

interface OpportunitySeed {
  /** 1-based index into the account seed table. */
  readonly accountIndex: number;
  /** 1-based index into the contact seed table; must belong to `accountIndex`. */
  readonly contactIndex: number;
  readonly name: string;
  readonly stage: OpportunityStage;
  readonly amount: number;
  readonly closeDaysFromToday: number;
  readonly nextStep: string;
  readonly leadSource: string;
  readonly lossReason?: string;
  readonly createdDaysAgo: number;
  readonly updatedDaysAgo: number;
}

const OPPORTUNITY_SEEDS: readonly OpportunitySeed[] = [
  { accountIndex: 1, contactIndex: 1, name: 'Northwind Omnichannel Rollout', stage: OpportunityStage.NEGOTIATION, amount: 1_250_000, closeDaysFromToday: 21, nextStep: 'Finalize the three-year commercial terms with the buying committee.', leadSource: 'Existing Customer Expansion', createdDaysAgo: 240, updatedDaysAgo: 2 },
  { accountIndex: 1, contactIndex: 2, name: 'Northwind Data Warehouse Modernization', stage: OpportunityStage.NEEDS_ANALYSIS, amount: 480_000, closeDaysFromToday: 45, nextStep: 'Deliver the merchandising data profiling report to Peter.', leadSource: 'Webinar', createdDaysAgo: 96, updatedDaysAgo: 11 },
  { accountIndex: 2, contactIndex: 4, name: 'Helix Clinical Trial Data Platform', stage: OpportunityStage.CLOSED_WON, amount: 2_400_000, closeDaysFromToday: -30, nextStep: 'Transition to the implementation team for phase one onboarding.', leadSource: 'Industry Conference', createdDaysAgo: 410, updatedDaysAgo: 30 },
  { accountIndex: 2, contactIndex: 5, name: 'Helix Regulatory Submission Suite', stage: OpportunityStage.DECISION_MAKERS, amount: 890_000, closeDaysFromToday: 14, nextStep: 'Confirm the security review outcome with the regulatory steering group.', leadSource: 'Partner Referral', createdDaysAgo: 205, updatedDaysAgo: 1 },
  { accountIndex: 2, contactIndex: 6, name: 'Helix Lab Procurement Portal', stage: OpportunityStage.PROSPECTING, amount: 150_000, closeDaysFromToday: 90, nextStep: 'Book the discovery workshop with the procurement leadership.', leadSource: 'Website Inbound', createdDaysAgo: 30, updatedDaysAgo: 25 },
  { accountIndex: 3, contactIndex: 7, name: 'Cascade Fleet Telematics Modernization', stage: OpportunityStage.VALUE_PROPOSITION, amount: 720_000, closeDaysFromToday: 35, nextStep: 'Present the value proposition deck to the supply chain steering group.', leadSource: 'Referral', createdDaysAgo: 150, updatedDaysAgo: 6 },
  { accountIndex: 3, contactIndex: 8, name: 'Cascade Warehouse Slotting Optimization', stage: OpportunityStage.QUALIFICATION, amount: 265_000, closeDaysFromToday: 60, nextStep: 'Complete the lane profile questionnaire with the fleet team.', leadSource: 'Trade Show', createdDaysAgo: 48, updatedDaysAgo: 20 },
  { accountIndex: 4, contactIndex: 9, name: 'Meridian Risk Analytics Suite', stage: OpportunityStage.NEGOTIATION, amount: 3_150_000, closeDaysFromToday: 10, nextStep: 'Escalate the pricing exception to the executive sponsor.', leadSource: 'Partner Referral', createdDaysAgo: 320, updatedDaysAgo: 1 },
  { accountIndex: 4, contactIndex: 10, name: 'Meridian Portfolio Reporting Refresh', stage: OpportunityStage.CLOSED_LOST, amount: 1_100_000, closeDaysFromToday: -45, nextStep: 'Revisit after the fiscal planning cycle resets in Q3.', leadSource: 'Existing Customer Expansion', lossReason: 'Meridian consolidated reporting onto an in-house platform after the budget freeze.', createdDaysAgo: 400, updatedDaysAgo: 45 },
  { accountIndex: 5, contactIndex: 12, name: 'Vireo Multi-Tenant Licensing Engine', stage: OpportunityStage.CLOSED_WON, amount: 675_000, closeDaysFromToday: -12, nextStep: 'Hand the engagement over to the solutions architecture team.', leadSource: 'Outbound Prospecting', createdDaysAgo: 230, updatedDaysAgo: 12 },
  { accountIndex: 5, contactIndex: 13, name: 'Vireo Usage Metering Service', stage: OpportunityStage.VALUE_PROPOSITION, amount: 330_000, closeDaysFromToday: 28, nextStep: 'Run the billing accuracy workshop with the product finance team.', leadSource: 'Website Inbound', createdDaysAgo: 75, updatedDaysAgo: 9 },
  { accountIndex: 7, contactIndex: 16, name: 'Solstice Patient Portal Redesign', stage: OpportunityStage.CLOSED_LOST, amount: 540_000, closeDaysFromToday: -60, nextStep: 'Re-approach the portal programme once the HIPAA review closes.', leadSource: 'Industry Conference', lossReason: 'Security review deferred the programme; the budget moved to infrastructure hardening.', createdDaysAgo: 380, updatedDaysAgo: 60 },
  { accountIndex: 7, contactIndex: 17, name: 'Solstice Staff Scheduling Platform', stage: OpportunityStage.CLOSED_WON, amount: 1_850_000, closeDaysFromToday: -75, nextStep: 'Complete the go-live readiness review with nursing operations.', leadSource: 'Referral', createdDaysAgo: 500, updatedDaysAgo: 75 },
  { accountIndex: 8, contactIndex: 19, name: 'Orion Store Operations Consolidation', stage: OpportunityStage.PROSPECTING, amount: 420_000, closeDaysFromToday: 75, nextStep: 'Qualify the store estate scope with the operations council.', leadSource: 'Existing Customer Expansion', createdDaysAgo: 25, updatedDaysAgo: 10 },
  { accountIndex: 10, contactIndex: 24, name: 'Lumen Strategy Enablement Program', stage: OpportunityStage.QUALIFICATION, amount: 195_000, closeDaysFromToday: 50, nextStep: 'Schedule the partner capability workshop with the advisory practice.', leadSource: 'Partner Referral', createdDaysAgo: 60, updatedDaysAgo: 14 }
];

export const SEED_OPPORTUNITIES: readonly Opportunity[] = OPPORTUNITY_SEEDS.map((seed, index) => {
  const account = SEED_ACCOUNTS[seed.accountIndex - 1];
  const contact = SEED_CONTACTS[seed.contactIndex - 1];
  if (!account || !contact) {
    throw new Error(`Seed opportunity ${index + 1} references a missing account or contact.`);
  }
  if (contact.accountId !== account.id) {
    throw new Error(
      `Seed opportunity ${index + 1} links contact ${seed.contactIndex} to account ${seed.accountIndex}, but that contact belongs to a different account.`
    );
  }
  const owner = requireOwnerIndex(requireAccountSeed(seed.accountIndex - 1).ownerIndex);
  const base: Opportunity = {
    id: seedUuid(`opportunity:${index + 1}`),
    accountId: account.id,
    primaryContactId: contact.id,
    name: seed.name,
    stage: seed.stage,
    amount: seed.amount,
    closeDate: dayOffset(seed.closeDaysFromToday),
    nextStep: seed.nextStep,
    leadSource: seed.leadSource,
    ownerId: ownerId(owner),
    ownerName: requireOwnerName(owner),
    version: 1,
    createdAt: daysAgo(seed.createdDaysAgo),
    updatedAt: daysAgo(seed.updatedDaysAgo)
  };
  if (seed.stage === OpportunityStage.CLOSED_LOST) {
    return { ...base, lossReason: seed.lossReason ?? 'Loss reason not recorded.' };
  }
  return base;
});

/* -------------------------------------------------------------------------- */
/* Activities                                                                  */
/* -------------------------------------------------------------------------- */

interface ActivitySeed {
  readonly entityType: Activity['entityType'];
  /** 1-based index into the account, opportunity or contact table. */
  readonly entityIndex: number;
  readonly type: ActivityType;
  readonly subject: string;
  readonly status: ActivityStatus;
  readonly priority: PriorityLevel;
  /** Days until due; `null` for notes and already completed work. */
  readonly dueDaysFromToday: number | null;
  /** Days since completion; `null` while the activity is still open. */
  readonly completedDaysAgo: number | null;
  readonly ownerIndex: number;
  readonly notes: string;
  readonly createdDaysAgo: number;
}

const ACTIVITY_SEEDS: readonly ActivitySeed[] = [
  // --- Account activities (16) ---
  { entityType: 'ACCOUNT', entityIndex: 1, type: ActivityType.MEETING, subject: 'Merchandising roadmap review', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.HIGH, dueDaysFromToday: 12, completedDaysAgo: null, ownerIndex: 0, notes: 'Half-day session with the Northwind buying committee covering the spring assortment plan.', createdDaysAgo: 5 },
  { entityType: 'ACCOUNT', entityIndex: 1, type: ActivityType.EMAIL, subject: 'Sent renewal cost breakdown', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 9, ownerIndex: 0, notes: 'Shared the three-year cost breakdown ahead of the roadmap review.', createdDaysAgo: 12 },
  { entityType: 'ACCOUNT', entityIndex: 1, type: ActivityType.NOTE, subject: 'Account health: supportive', status: ActivityStatus.COMPLETED, priority: PriorityLevel.LOW, dueDaysFromToday: null, completedDaysAgo: 14, ownerIndex: 0, notes: 'Usage up 18% quarter over quarter with no support escalations in the last 60 days.', createdDaysAgo: 15 },
  { entityType: 'ACCOUNT', entityIndex: 2, type: ActivityType.CALL, subject: 'Clinical operations status call', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.CRITICAL, dueDaysFromToday: 3, completedDaysAgo: null, ownerIndex: 1, notes: 'Confirm the trial site onboarding schedule before the regulatory submission deadline.', createdDaysAgo: 4 },
  { entityType: 'ACCOUNT', entityIndex: 2, type: ActivityType.MEETING, subject: 'Onsite at the Cambridge research loop', status: ActivityStatus.COMPLETED, priority: PriorityLevel.HIGH, dueDaysFromToday: null, completedDaysAgo: 6, ownerIndex: 1, notes: 'Met the clinical data and regulatory teams and mapped the integration points.', createdDaysAgo: 10 },
  { entityType: 'ACCOUNT', entityIndex: 2, type: ActivityType.TASK, subject: 'Prepare clinical data retention brief', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.NORMAL, dueDaysFromToday: 20, completedDaysAgo: null, ownerIndex: 1, notes: 'Required input for the Helix regulatory submission suite opportunity.', createdDaysAgo: 3 },
  { entityType: 'ACCOUNT', entityIndex: 3, type: ActivityType.EMAIL, subject: 'Sent fleet telematics requirements', status: ActivityStatus.COMPLETED, priority: PriorityLevel.LOW, dueDaysFromToday: null, completedDaysAgo: 21, ownerIndex: 2, notes: 'Requirements document covering trailer tracking, dwell times and yard geofencing.', createdDaysAgo: 26 },
  { entityType: 'ACCOUNT', entityIndex: 3, type: ActivityType.CALL, subject: 'Warehouse slotting discovery', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.NORMAL, dueDaysFromToday: 7, completedDaysAgo: null, ownerIndex: 2, notes: 'Walk through the lane profile questionnaire with the operations team.', createdDaysAgo: 6 },
  { entityType: 'ACCOUNT', entityIndex: 4, type: ActivityType.MEETING, subject: 'Risk committee executive briefing', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.CRITICAL, dueDaysFromToday: 1, completedDaysAgo: null, ownerIndex: 3, notes: 'The executive sponsor expects a pricing exception proposal at the meeting.', createdDaysAgo: 2 },
  { entityType: 'ACCOUNT', entityIndex: 4, type: ActivityType.TASK, subject: 'Model the multi-year pricing exception', status: ActivityStatus.DEFERRED, priority: PriorityLevel.NORMAL, dueDaysFromToday: 40, completedDaysAgo: null, ownerIndex: 3, notes: 'Deferred until the fiscal planning cycle publishes the new discount bands.', createdDaysAgo: 18 },
  { entityType: 'ACCOUNT', entityIndex: 4, type: ActivityType.NOTE, subject: 'Loss review: portfolio reporting', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 18, ownerIndex: 3, notes: 'Competitor displacement plus a budget freeze. Re-approach after the Q3 planning reset.', createdDaysAgo: 47 },
  { entityType: 'ACCOUNT', entityIndex: 5, type: ActivityType.TASK, subject: 'Ship licensing engine architecture note', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.HIGH, dueDaysFromToday: 5, completedDaysAgo: null, ownerIndex: 0, notes: 'Post-implementation documentation owed to the Vireo engineering team.', createdDaysAgo: 7 },
  { entityType: 'ACCOUNT', entityIndex: 6, type: ActivityType.CALL, subject: 'Re-engage the Ironbark plant', status: ActivityStatus.DEFERRED, priority: PriorityLevel.LOW, dueDaysFromToday: 55, completedDaysAgo: null, ownerIndex: 4, notes: 'No active programme since the budget reforecast. Revisit in the next quarter.', createdDaysAgo: 90 },
  { entityType: 'ACCOUNT', entityIndex: 7, type: ActivityType.MEETING, subject: 'Nursing operations go-live review', status: ActivityStatus.COMPLETED, priority: PriorityLevel.HIGH, dueDaysFromToday: null, completedDaysAgo: 3, ownerIndex: 1, notes: 'Readiness confirmed for the scheduling platform rollout.', createdDaysAgo: 8 },
  { entityType: 'ACCOUNT', entityIndex: 8, type: ActivityType.TASK, subject: 'Scope the store estate inventory', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.NORMAL, dueDaysFromToday: 18, completedDaysAgo: null, ownerIndex: 2, notes: 'Required before the Orion store operations consolidation can be qualified.', createdDaysAgo: 11 },
  { entityType: 'ACCOUNT', entityIndex: 8, type: ActivityType.NOTE, subject: 'Operations council meets quarterly', status: ActivityStatus.COMPLETED, priority: PriorityLevel.LOW, dueDaysFromToday: null, completedDaysAgo: 11, ownerIndex: 2, notes: 'Align opportunity milestones to the council dates to shorten approval cycles.', createdDaysAgo: 13 },

  // --- Opportunity activities (16) ---
  { entityType: 'OPPORTUNITY', entityIndex: 1, type: ActivityType.TASK, subject: 'Redline the three-year commercial terms', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.HIGH, dueDaysFromToday: 4, completedDaysAgo: null, ownerIndex: 0, notes: 'Legal returned the redline; pricing escalations are still outstanding.', createdDaysAgo: 6 },
  { entityType: 'OPPORTUNITY', entityIndex: 1, type: ActivityType.EMAIL, subject: 'Sent the implementation timeline draft', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 2, ownerIndex: 0, notes: 'The timeline assumes a phase one start within 30 days of signature.', createdDaysAgo: 4 },
  { entityType: 'OPPORTUNITY', entityIndex: 2, type: ActivityType.MEETING, subject: 'Data profiling workshop', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.NORMAL, dueDaysFromToday: 9, completedDaysAgo: null, ownerIndex: 0, notes: 'Half-day session on merchandising data quality with the digital channels team.', createdDaysAgo: 9 },
  { entityType: 'OPPORTUNITY', entityIndex: 3, type: ActivityType.NOTE, subject: 'Post-close lessons learned', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 30, ownerIndex: 1, notes: 'The deal cycle ran 380 days; a regulatory partner referral drove the final acceleration.', createdDaysAgo: 31 },
  { entityType: 'OPPORTUNITY', entityIndex: 3, type: ActivityType.TASK, subject: 'Obtain contract countersignature', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 28, ownerIndex: 1, notes: 'Countersigned by the Helix procurement office.', createdDaysAgo: 32 },
  { entityType: 'OPPORTUNITY', entityIndex: 4, type: ActivityType.CALL, subject: 'Security review outcome call', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.CRITICAL, dueDaysFromToday: 2, completedDaysAgo: null, ownerIndex: 1, notes: 'The regulatory submission suite is blocked on the security review outcome.', createdDaysAgo: 5 },
  { entityType: 'OPPORTUNITY', entityIndex: 5, type: ActivityType.EMAIL, subject: 'Procurement discovery invitation', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.LOW, dueDaysFromToday: 30, completedDaysAgo: null, ownerIndex: 1, notes: 'Send once Helix confirms the procurement workshop window.', createdDaysAgo: 20 },
  { entityType: 'OPPORTUNITY', entityIndex: 6, type: ActivityType.MEETING, subject: 'Value proposition presentation', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.HIGH, dueDaysFromToday: 6, completedDaysAgo: null, ownerIndex: 2, notes: 'The deck and ROI model are ready; waiting on a steering group slot.', createdDaysAgo: 7 },
  { entityType: 'OPPORTUNITY', entityIndex: 7, type: ActivityType.NOTE, subject: 'Lane profile data received', status: ActivityStatus.COMPLETED, priority: PriorityLevel.LOW, dueDaysFromToday: null, completedDaysAgo: 16, ownerIndex: 2, notes: 'The data covers 14 lanes over 90 days; analysis is in progress.', createdDaysAgo: 18 },
  { entityType: 'OPPORTUNITY', entityIndex: 8, type: ActivityType.TASK, subject: 'Executive pricing exception proposal', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.CRITICAL, dueDaysFromToday: 1, completedDaysAgo: null, ownerIndex: 3, notes: 'The draft is at 70% and needs sponsor sign-off before the risk committee meeting.', createdDaysAgo: 3 },
  { entityType: 'OPPORTUNITY', entityIndex: 8, type: ActivityType.MEETING, subject: 'Risk committee pricing session', status: ActivityStatus.COMPLETED, priority: PriorityLevel.HIGH, dueDaysFromToday: null, completedDaysAgo: 4, ownerIndex: 3, notes: 'The committee asked for a revised concession structure before the next session.', createdDaysAgo: 6 },
  { entityType: 'OPPORTUNITY', entityIndex: 9, type: ActivityType.NOTE, subject: 'Post-mortem: portfolio reporting', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 45, ownerIndex: 3, notes: 'Lost to an in-house build after the budget freeze. Revisit in Q3.', createdDaysAgo: 46 },
  { entityType: 'OPPORTUNITY', entityIndex: 10, type: ActivityType.TASK, subject: 'Hand over the licensing engine', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 10, ownerIndex: 0, notes: 'The architecture note was accepted by the Vireo engineering team.', createdDaysAgo: 14 },
  { entityType: 'OPPORTUNITY', entityIndex: 11, type: ActivityType.CALL, subject: 'Billing accuracy workshop', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.NORMAL, dueDaysFromToday: 8, completedDaysAgo: null, ownerIndex: 0, notes: 'Session with the Vireo product finance team to validate the metering model.', createdDaysAgo: 8 },
  { entityType: 'OPPORTUNITY', entityIndex: 12, type: ActivityType.NOTE, subject: 'HIPAA review deferral recorded', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 60, ownerIndex: 1, notes: 'The security review deferred the patient portal programme indefinitely.', createdDaysAgo: 61 },
  { entityType: 'OPPORTUNITY', entityIndex: 13, type: ActivityType.TASK, subject: 'Go-live readiness sign-off', status: ActivityStatus.COMPLETED, priority: PriorityLevel.HIGH, dueDaysFromToday: null, completedDaysAgo: 70, ownerIndex: 1, notes: 'Signed off by nursing operations; the rollout completed on schedule.', createdDaysAgo: 73 },

  // --- Contact activities (8) ---
  { entityType: 'CONTACT', entityIndex: 1, type: ActivityType.EMAIL, subject: 'Roadmap agenda circulated', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 5, ownerIndex: 0, notes: 'The agenda focused on assortment planning and store technology integrations.', createdDaysAgo: 6 },
  { entityType: 'CONTACT', entityIndex: 2, type: ActivityType.CALL, subject: 'Warehouse data access follow-up', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.NORMAL, dueDaysFromToday: 11, completedDaysAgo: null, ownerIndex: 0, notes: 'Confirm read access to the merchandising warehouse extracts.', createdDaysAgo: 11 },
  { entityType: 'CONTACT', entityIndex: 4, type: ActivityType.MEETING, subject: 'Trial site onboarding workshop', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.HIGH, dueDaysFromToday: 5, completedDaysAgo: null, ownerIndex: 1, notes: 'Covers site activation, data loading and investigator training.', createdDaysAgo: 7 },
  { entityType: 'CONTACT', entityIndex: 9, type: ActivityType.CALL, subject: 'Pricing exception briefing', status: ActivityStatus.IN_PROGRESS, priority: PriorityLevel.CRITICAL, dueDaysFromToday: 2, completedDaysAgo: null, ownerIndex: 3, notes: 'Walk through the revised concession structure with the chief risk officer.', createdDaysAgo: 2 },
  { entityType: 'CONTACT', entityIndex: 12, type: ActivityType.EMAIL, subject: 'Sent the licensing architecture note', status: ActivityStatus.COMPLETED, priority: PriorityLevel.NORMAL, dueDaysFromToday: null, completedDaysAgo: 7, ownerIndex: 0, notes: 'Shared the multi-tenant licensing architecture note for internal review.', createdDaysAgo: 9 },
  { entityType: 'CONTACT', entityIndex: 16, type: ActivityType.NOTE, subject: 'Clinical advisor relationship is strong', status: ActivityStatus.COMPLETED, priority: PriorityLevel.HIGH, dueDaysFromToday: null, completedDaysAgo: 13, ownerIndex: 1, notes: 'Executive sponsor for the patient services line. Re-engage after the security review.', createdDaysAgo: 14 },
  { entityType: 'CONTACT', entityIndex: 19, type: ActivityType.TASK, subject: 'Prepare store estate scoping questions', status: ActivityStatus.NOT_STARTED, priority: PriorityLevel.NORMAL, dueDaysFromToday: 22, completedDaysAgo: null, ownerIndex: 2, notes: 'Input required for the Orion store operations consolidation.', createdDaysAgo: 10 },
  { entityType: 'CONTACT', entityIndex: 24, type: ActivityType.EMAIL, subject: 'Partner capability workshop agenda', status: ActivityStatus.COMPLETED, priority: PriorityLevel.LOW, dueDaysFromToday: null, completedDaysAgo: 19, ownerIndex: 4, notes: 'The agenda covers the advisory practice enablement curriculum.', createdDaysAgo: 22 }
];

function resolveActivityEntityId(seed: ActivitySeed, position: number): UUID {
  const collection: readonly { readonly id: UUID }[] =
    seed.entityType === 'ACCOUNT'
      ? SEED_ACCOUNTS
      : seed.entityType === 'OPPORTUNITY'
        ? SEED_OPPORTUNITIES
        : SEED_CONTACTS;
  const entity = collection[seed.entityIndex - 1];
  if (!entity) {
    throw new Error(
      `Seed activity ${position} references missing ${seed.entityType} entity at index ${seed.entityIndex}.`
    );
  }
  return entity.id;
}

export const SEED_ACTIVITIES: readonly Activity[] = ACTIVITY_SEEDS.map((seed, index) => {
  const owner = requireOwnerIndex(seed.ownerIndex);
  return {
    id: seedUuid(`activity:${index + 1}`),
    entityType: seed.entityType,
    entityId: resolveActivityEntityId(seed, index + 1),
    type: seed.type,
    subject: seed.subject,
    status: seed.status,
    priority: seed.priority,
    dueDate: seed.dueDaysFromToday === null ? null : daysAgo(-seed.dueDaysFromToday),
    completedDate: seed.completedDaysAgo === null ? null : daysAgo(seed.completedDaysAgo),
    assignedToId: ownerId(owner),
    assignedToName: requireOwnerName(owner),
    notes: seed.notes,
    version: 1,
    createdAt: daysAgo(seed.createdDaysAgo),
    updatedAt: daysAgo(seed.completedDaysAgo ?? seed.createdDaysAgo)
  };
});
