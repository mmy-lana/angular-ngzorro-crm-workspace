import {
  ChangeDetectionStrategy,
  Component,
  Type,
  computed,
  effect,
  inject,
  untracked
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { SupportedIcon, WorkspaceTab } from '@core/models/crm.models';
import { CrmRepositoryService } from '@core/services/crm-repository.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { QuickCreateStateService } from '@core/services/quick-create-state.service';
import { ViewportService } from '@core/services/viewport.service';
import { WorkspaceTabService } from '@core/services/workspace-tab.service';
import { QuickCreateDrawerComponent } from '@shared/ui/quick-create-drawer/quick-create-drawer.component';
import { AccountDetailComponent } from '@features/accounts/account-detail/account-detail.component';
import { AccountListComponent } from '@features/accounts/account-list/account-list.component';
import { OpportunityDetailComponent } from '@features/opportunities/opportunity-detail/opportunity-detail.component';
import { OpportunityListComponent } from '@features/opportunities/opportunity-list/opportunity-list.component';
import {
  ConsoleTabBarComponent,
  NavigationTarget
} from '@features/workspace/components/console-tab-bar/console-tab-bar.component';
import { UtilityBarComponent, QuickAction } from '@features/workspace/components/utility-bar/utility-bar.component';
import { PipelineDashboardComponent } from '@features/workspace/pipeline-dashboard/pipeline-dashboard.component';

/**
 * Frames to wait before requesting focus on a pane that was just opened. One
 * animation frame's worth of headroom is enough for the outlet to create the
 * component; the delay is a scheduling detail, not a timeout to tune.
 */
const SEARCH_FOCUS_DELAY_MS = 50;

interface Pane {
  readonly tab: WorkspaceTab;
  readonly component: Type<unknown>;
  readonly inputs: Record<string, unknown>;
}

/**
 * Application shell: tab strip, keep-alive pane stack, status bar and the single
 * quick-create drawer.
 *
 * Panes stay mounted and are hidden with `[hidden]` rather than being created and
 * destroyed on switch. A detail view holds a reactive form, a scroll position and
 * a selected sub-tab; destroying and recreating it on every tab click would
 * throw all of that away, and re-running every form's async setup each time is a
 * cost the user can feel. The shell is responsible for making sure a hidden pane
 * releases resources, which the density stylesheet does through
 * `.workspace-pane[hidden] { display: none !important; }`.
 *
 * Two effects carry the cross-cutting behaviour:
 *
 * - pruning, so a record deleted anywhere (this window or a sibling) retires its
 *   tab without a discard prompt;
 * - a resize ping on tab switch, because a pane that was `display: none` has no
 *   width, and tables and scroll containers measured while hidden lay out wrong
 *   the moment they are shown.
 */
@Component({
  selector: 'app-workspace-shell',
  imports: [
    NgComponentOutlet,
    NzIconModule,
    ConsoleTabBarComponent,
    QuickCreateDrawerComponent,
    UtilityBarComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './workspace-shell.component.scss',
  template: `
    <div class="shell">
      <app-console-tab-bar
        [tabs]="tabService.tabs()"
        [activeTabId]="tabService.activeTabId()"
        (tabSelect)="onTabSelect($event)"
        (tabClose)="onTabClose($event)"
        (navigateObject)="onNavigateObject($event)"
      />

      <main class="shell__main">
        @for (pane of panes(); track pane.tab.id) {
          <div class="workspace-pane" [hidden]="pane.tab.id !== tabService.activeTabId()">
            <ng-container *ngComponentOutlet="pane.component; inputs: pane.inputs" />
          </div>
        }
      </main>

      <app-utility-bar
        [activeTabId]="tabService.activeTabId()"
        [activeTabTitle]="tabService.activeTab().title"
        [entityCount]="recordCount()"
        (quickActionClick)="onQuickAction($event)"
        (statusClick)="onStatusClick()"
      />

      <app-quick-create-drawer
        [visible]="drawer.visible()"
        [mode]="drawer.mode()"
        [entityType]="drawer.entityType()"
        [recordId]="drawer.recordId()"
        [contextId]="drawer.contextId()"
        [contextType]="drawer.contextType()"
        (closed)="drawer.close()"
        (created)="onDrawerCreated()"
      />
    </div>
  `
})
export class WorkspaceShellComponent {
  protected readonly tabService = inject(WorkspaceTabService);
  protected readonly drawer = inject(QuickCreateStateService);
  protected readonly viewport = inject(ViewportService);

  private readonly repo = inject(CrmRepositoryService);
  private readonly shortcuts = inject(KeyboardShortcutService);
  private readonly message = inject(NzMessageService);

  /** Panes with no inputs need a stable empty object, not a fresh one per call. */
  private static readonly NO_INPUTS: Record<string, unknown> = {};

  protected readonly recordCount = computed(() => this.repo.allEntityIds().size);

  protected readonly panes = computed<Pane[]>(() =>
    this.tabService.tabs().map(tab => ({
      tab,
      component: resolveComponent(tab),
      inputs: tab.entityId === null ? WorkspaceShellComponent.NO_INPUTS : { entityId: tab.entityId }
    }))
  );

  constructor() {
    this.shortcuts.init();

    // `closeTab` awaits a discard dialog, so a rejection here is a real
    // failure path: swallowing it with `void` turns a broken close into a
    // keyboard shortcut that silently does nothing.
    this.shortcuts.tabCloseRequested$
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        this.tabService
          .closeTab(this.tabService.activeTabId())
          .catch((error: unknown) => {
            console.error('Failed to close active tab:', error);
            this.message.error('Tab could not be closed.');
          });
      });

    // Retiring tabs for deleted records is a shell concern, not a detail-view
    // one: the component that deleted the record must not also decide to close
    // its own tab, or a background pane would close the tab the user is looking
    // at. Pruning never prompts.
    effect(() => {
      const validIds = this.repo.allEntityIds();
      untracked(() => this.tabService.pruneMissingEntities(validIds));
    });

    // A pane shown after being hidden has never been measured, so anything
    // width-dependent (table layout, scroll shadows) would be wrong until the
    // next unrelated resize.
    effect(() => {
      this.tabService.activeTabId();
      untracked(() => {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new Event('resize'));
        }
      });
    });
  }

  /**
   * Routes a launcher entry to a tab.
   *
   * The dashboard already exists as the workspace floor, so selecting it is
   * enough; the two master lists are opened on demand. `openTab` focuses an
   * existing tab rather than duplicating it, so repeated navigation is a no-op
   * instead of a stack of identical panes.
   */
  protected onNavigateObject(target: NavigationTarget): void {
    switch (target) {
      case 'DASHBOARD':
        this.tabService.selectTab(WorkspaceTabService.DASHBOARD_TAB_ID);
        return;
      case 'ACCOUNTS':
        this.openListTab('accounts', 'Accounts', 'team');
        return;
      case 'OPPORTUNITIES':
        this.openListTab('opportunities', 'Opportunities', 'dollar');
        return;
    }
  }

  private openListTab(listKey: 'accounts' | 'opportunities', title: string, icon: SupportedIcon): void {
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('LIST', listKey),
      title,
      entityType: 'LIST',
      entityId: null,
      listKey,
      icon,
      closable: true
    });
  }

  protected onTabSelect(tabId: string): void {
    this.tabService.selectTab(tabId);
  }

  protected onTabClose(tabId: string): void {
    void this.tabService.closeTab(tabId);
  }

  protected onQuickAction(action: QuickAction): void {
    switch (action) {
      case 'NEW_ACCOUNT':
        this.drawer.openCreate('ACCOUNT');
        return;
      case 'NEW_TASK': {
        // A task needs a parent record, so it attaches to whatever record the
        // active tab is showing and falls back to the primary contact.
        const tab = this.tabService.activeTab();
        if (tab.entityType === 'ACCOUNT' && tab.entityId !== null) {
          this.drawer.openCreate('ACTIVITY', tab.entityId, 'ACCOUNT');
          return;
        }
        if (tab.entityType === 'OPPORTUNITY' && tab.entityId !== null) {
          this.drawer.openCreate('ACTIVITY', tab.entityId, 'OPPORTUNITY');
          return;
        }
        this.message.info('Open a record to log a task against it.');
        return;
      }
      case 'SEARCH':
        this.handleSearchAction();
        return;
    }
  }

  protected onDrawerCreated(): void {
    this.drawer.close();
  }

  /**
   * Search is always actionable and context-sensitive.
   *
   * On a list tab the shortcut focuses its search box. When viewing an opportunity,
   * it routes to the opportunities list; otherwise, it routes to accounts.
   */
  private handleSearchAction(): void {
    const active = this.tabService.activeTab();
    if (active.entityType === 'LIST') {
      this.shortcuts.triggerSearchFocus();
      return;
    }

    if (active.entityType === 'OPPORTUNITY') {
      this.openListTab('opportunities', 'Opportunities', 'dollar');
    } else {
      this.openListTab('accounts', 'Accounts', 'team');
    }

    setTimeout(() => this.shortcuts.triggerSearchFocus(), SEARCH_FOCUS_DELAY_MS);
  }

  protected onStatusClick(): void {
    if (typeof document === 'undefined') {
      return;
    }
    const activePane = document.querySelector('.workspace-pane:not([hidden])');
    activePane?.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function resolveComponent(tab: WorkspaceTab): Type<unknown> {
  switch (tab.entityType) {
    case 'ACCOUNT':
      return AccountDetailComponent;
    case 'OPPORTUNITY':
      return OpportunityDetailComponent;
    case 'LIST':
      return tab.listKey === 'opportunities' ? OpportunityListComponent : AccountListComponent;
    case 'DASHBOARD':
      return PipelineDashboardComponent;
  }
}
