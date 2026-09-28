import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { SupportedIcon } from '@core/models/crm.models';
import { ViewportService } from '@core/services/viewport.service';
import { MetricChipComponent } from '@shared/ui/metric-chip/metric-chip.component';

/** A single label/value pair rendered as a chip in the banner strip. */
export interface BannerMetric {
  readonly label: string;
  readonly value: string;
}

/**
 * Record identity header for a detail view.
 *
 * Carries the entity icon, the title, a responsive strip of 2-4 metrics and the
 * edit/delete cluster. The metric strip drops to two columns on a phone and
 * becomes four on a desktop, and the action cluster collapses to icon-only
 * buttons under a coarse pointer so the header never wraps into three rows.
 */
@Component({
  selector: 'app-record-banner',
  imports: [NzButtonModule, NzIconModule, MetricChipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './record-banner.component.scss',
  template: `
    <header class="record-banner">
      <div class="record-banner__identity">
        <span class="record-banner__icon" aria-hidden="true">
          <nz-icon [nzType]="icon()" />
        </span>
        <h1 class="record-banner__title" [attr.title]="title()">{{ title() }}</h1>
      </div>

      @if (metrics().length > 0) {
        <div class="record-banner__metrics">
          @for (metric of metrics(); track metric.label) {
            <app-metric-chip [label]="metric.label" [value]="metric.value" />
          }
        </div>
      }

      <div class="record-banner__actions">
        <button
          nz-button
          nzType="default"
          nzSize="small"
          class="record-banner__action"
          [attr.aria-label]="editLabel()"
          (click)="editClick.emit()"
        >
          <nz-icon nzType="edit" />
          @if (!viewport.isCoarsePointer()) {
            <span>{{ editLabel() }}</span>
          }
        </button>

        <button
          nz-button
          nzType="default"
          nzDanger
          nzSize="small"
          class="record-banner__action"
          [attr.aria-label]="deleteLabel()"
          (click)="deleteClick.emit()"
        >
          <nz-icon nzType="delete" />
          @if (!viewport.isCoarsePointer()) {
            <span>{{ deleteLabel() }}</span>
          }
        </button>
      </div>
    </header>
  `
})
export class RecordBannerComponent {
  protected readonly viewport = inject(ViewportService);

  public readonly title = input.required<string>();
  public readonly icon = input.required<SupportedIcon>();
  public readonly metrics = input.required<readonly BannerMetric[]>();
  public readonly editLabel = input<string>('Edit');
  public readonly deleteLabel = input<string>('Delete');

  public readonly editClick = output<void>();
  public readonly deleteClick = output<void>();
}
