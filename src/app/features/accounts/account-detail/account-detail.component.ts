import { ChangeDetectionStrategy, Component, computed, effect, inject, input, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSpinModule } from 'ng-zorro-antd/spin';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import { UUID } from '@core/models/crm.models';
import { CrmRepositoryService } from '@core/services/crm-repository.service';
import { KeyboardShortcutService } from '@core/services/keyboard-shortcut.service';
import { QuickCreateStateService } from '@core/services/quick-create-state.service';
import { WorkspaceTabService } from '@core/services/workspace-tab.service';
import { formatCompactCurrency } from '@shared/pipes/currency-formatter.pipe';
import { ActivityTimelineComponent } from '@shared/ui/activity-timeline/activity-timeline.component';
import { CompactBadgeComponent, CompactBadgeColor } from '@shared/ui/compact-badge/compact-badge.component';
import { RecordBannerComponent } from '@shared/ui/record-banner/record-banner.component';
import { RelatedEntityCardComponent } from '@shared/ui/related-entity-card/related-entity-card.component';
import { ActivityComposerComponent } from '@features/activities/activity-composer/activity-composer.component';

const SUB_TABS = ['overview', 'contacts', 'opportunities', 'activity'] as const;
type SubTab = (typeof SUB_TABS)[number];

/**
 * Account workspace.
 *
 * An account is a hub: it owns contacts, opportunities and its own activity
 * log. Those are surfaced as sub-tabs rather than as one long scroll, because a
 * large account would otherwise bury the contacts grid under opportunity rows.
 *
 * Contacts do not get their own tab. Opening one focuses its account with the
 * Contacts sub-tab selected, which keeps the account as the single navigation
 * unit and means there is never a "contact detail" pane with no context.
 */
@Component({
  selector: 'app-account-detail',
  imports: [
    NzButtonModule,
    NzIconModule,
    NzSpinModule,
    NzTabsModule,
    ActivityComposerComponent,
    ActivityTimelineComponent,
    CompactBadgeComponent,
    RecordBannerComponent,
    RelatedEntityCardComponent
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './account-detail.component.scss',
  template: `
    @if (account(); as record) {
      <div class="detail">
        <app-record-banner
          [title]="record.name"
          icon="team"
          [metrics]="bannerMetrics()"
          editLabel="Edit"
          deleteLabel="Delete"
          (editClick)="editClick()"
          (deleteClick)="confirmDelete()"
        />

        <nz-tabs
          class="detail__tabs"
          nzSize="small"
          [nzSelectedIndex]="subTabIndex()"
          (nzSelectedIndexChange)="onSubTabChange($event)"
        >
          <nz-tab nzTitle="Overview">
            <div class="detail__body">
              <dl class="fields">
                <div class="fields__row"><dt>Account number</dt><dd>{{ record.accountNumber }}</dd></div>
                <div class="fields__row"><dt>Industry</dt><dd>{{ record.industry }}</dd></div>
                <div class="fields__row">
                  <dt>Rating</dt>
                  <dd><app-compact-badge [status]="record.rating" [colorType]="ratingTone(record.rating)" /></dd>
                </div>
                <div class="fields__row"><dt>Annual revenue</dt><dd class="fields__numeric">{{ compact(record.annualRevenue) }}</dd></div>
                <div class="fields__row"><dt>Phone</dt><dd>{{ record.phone || '—' }}</dd></div>
                <div class="fields__row"><dt>Website</dt><dd>{{ record.website || '—' }}</dd></div>
                <div class="fields__row"><dt>Owner</dt><dd>{{ record.ownerName }}</dd></div>
                <div class="fields__row"><dt>Open pipeline</dt><dd class="fields__numeric">{{ compact(openPipeline()) }}</dd></div>
                <div class="fields__row">
                  <dt>Billing address</dt>
                  <dd>
                    {{ record.billingAddress.street }}<br />
                    {{ record.billingAddress.city }}, {{ record.billingAddress.state }}
                    {{ record.billingAddress.postalCode }}<br />
                    {{ record.billingAddress.country }}
                  </dd>
                </div>
                <div class="fields__row">
                  <dt>Shipping address</dt>
                  <dd>
                    {{ record.shippingAddress.street }}<br />
                    {{ record.shippingAddress.city }}, {{ record.shippingAddress.state }}
                    {{ record.shippingAddress.postalCode }}<br />
                    {{ record.shippingAddress.country }}
                  </dd>
                </div>
              </dl>
            </div>
          </nz-tab>

          <nz-tab nzTitle="Contacts">
            <div class="detail__body">
              <app-related-entity-card
                title="Contacts"
                [count]="contacts().length"
                [columns]="contactColumns"
                [data]="contacts()"
                emptyText="No contacts recorded for this account yet."
                (addClick)="addContact()"
                (rowClick)="focusContacts()"
              />
            </div>
          </nz-tab>

          <nz-tab nzTitle="Opportunities">
            <div class="detail__body">
              <app-related-entity-card
                title="Opportunities"
                [count]="opportunities().length"
                [columns]="opportunityColumns"
                [data]="opportunityRows()"
                emptyText="No opportunities for this account yet."
                (addClick)="addOpportunity()"
                (rowClick)="openOpportunity($event)"
              />
            </div>
          </nz-tab>

          <nz-tab nzTitle="Activity">
            <div class="detail__body detail__body--split">
              <section class="detail__col">
                <h2 class="detail__col-title">Timeline</h2>
                @if (activities().length === 0) {
                  <p class="detail__empty">No activity logged against this account yet.</p>
                } @else {
                  <app-activity-timeline [activities]="activities()" (statusToggle)="onActivityToggle($event)" />
                }
              </section>
              <section class="detail__col">
                <h2 class="detail__col-title">Log something</h2>
                <app-activity-composer
                  entityType="ACCOUNT"
                  [entityId]="entityId()"
                  (activityAdded)="onActivityAdded()"
                />
              </section>
            </div>
          </nz-tab>
        </nz-tabs>
      </div>
    } @else {
      <div class="detail__missing">
        <nz-spin nzTip="Loading account" />
        <p>This account is no longer available. It may have been deleted in another window.</p>
        <button nz-button nzType="default" (click)="backToDashboard()">Back to dashboard</button>
      </div>
    }
  `
})
export class AccountDetailComponent {
  private readonly repo = inject(CrmRepositoryService);
  private readonly tabService = inject(WorkspaceTabService);
  private readonly shortcuts = inject(KeyboardShortcutService);
  private readonly drawer = inject(QuickCreateStateService);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);

  public readonly entityId = input.required<UUID>();

  protected readonly contactColumns = [
    { key: 'lastName', label: 'Last name' },
    { key: 'firstName', label: 'First name' },
    { key: 'title', label: 'Title' },
    { key: 'email', label: 'Email' }
  ];

  protected readonly opportunityColumns = [
    { key: 'name', label: 'Opportunity' },
    { key: 'stageLabel', label: 'Stage' },
    { key: 'amountLabel', label: 'Amount' },
    { key: 'closeDate', label: 'Close' }
  ];

  protected readonly myTabId = computed(() => WorkspaceTabService.tabIdFor('ACCOUNT', this.entityId()));
  protected readonly account = computed(() => this.repo.account(this.entityId()));
  protected readonly contacts = computed(() => this.repo.contactsForAccount(this.entityId()));
  protected readonly opportunities = computed(() => this.repo.opportunitiesForAccount(this.entityId()));
  protected readonly activities = computed(() => this.repo.activitiesForEntity('ACCOUNT', this.entityId()));

  protected readonly opportunityRows = computed(() =>
    this.opportunities().map(opportunity => ({
      ...opportunity,
      stageLabel: this.repo.opportunitiesWithDerived().find(view => view.id === opportunity.id)?.forecastCategory ?? '',
      amountLabel: formatCompactCurrency(opportunity.amount)
    }))
  );

  protected readonly openPipeline = computed(() =>
    this.opportunities()
      .filter(opportunity => !/^CLOSED/.test(opportunity.stage))
      .reduce((total, opportunity) => total + opportunity.amount, 0)
  );

  protected readonly subTabIndex = computed(() => {
    const key = this.tabService.activeTab().activeSubTabKey;
    const index = SUB_TABS.indexOf(key as SubTab);
    return index < 0 ? 0 : index;
  });

  protected readonly bannerMetrics = computed(() => {
    const record = this.account();
    if (!record) {
      return [];
    }
    return [
      { label: 'Industry', value: record.industry.replace(/_/g, ' ').toLowerCase() },
      { label: 'Revenue', value: formatCompactCurrency(record.annualRevenue) },
      { label: 'Contacts', value: String(this.contacts().length) },
      { label: 'Open deals', value: String(this.opportunities().filter(o => !/^CLOSED/.test(o.stage)).length) }
    ];
  });

  constructor() {
    effect(() => {
      const record = this.account();
      untracked(() => {
        this.tabService.updateTabTitle(this.myTabId(), record ? record.name : 'Account');
      });
    });

    this.shortcuts.saveRequested$
      .pipe(takeUntilDestroyed())
      .subscribe(() => {
        // Ctrl+S must only act on the tab the user is actually looking at.
        if (this.tabService.activeTabId() === this.myTabId()) {
          this.message.info('Account changes are saved as you make them.');
        }
      });
  }

  protected onSubTabChange(index: number): void {
    this.tabService.updateSubTab(this.myTabId(), SUB_TABS[index] ?? SUB_TABS[0]);
  }

  protected compact(value: number): string {
    return formatCompactCurrency(value);
  }

  protected ratingTone(rating: 'HOT' | 'WARM' | 'COLD'): CompactBadgeColor {
    if (rating === 'HOT') {
      return 'error';
    }
    return rating === 'WARM' ? 'warning' : 'default';
  }

  protected addContact(): void {
    this.drawer.openCreate('CONTACT', this.entityId(), 'ACCOUNT');
  }

  protected addOpportunity(): void {
    this.drawer.openCreate('OPPORTUNITY', this.entityId(), 'ACCOUNT');
  }

  protected editClick(): void {
    this.drawer.openEdit('ACCOUNT', this.entityId());
  }

  /** Contacts have no tab of their own; focusing the row reveals the grid. */
  protected focusContacts(): void {
    this.tabService.updateSubTab(this.myTabId(), 'contacts');
  }

  protected openOpportunity(id: UUID): void {
    this.tabService.openTab({
      id: WorkspaceTabService.tabIdFor('OPPORTUNITY', id),
      title: this.repo.opportunity(id)?.name ?? 'Opportunity',
      entityType: 'OPPORTUNITY',
      entityId: id,
      icon: 'dollar',
      closable: true
    });
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
    // The timeline reads the signal store and is already current.
  }

  protected confirmDelete(): void {
    const record = this.account();
    if (!record) {
      return;
    }
    this.modal.confirm({
      nzTitle: 'Delete account',
      nzContent: `"${record.name}", its ${this.contacts().length} contacts, ${this.opportunities().length} opportunities and all of their activity will be removed. This cannot be undone.`,
      nzOkText: 'Delete everything',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => {
        try {
          this.repo.deleteAccount(record.id);
          this.message.success('Account and all related records deleted');
          // The tab is retired by the shell's prune effect, not here.
        } catch (error) {
          this.message.error(error instanceof Error ? error.message : 'The account could not be deleted.');
        }
      }
    });
  }

  protected backToDashboard(): void {
    this.tabService.selectTab(WorkspaceTabService.DASHBOARD_TAB_ID);
  }
}
