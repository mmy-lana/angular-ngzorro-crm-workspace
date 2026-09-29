import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NzDropdownModule } from 'ng-zorro-antd/dropdown';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { SupportedIcon, WorkspaceTab } from '@core/models/crm.models';
import { ViewportService } from '@core/services/viewport.service';
import { inject } from '@angular/core';

/** How many tabs fit inline before the rest collapse into an overflow menu. */
const INLINE_TAB_LIMIT = 3;

/** Master objects the launcher can open. */
export type NavigationTarget = 'DASHBOARD' | 'ACCOUNTS' | 'OPPORTUNITIES';

interface NavigationEntry {
  readonly target: NavigationTarget;
  readonly label: string;
  readonly description: string;
  readonly icon: SupportedIcon;
}

/**
 * The three destinations that are always reachable, whether or not a tab for
 * them is currently open. The launcher is deliberately separate from the tab
 * list: a list is a thing you are looking at, and the master directories are
 * the way to get to one.
 */
const NAVIGATION_ENTRIES: readonly NavigationEntry[] = [
  { target: 'DASHBOARD', label: 'Executive Pipeline', description: 'Pipeline overview', icon: 'dashboard' },
  { target: 'ACCOUNTS', label: 'Accounts', description: 'Master account directory', icon: 'team' },
  { target: 'OPPORTUNITIES', label: 'Opportunities', description: 'Master pipeline list', icon: 'dollar' }
];

/** Prefix marking a mobile picker option as a launcher entry, not a real tab. */
const NAV_OPTION_PREFIX = 'nav:';

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
            <optgroup label="Go to">
              @for (entry of navigation; track entry.target) {
                <option [value]="navOptionValue(entry.target)">{{ entry.label }}</option>
              }
            </optgroup>
            <optgroup label="Open tabs">
              @for (tab of tabs(); track tab.id) {
                <option [value]="tab.id">{{ tab.title }}{{ tab.isDirty ? ' (unsaved)' : '' }}</option>
              }
            </optgroup>
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
      <div class="tab-bar">
        <div
          class="tab-bar__launcher"
          nz-dropdown
          nzTrigger="click"
          [nzDropdownMenu]="navigationMenu"
          role="button"
          tabindex="0"
          aria-haspopup="menu"
          aria-label="Navigation"
          (keydown.enter)="openLauncherMenu($event)"
          (keydown.space)="openLauncherMenu($event); $event.preventDefault()"
        >
          <nz-icon nzType="menu" />
          <span>Navigation</span>
          <nz-icon nzType="down" class="tab-bar__launcher-caret" />
        </div>

        <div class="tab-bar__tabs" role="tablist" aria-label="Open records">
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

        <nz-dropdown-menu #navigationMenu="nzDropdownMenu">
          <ul class="tab-bar__menu" role="menu">
            @for (entry of navigation; track entry.target) {
              <li role="none">
                <button
                  type="button"
                  class="tab-bar__menu-item"
                  role="menuitem"
                  (click)="navigateObject.emit(entry.target)"
                >
                  <nz-icon [nzType]="entry.icon" />
                  <span class="tab-bar__menu-text">
                    <span class="tab-bar__menu-label">{{ entry.label }}</span>
                    <span class="tab-bar__menu-description">{{ entry.description }}</span>
                  </span>
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
  public readonly navigateObject = output<NavigationTarget>();

  protected readonly activeTab = computed<WorkspaceTab>(() => {
    const all = this.tabs();
    return all.find(tab => tab.id === this.activeTabId()) ?? all[0];
  });

  protected readonly inlineTabs = computed(() => this.tabs().slice(0, INLINE_TAB_LIMIT));
  protected readonly overflow = computed(() => this.tabs().slice(INLINE_TAB_LIMIT));

  protected readonly navigation = NAVIGATION_ENTRIES;

  /** Mobile picker values for launcher entries are namespaced so they can never
   * be mistaken for a tab id. */
  protected navOptionValue(target: NavigationTarget): string {
    return `${NAV_OPTION_PREFIX}${target}`;
  }

  protected onSelect(event: Event): void {
    const target = event.target;
    if (!(target instanceof HTMLSelectElement)) {
      return;
    }
    const value = target.value;
    if (value.startsWith(NAV_OPTION_PREFIX)) {
      // A launcher entry, not a tab: emit the intent and restore the picker so
      // the control keeps showing the tab that is actually active.
      const selected = value.slice(NAV_OPTION_PREFIX.length) as NavigationTarget;
      this.navigateObject.emit(selected);
      target.value = this.activeTabId();
      return;
    }
    this.tabSelect.emit(value);
  }

  /**
   * Keyboard equivalent of the launcher's click trigger. The dropdown listens
   * for a pointer only, so without this the launcher is focusable but inert.
   */
  protected openLauncherMenu(event: Event): void {
    const element = event.currentTarget;
    if (element instanceof HTMLElement) {
      element.click();
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
