import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzPopoverModule } from 'ng-zorro-antd/popover';
import { NzSegmentedModule } from 'ng-zorro-antd/segmented';

export type TableDensity = 'compact' | 'normal';

/** A selectable column, mirroring a column key owned by the consuming table. */
export interface ColumnToggle {
  readonly key: string;
  readonly label: string;
}

/** Popover body listing every column with a visibility checkbox. */
@Component({
  selector: 'app-dense-table-columns-popover',
  imports: [FormsModule, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <fieldset class="columns-popover">
      <legend class="columns-popover__legend">Visible columns</legend>
      @for (column of columns(); track column.key) {
        <label class="columns-popover__row">
          <input
            type="checkbox"
            [ngModel]="hiddenColumns().includes(column.key)"
            (ngModelChange)="toggle(column.key, $event)"
          />
          <span>{{ column.label }}</span>
        </label>
      }
    </fieldset>
  `,
  styles: [
    `
      .columns-popover {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        border: 0;
        min-width: 180px;
      }

      .columns-popover__legend {
        font-size: var(--slds-font-size-label);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--slds-text-secondary);
        padding: 0 0 4px;
      }

      .columns-popover__row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 2px 0;
        cursor: pointer;
        white-space: nowrap;
      }
    `
  ]
})
export class DenseTableColumnsPopoverComponent {
  readonly columns = input.required<readonly ColumnToggle[]>();
  readonly hiddenColumns = input.required<readonly string[]>();
  readonly columnsChanged = output<string[]>();

  protected toggle(key: string, hidden: boolean): void {
    const next = new Set(this.hiddenColumns());
    if (hidden) {
      next.add(key);
    } else {
      next.delete(key);
    }
    this.columnsChanged.emit([...next]);
  }
}

/**
 * Search, filter, column visibility, density switch and the create action.
 *
 * Everything a dense enterprise table needs sits in one 32px row so the grid
 * itself keeps the vertical space. The toolbar owns no data: it emits intents
 * and lets the table own filtering, so the same toolbar serves both list views.
 */
@Component({
  selector: 'app-dense-table-toolbar',
  imports: [
    FormsModule,
    NzButtonModule,
    NzIconModule,
    NzInputModule,
    NzPopoverModule,
    NzSegmentedModule,
    DenseTableColumnsPopoverComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toolbar">
      <label class="toolbar__search">
        <nz-icon nzType="search" class="toolbar__search-icon" />
        <input
          nz-input
          type="search"
          class="toolbar__search-input"
          [attr.aria-label]="searchPlaceholder()"
          [placeholder]="searchPlaceholder()"
          [ngModel]="search()"
          (ngModelChange)="onSearch($event)"
        />
      </label>

      <div class="toolbar__actions">
        <button
          nz-button
          nzType="default"
          nzSize="small"
          class="toolbar__button"
          [class.is-active]="filterActive()"
          [attr.aria-pressed]="filterActive()"
          (click)="filterToggle.emit()"
        >
          <nz-icon nzType="filter" />
          <span>Filter</span>
        </button>

        <ng-template #columnsTemplate>
          <app-dense-table-columns-popover
            [columns]="columns()"
            [hiddenColumns]="hiddenColumns()"
            (columnsChanged)="columnsChange.emit($event)"
          />
        </ng-template>

        <button
          nz-button
          nzType="default"
          nzSize="small"
          class="toolbar__button"
          nz-popover
          [nzPopoverContent]="columnsTemplate"
          nzPopoverTrigger="click"
          nzPopoverPlacement="bottomRight"
          aria-label="Choose visible columns"
        >
          <nz-icon nzType="menu" />
          <span>Columns</span>
        </button>

        <nz-segmented
          class="toolbar__density"
          size="small"
          [nzOptions]="densityOptions"
          [ngModel]="density()"
          (ngModelChange)="densityChange.emit($event)"
          aria-label="Table density"
        />

        <button
          nz-button
          nzType="primary"
          nzSize="small"
          class="toolbar__button"
          (click)="newClick.emit()"
        >
          <nz-icon nzType="plus" />
          <span>New</span>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 4px 0;
      }

      .toolbar__search {
        position: relative;
        display: flex;
        align-items: center;
        flex: 1 1 220px;
        min-width: 180px;
      }

      .toolbar__search-icon {
        position: absolute;
        left: 8px;
        color: var(--slds-text-secondary);
        pointer-events: none;
      }

      .toolbar__search-input {
        width: 100%;
      }

      .toolbar__actions {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-wrap: wrap;
      }

      .toolbar__button.is-active {
        border-color: var(--slds-brand);
        color: var(--slds-brand);
      }

      @media (pointer: coarse) {
        .toolbar__button {
          min-height: 44px;
        }
      }
    `
  ]
})
export class DenseTableToolbarComponent {
  /**
   * The debounce timer is a bare `setTimeout`, so nothing cancels it when the
   * view is destroyed. In a keep-alive workspace shell that means a toolbar
   * closed mid-keystroke fires `searchChange` against a destroyed component.
   */
  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    this.destroyRef.onDestroy(() => {
      if (this.debounceHandle !== null) {
        clearTimeout(this.debounceHandle);
        this.debounceHandle = null;
      }
    });
  }

  public readonly searchPlaceholder = input<string>('Search records...');
  public readonly filterActive = input<boolean>(false);
  /** Column definitions; the default is the bare search/create toolbar. */
  public readonly columns = input<readonly ColumnToggle[]>([]);
  /** Keys currently hidden, so the parent owns the single source of truth. */
  public readonly hiddenColumns = input<readonly string[]>([]);
  public readonly density = input<TableDensity>('normal');

  public readonly searchChange = output<string>();
  public readonly filterToggle = output<void>();
  public readonly newClick = output<void>();
  public readonly densityChange = output<TableDensity>();
  public readonly columnsChange = output<string[]>();

  protected readonly densityOptions = [
    { label: 'Comfortable', value: 'normal' },
    { label: 'Compact', value: 'compact' }
  ];

  /** Debounces typing so a keystroke does not re-filter the whole dataset. */
  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  private readonly searchTerm = signal<string>('');

  protected readonly search = computed(() => this.searchTerm());

  protected onSearch(value: string): void {
    this.searchTerm.set(value);
    if (this.debounceHandle !== null) {
      clearTimeout(this.debounceHandle);
    }
    this.debounceHandle = setTimeout(() => {
      this.debounceHandle = null;
      this.searchChange.emit(value);
    }, 200);
  }
}
