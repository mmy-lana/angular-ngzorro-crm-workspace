import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalModule, NzModalService } from 'ng-zorro-antd/modal';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { OpportunityStage, UUID } from '@core/models/crm.models';
import { CrmRepositoryService } from '@core/services/crm-repository.service';
import { ViewportService } from '@core/services/viewport.service';
import { WorkspaceTabService } from '@core/services/workspace-tab.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { QuickCreateStateService } from '@core/services/quick-create-state.service';
import { STAGE_CONFIG, isClosedStage } from '@core/utils/pipeline-calc';
import { CurrencyFormatterPipe, formatCompactCurrency } from '@shared/pipes/currency-formatter.pipe';
import { CompactBadgeComponent, CompactBadgeColor } from '@shared/ui/compact-badge/compact-badge.component';
import { ActivityTimelineComponent } from '@shared/ui/activity-timeline/activity-timeline.component';
import { RecordBannerComponent } from '@shared/ui/record-banner/record-banner.component';
import { StagePathComponent } from '@shared/ui/stage-path/stage-path.component';
import { ActivityComposerComponent } from '@features/activities/activity-composer/activity-composer.component';
import { LossReasonModalComponent } from '@features/opportunities/components/loss-reason-modal/loss-reason-modal.component';

const SUB_TABS = ['details', 'activity', 'related'] as const;
type SubTab = (typeof SUB_TABS)[number];

/**
 * Opportunity workspace.
 *
 * The stage ribbon is the primary control: clicking a chevron is the whole
 * point of a pipeline console, so it sits above the fold and is the only element
 * that changes the record. Everything else on this screen is either a
 * consequence of the stage or a log.
 *
 * Two behaviours are worth calling out.
 *
 * Shortcut isolation: Ctrl/Cmd+S is a global shortcut, but it must only act on
 * the tab the user is actually looking at. Saving an opportunity in a background
 * pane would be a genuinely destructive surprise, so the subscription is gated
 * on this tab being active.
 *
 * Tab retirement: deleting the record removes it from the store. This component
 * does not close its own tab; the shell's prune effect notices the id is gone
 * and drops the tab, without a "discard unsaved changes" dialog for edits the
 * user just deliberately threw away.
 */
@Component({
  selector: 'app-opportunity-detail',
  imports: [
    NzButtonModule,
    NzIconModule,
    NzModalModule,
    NzSpinModule,
    NzTabsModule,
    ActivityComposerComponent,
    ActivityTimelineComponent,
    CompactBadgeComponent,
    CurrencyFormatterPipe,
    LossReasonModalComponent,
    RecordBannerComponent,
    StagePathComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './opportunity-detail.component.scss',
  template: `
    @if (opportunity(); as record) {
      <div class="detail">
        <app-record-banner
          [title]="record.name"
          icon="dollar"
          [metrics]="bannerMetrics(record)"
          editLabel="Edit"
          deleteLabel="Delete"
          (editClick)="editClick()"
          (deleteClick)="confirmDelete()"
        />

        <app-stage-path [currentStage]="record.stage" (stageChange)="onStageChange($event)" />

        <nz-tabs
          class="detail__tabs"
          nzSize="small"
          [nzSelectedIndex]="subTabIndex()"
          (nzSelectedIndexChange)="onSubTabChange($event)"
        >
          <nz-tab nzTitle="Details">
            <div class="detail__body">
              <dl class="fields">
                <div class="fields__row">
                  <dt>Account</dt>
                  <dd>
                    <button type="button" class="fields__link" (click)="openAccount(record.accountId)">
                      {{ accountName(record.accountId) }}
                    </button>
                  </dd>
                </div>
                <div class="fields__row">
                  <dt>Primary contact</dt>
                  <dd>
                    <button type="button" class="fields__link" (click)="openAccount(record.accountId, 'contacts')">
                      {{ contactName(record.primaryContactId) }}
                    </button>
                  </dd>
                </div>
                <div class="fields__row">
                  <dt>Stage</dt>
                  <dd>
                    <app-compact-badge [status]="stageLabel(record.stage)" [colorType]="stageTone(record.stage)" />
                  </dd>
                </div>
                <div class="fields__row">
                  <dt>Amount</dt>
                  <dd class="fields__numeric">{{ record.amount | currencyFormatter: false }}</dd>
                </div>
                <div class="fields__row">
                  <dt>Probability</dt>
                  <dd class="fields__numeric">{{ record.probability }}%</dd>
                </div>
                <div class="fields__row">
                  <dt>Expected revenue</dt>
                  <dd class="fields__numeric">{{ record.expectedRevenue | currencyFormatter: false }}</dd>
                </div>
                <div class="fields__row">
                  <dt>Forecast</dt>
                  <dd>{{ record.forecastCategory }}</dd>
                </div>
                <div class="fields__row">
                  <dt>Close date</dt>
                  <dd class="fields__numeric" [class.is-overdue]="isOverdue(record.closeDate)">{{ record.closeDate }}</dd>
                </div>
                <div class="fields__row">
                  <dt>Next step</dt>
                  <dd>{{ record.nextStep || '—' }}</dd>
                </div>
                <div class="fields__row">
                  <dt>Lead source</dt>
                  <dd>{{ record.leadSource || '—' }}</dd>
                </div>
                <div class="fields__row">
                  <dt>Owner</dt>
                  <dd>{{ record.ownerName }}</dd>
                </div>
                @if (record.lossReason) {
                  <div class="fields__row">
                    <dt>Loss reason</dt>
                    <dd class="fields__loss">{{ record.lossReason }}</dd>
                  </div>
                }
              </dl>
            </div>
          </nz-tab>

          <nz-tab nzTitle="Activity">
            <div class="detail__body detail__body--split">
              <section class="detail__col">
                <h2 class="detail__col-title">Timeline</h2>
                @if (activities().length === 0) {
                  <p class="detail__empty">No activity logged against this opportunity yet.</p>
                } @else {
                  <app-activity-timeline [activities]="activities()" (statusToggle)="onActivityToggle($event)" />
                }
              </section>
              <section class="detail__col">
                <h2 class="detail__col-title">Log something</h2>
                <app-activity-composer
                  entityType="OPPORTUNITY"
                  [entityId]="entityId()"
                  (activityAdded)="onActivityAdded()"
                />
              </section>
            </div>
          </nz-tab>

          <nz-tab nzTitle="Related">
            <div class="detail__body">
              <section class="detail__col">
                <h2 class="detail__col-title">Account</h2>
                @if (account(); as linked) {
                  <dl class="fields">
                    <div class="fields__row"><dt>Name</dt><dd>{{ linked.name }}</dd></div>
                    <div class="fields__row"><dt>Number</dt><dd>{{ linked.accountNumber }}</dd></div>
                    <div class="fields__row"><dt>Industry</dt><dd>{{ linked.industry }}</dd></div>
                    <div class="fields__row"><dt>Revenue</dt><dd class="fields__numeric">{{ linked.annualRevenue | currencyFormatter: false }}</dd></div>
                    <div class="fields__row"><dt>Rating</dt><dd>{{ linked.rating }}</dd></div>
                    <div class="fields__row">
                      <dt>Location</dt>
                      <dd>{{ linked.billingAddress.city }}, {{ linked.billingAddress.state }} {{ linked.billingAddress.country }}</dd>
                    </div>
                  </dl>
                } @else {
                  <p class="detail__empty">The linked account is no longer available.</p>
                }
              </section>
            </div>
          </nz-tab>
        </nz-tabs>
      </div>
    } @else {
      <div class="detail__missing">
        <nz-spin nzTip="Loading opportunity" />
        <p>This opportunity is no longer available. It may have been deleted in another window.</p>
        <button nz-button nzType="default" (click)="backToDashboard()">Back to dashboard</button>
      </div>
    }

    <app-loss-reason-modal
      [visible]="lossModalOpen()"
      [initialReason]="opportunity()?.lossReason ?? ''"
      (confirmed)="confirmLost($event)"
      (cancelled)="cancelLost()"
    />
  `
})
export class OpportunityDetailComponent {
  private readonly repo = inject(CrmRepositoryService);
  private readonly tabService = inject(WorkspaceTabService);
  private readonly shortcuts = inject(KeyboardShortcutService);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);
  private readonly drawer = inject(QuickCreateStateService);
  protected readonly viewport = inject(ViewportService);

  public readonly entityId = input.required<UUID>();

  protected readonly lossModalOpen = signal<boolean>(false);
  protected readonly errorMessage = signal<string>('');

  protected readonly myTabId = computed(() => WorkspaceTabService.tabIdFor('OPPORTUNITY', this.entityId()));

  /** The derived view carries probability, expected revenue and forecast roll-up. */
  protected readonly opportunity = computed(() =>
    this.repo.opportunitiesWithDerived().find(view => view.id === this.entityId())
  );
  protected readonly account = computed(() => {
    const record = this.opportunity();
    return record ? this.repo.account(record.accountId) : undefined;
  });
  protected readonly activities = computed(() => this.repo.activitiesForEntity('OPPORTUNITY', this.entityId()));

  protected readonly subTabIndex = computed(() => {
    const key = this.tabService.activeTab().activeSubTabKey;
    const index = SUB_TABS.indexOf(key as SubTab);
    return index < 0 ? 0 : index;
  });

  constructor() {
    // Keep the tab title in step with a rename, and retire the tab title when
    // the record disappears.
    effect(() => {
      const record = this.opportunity();
      untracked(() => {
        this.tabService.updateTabTitle(this.myTabId(), record ? record.name : 'Opportunity');
      });
    });

    this.shortcuts.saveRequested$
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        // Ctrl+S must never act on a background pane.
        if (this.tabService.activeTabId() === this.myTabId()) {
          this.onSaveShortcut();
        }
      });
  }

  protected onSubTabChange(index: number): void {
    const key = SUB_TABS[index] ?? SUB_TABS[0];
    this.tabService.updateSubTab(this.myTabId(), key);
  }

  protected onStageChange(stage: OpportunityStage): void {
    const record = this.opportunity();
    if (!record || stage === record.stage) {
      return;
    }
    if (stage === OpportunityStage.CLOSED_LOST) {
      // Deferred: the reason must be collected before anything is committed.
      this.lossModalOpen.set(true);
      return;
    }
    this.commitStage(stage);
  }

  protected confirmLost(reason: string): void {
    this.lossModalOpen.set(false);
    this.commitStage(OpportunityStage.CLOSED_LOST, reason);
  }

  protected cancelLost(): void {
    this.lossModalOpen.set(false);
  }

  private commitStage(stage: OpportunityStage, lossReason?: string): void {
    const record = this.opportunity();
    if (!record) {
      return;
    }
    try {
      this.repo.updateOpportunityStage(record.id, stage, record.version, lossReason);
      this.message.success(`Moved to ${STAGE_CONFIG[stage].label}`);
      this.errorMessage.set('');
    } catch (error) {
      this.errorMessage.set(error instanceof Error ? error.message : 'The stage change was rejected.');
      this.message.error(this.errorMessage());
    }
  }

  protected onActivityToggle(event: { id: UUID; completed: boolean }): void {
    const activity = this.repo.activity(event.id);
    if (!activity) {
      return;
    }
    try {
      this.repo.toggleActivityCompletion(activity.id, event.completed, activity.version);
    } catch (error) {
      this.message.error(error instanceof Error ? error.message : 'The activity could not be updated.');
    }
  }

  protected onActivityAdded(): void {
    // The timeline reads the signal store, so it is already current; this only
    // exists to give the shell a hook if it later needs to react.
  }

  protected editClick(): void {
    this.drawer.openEdit('OPPORTUNITY', this.entityId());
  }

  protected confirmDelete(): void {
    const record = this.opportunity();
    if (!record) {
      return;
    }
    this.modal.confirm({
      nzTitle: 'Delete opportunity',
      nzContent: `"${record.name}" and its activity history will be removed. This cannot be undone.`,
      nzOkText: 'Delete',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => {
        try {
          this.repo.deleteOpportunity(record.id);
          this.message.success('Opportunity deleted');
          // The tab is retired by the shell's prune effect, not here.
        } catch (error) {
          this.message.error(error instanceof Error ? error.message : 'The opportunity could not be deleted.');
        }
      }
    });
  }

  protected openAccount(accountId: UUID, subTab = 'overview'): void {
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('ACCOUNT', accountId),
      title: this.repo.account(accountId)?.name ?? 'Account',
      entityType: 'ACCOUNT',
      entityId: accountId,
      icon: 'team',
      closable: true,
      activeSubTabKey: subTab
    });
  }

  protected backToDashboard(): void {
    this.tabService.selectTab(WorkspaceTabService.DASHBOARD_TAB_ID);
  }

  protected accountName(accountId: UUID): string {
    return this.repo.account(accountId)?.name ?? 'Unknown account';
  }

  protected contactName(contactId: UUID): string {
    const contact = this.repo.contact(contactId);
    return contact ? `${contact.firstName} ${contact.lastName}` : 'Unknown contact';
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

  protected isOverdue(closeDate: string): boolean {
    return !isClosedStage(this.opportunity()?.stage ?? OpportunityStage.PROSPECTING) && closeDate < new Date().toISOString().slice(0, 10);
  }

  protected bannerMetrics(record: { amount: number; probability: number; expectedRevenue: number; closeDate: string }): { label: string; value: string }[] {
    return [
      { label: 'Amount', value: this.compact(record.amount) },
      { label: 'Probability', value: `${record.probability}%` },
      { label: 'Expected', value: this.compact(record.expectedRevenue) },
      { label: 'Close date', value: record.closeDate }
    ];
  }

  private compact(value: number): string {
    return formatCompactCurrency(value);
  }

  /**
   * Opportunity stage changes are their own save, so Ctrl+S only reports that
   * there is nothing outstanding rather than silently doing nothing.
   */
  private onSaveShortcut(): void {
    this.message.info('Opportunity changes are saved as you move the stage.');
  }
}
