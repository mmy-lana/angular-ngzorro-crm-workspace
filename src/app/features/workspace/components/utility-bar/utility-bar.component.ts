import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';

/** Quick actions exposed on the status bar. */
export type QuickAction = 'NEW_ACCOUNT' | 'NEW_TASK' | 'SEARCH';

/**
 * Sticky status and action bar.
 *
 * On a phone it docks to the bottom of the viewport above the safe area, so the
 * three primary actions are reachable with a thumb without scrolling back to the
 * top. On wider screens it sits inline under the tab strip.
 *
 * Shortcuts are advertised here rather than only in a menu: a keyboard-driven
 * console user should not have to guess that "/" searches.
 */
@Component({
  selector: 'app-utility-bar',
  imports: [NzButtonModule, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="utility-bar" role="toolbar" aria-label="Workspace actions and status">
      <div class="utility-bar__status" aria-live="polite">
        <span class="utility-bar__count">{{ entityCount() }}</span>
        <span class="utility-bar__status-label">
          {{ entityCount() === 1 ? 'record' : 'records' }} in workspace
        </span>
        <span class="utility-bar__tab-status">{{ tabStatus() }}</span>
      </div>

      <div class="utility-bar__actions">
        <button
          nz-button
          nzType="default"
          class="utility-bar__action"
          (click)="quickActionClick.emit('SEARCH')"
        >
          <nz-icon nzType="search" />
          <span class="utility-bar__action-label">Search</span>
          <kbd class="utility-bar__kbd" aria-hidden="true">/</kbd>
        </button>

        <button
          nz-button
          nzType="default"
          class="utility-bar__action"
          (click)="quickActionClick.emit('NEW_TASK')"
        >
          <nz-icon nzType="calendar" />
          <span class="utility-bar__action-label">New task</span>
        </button>

        <button
          nz-button
          nzType="primary"
          class="utility-bar__action"
          (click)="quickActionClick.emit('NEW_ACCOUNT')"
        >
          <nz-icon nzType="plus" />
          <span class="utility-bar__action-label">New account</span>
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .utility-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
        padding: 4px 8px;
        background: var(--slds-surface-card);
        border-bottom: 1px solid var(--slds-border);
      }

      .utility-bar__status {
        display: flex;
        align-items: baseline;
        gap: 5px;
        min-width: 0;
        font-size: var(--slds-font-size-body);
        color: var(--slds-text-secondary);
      }

      .utility-bar__count {
        font-weight: 700;
        color: var(--slds-text-primary);
        font-variant-numeric: tabular-nums;
      }

      .utility-bar__tab-status {
        color: var(--slds-brand);
      }

      .utility-bar__actions {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-left: auto;
        flex-wrap: wrap;
      }

      .utility-bar__action {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }

      .utility-bar__kbd {
        padding: 0 4px;
        border: 1px solid var(--slds-border);
        border-radius: 2px;
        background: var(--slds-surface);
        font-family: inherit;
        font-size: var(--slds-font-size-label);
        color: var(--slds-text-secondary);
      }

      /* Docks to the bottom of the viewport, clear of the home indicator. */
      @media (max-width: 767px) {
        .utility-bar {
          position: sticky;
          bottom: 0;
          z-index: 10;
          padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
          border-top: 1px solid var(--slds-border);
          border-bottom: 0;
          box-shadow: 0 -1px 3px rgb(0 0 0 / 12%);
        }

        .utility-bar__status {
          width: 100%;
        }

        .utility-bar__actions {
          width: 100%;
          margin-left: 0;
        }

        .utility-bar__actions .utility-bar__action {
          flex: 1 1 0;
          justify-content: center;
          min-height: 44px;
        }

        /* Labels are dropped before targets are shrunk. */
        .utility-bar__action-label,
        .utility-bar__kbd {
          display: none;
        }
      }
    `
  ]
})
export class UtilityBarComponent {
  public readonly activeTabId = input.required<string>();
  public readonly entityCount = input.required<number>();
  public readonly activeTabTitle = input<string>('');

  public readonly quickActionClick = output<QuickAction>();

  protected tabStatus(): string {
    const title = this.activeTabTitle();
    return title ? `· ${title}` : '';
  }
}
