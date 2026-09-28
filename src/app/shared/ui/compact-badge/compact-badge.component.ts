import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NzBadgeModule } from 'ng-zorro-antd/badge';

/** Semantic tone of a compact badge, mapped onto the badge status vocabulary. */
export type CompactBadgeColor = 'success' | 'warning' | 'error' | 'default';

/**
 * Dense, single-line status chip.
 *
 * Record headers and table cells only have room for a dot plus a short word, so
 * this wraps the design-system badge with a fixed line height and a
 * non-wrapping label that keeps dense rows from reflowing when a value changes.
 */
@Component({
  selector: 'app-compact-badge',
  imports: [NzBadgeModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nz-badge [nzStatus]="badgeStatus()" [nzText]="status()"></nz-badge>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        align-items: center;
        line-height: 1.4;
        font-size: var(--slds-font-size-body);
        white-space: nowrap;
      }
    `
  ]
})
export class CompactBadgeComponent {
  public readonly status = input.required<string>();
  public readonly colorType = input.required<CompactBadgeColor>();

  protected readonly badgeStatus = computed(() => this.colorType());
}
