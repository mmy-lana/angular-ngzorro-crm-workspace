import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzPaginationModule } from 'ng-zorro-antd/pagination';
import { NzTableModule } from 'ng-zorro-antd/table';
import { Account, FilterCriterion, SortCriterion, UUID } from '@core/models/crm.models';
import { CrmRepositoryService } from '@core/services/crm-repository.service';
import { QuickCreateStateService } from '@core/services/quick-create-state.service';
import { WorkspaceTabService } from '@core/services/workspace-tab.service';
import { ViewportService } from '@core/services/viewport.service';
import { evaluateCriteria } from '@core/utils/filter-evaluator';
import { formatCompactCurrency } from '@shared/pipes/currency-formatter.pipe';
import { CompactBadgeComponent, CompactBadgeColor } from '@shared/ui/compact-badge/compact-badge.component';
import {
  DenseTableToolbarComponent,
  TableDensity
} from '@shared/ui/dense-table-toolbar/dense-table-toolbar.component';

/** Columns available to the visibility picker, in display order. */
const ALL_COLUMNS = [
  { key: 'name', label: 'Account' },
  { key: 'accountNumber', label: 'Number' },
  { key: 'industry', label: 'Industry' },
  { key: 'rating', label: 'Rating' },
  { key: 'annualRevenue', label: 'Revenue' },
  { key: 'contactCount', label: 'Contacts' },
  { key: 'openDeals', label: 'Open deals' },
  { key: 'ownerName', label: 'Owner' }
] as const;

const DEFAULT_PAGE_SIZE = 25;
type ColumnKey = (typeof ALL_COLUMNS)[number]['key'];

/**
 * Account list with client-side search, filtering, sorting and pagination.
 *
 * Everything runs in the browser over the signal store, so a search keystroke is
 * synchronous and a row click opens instantly with no loading state. The dataset
 * is small enough for this to be the right trade; a server-backed list would
 * need debouncing and a request state instead.
 *
 * Below 768px the table is replaced by a card stream: a horizontally scrolling
 * table on a phone hides its own columns behind a gesture nobody performs.
 */
@Component({
  selector: 'app-account-list',
  imports: [
    NzEmptyModule,
    NzIconModule,
    NzPaginationModule,
    NzTableModule,
    CompactBadgeComponent,
    DenseTableToolbarComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-list.component.scss',
  template: `
    <div class="list">
      <app-dense-table-toolbar
        searchPlaceholder="Search accounts, numbers, owners..."
        [filterActive]="filters().length > 0"
        [columns]="columnOptions"
        [hiddenColumns]="hiddenColumns()"
        [density]="density()"
        (searchChange)="onSearch($event)"
        (filterToggle)="toggleFilter()"
        (newClick)="createAccount()"
        (densityChange)="density.set($event)"
        (columnsChange)="hiddenColumns.set($event)"
      />

      @if (filters().length > 0) {
        <div class="list__filter-bar">
          <span class="list__filter-label">Filters</span>
          @for (filter of filters(); track $index) {
            <span class="list__chip">
              {{ filter.field }} {{ operatorLabel(filter.operator) }}
              @if (filter.value !== undefined) {
                {{ filter.value }}
              }
              <button type="button" class="list__chip-clear" [attr.aria-label]="'Remove ' + filter.field + ' filter'" (click)="removeFilter($index)">
                <nz-icon nzType="close" />
              </button>
            </span>
          }
          <button nz-button nzType="link" nzSize="small" (click)="clearFilters()">Clear all</button>
        </div>
      }

      @if (viewport.isMobile()) {
        @if (rows().length === 0) {
          <nz-empty nzNotFoundContent="No accounts match the current search."></nz-empty>
        } @else {
          <ul class="cards" role="list">
            @for (row of pageRows(); track row.account.id) {
              <li class="cards__item">
                <button type="button" class="cards__button" (click)="open(row.account.id)">
                  <span class="cards__head">
                    <span class="cards__title">{{ row.account.name }}</span>
                    <app-compact-badge [status]="row.account.rating" [colorType]="ratingTone(row.account.rating)" />
                  </span>
                  <span class="cards__meta">
                    {{ row.account.accountNumber }} · {{ titleCase(row.account.industry) }}
                  </span>
                  <span class="cards__meta">
                    {{ row.contactCount }} contacts · {{ row.openDeals }} open ·
                    {{ format(row.account.annualRevenue) }}
                  </span>
                </button>
              </li>
            }
          </ul>
        }
      } @else {
        <nz-table
          #table
          [nzData]="rows()"
          [nzShowPagination]="false"
          nzSize="small"
          [nzScroll]="{ x: '900px' }"
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
            @for (row of pageRows(); track row.account.id) {
              <tr class="list__row" (click)="open(row.account.id)">
                @for (column of visibleColumns(); track column.key) {
                  <td [class.list__name]="column.key === 'name'">
                    @switch (column.key) {
                      @case ('name') {
                        <span class="list__primary">{{ row.account.name }}</span>
                      }
                      @case ('industry') {
                        {{ titleCase(row.account.industry) }}
                      }
                      @case ('rating') {
                        <app-compact-badge [status]="row.account.rating" [colorType]="ratingTone(row.account.rating)" />
                      }
                      @case ('annualRevenue') {
                        <span class="list__numeric">{{ format(row.account.annualRevenue) }}</span>
                      }
                      @case ('contactCount') {
                        <span class="list__numeric">{{ row.contactCount }}</span>
                      }
                      @case ('openDeals') {
                        <span class="list__numeric">{{ row.openDeals }}</span>
                      }
                      @default {
                        {{ row.account[column.key] }}
                      }
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </nz-table>
      }

      @if (!viewport.isMobile() && rows().length === 0) {
        <nz-empty nzNotFoundContent="No accounts match the current search."></nz-empty>
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
export class AccountListComponent {
  private readonly repo = inject(CrmRepositoryService);
  private readonly tabService = inject(WorkspaceTabService);
  private readonly drawer = inject(QuickCreateStateService);

  protected readonly viewport = inject(ViewportService);

  protected readonly pageSize = DEFAULT_PAGE_SIZE;
  protected readonly columnOptions = ALL_COLUMNS.map(column => ({ key: column.key, label: column.label }));
  protected readonly density = signal<TableDensity>('normal');
  protected readonly hiddenColumns = signal<string[]>(['accountNumber', 'contactCount']);
  protected readonly searchTerm = signal<string>('');
  protected readonly filters = signal<FilterCriterion[]>([]);
  protected readonly sorts = signal<SortCriterion[]>([{ field: 'name', direction: 'asc' }]);
  protected readonly pageIndex = signal<number>(0);

  private readonly contactCounts = computed(() => {
    const counts = new Map<UUID, number>();
    for (const contact of this.repo.contacts()) {
      counts.set(contact.accountId, (counts.get(contact.accountId) ?? 0) + 1);
    }
    return counts;
  });

  private readonly openDealCounts = computed(() => {
    const counts = new Map<UUID, number>();
    for (const opportunity of this.repo.opportunities()) {
      if (opportunity.stage.startsWith('CLOSED')) {
        continue;
      }
      counts.set(opportunity.accountId, (counts.get(opportunity.accountId) ?? 0) + 1);
    }
    return counts;
  });

  private readonly enriched = computed(() =>
    this.repo.accounts().map(account => ({
      account,
      contactCount: this.contactCounts().get(account.id) ?? 0,
      openDeals: this.openDealCounts().get(account.id) ?? 0
    }))
  );

  /** Search, filters and sorts compose through the shared evaluator. */
  protected readonly rows = computed(() => {
    const term = this.searchTerm().trim();
    const search =
      term.length > 0
        ? {
            term,
            fields: ['account.name', 'account.accountNumber', 'account.ownerName', 'account.industry']
          }
        : undefined;

    return evaluateCriteria(this.enriched(), this.filters(), this.sorts(), search);
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

  protected toggleFilter(): void {
    if (this.filters().length > 0) {
      this.filters.set([]);
      return;
    }
    // Seed with the two filters a sales manager reaches for first.
    this.filters.set([
      { field: 'account.rating', operator: 'equals', value: 'HOT' },
      { field: 'openDeals', operator: 'greaterThan', value: 0 }
    ]);
  }

  protected removeFilter(index: number): void {
    this.filters.update(current => current.filter((_, position) => position !== index));
    this.pageIndex.set(0);
  }

  protected clearFilters(): void {
    this.filters.set([]);
    this.pageIndex.set(0);
  }

  /**
   * Appends the column to the sort chain, flipping an existing one, and
   * re-appending it on a third click so a column can be promoted in a
   * multi-sort without clearing the rest.
   */
  protected toggleSort(key: ColumnKey): void {
    const field = `account.${key}`;
    this.sorts.update(current => {
      const existing = current.find(sort => sort.field === field);
      if (!existing) {
        return [...current, { field, direction: 'asc' as const }];
      }
      if (existing.direction === 'asc') {
        return current.map(sort => (sort === existing ? { field, direction: 'desc' as const } : sort));
      }
      return [...current.filter(sort => sort !== existing), { field, direction: 'asc' as const }];
    });
  }

  protected sortGlyph(key: ColumnKey): string {
    const sort = this.sorts().find(candidate => candidate.field === `account.${key}`);
    if (!sort) {
      return '\u21C5';
    }
    return sort.direction === 'asc' ? '\u25B2' : '\u25BC';
  }

  protected ariaSort(key: ColumnKey): 'ascending' | 'descending' | null {
    const field = `account.${key}`;
    const sort = this.sorts().find(candidate => candidate.field === field || candidate.field === key);
    if (!sort) {
      return null;
    }
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected operatorLabel(operator: FilterCriterion['operator']): string {
    switch (operator) {
      case 'equals':
        return '=';
      case 'contains':
        return 'contains';
      case 'greaterThan':
        return '>';
      case 'lessThan':
        return '<';
      case 'in':
        return 'in';
      case 'isEmpty':
        return 'is empty';
      case 'isNotEmpty':
        return 'is not empty';
    }
  }

  protected open(id: UUID): void {
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('ACCOUNT', id),
      title: this.repo.account(id)?.name ?? 'Account',
      entityType: 'ACCOUNT',
      entityId: id,
      icon: 'team',
      closable: true
    });
  }

  protected createAccount(): void {
    this.drawer.openCreate('ACCOUNT');
  }

  protected format(value: number): string {
    return formatCompactCurrency(value);
  }

  protected titleCase(value: string): string {
    return value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, character => character.toUpperCase());
  }

  protected ratingTone(rating: 'HOT' | 'WARM' | 'COLD'): CompactBadgeColor {
    if (rating === 'HOT') {
      return 'error';
    }
    return rating === 'WARM' ? 'warning' : 'default';
  }
}

/** Re-exported so the shell can build a list tab without importing the models. */
export type AccountRow = Pick<Account, 'id'>;
