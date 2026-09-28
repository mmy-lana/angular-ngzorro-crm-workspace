import {
  ForecastCategory,
  ISODateOnly,
  Opportunity,
  OpportunityStage
} from '@core/models/crm.models';

export interface StageMetadata {
  probability: number;
  label: string;
  order: number;
  closed: boolean;
  forecastCategory: ForecastCategory;
}

/**
 * Single source of truth for stage ordering, win probability and roll-up
 * forecast category. Every derived metric in the application is a pure function
 * of an amount and one of these entries.
 */
export const STAGE_CONFIG: Record<OpportunityStage, StageMetadata> = {
  [OpportunityStage.PROSPECTING]: { probability: 10, label: 'Prospecting', order: 1, closed: false, forecastCategory: ForecastCategory.PIPELINE },
  [OpportunityStage.QUALIFICATION]: { probability: 20, label: 'Qualification', order: 2, closed: false, forecastCategory: ForecastCategory.PIPELINE },
  [OpportunityStage.NEEDS_ANALYSIS]: { probability: 40, label: 'Needs Analysis', order: 3, closed: false, forecastCategory: ForecastCategory.PIPELINE },
  [OpportunityStage.VALUE_PROPOSITION]: { probability: 60, label: 'Value Proposition', order: 4, closed: false, forecastCategory: ForecastCategory.BEST_CASE },
  [OpportunityStage.DECISION_MAKERS]: { probability: 75, label: 'Decision Makers', order: 5, closed: false, forecastCategory: ForecastCategory.BEST_CASE },
  [OpportunityStage.NEGOTIATION]: { probability: 90, label: 'Negotiation/Review', order: 6, closed: false, forecastCategory: ForecastCategory.COMMIT },
  [OpportunityStage.CLOSED_WON]: { probability: 100, label: 'Closed Won', order: 7, closed: true, forecastCategory: ForecastCategory.CLOSED },
  [OpportunityStage.CLOSED_LOST]: { probability: 0, label: 'Closed Lost', order: 8, closed: true, forecastCategory: ForecastCategory.OMITTED }
};

/** Open stages in ribbon order; used by the stage path and stage filters. */
export const OPEN_STAGES: readonly OpportunityStage[] = Object.freeze([
  OpportunityStage.PROSPECTING,
  OpportunityStage.QUALIFICATION,
  OpportunityStage.NEEDS_ANALYSIS,
  OpportunityStage.VALUE_PROPOSITION,
  OpportunityStage.DECISION_MAKERS,
  OpportunityStage.NEGOTIATION
]);

/** Full progression ribbon, closed stages last. */
export const PIPELINE_STAGES: readonly OpportunityStage[] = Object.freeze([
  ...OPEN_STAGES,
  OpportunityStage.CLOSED_WON,
  OpportunityStage.CLOSED_LOST
]);

/**
 * Formats a `Date` as a local `YYYY-MM-DD` string. Deliberately avoids
 * `toISOString()`, which shifts the calendar day for negative UTC offsets.
 */
export function toLocalDateOnly(d: Date = new Date()): ISODateOnly {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function deriveForecastCategory(stage: OpportunityStage): ForecastCategory {
  return STAGE_CONFIG[stage].forecastCategory;
}

export function stageLabel(stage: OpportunityStage): string {
  return STAGE_CONFIG[stage].label;
}

export function stageProbability(stage: OpportunityStage): number {
  return STAGE_CONFIG[stage].probability;
}

export function isClosedStage(stage: OpportunityStage): boolean {
  return STAGE_CONFIG[stage].closed;
}

/**
 * Coerces an amount to a usable currency figure.
 *
 * A non-finite value (`NaN`, or an `Infinity` from a corrupt payload) or a
 * negative one is meaningless as money, and letting it through poisons every
 * aggregate it reaches: one `NaN` turns a pipeline total into `NaN`. Anything
 * outside the valid range collapses to `0`, so a bad cell reads as empty rather
 * than destroying the report around it.
 */
function safeAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER) {
    return 0;
  }
  return amount;
}

export function calculateExpectedRevenue(amount: number, stage: OpportunityStage): number {
  const prob = STAGE_CONFIG[stage].probability;
  // The probability is divided first: `amount * 90` can exceed 2^53 and lose
  // precision on large deals, while `amount * (90 / 100)` stays in range.
  const weighted = safeAmount(amount) * (prob / 100);
  return Math.min(Math.round(weighted), Number.MAX_SAFE_INTEGER);
}

/**
 * Stage gate. `CLOSED_LOST` is the only transition carrying an extra
 * precondition: a non-empty loss reason must be supplied.
 */
export function validateStageTransition(
  currentStage: OpportunityStage,
  targetStage: OpportunityStage,
  lossReason?: string
): { valid: boolean; reason?: string } {
  if (currentStage === targetStage) return { valid: true };
  if (targetStage === OpportunityStage.CLOSED_LOST && (!lossReason || lossReason.trim().length === 0)) {
    return { valid: false, reason: 'Loss reason is mandatory when marking Closed Lost.' };
  }
  return { valid: true };
}

/**
 * Builds the patch for a stage transition:
 * - a loss reason is only retained on `CLOSED_LOST`, otherwise it is cleared;
 * - closing forces `closeDate` to today when it is empty or still in the future;
 * - reopening forces `closeDate` to today when the previous date is in the past.
 */
export function applyStageTransition(
  opportunity: Opportunity,
  targetStage: OpportunityStage,
  todayDate: ISODateOnly,
  lossReason?: string
): Partial<Opportunity> {
  const patch: Partial<Opportunity> = {
    stage: targetStage
  };

  if (targetStage === OpportunityStage.CLOSED_LOST) {
    patch.lossReason = lossReason?.trim();
  } else {
    patch.lossReason = undefined;
  }

  const isTargetTerminal = targetStage === OpportunityStage.CLOSED_WON || targetStage === OpportunityStage.CLOSED_LOST;
  const isCurrentTerminal = opportunity.stage === OpportunityStage.CLOSED_WON || opportunity.stage === OpportunityStage.CLOSED_LOST;

  if (isTargetTerminal && (!opportunity.closeDate || opportunity.closeDate > todayDate)) {
    patch.closeDate = todayDate;
  } else if (isCurrentTerminal && !isTargetTerminal && opportunity.closeDate < todayDate) {
    patch.closeDate = todayDate;
  }

  return patch;
}

/** Percentage of closed opportunities that were won; 0 when nothing is closed. */
export function calculateWinRate(opportunities: Opportunity[]): number {
  const wonCount = opportunities.filter(o => o.stage === OpportunityStage.CLOSED_WON).length;
  const lostCount = opportunities.filter(o => o.stage === OpportunityStage.CLOSED_LOST).length;
  const totalClosed = wonCount + lostCount;
  // No closed deals is an unknown rate, not an infinite or NaN one.
  if (totalClosed === 0) {
    return 0;
  }
  const rate = Math.round((wonCount / totalClosed) * 100);
  // A rate is a percentage, and this value feeds progress bars and report text,
  // where anything outside 0-100 is a visible defect.
  return Math.min(100, Math.max(0, rate));
}

/** Sum of probability-weighted revenue across still-open opportunities. */
export function calculateWeightedForecast(opportunities: Opportunity[]): number {
  const total = opportunities
    .filter(o => o.stage !== OpportunityStage.CLOSED_WON && o.stage !== OpportunityStage.CLOSED_LOST)
    .reduce((sum, o) => sum + calculateExpectedRevenue(o.amount, o.stage), 0);
  return Number.isFinite(total) ? Math.min(total, Number.MAX_SAFE_INTEGER) : 0;
}

/** Gross value of every open opportunity. */
export function calculateOpenPipelineValue(opportunities: Opportunity[]): number {
  const total = opportunities
    .filter(o => !isClosedStage(o.stage))
    .reduce((sum, o) => sum + safeAmount(o.amount), 0);
  return Number.isFinite(total) ? Math.min(total, Number.MAX_SAFE_INTEGER) : 0;
}

/** Win rate restricted to a single forecast bucket. */
export function calculateCategoryWinRate(
  opportunities: Opportunity[],
  category: ForecastCategory
): number {
  return calculateWinRate(
    opportunities.filter(o => deriveForecastCategory(o.stage) === category)
  );
}
