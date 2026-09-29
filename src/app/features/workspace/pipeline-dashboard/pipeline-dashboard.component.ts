import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzProgressModule } from 'ng-zorro-antd/progress';
import { NzTableModule } from 'ng-zorro-antd/table';
import { CurrencyFormatterPipe } from '@shared/pipes/currency-formatter.pipe';
import { CompactBadgeComponent, CompactBadgeColor } from '@shared/ui/compact-badge/compact-badge.component';
import { MetricChipComponent } from '@shared/ui/metric-chip/metric-chip.component';
import { ForecastCategory, OpportunityStage, WorkspaceTab } from '@core/models/crm.models';
import { CrmRepositoryService } from '@core/services/crm-repository.service';
import { WorkspaceTabService } from '@core/services/workspace-tab.service';
import {
  OPEN_STAGES,
  STAGE_CONFIG,
  calculateOpenPipelineValue,
  calculateWeightedForecast,
  calculateWinRate
} from '@core/utils/pipeline-calc';

interface StageRow {
  readonly stage: OpportunityStage;
  readonly label: string;
  readonly color: string;
  readonly count: number;
  readonly value: number;
  readonly weighted: number;
  /** Share of the open pipeline this stage represents, 0-100. */
  readonly share: number;
  readonly isTerminal: boolean;
}

interface ForecastRow {
  readonly category: ForecastCategory;
  readonly label: string;
  readonly count: number;
  readonly value: number;
  readonly color: CompactBadgeColor;
}

/**
 * Executive pipeline overview: the first thing the console shows.
 *
 * The four headline numbers answer the only questions a manager opens this
 * screen with — how much is in the pipe, what is likely to land, how often we
 * win, and what is overdue. Stage and forecast breakdowns follow.
 *
 * Bars are plain CSS widths rather than a charting dependency: there is no
 * interaction beyond navigation, and a 1 MB chart library is a poor trade for a
 * horizontal bar.
 */
@Component({
  selector: 'app-pipeline-dashboard',
  imports: [
    NzIconModule,
    NzProgressModule,
    NzTableModule,
    CompactBadgeComponent,
    CurrencyFormatterPipe,
    MetricChipComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './pipeline-dashboard.component.scss',
  template: `
    <section class="dashboard">
      <header class="dashboard__header">
        <h1 class="dashboard__title">Executive Pipeline</h1>
        <p class="dashboard__subtitle">
          <button type="button" class="dashboard__link" (click)="openAccountsList()">
            {{ repo.accounts().length }} accounts
          </button>
          <span aria-hidden="true"> · </span>
          <span>{{ repo.contacts().length }} contacts</span>
          <span aria-hidden="true"> · </span>
          <button type="button" class="dashboard__link" (click)="openOpportunitiesList()">
            {{ repo.opportunities().length }} opportunities
          </button>
        </p>
      </header>

      <div class="dashboard__metrics">
        <app-metric-chip label="Total pipeline" [value]="totalPipeline() | currencyFormatter" />
        <app-metric-chip label="Weighted forecast" [value]="weightedForecast() | currencyFormatter" />
        <app-metric-chip label="Closed won" [value]="closedWonValue() | currencyFormatter" />
        <app-metric-chip label="Win rate" [value]="winRate() + '%'" />
        <app-metric-chip label="Overdue" [value]="overdueCount()" />
        <app-metric-chip label="Due this month" [value]="dueThisMonthCount()" />
      </div>

      <div class="dashboard__panels">
        <section class="panel">
          <h2 class="panel__title">Pipeline by stage</h2>
          @if (stageRows().length === 0) {
            <p class="panel__empty">No opportunities yet. Create one to see the pipeline.</p>
          } @else {
            <ul class="stage-list" role="list">
              @for (row of stageRows(); track row.stage) {
                <li class="stage-row">
                  <button
                    type="button"
                    class="stage-row__label"
                    [style.--stage-color]="row.color"
                    (click)="openStage(row.stage)"
                  >
                    <span class="stage-row__swatch" aria-hidden="true"></span>
                    {{ row.label }}
                  </button>
                  <div class="stage-row__track">
                    <div
                      class="stage-row__bar"
                      [style.width.%]="row.share"
                      [style.background]="row.color"
                      role="img"
                      [attr.aria-label]="row.label + ': ' + (row.value | currencyFormatter) + ' across ' + row.count + ' deals'"
                    ></div>
                  </div>
                  <span class="stage-row__count">{{ row.count }}</span>
                  <span class="stage-row__value">{{ row.value | currencyFormatter }}</span>
                </li>
              }
            </ul>
          }
        </section>

        <section class="panel">
          <h2 class="panel__title">Forecast roll-up</h2>
          <nz-table #forecastTable [nzData]="forecastRows()" nzSize="small" [nzShowPagination]="false">
            <thead>
              <tr>
                <th>Category</th>
                <th nzAlign="right">Deals</th>
                <th nzAlign="right">Value</th>
              </tr>
            </thead>
            <tbody>
              @for (row of forecastRows(); track row.category) {
                <tr>
                  <td>
                    <app-compact-badge [status]="row.label" [colorType]="row.color" />
                  </td>
                  <td nzAlign="right" class="numeric">{{ row.count }}</td>
                  <td nzAlign="right" class="numeric">{{ row.value | currencyFormatter }}</td>
                </tr>
              }
            </tbody>
          </nz-table>
        </section>

        <section class="panel panel--wide">
          <h2 class="panel__title">Closing soon</h2>
          @if (closingSoon().length === 0) {
            <p class="panel__empty">No open deals have a close date in the next 30 days.</p>
          } @else {
            <nz-table #closingTable [nzData]="closingSoon()" nzSize="small" [nzShowPagination]="false">
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Account</th>
                  <th>Stage</th>
                  <th nzAlign="right">Amount</th>
                  <th nzAlign="right">Close</th>
                </tr>
              </thead>
              <tbody>
                @for (deal of closingSoon(); track deal.id) {
                  <tr class="closing-row" (click)="openOpportunity(deal.id)">
                    <td class="closing-row__name">{{ deal.name }}</td>
                    <td>{{ deal.accountName }}</td>
                    <td>
                      <app-compact-badge [status]="deal.stageLabel" [colorType]="deal.stageTone" />
                    </td>
                    <td nzAlign="right" class="numeric">{{ deal.amount | currencyFormatter }}</td>
                    <td nzAlign="right" class="numeric" [class.is-overdue]="deal.isOverdue">
                      {{ deal.closeDate }}
                    </td>
                  </tr>
                }
              </tbody>
            </nz-table>
          }
        </section>
      </div>
    </section>
  `
})
export class PipelineDashboardComponent {
  protected readonly repo = inject(CrmRepositoryService);
  private readonly tabService = inject(WorkspaceTabService);

  protected readonly totalPipeline = computed(() => calculateOpenPipelineValue([...this.repo.opportunities()]));
  protected readonly weightedForecast = computed(() => calculateWeightedForecast([...this.repo.opportunities()]));
  protected readonly winRate = computed(() => calculateWinRate([...this.repo.opportunities()]));
  protected readonly closedWonValue = computed(() =>
    this.repo
      .opportunities()
      .filter(opportunity => opportunity.stage === OpportunityStage.CLOSED_WON)
      .reduce((total, opportunity) => total + opportunity.amount, 0)
  );

  protected readonly overdueCount = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    return this.repo
      .opportunities()
      .filter(opportunity => !this.isClosed(opportunity.stage) && opportunity.closeDate < today).length;
  });

  protected readonly dueThisMonthCount = computed(() => {
    const now = new Date();
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getTime();
    return this.repo.opportunities().filter(opportunity => {
      if (this.isClosed(opportunity.stage)) {
        return false;
      }
      const close = Date.parse(`${opportunity.closeDate}T00:00:00`);
      return !Number.isNaN(close) && close <= endOfMonth;
    }).length;
  });

  protected readonly stageRows = computed<StageRow[]>(() => {
    const opportunities = this.repo.opportunities();
    const open = opportunities.filter(opportunity => !this.isClosed(opportunity.stage));
    const largest = Math.max(
      1,
      ...open.map(opportunity => opportunities.filter(candidate => candidate.stage === opportunity.stage).reduce((s, o) => s + o.amount, 0))
    );

    const stages = [...OPEN_STAGES, OpportunityStage.CLOSED_WON, OpportunityStage.CLOSED_LOST] as const;
    return stages.map(stage => {
      const inStage = opportunities.filter(opportunity => opportunity.stage === stage);
      const value = inStage.reduce((total, opportunity) => total + opportunity.amount, 0);
      return {
        stage,
        label: STAGE_CONFIG[stage].label,
        color: `var(--crm-stage-${stage.toLowerCase().replace(/_/g, '-')})`,
        count: inStage.length,
        value,
        weighted: inStage.reduce(
          (total, opportunity) => total + (opportunity.amount * STAGE_CONFIG[stage].probability) / 100,
          0
        ),
        // Bar width is relative to the busiest stage, so a late-stage-heavy pipe
        // does not flatten every earlier bar to nothing.
        share: Math.round((value / largest) * 100),
        isTerminal: this.isClosed(stage)
      };
    });
  });

  protected readonly forecastRows = computed<ForecastRow[]>(() => {
    const opportunities = this.repo.opportunities();
    const definition: { category: ForecastCategory; label: string; color: CompactBadgeColor }[] = [
      { category: ForecastCategory.PIPELINE, label: 'Pipeline', color: 'default' },
      { category: ForecastCategory.BEST_CASE, label: 'Best case', color: 'default' },
      { category: ForecastCategory.COMMIT, label: 'Commit', color: 'warning' },
      { category: ForecastCategory.CLOSED, label: 'Closed won', color: 'success' },
      { category: ForecastCategory.OMITTED, label: 'Omitted', color: 'error' }
    ];
    return definition.map(entry => {
      const inCategory = opportunities.filter(
        opportunity => this.categoryOf(opportunity.stage) === entry.category
      );
      return {
        ...entry,
        count: inCategory.length,
        value: inCategory.reduce((total, opportunity) => total + opportunity.amount, 0)
      };
    });
  });

  protected readonly closingSoon = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date();
    horizon.setDate(horizon.getDate() + 30);
    const horizonDay = horizon.toISOString().slice(0, 10);

    return this.repo
      .opportunities()
      .filter(
        opportunity =>
          !this.isClosed(opportunity.stage) && opportunity.closeDate >= today && opportunity.closeDate <= horizonDay
      )
      .slice()
      .sort((a, b) => (a.closeDate < b.closeDate ? -1 : a.closeDate > b.closeDate ? 1 : 0))
      .slice(0, 8)
      .map(opportunity => ({
        id: opportunity.id,
        name: opportunity.name,
        accountName: this.repo.account(opportunity.accountId)?.name ?? 'Unknown account',
        stageLabel: STAGE_CONFIG[opportunity.stage].label,
        stageTone: this.stageTone(opportunity.stage),
        amount: opportunity.amount,
        closeDate: opportunity.closeDate,
        isOverdue: false
      }));
  });

  /**
   * The counts in the subtitle are the fastest route to the master lists, so
   * they are buttons rather than text. A number that looks like a link but is
   * not is worse than plain text, and the underline below is the only thing
   * distinguishing them.
   */
  protected openAccountsList(): void {
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('LIST', 'accounts'),
      title: 'Accounts',
      entityType: 'LIST',
      entityId: null,
      listKey: 'accounts',
      icon: 'team',
      closable: true
    });
  }

  protected openOpportunitiesList(): void {
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('LIST', 'opportunities'),
      title: 'Opportunities',
      entityType: 'LIST',
      entityId: null,
      listKey: 'opportunities',
      icon: 'dollar',
      closable: true
    });
  }

  protected openOpportunity(id: string): void {
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('OPPORTUNITY', id),
      title: this.repo.opportunity(id)?.name ?? 'Opportunity',
      entityType: 'OPPORTUNITY',
      entityId: id,
      icon: 'dollar',
      closable: true
    });
  }

  protected openStage(stage: OpportunityStage): void {
    void stage;
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('LIST', 'opportunities'),
      title: 'Opportunities',
      entityType: 'LIST',
      entityId: null,
      listKey: 'opportunities',
      icon: 'dollar',
      closable: true,
      activeSubTabKey: stage.toLowerCase()
    });
  }

  private isClosed(stage: OpportunityStage): boolean {
    return STAGE_CONFIG[stage].closed;
  }

  private categoryOf(stage: OpportunityStage): ForecastCategory {
    return STAGE_CONFIG[stage].forecastCategory;
  }

  private stageTone(stage: OpportunityStage): CompactBadgeColor {
    if (stage === OpportunityStage.CLOSED_WON) {
      return 'success';
    }
    if (stage === OpportunityStage.CLOSED_LOST) {
      return 'error';
    }
    const probability = STAGE_CONFIG[stage].probability;
    if (probability >= 75) {
      return 'warning';
    }
    return 'default';
  }
}

/** Tab identity helper kept local so the dashboard does not import the models. */
export type DashboardTab = WorkspaceTab;
