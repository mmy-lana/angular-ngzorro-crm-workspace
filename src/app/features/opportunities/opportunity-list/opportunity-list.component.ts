import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPaginationModule } from 'ng-zorro-antd/pagination';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTableModule } from 'ng-zorro-antd/table';
import {
  FilterCriterion,
  ForecastCategory,
  OpportunityStage,
  OpportunityView,
  SortCriterion,
  UUID
} from '@core/models/crm.models';
import { CrmRepositoryService } from '@core/services/crm-repository.service';
import { QuickCreateStateService } from '@core/services/quick-create-state.service';
import { ViewportService } from '@core/services/viewport.service';
import { WorkspaceTabService } from '@core/services/workspace-tab.service';
import { evaluateCriteria } from '@core/utils/filter-evaluator';
import { STAGE_CONFIG, isClosedStage } from '@core/utils/pipeline-calc';
import { formatCompactCurrency } from '@shared/pipes/currency-formatter.pipe';
import { StageColorPipe } from '@shared/pipes/stage-color.pipe';
import { CompactBadgeComponent, CompactBadgeColor } from '@shared/ui/compact-badge/compact-badge.component';
import { DenseTableToolbarComponent, TableDensity } from '@shared/ui/dense-table-toolbar/dense-table-toolbar.component';

const ALL_COLUMNS = [
  { key: 'name', label: 'Opportunity' },
  { key: 'accountName', label: 'Account' },
  { key: 'stage', label: 'Stage' },
  { key: 'amount', label: 'Amount' },
  { key: 'probability', label: 'Prob.' },
  { key: 'expectedRevenue', label: 'Expected' },
  { key: 'closeDate', label: 'Close' },
  { key: 'forecastCategory', label: 'Forecast' },
  { key: 'ownerName', label: 'Owner' }
] as const;

const DEFAULT_PAGE_SIZE = 25;
type ColumnKey = (typeof ALL_COLUMNS)[number]['key'];

interface OpportunityRow extends OpportunityView {
  readonly accountName: string;
}

/**
 * Opportunity list, the pipeline view of the same data the dashboard summarises.
 *
 * It reads `opportunitiesWithDerived` rather than the raw records, so probability,
 * expected revenue and forecast roll-up are present on every row without each
 * cell recomputing them. Sorting and filtering go through the same shared
 * evaluator the account list uses, which keeps "what order is this in" a single
 * decision rather than one per screen.
 */
@Component({
  selector: 'app-opportunity-list',
  imports: [
    FormsModule,
    NzEmptyModule,
    NzIconModule,
    NzPaginationModule,
    NzSelectModule,
    NzTableModule,
    CompactBadgeComponent,
    DenseTableToolbarComponent,
    StageColorPipe
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './opportunity-list.component.scss',
  template: `
    <div class="list">
      <app-dense-table-toolbar
        searchPlaceholder="Search opportunities, accounts, owners..."
        [filterActive]="stageFilter() !== 'ALL'"
        [columns]="columnOptions"
        [hiddenColumns]="hiddenColumns()"
        [density]="density()"
        (searchChange)="onSearch($event)"
        (filterToggle)="cycleStageFilter()"
        (newClick)="createOpportunity()"
        (densityChange)="density.set($event)"
        (columnsChange)="hiddenColumns.set($event)"
      />

      <div class="list__filter-bar">
        <div class="list__stage-filter">
          <span id="stage-filter-label">Stage</span>
          <nz-select
            [ngModel]="stageFilter()"
            (ngModelChange)="onStageFilter($event)"
            nzSize="small"
            class="list__stage-select"
            aria-labelledby="stage-filter-label"
          >
            <nz-option nzValue="ALL" nzLabel="All stages" />
            @for (stage of stages; track stage) {
              <nz-option [nzValue]="stage" [nzLabel]="stageLabel(stage)" />
            }
          </nz-select>
        </div>
        <span class="list__result-count">{{ rows().length }} of {{ total() }} opportunities</span>
      </div>

      @if (rows().length === 0) {
        <nz-empty nzNotFoundContent="No opportunities match the current filters."></nz-empty>
      } @else if (viewport.isMobile()) {
        <ul class="cards" role="list">
          @for (row of pageRows(); track row.id) {
            <li>
              <button type="button" class="cards__button" (click)="open(row.id)">
                <span class="cards__head">
                  <span class="cards__title">{{ row.name }}</span>
                  <app-compact-badge [status]="stageLabel(row.stage)" [colorType]="stageTone(row.stage)" />
                </span>
                <span class="cards__meta">{{ row.accountName }} · {{ row.ownerName }}</span>
                <span class="cards__meta">
                  {{ format(row.amount) }} · {{ row.probability }}% · closes {{ row.closeDate }}
                </span>
              </button>
            </li>
          }
        </ul>
      } @else {
        <nz-table
          [nzData]="pageRows()"
          [nzShowPagination]="false"
          nzSize="small"
          [nzScroll]="{ x: '1000px' }"
        >
          <thead>
            <tr>
              @for (column of visibleColumns(); track column.key) {
                <th [attr.aria-sort]="ariaSort(column.key)">
                  <button type="button" class="list__sort" (click)="toggleSort(column.key)">
                    <span>{{ column.label }}</span>
                    <span class="list__sort-icon" aria-hidden="true">{{ sortGlyph(column.key) }}</span>
                  </button>
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of pageRows(); track row.id) {
              <tr class="list__row" (click)="open(row.id)">
                @for (column of visibleColumns(); track column.key) {
                  <td>
                    @switch (column.key) {
                      @case ('name') {
                        <span class="list__primary">{{ row.name }}</span>
                      }
                      @case ('accountName') {
                        {{ row.accountName }}
                      }
                      @case ('stage') {
                        <span class="list__stage" [style.--stage-color]="row.stage | stageColor">
                          <span class="list__stage-dot" aria-hidden="true"></span>
                          {{ stageLabel(row.stage) }}
                        </span>
                      }
                      @case ('amount') {
                        <span class="list__numeric">{{ format(row.amount) }}</span>
                      }
                      @case ('probability') {
                        <span class="list__numeric">{{ row.probability }}%</span>
                      }
                      @case ('expectedRevenue') {
                        <span class="list__numeric">{{ format(row.expectedRevenue) }}</span>
                      }
                      @case ('closeDate') {
                        <span class="list__numeric" [class.is-overdue]="isOverdue(row)">{{ row.closeDate }}</span>
                      }
                      @case ('forecastCategory') {
                        <app-compact-badge [status]="row.forecastCategory" [colorType]="forecastTone(row)" />
                      }
                      @default {
                        {{ row[column.key] }}
                      }
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </nz-table>
      }

      @if (rows().length > pageSize) {
        <nz-pagination
          class="list__pager"
          [nzPageIndex]="pageIndex() + 1"
          [nzPageSize]="pageSize"
          [nzTotal]="rows().length"
          [nzShowSizeChanger]="false"
          (nzPageIndexChange)="pageIndex.set($event - 1)"
        />
      }
    </div>
  `
})
export class OpportunityListComponent {
  private readonly repo = inject(CrmRepositoryService);
  private readonly tabService = inject(WorkspaceTabService);
  private readonly drawer = inject(QuickCreateStateService);

  protected readonly viewport = inject(ViewportService);

  protected readonly pageSize = DEFAULT_PAGE_SIZE;
  protected readonly columnOptions = ALL_COLUMNS.map(column => ({ key: column.key, label: column.label }));
  protected readonly stages = Object.values(OpportunityStage);
  protected readonly density = signal<TableDensity>('normal');
  protected readonly hiddenColumns = signal<string[]>(['ownerName', 'expectedRevenue']);
  protected readonly searchTerm = signal<string>('');
  protected readonly stageFilter = signal<string>('ALL');
  protected readonly sorts = signal<SortCriterion[]>([{ field: 'closeDate', direction: 'asc' }]);
  protected readonly pageIndex = signal<number>(0);

  private readonly enriched = computed<OpportunityRow[]>(() =>
    this.repo.opportunitiesWithDerived().map(view => ({
      ...view,
      accountName: this.repo.account(view.accountId)?.name ?? 'Unknown account'
    }))
  );

  protected readonly total = computed(() => this.repo.opportunities().length);

  protected readonly rows = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const criteria: FilterCriterion[] = [];

    if (term.length > 0) {
      criteria.push(
        { field: 'name', operator: 'contains', value: term },
        { field: 'accountName', operator: 'contains', value: term },
        { field: 'ownerName', operator: 'contains', value: term }
      );
    }
    const stage = this.stageFilter();
    if (stage !== 'ALL') {
      criteria.push({ field: 'stage', operator: 'equals', value: stage });
    }
    return evaluateCriteria(this.enriched(), criteria, this.sorts());
  });

  protected readonly pageRows = computed(() => {
    const all = this.rows();
    const start = this.pageIndex() * this.pageSize;
    return all.slice(start, start + this.pageSize);
  });

  protected readonly visibleColumns = computed(() =>
    ALL_COLUMNS.filter(column => !this.hiddenColumns().includes(column.key))
  );

  protected onSearch(term: string): void {
    this.searchTerm.set(term);
    this.pageIndex.set(0);
  }

  protected onStageFilter(stage: string): void {
    this.stageFilter.set(stage);
    this.pageIndex.set(0);
  }

  /** The filter toggle walks the stages, which is faster than opening a popover. */
  protected cycleStageFilter(): void {
    const order = ['ALL', ...this.stages];
    const current = order.indexOf(this.stageFilter());
    this.onStageFilter(order[(current + 1) % order.length]);
  }

  protected toggleSort(key: ColumnKey): void {
    this.sorts.update(current => {
      const existing = current.find(sort => sort.field === key);
      if (!existing) {
        return [...current, { field: key, direction: 'asc' as const }];
      }
      if (existing.direction === 'asc') {
        return current.map(sort => (sort === existing ? { field: key, direction: 'desc' as const } : sort));
      }
      return [...current.filter(sort => sort !== existing), { field: key, direction: 'asc' as const }];
    });
    this.pageIndex.set(0);
  }

  protected sortGlyph(key: ColumnKey): string {
    const sort = this.sorts().find(candidate => candidate.field === key);
    if (!sort) {
      return '\u21C5';
    }
    return sort.direction === 'asc' ? '\u25B2' : '\u25BC';
  }

  protected ariaSort(key: ColumnKey): 'ascending' | 'descending' | null {
    const sort = this.sorts().find(candidate => candidate.field === key);
    if (!sort) {
      return null;
    }
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected stageLabel(stage: OpportunityStage): string {
    return STAGE_CONFIG[stage].label;
  }

  protected stageTone(stage: OpportunityStage): CompactBadgeColor {
    if (stage === OpportunityStage.CLOSED_WON) {
      return 'success';
    }
    if (stage === OpportunityStage.CLOSED_LOST) {
      return 'error';
    }
    return STAGE_CONFIG[stage].probability >= 75 ? 'warning' : 'default';
  }

  protected forecastTone(row: OpportunityRow): CompactBadgeColor {
    switch (row.forecastCategory) {
      case ForecastCategory.CLOSED:
        return 'success';
      case ForecastCategory.COMMIT:
        return 'warning';
      case ForecastCategory.OMITTED:
        return 'error';
      case ForecastCategory.PIPELINE:
      case ForecastCategory.BEST_CASE:
        return 'default';
    }
  }

  protected isOverdue(row: OpportunityRow): boolean {
    return !isClosedStage(row.stage) && row.closeDate < new Date().toISOString().slice(0, 10);
  }

  protected format(value: number): string {
    return formatCompactCurrency(value);
  }

  protected open(id: UUID): void {
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('OPPORTUNITY', id),
      title: this.repo.opportunity(id)?.name ?? 'Opportunity',
      entityType: 'OPPORTUNITY',
      entityId: id,
      icon: 'dollar',
      closable: true
    });
  }

  protected createOpportunity(): void {
    this.drawer.openCreate('OPPORTUNITY');
  }
}
