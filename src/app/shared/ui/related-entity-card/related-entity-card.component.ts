import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { UUID } from '@core/models/crm.models';

/** A column definition; `key` is a dotted path read from each data row. */
export interface RelatedColumn {
  readonly key: string;
  readonly label: string;
}

/**
 * Compact related-records grid.
 *
 * Rows are supplied as `unknown` because the same card renders accounts,
 * contacts, opportunities and activities. The card never inspects the payload:
 * it reads each cell through the dotted `key` of its column definition and
 * ignores anything that is not a primitive, so a caller can never break the
 * card by widening a row type.
 */
@Component({
  selector: 'app-related-entity-card',
  imports: [NzButtonModule, NzEmptyModule, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './related-entity-card.component.scss',
  template: `
    <section class="related-card">
      <header class="related-card__header">
        <h2 class="related-card__title">
          {{ title() }}
          <span class="related-card__count">{{ count() }}</span>
        </h2>
        <button
          nz-button
          nzType="default"
          nzSize="small"
          class="related-card__add"
          [attr.aria-label]="'Add ' + title()"
          (click)="addClick.emit()"
        >
          <nz-icon nzType="plus" />
          <span>Add</span>
        </button>
      </header>

      @if (data().length === 0) {
        <nz-empty [nzNotFoundContent]="emptyText()"></nz-empty>
      } @else {
        <table class="related-card__table">
          <thead>
            <tr>
              @for (column of columns(); track column.key) {
                <th scope="col">{{ column.label }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.id) {
              <tr (click)="rowClick.emit(row.id)" tabindex="0" (keydown.enter)="rowClick.emit(row.id)">
                @for (column of columns(); track column.key) {
                  <td [attr.title]="row.cells[column.key]">{{ row.cells[column.key] }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      }
    </section>
  `
})
export class RelatedEntityCardComponent {
  public readonly title = input.required<string>();
  public readonly count = input.required<number>();
  public readonly columns = input.required<readonly RelatedColumn[]>();
  public readonly data = input.required<readonly unknown[]>();
  public readonly emptyText = input<string>('Nothing here yet.');

  public readonly addClick = output<void>();
  public readonly rowClick = output<UUID>();

  /** Rows projected to a stable id plus a cell map, computed once per change. */
  protected readonly rows = computed(() =>
    this.data().map(item => ({
      id: readString(item, 'id'),
      cells: this.cellMap(item)
    }))
  );

  private cellMap(row: unknown): Record<string, string> {
    const cells: Record<string, string> = {};
    for (const column of this.columns()) {
      cells[column.key] = formatCell(readPath(row, column.key));
    }
    return cells;
  }
}

/** Reads a dotted path from an unknown row without assuming a record shape. */
function readPath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || typeof current !== 'object') {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, source);
}

/** Stable row identity; rows without one are skipped by the `@for` tracker. */
function readString(source: unknown, key: string): string {
  const value = readPath(source, key);
  return typeof value === 'string' ? value : '';
}

/** Renders a cell as a string, reserving a visible dash for absent values. */
function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') {
    return '—';
  }
  if (typeof value === 'number') {
    return value.toLocaleString('en-US');
  }
  if (typeof value === 'boolean') {
    return value ? 'Yes' : 'No';
  }
  if (typeof value === 'object') {
    // An object cell has no meaningful inline rendering; show its keys count is
    // noise, so surface it as a dash rather than "[object Object]".
    return '—';
  }
  return String(value);
}
