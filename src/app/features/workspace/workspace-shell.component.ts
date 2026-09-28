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
import { WorkspaceTab } from '@core/models/crm.models';
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
import { ConsoleTabBarComponent } from '@features/workspace/components/console-tab-bar/console-tab-bar.component';
import { UtilityBarComponent, QuickAction } from '@features/workspace/components/utility-bar/utility-bar.component';
import { PipelineDashboardComponent } from '@features/workspace/pipeline-dashboard/pipeline-dashboard.component';

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

    this.shortcuts.tabCloseRequested$
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        void this.tabService.closeTab(this.tabService.activeTabId());
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
        this.reportSearchAvailability();
        return;
    }
  }

  protected onDrawerCreated(): void {
    this.drawer.close();
  }

  /**
   * Search lives in the list toolbars, so the shortcut is only meaningful on a
   * list tab. On a detail tab it says where search does live instead of
   * silently doing nothing, which reads as a broken key.
   */
  private reportSearchAvailability(): void {
    if (this.tabService.activeTab().entityType === 'LIST') {
      this.message.success('Use the search box above the table.');
      return;
    }
    this.message.info('Search is available on the Accounts and Opportunities list tabs.');
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
