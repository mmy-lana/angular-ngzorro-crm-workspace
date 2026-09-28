import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { NzModalService } from 'ng-zorro-antd/modal';
import { ICON_NAMES, SupportedIcon, UUID, WorkspaceTab } from '@core/models/crm.models';
import { SESSION_STORAGE, WORKSPACE_SESSION_KEYS } from '@core/tokens/crm-storage.token';

/** Input accepted by {@link WorkspaceTabService.openTab}. */
export type OpenTabRequest = Omit<WorkspaceTab, 'isDirty' | 'activeSubTabKey'> & {
  activeSubTabKey?: string;
};

/**
 * Multi-document tab state for the console shell.
 *
 * Tabs are the shell's only navigation state: the record they point at, the
 * sub-tab a detail view is showing, and whether that view has unsaved edits.
 *
 * Two decisions worth stating:
 *
 * *Session, not durable.* Tabs live in `sessionStorage` and are deliberately not
 * written to `localStorage`. Reopening the browser should present the
 * dashboard, not a half-restored set of panes pointing at records the user has
 * forgotten. A restored tab is still validated against the schema, because
 * session storage survives a reload and the stored shape can predate a release.
 *
 * *Dismissal is the shell's job.* A detail component that deletes its own record
 * does not close its tab. It removes the record; the prune effect notices the id
 * is gone and drops the tab silently, without raising a discard-confirmation for
 * a form the user has just deliberately thrown away.
 */
@Injectable({ providedIn: 'root' })
export class WorkspaceTabService {
  private readonly store = inject(SESSION_STORAGE);
  private readonly modalService = inject(NzModalService);

  /** Guards against stacking a second discard dialog behind the first. */
  private discardDialogOpen = false;

  /** `${entityType}:${entityIdOrListKey}` — the single tab-identity format. */
  public static tabIdFor(entityType: WorkspaceTab['entityType'], key: string): string {
    return `${entityType}:${key}`;
  }

  public static readonly DASHBOARD_TAB_ID = 'DASHBOARD:overview';

  private readonly defaultTab: WorkspaceTab = {
    id: WorkspaceTabService.DASHBOARD_TAB_ID,
    title: 'Executive Pipeline',
    entityType: 'DASHBOARD',
    entityId: null,
    icon: 'dashboard',
    isDirty: false,
    closable: false,
    activeSubTabKey: 'overview'
  };

  private readonly tabsSignal = signal<WorkspaceTab[]>([this.defaultTab]);
  private readonly activeTabIdSignal = signal<string>(WorkspaceTabService.DASHBOARD_TAB_ID);

  public readonly tabs: Signal<WorkspaceTab[]> = this.tabsSignal.asReadonly();
  public readonly activeTabId: Signal<string> = this.activeTabIdSignal.asReadonly();

  public readonly activeTab: Signal<WorkspaceTab> = computed(() => {
    const all = this.tabsSignal();
    return all.find(tab => tab.id === this.activeTabIdSignal()) ?? all[0] ?? this.defaultTab;
  });

  /** Tabs that sit after the first three, surfaced as an overflow dropdown. */
  public readonly overflowTabs: Signal<WorkspaceTab[]> = computed(() => this.tabsSignal().slice(3));

  public readonly closableTabCount: Signal<number> = computed(
    () => this.tabsSignal().filter(tab => tab.closable).length
  );

  constructor() {
    this.hydrateSession();
  }

  /**
   * Opens a tab, or focuses it when it is already open. Passing an
   * `activeSubTabKey` for an existing tab switches that tab's sub-view, which is
   * how navigating to a contact lands on the account's Contacts sub-tab.
   */
  public openTab(request: OpenTabRequest): void {
    const existing = this.tabsSignal().find(tab => tab.id === request.id);

    if (existing) {
      if (request.activeSubTabKey !== undefined && request.activeSubTabKey !== existing.activeSubTabKey) {
        this.updateSubTab(existing.id, request.activeSubTabKey);
      }
      this.activeTabIdSignal.set(existing.id);
      this.persist();
      return;
    }

    const newTab: WorkspaceTab = {
      ...request,
      isDirty: false,
      activeSubTabKey: request.activeSubTabKey ?? 'overview'
    };
    this.tabsSignal.update(tabs => [...tabs, newTab]);
    this.activeTabIdSignal.set(newTab.id);
    this.persist();
  }

  public selectTab(tabId: string): void {
    if (this.tabsSignal().some(tab => tab.id === tabId)) {
      this.activeTabIdSignal.set(tabId);
      this.persist();
    }
  }

  /**
   * Closes a tab, asking for confirmation when it holds unsaved edits.
   *
   * @returns `true` when the tab was actually closed. A cancelled dialog and a
   *   second close request while a dialog is open both return `false`, so a
   *   double click on the tab close button cannot stack dialogs.
   */
  public async closeTab(tabId: string): Promise<boolean> {
    const target = this.tabsSignal().find(tab => tab.id === tabId);
    if (!target || !target.closable) {
      return false;
    }

    if (target.isDirty) {
      if (this.discardDialogOpen) {
        return false;
      }
      const confirmed = await this.confirmDiscard();
      if (!confirmed) {
        return false;
      }
    }

    const current = this.tabsSignal();
    const closingIndex = current.findIndex(tab => tab.id === tabId);
    const remaining = current.filter(tab => tab.id !== tabId);
    if (remaining.length === 0) {
      // The dashboard is not closable, so this is unreachable in practice; the
      // guard keeps the invariant local rather than assumed.
      return false;
    }

    this.tabsSignal.set(remaining);

    if (this.activeTabIdSignal() === tabId) {
      // Focus the neighbour to the left, which is where the eye already is.
      const nextIndex = Math.max(0, closingIndex - 1);
      this.activeTabIdSignal.set((remaining[nextIndex] ?? remaining[0]).id);
    }

    this.persist();
    return true;
  }

  /** Marks a tab as holding unsaved edits; drives the dot in the tab strip. */
  public setTabDirty(tabId: string, isDirty: boolean): void {
    const target = this.tabsSignal().find(tab => tab.id === tabId);
    if (!target || target.isDirty === isDirty) {
      return;
    }
    this.tabsSignal.update(tabs => tabs.map(tab => (tab.id === tabId ? { ...tab, isDirty } : tab)));
  }

  public updateSubTab(tabId: string, subTabKey: string): void {
    const target = this.tabsSignal().find(tab => tab.id === tabId);
    if (!target || target.activeSubTabKey === subTabKey) {
      return;
    }
    this.tabsSignal.update(tabs =>
      tabs.map(tab => (tab.id === tabId ? { ...tab, activeSubTabKey: subTabKey } : tab))
    );
    this.persist();
  }

  public updateTabTitle(tabId: string, title: string): void {
    const target = this.tabsSignal().find(tab => tab.id === tabId);
    if (!target || target.title === title) {
      return;
    }
    this.tabsSignal.update(tabs => tabs.map(tab => (tab.id === tabId ? { ...tab, title } : tab)));
    this.persist();
  }

  /**
   * Drops tabs whose record no longer exists. Called from the shell in reaction
   * to `CrmRepositoryService.allEntityIds`, so a record deleted anywhere — this
   * window or a sibling one — retires its tab without a discard prompt.
   */
  public pruneMissingEntities(validEntityIds: ReadonlySet<UUID>): void {
    const current = this.tabsSignal();
    const surviving = current.filter(tab => tab.entityId === null || validEntityIds.has(tab.entityId));
    if (surviving.length === current.length) {
      return;
    }

    this.tabsSignal.set(surviving);
    if (!surviving.some(tab => tab.id === this.activeTabIdSignal())) {
      this.activeTabIdSignal.set((surviving[0] ?? this.defaultTab).id);
    }
    this.persist();
  }

  private confirmDiscard(): Promise<boolean> {
    this.discardDialogOpen = true;
    return new Promise(resolve => {
      let settled = false;
      const settle = (value: boolean): void => {
        if (!settled) {
          settled = true;
          this.discardDialogOpen = false;
          resolve(value);
        }
      };

      const reference = this.modalService.confirm({
        nzTitle: 'Unsaved changes',
        nzContent: 'This tab has edits that have not been saved. Closing it will discard them.',
        nzOkText: 'Discard and close',
        nzOkDanger: true,
        nzCancelText: 'Keep editing',
        nzOnOk: () => settle(true),
        nzOnCancel: () => settle(false)
      });
      // Covers the mask click and the escape key, which bypass nzOnCancel.
      reference.afterClose.subscribe(() => settle(false));
    });
  }

  private persist(): void {
    if (!this.store) {
      return;
    }
    try {
      // Dirty state is deliberately not persisted: a tab restored after a
      // reload has no live form to discard, so claiming it does would produce a
      // dialog for edits the user can no longer see or keep.
      const serializable = this.tabsSignal().map(tab => ({ ...tab, isDirty: false }));
      this.store.setItem(WORKSPACE_SESSION_KEYS.WORKSPACE_TABS, JSON.stringify(serializable));
      this.store.setItem(WORKSPACE_SESSION_KEYS.ACTIVE_TAB_ID, this.activeTabIdSignal());
    } catch {
      // A full or blocked store costs tab persistence for the session only.
    }
  }

  private hydrateSession(): void {
    if (!this.store) {
      return;
    }
    let raw: string | null;
    let activeId: string | null;
    try {
      raw = this.store.getItem(WORKSPACE_SESSION_KEYS.WORKSPACE_TABS);
      activeId = this.store.getItem(WORKSPACE_SESSION_KEYS.ACTIVE_TAB_ID);
    } catch {
      return;
    }
    if (!raw) {
      return;
    }

    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed) || parsed.length === 0) {
        return;
      }
      const sanitized = parsed
        .map(entry => sanitizeTab(entry))
        .filter((tab): tab is WorkspaceTab => tab !== null);

      if (sanitized.length === 0) {
        return;
      }
      // The dashboard is the floor of the workspace and is never restored away.
      const withDashboard = sanitized.some(tab => tab.id === this.defaultTab.id)
        ? sanitized
        : [this.defaultTab, ...sanitized];

      this.tabsSignal.set(withDashboard);
      if (activeId !== null && withDashboard.some(tab => tab.id === activeId)) {
        this.activeTabIdSignal.set(activeId);
      }
    } catch {
      // Corrupt session state falls back to the default single-tab workspace.
      this.tabsSignal.set([this.defaultTab]);
      this.activeTabIdSignal.set(WorkspaceTabService.DASHBOARD_TAB_ID);
    }
  }
}

const ENTITY_TYPES = new Set<WorkspaceTab['entityType']>(['ACCOUNT', 'OPPORTUNITY', 'LIST', 'DASHBOARD']);
const ICON_SET = new Set<string>(ICON_NAMES);
const LIST_KEYS = new Set<NonNullable<WorkspaceTab['listKey']>>(['accounts', 'opportunities']);

/**
 * Validates a persisted tab. Session storage survives a reload, so its contents
 * can predate a schema change; anything that fails validation is dropped rather
 * than crashing the shell on an unknown icon or entity type.
 */
function sanitizeTab(value: unknown): WorkspaceTab | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const id = candidate['id'];
  const title = candidate['title'];
  const entityType = candidate['entityType'];
  const icon = candidate['icon'];
  const entityId = candidate['entityId'];

  if (typeof id !== 'string' || typeof title !== 'string' || !ENTITY_TYPES.has(entityType as WorkspaceTab['entityType'])) {
    return null;
  }
  if (typeof icon !== 'string' || !ICON_SET.has(icon)) {
    return null;
  }
  if (entityId !== null && typeof entityId !== 'string') {
    return null;
  }
  const listKey = candidate['listKey'];
  if (listKey !== undefined && !LIST_KEYS.has(listKey as NonNullable<WorkspaceTab['listKey']>)) {
    return null;
  }

  return {
    id,
    title,
    entityType: entityType as WorkspaceTab['entityType'],
    entityId,
    icon: icon as SupportedIcon,
    isDirty: false,
    closable: candidate['closable'] === true,
    activeSubTabKey: typeof candidate['activeSubTabKey'] === 'string' ? candidate['activeSubTabKey'] : 'overview',
    ...(listKey === undefined ? {} : { listKey: listKey as NonNullable<WorkspaceTab['listKey']> })
  };
}
