import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NzDropdownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { WorkspaceTab } from '@core/models/crm.models';
import { ViewportService } from '@core/services/viewport.service';
import { inject } from '@angular/core';

/** How many tabs fit inline before the rest collapse into an overflow menu. */
const INLINE_TAB_LIMIT = 3;

/**
 * Console tab strip.
 *
 * On a phone a horizontal strip cannot show a meaningful number of tabs beside
 * a close target, so the whole strip becomes a single select-like control; on a
 * tablet the first three tabs stay visible and the remainder collapse into a
 * dropdown with a count badge; on a desktop every tab is inline.
 *
 * The dirty dot is never the only signal: the close control is also styled and
 * carries a `title`, so unsaved work is announced rather than merely coloured.
 */
@Component({
  selector: 'app-console-tab-bar',
  imports: [NzDropdownModule, NzIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './console-tab-bar.component.scss',
  template: `
    @if (viewport.isMobile()) {
      <div class="tab-bar tab-bar--mobile">
        <label class="tab-bar__picker">
          <span class="tab-bar__picker-icon" aria-hidden="true">
            <nz-icon [nzType]="activeTab().icon" />
          </span>
          <select
            class="tab-bar__select"
            [attr.aria-label]="'Active tab: ' + activeTab().title"
            [value]="activeTabId()"
            (change)="onSelect($event)"
          >
            @for (tab of tabs(); track tab.id) {
              <option [value]="tab.id">{{ tab.title }}{{ tab.isDirty ? ' (unsaved)' : '' }}</option>
            }
          </select>
          <nz-icon nzType="down" />
        </label>
        @if (activeTab().closable) {
          <button
            type="button"
            class="tab-bar__close"
            aria-label="Close active tab"
            (click)="tabClose.emit(activeTabId())"
          >
            <nz-icon nzType="close" />
          </button>
        }
      </div>
    } @else {
      <div class="tab-bar" role="tablist" aria-label="Open records">
        @for (tab of inlineTabs(); track tab.id) {
          <div
            class="tab-bar__tab"
            role="tab"
            [class.is-active]="tab.id === activeTabId()"
            [class.is-dirty]="tab.isDirty"
            [attr.aria-selected]="tab.id === activeTabId()"
            [attr.tabindex]="tab.id === activeTabId() ? 0 : -1"
            (click)="tabSelect.emit(tab.id)"
            (keydown.enter)="tabSelect.emit(tab.id)"
            (keydown.space)="tabSelect.emit(tab.id); $event.preventDefault()"
          >
            <span class="tab-bar__dot" aria-hidden="true"></span>
            <nz-icon [nzType]="tab.icon" class="tab-bar__icon" />
            <span class="tab-bar__title" [attr.title]="tab.title">{{ tab.title }}</span>
            @if (tab.closable) {
              <button
                type="button"
                class="tab-bar__close"
                [attr.aria-label]="'Close ' + tab.title"
                [attr.title]="tab.isDirty ? 'Close with unsaved changes' : 'Close tab'"
                (click)="closeTab($event, tab.id)"
              >
                <nz-icon nzType="close" />
              </button>
            }
          </div>
        }

        @if (overflow().length > 0) {
          <div
            class="tab-bar__overflow"
            nz-dropdown
            nzTrigger="click"
            [nzDropdownMenu]="overflowMenu"
            role="button"
            tabindex="0"
            aria-haspopup="menu"
            [attr.aria-label]="'More tabs, ' + overflow().length + ' hidden'"
            (keydown.enter)="openOverflowMenu($event)"
            (keydown.space)="openOverflowMenu($event); $event.preventDefault()"
          >
            <span class="tab-bar__overflow-label">More</span>
            <span class="tab-bar__overflow-count">{{ overflow().length }}</span>
            <nz-icon nzType="down" />
          </div>
        }

        <nz-dropdown-menu #overflowMenu="nzDropdownMenu">
          <ul class="tab-bar__menu" role="menu">
            @for (tab of overflow(); track tab.id) {
              <li role="none">
                <button
                  type="button"
                  class="tab-bar__menu-item"
                  role="menuitem"
                  [class.is-active]="tab.id === activeTabId()"
                  (click)="tabSelect.emit(tab.id)"
                >
                  <span class="tab-bar__dot" [class.is-dirty]="tab.isDirty" aria-hidden="true"></span>
                  <nz-icon [nzType]="tab.icon" />
                  <span>{{ tab.title }}</span>
                </button>
              </li>
            }
          </ul>
        </nz-dropdown-menu>
      </div>
    }
  `
})
export class ConsoleTabBarComponent {
  protected readonly viewport = inject(ViewportService);

  public readonly tabs = input.required<readonly WorkspaceTab[]>();
  public readonly activeTabId = input.required<string>();

  public readonly tabSelect = output<string>();
  public readonly tabClose = output<string>();

  protected readonly activeTab = computed<WorkspaceTab>(() => {
    const all = this.tabs();
    return all.find(tab => tab.id === this.activeTabId()) ?? all[0];
  });

  protected readonly inlineTabs = computed(() => this.tabs().slice(0, INLINE_TAB_LIMIT));
  protected readonly overflow = computed(() => this.tabs().slice(INLINE_TAB_LIMIT));

  protected onSelect(event: Event): void {
    const target = event.target;
    if (target instanceof HTMLSelectElement) {
      this.tabSelect.emit(target.value);
    }
  }

  /**
   * Keyboard equivalent of the click trigger.
   *
   * `nz-trigger="click"` only listens for a pointer, so a keyboard user could
   * focus this control and never open the menu. The click is dispatched on
   * `currentTarget` rather than `target`: `target` is whatever child the key
   * landed on, and clicking a `<span>` that has no handler of its own would
   * not open the dropdown.
   */
  protected openOverflowMenu(event: Event): void {
    const element = event.currentTarget;
    if (element instanceof HTMLElement) {
      element.click();
    }
  }

  /** Stops the row click from also re-selecting the tab being closed. */
  protected closeTab(event: Event, tabId: string): void {
    event.stopPropagation();
    this.tabClose.emit(tabId);
  }
}
