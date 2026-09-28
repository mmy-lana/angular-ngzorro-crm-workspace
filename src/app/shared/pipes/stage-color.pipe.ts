import { Pipe, PipeTransform } from '@angular/core';
import { OpportunityStage } from '@core/models/crm.models';

/**
 * Resolves a pipeline stage to its design token.
 *
 * Stages are identified by colour in the ribbon, in table rows and in badges, so
 * the mapping lives in exactly one place. The pipe returns a CSS custom
 * property rather than a raw hex value, which keeps the palette re-themeable
 * from `_theme-variables.scss` without touching TypeScript.
 */
@Pipe({ name: 'stageColor' })
export class StageColorPipe implements PipeTransform {
  /**
   * @param stage the stage to colour
   * @param tone `fill` for a solid chip, `text` for a readable foreground that
   *   sits on a tinted background.
   */
  public transform(stage: OpportunityStage | null | undefined, tone: 'fill' | 'text' = 'fill'): string {
    if (!stage) {
      return 'var(--slds-text-secondary)';
    }
    const token = STAGE_COLOR_TOKENS[stage];
    return tone === 'text' ? `color-mix(in srgb, ${token} 72%, black)` : token;
  }
}

const STAGE_COLOR_TOKENS: Record<OpportunityStage, string> = {
  [OpportunityStage.PROSPECTING]: 'var(--crm-stage-prospecting)',
  [OpportunityStage.QUALIFICATION]: 'var(--crm-stage-qualification)',
  [OpportunityStage.NEEDS_ANALYSIS]: 'var(--crm-stage-needs-analysis)',
  [OpportunityStage.VALUE_PROPOSITION]: 'var(--crm-stage-value-proposition)',
  [OpportunityStage.DECISION_MAKERS]: 'var(--crm-stage-decision-makers)',
  [OpportunityStage.NEGOTIATION]: 'var(--crm-stage-negotiation)',
  [OpportunityStage.CLOSED_WON]: 'var(--crm-stage-closed-won)',
  [OpportunityStage.CLOSED_LOST]: 'var(--crm-stage-closed-lost)'
};
