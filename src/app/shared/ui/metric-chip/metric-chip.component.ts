import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Label-over-value tile used in record banners and the dashboard metric strip.
 *
 * The label is rendered above the value at label size and the value at heading
 * size, with tabular figures so a row of chips keeps its digits aligned as
 * values change. `title` gives the native tooltip for a value that is visually
 * truncated on narrow viewports.
 */
@Component({
  selector: 'app-metric-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="metric-chip__label">{{ label() }}</span>
    <span class="metric-chip__value" [attr.title]="displayTitle()">{{ value() }}</span>
  `,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        gap: 1px;
        min-width: 0;
        padding: 2px 0;
      }

      .metric-chip__label {
        font-size: var(--slds-font-size-label);
        line-height: 1.2;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--slds-text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .metric-chip__value {
        font-size: var(--slds-font-size-heading);
        line-height: 1.25;
        font-weight: 600;
        color: var(--slds-text-primary);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    `
  ]
})
export class MetricChipComponent {
  public readonly label = input.required<string>();
  public readonly value = input.required<string | number>();

  protected displayTitle(): string {
    const value = this.value();
    return typeof value === 'number' ? value.toLocaleString('en-US') : value;
  }
}
