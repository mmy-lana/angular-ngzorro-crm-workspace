import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzInputNumberModule } from 'ng-zorro-antd/input-number';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import {
  AccountFormModel,
  ActivityFormModel,
  ActivityStatus,
  ActivityType,
  ConflictError,
  ContactFormModel,
  DomainRuleError,
  IndustryType,
  OpportunityFormModel,
  OpportunityStage,
  PriorityLevel,
  StageTransitionError,
  UUID
} from '@core/models/crm.models';
import { CrmRepositoryService } from '@core/services/crm-repository.service';
import { ViewportService } from '@core/services/viewport.service';
import { toLocalDateOnly } from '@core/utils/pipeline-calc';

type DrawerEntityType = 'ACCOUNT' | 'CONTACT' | 'OPPORTUNITY' | 'ACTIVITY';
type DrawerMode = 'create' | 'edit';
type ContextType = 'ACCOUNT' | 'OPPORTUNITY' | 'CONTACT' | null;

const ENTITY_LABELS: Record<DrawerEntityType, string> = {
  ACCOUNT: 'Account',
  CONTACT: 'Contact',
  OPPORTUNITY: 'Opportunity',
  ACTIVITY: 'Activity'
};

/**
 * Single drawer for creating and editing any of the four entity types.
 *
 * One drawer with four forms beats four drawers with one form: the shell owns a
 * single instance, so opening a contact from an account, an opportunity from
 * the utility bar, or a task from a keyboard shortcut all take the same path and
 * the same validation and error handling.
 *
 * The form is re-seeded from the record every time the drawer opens in edit
 * mode, and a record that disappears underneath the drawer (deleted in another
 * window) closes the drawer instead of saving a phantom edit.
 */
@Component({
  selector: 'app-quick-create-drawer',
  imports: [
    ReactiveFormsModule,
    NzButtonModule,
    NzCheckboxModule,
    NzDrawerModule,
    NzFormModule,
    NzInputModule,
    NzInputNumberModule,
    NzSelectModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './quick-create-drawer.component.scss',
  template: `
    <nz-drawer
      [nzVisible]="visible()"
      [nzTitle]="title()"
      [nzPlacement]="viewport.isMobile() ? 'bottom' : 'right'"
      [nzWidth]="viewport.isMobile() ? '100%' : 420"
      [nzHeight]="viewport.isMobile() ? '85dvh' : undefined"
      (nzOnClose)="close()"
    >
      <ng-container *nzDrawerContent>
        <div class="drawer-body">
          @switch (entityType()) {
            @case ('ACCOUNT') {
              <form [formGroup]="accountForm" class="drawer-form">
                <nz-form-item>
                  <nz-form-label nzFor="acc-name" nzRequired>Account name</nz-form-label>
                  <nz-form-control><input nz-input id="acc-name" formControlName="name" /></nz-form-control>
                </nz-form-item>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="acc-number">Account number</nz-form-label>
                    <nz-form-control><input nz-input id="acc-number" formControlName="accountNumber" placeholder="Auto-assigned" /></nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="acc-industry" nzRequired>Industry</nz-form-label>
                    <nz-form-control>
                      <nz-select id="acc-industry" formControlName="industry">
                        @for (option of industryOptions; track option) {
                          <nz-option [nzValue]="option" [nzLabel]="option" />
                        }
                      </nz-select>
                    </nz-form-control>
                  </nz-form-item>
                </div>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="acc-revenue" nzRequired>Annual revenue (USD)</nz-form-label>
                    <nz-form-control>
                      <nz-input-number id="acc-revenue" formControlName="annualRevenue" [nzMin]="0" [nzStep]="100000" nzSize="large" />
                    </nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="acc-rating" nzRequired>Rating</nz-form-label>
                    <nz-form-control>
                      <nz-select id="acc-rating" formControlName="rating">
                        <nz-option nzValue="HOT" nzLabel="Hot" />
                        <nz-option nzValue="WARM" nzLabel="Warm" />
                        <nz-option nzValue="COLD" nzLabel="Cold" />
                      </nz-select>
                    </nz-form-control>
                  </nz-form-item>
                </div>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="acc-phone">Phone</nz-form-label>
                    <nz-form-control><input nz-input id="acc-phone" formControlName="phone" /></nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="acc-website">Website</nz-form-label>
                    <nz-form-control><input nz-input id="acc-website" formControlName="website" /></nz-form-control>
                  </nz-form-item>
                </div>
                <fieldset class="drawer-form__fieldset">
                  <legend>Billing address</legend>
                  <nz-form-item>
                    <nz-form-label nzFor="acc-street" nzRequired>Street</nz-form-label>
                    <nz-form-control><input nz-input id="acc-street" formControlName="billingStreet" /></nz-form-control>
                  </nz-form-item>
                  <div class="drawer-form__row">
                    <nz-form-item>
                      <nz-form-label nzFor="acc-city" nzRequired>City</nz-form-label>
                      <nz-form-control><input nz-input id="acc-city" formControlName="billingCity" /></nz-form-control>
                    </nz-form-item>
                    <nz-form-item>
                      <nz-form-label nzFor="acc-state" nzRequired>State</nz-form-label>
                      <nz-form-control><input nz-input id="acc-state" formControlName="billingState" /></nz-form-control>
                    </nz-form-item>
                    <nz-form-item>
                      <nz-form-label nzFor="acc-postal" nzRequired>Postal code</nz-form-label>
                      <nz-form-control><input nz-input id="acc-postal" formControlName="billingPostalCode" /></nz-form-control>
                    </nz-form-item>
                  </div>
                  <nz-form-item>
                    <nz-form-label nzFor="acc-country" nzRequired>Country</nz-form-label>
                    <nz-form-control><input nz-input id="acc-country" formControlName="billingCountry" /></nz-form-control>
                  </nz-form-item>
                </fieldset>
              </form>
            }

            @case ('CONTACT') {
              <form [formGroup]="contactForm" class="drawer-form">
                <nz-form-item>
                  <nz-form-label nzFor="con-account" nzRequired>Account</nz-form-label>
                  <nz-form-control>
                    <nz-select id="con-account" formControlName="accountId" nzShowSearch nzPlaceHolder="Select an account">
                      @for (option of accountOptions(); track option.value) {
                        <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                      }
                    </nz-select>
                  </nz-form-control>
                </nz-form-item>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="con-first" nzRequired>First name</nz-form-label>
                    <nz-form-control><input nz-input id="con-first" formControlName="firstName" /></nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="con-last" nzRequired>Last name</nz-form-label>
                    <nz-form-control><input nz-input id="con-last" formControlName="lastName" /></nz-form-control>
                  </nz-form-item>
                </div>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="con-title">Job title</nz-form-label>
                    <nz-form-control><input nz-input id="con-title" formControlName="title" /></nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="con-dept">Department</nz-form-label>
                    <nz-form-control><input nz-input id="con-dept" formControlName="department" /></nz-form-control>
                  </nz-form-item>
                </div>
                <nz-form-item>
                  <nz-form-label nzFor="con-email" nzRequired>Email</nz-form-label>
                  <nz-form-control><input nz-input id="con-email" type="email" formControlName="email" /></nz-form-control>
                </nz-form-item>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="con-phone">Phone</nz-form-label>
                    <nz-form-control><input nz-input id="con-phone" formControlName="phone" /></nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="con-mobile">Mobile</nz-form-label>
                    <nz-form-control><input nz-input id="con-mobile" formControlName="mobilePhone" /></nz-form-control>
                  </nz-form-item>
                </div>
                <nz-form-item>
                  <nz-form-label nzFor="con-source">Lead source</nz-form-label>
                  <nz-form-control><input nz-input id="con-source" formControlName="leadSource" /></nz-form-control>
                </nz-form-item>
                <nz-form-item>
                  <nz-form-control>
                    <label class="drawer-form__check" for="con-primary">
                      <input id="con-primary" type="checkbox" formControlName="isPrimary" />
                      <span>Primary contact for this account</span>
                    </label>
                    <div class="drawer-form__hint">Only one contact per account can be primary.</div>
                  </nz-form-control>
                </nz-form-item>
              </form>
            }

            @case ('OPPORTUNITY') {
              <form [formGroup]="opportunityForm" class="drawer-form">
                <nz-form-item>
                  <nz-form-label nzFor="opp-name" nzRequired>Opportunity name</nz-form-label>
                  <nz-form-control><input nz-input id="opp-name" formControlName="name" /></nz-form-control>
                </nz-form-item>
                <nz-form-item>
                  <nz-form-label nzFor="opp-account" nzRequired>Account</nz-form-label>
                  <nz-form-control>
                    <nz-select id="opp-account" formControlName="accountId" nzShowSearch nzPlaceHolder="Select an account">
                      @for (option of accountOptions(); track option.value) {
                        <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                      }
                    </nz-select>
                  </nz-form-control>
                </nz-form-item>
                <nz-form-item>
                  <nz-form-label nzFor="opp-contact" nzRequired>Primary contact</nz-form-label>
                  <nz-form-control>
                    <nz-select
                      id="opp-contact"
                      formControlName="primaryContactId"
                      nzShowSearch
                      [nzPlaceHolder]="selectedAccountId() ? 'Select a contact' : 'Choose an account first'"
                    >
                      @for (option of contactOptions(); track option.value) {
                        <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                      }
                    </nz-select>
                    @if (selectedAccountId() && contactOptions().length === 0) {
                      <div class="drawer-form__hint">This account has no contacts yet. Add one first.</div>
                    }
                  </nz-form-control>
                </nz-form-item>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="opp-stage" nzRequired>Stage</nz-form-label>
                    <nz-form-control>
                      <nz-select id="opp-stage" formControlName="stage">
                        @for (option of stageOptions; track option.value) {
                          <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                        }
                      </nz-select>
                    </nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="opp-amount" nzRequired>Amount (USD)</nz-form-label>
                    <nz-form-control>
                      <nz-input-number id="opp-amount" formControlName="amount" [nzMin]="0" [nzStep]="10000" nzSize="large" />
                    </nz-form-control>
                  </nz-form-item>
                </div>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="opp-close" nzRequired>Close date</nz-form-label>
                    <nz-form-control><input nz-input id="opp-close" type="date" formControlName="closeDate" /></nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="opp-source">Lead source</nz-form-label>
                    <nz-form-control><input nz-input id="opp-source" formControlName="leadSource" /></nz-form-control>
                  </nz-form-item>
                </div>
                <nz-form-item>
                  <nz-form-label nzFor="opp-next">Next step</nz-form-label>
                  <nz-form-control><textarea nz-input id="opp-next" rows="2" formControlName="nextStep"></textarea></nz-form-control>
                </nz-form-item>
                @if (opportunityForm.controls.stage.value === 'CLOSED_LOST') {
                  <nz-form-item>
                    <nz-form-label nzFor="opp-loss" nzRequired>Loss reason</nz-form-label>
                    <nz-form-control>
                      <textarea nz-input id="opp-loss" rows="2" formControlName="lossReason"></textarea>
                      <div class="drawer-form__hint">Required to mark an opportunity Closed Lost.</div>
                    </nz-form-control>
                  </nz-form-item>
                }
              </form>
            }

            @case ('ACTIVITY') {
              <form [formGroup]="activityForm" class="drawer-form">
                <nz-form-item>
                  <nz-form-label nzFor="act-type" nzRequired>Activity type</nz-form-label>
                  <nz-form-control>
                    <nz-select id="act-type" formControlName="type">
                      @for (option of activityTypeOptions; track option.value) {
                        <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                      }
                    </nz-select>
                  </nz-form-control>
                </nz-form-item>
                <nz-form-item>
                  <nz-form-label nzFor="act-subject" nzRequired>Subject</nz-form-label>
                  <nz-form-control><input nz-input id="act-subject" formControlName="subject" /></nz-form-control>
                </nz-form-item>
                <div class="drawer-form__row">
                  <nz-form-item>
                    <nz-form-label nzFor="act-priority" nzRequired>Priority</nz-form-label>
                    <nz-form-control>
                      <nz-select id="act-priority" formControlName="priority">
                        @for (option of priorityOptions; track option.value) {
                          <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                        }
                      </nz-select>
                    </nz-form-control>
                  </nz-form-item>
                  <nz-form-item>
                    <nz-form-label nzFor="act-status" nzRequired>Status</nz-form-label>
                    <nz-form-control>
                      <nz-select id="act-status" formControlName="status">
                        @for (option of statusOptions; track option.value) {
                          <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                        }
                      </nz-select>
                    </nz-form-control>
                  </nz-form-item>
                </div>
                @if (activityForm.controls.type.value !== 'NOTE') {
                  <nz-form-item>
                    <nz-form-label nzFor="act-due">Due date</nz-form-label>
                    <nz-form-control><input nz-input id="act-due" type="date" formControlName="dueDate" /></nz-form-control>
                  </nz-form-item>
                }
                <nz-form-item>
                  <nz-form-label nzFor="act-assignee">Assigned to</nz-form-label>
                  <nz-form-control>
                    <nz-select id="act-assignee" formControlName="assignedToName" nzShowSearch nzPlaceHolder="Unassigned">
                      @for (option of assigneeOptions(); track option.value) {
                        <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                      }
                    </nz-select>
                  </nz-form-control>
                </nz-form-item>
                <nz-form-item>
                  <nz-form-label nzFor="act-notes">Notes</nz-form-label>
                  <nz-form-control><textarea nz-input id="act-notes" rows="3" formControlName="notes"></textarea></nz-form-control>
                </nz-form-item>
              </form>
            }
          }

          @if (errorMessage()) {
            <p class="drawer-body__error" role="alert">{{ errorMessage() }}</p>
          }
        </div>

        <div class="drawer-footer">
          <button nz-button nzType="default" (click)="close()">Cancel</button>
          <button nz-button nzType="primary" [disabled]="saving()" (click)="save()">
            {{ saving() ? 'Saving...' : submitLabel() }}
          </button>
        </div>
      </ng-container>
    </nz-drawer>
  `
})
export class QuickCreateDrawerComponent {
  private readonly repo = inject(CrmRepositoryService);
  private readonly message = inject(NzMessageService);

  public readonly visible = input.required<boolean>();
  public readonly mode = input<DrawerMode>('create');
  public readonly entityType = input.required<DrawerEntityType>();
  public readonly recordId = input<UUID | null>(null);
  public readonly contextId = input<UUID | null>(null);
  public readonly contextType = input<ContextType>(null);

  public readonly closed = output<void>();
  public readonly created = output<void>();

  protected readonly viewport = inject(ViewportService);
  protected readonly errorMessage = signal<string>('');
  protected readonly saving = signal<boolean>(false);

  protected readonly industryOptions = Object.values(IndustryType);
  protected readonly stageOptions = Object.values(OpportunityStage).map(value => ({
    value,
    label: value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())
  }));
  protected readonly activityTypeOptions = Object.values(ActivityType).map(value => ({
    value,
    label: value.charAt(0) + value.slice(1).toLowerCase()
  }));
  protected readonly priorityOptions = Object.values(PriorityLevel).map(value => ({
    value,
    label: value.charAt(0) + value.slice(1).toLowerCase()
  }));
  protected readonly statusOptions = Object.values(ActivityStatus).map(value => ({
    value,
    label: value.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())
  }));

  protected readonly accountForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    accountNumber: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    industry: new FormControl<IndustryType>(IndustryType.TECHNOLOGY, { nonNullable: true, validators: [Validators.required] }),
    annualRevenue: new FormControl<number>(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    website: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(200)] }),
    rating: new FormControl<AccountFormModel['rating']>('WARM', { nonNullable: true, validators: [Validators.required] }),
    billingStreet: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(160)] }),
    billingCity: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    billingState: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] }),
    billingPostalCode: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(20)] }),
    billingCountry: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(80)] })
  });

  protected readonly contactForm = new FormGroup({
    accountId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    firstName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    lastName: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(60)] }),
    title: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
    department: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(120)] }),
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    phone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    mobilePhone: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(40)] }),
    isPrimary: new FormControl(false, { nonNullable: true }),
    leadSource: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] })
  });

  protected readonly opportunityForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    accountId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    primaryContactId: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    stage: new FormControl<OpportunityStage>(OpportunityStage.PROSPECTING, { nonNullable: true, validators: [Validators.required] }),
    amount: new FormControl<number>(0, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
    closeDate: new FormControl(toLocalDateOnly(), { nonNullable: true, validators: [Validators.required] }),
    nextStep: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] }),
    leadSource: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    lossReason: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(500)] })
  });

  protected readonly activityForm = new FormGroup({
    type: new FormControl<ActivityType>(ActivityType.TASK, { nonNullable: true, validators: [Validators.required] }),
    subject: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    status: new FormControl<ActivityStatus>(ActivityStatus.NOT_STARTED, { nonNullable: true, validators: [Validators.required] }),
    priority: new FormControl<PriorityLevel>(PriorityLevel.NORMAL, { nonNullable: true, validators: [Validators.required] }),
    dueDate: new FormControl<string | null>(null),
    assignedToName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(2000)] })
  });

  protected readonly accountOptions = computed(() =>
    this.repo
      .accounts()
      .map(account => ({ value: account.id, label: account.name }))
      .sort((a, b) => a.label.localeCompare(b.label))
  );

  protected readonly assigneeOptions = computed(() => {
    const names = new Set<string>();
    for (const account of this.repo.accounts()) {
      names.add(account.ownerName);
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ value: name, label: name }));
  });

  protected readonly selectedAccountId = toSignal(this.opportunityForm.controls.accountId.valueChanges, {
    initialValue: this.opportunityForm.controls.accountId.value
  });

  /** Contacts of the selected account only, per the linkage invariant. */
  protected readonly contactOptions = computed(() => {
    const accountId = this.selectedAccountId();
    if (!accountId) {
      return [];
    }
    return this.repo
      .contactsForAccount(accountId)
      .map(contact => ({ value: contact.id, label: `${contact.firstName} ${contact.lastName}`.trim() }));
  });

  protected readonly title = computed(() => {
    const label = ENTITY_LABELS[this.entityType()];
    return `${this.mode() === 'edit' ? 'Edit' : 'New'} ${label}`;
  });

  protected readonly submitLabel = computed(() => (this.mode() === 'edit' ? 'Save changes' : 'Create'));

  constructor() {
    // Re-seed the form every time the drawer opens so a previous edit never
    // leaks into the next one, and so edit mode always reflects current data.
    effect(() => {
      const visible = this.visible();
      const entityType = this.entityType();
      const mode = this.mode();
      const recordId = this.recordId();
      const contextId = this.contextId();
      const contextType = this.contextType();
      if (!visible) {
        return;
      }
      untracked(() => {
        this.errorMessage.set('');
        this.seedForms(entityType, mode, recordId, contextId, contextType);
      });
    });

    // Closed Lost is the only stage that demands a loss reason.
    this.opportunityForm.controls.stage.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(stage => {
        const control = this.opportunityForm.controls.lossReason;
        if (stage === OpportunityStage.CLOSED_LOST) {
          control.addValidators(Validators.required);
        } else {
          control.clearValidators();
        }
        control.updateValueAndValidity({ emitEvent: false });
      });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected save(): void {
    if (this.saving()) {
      return;
    }
    this.errorMessage.set('');
    try {
      switch (this.entityType()) {
        case 'ACCOUNT':
          this.saveAccount();
          break;
        case 'CONTACT':
          this.saveContact();
          break;
        case 'OPPORTUNITY':
          this.saveOpportunity();
          break;
        case 'ACTIVITY':
          this.saveActivity();
          break;
      }
    } catch (error) {
      this.errorMessage.set(describeFailure(error));
      return;
    }
    this.message.success(this.mode() === 'edit' ? 'Changes saved' : 'Record created');
    this.created.emit();
  }

  private saveAccount(): void {
    const raw = this.accountForm.getRawValue();
    this.accountForm.markAllAsTouched();
    if (this.accountForm.invalid) {
      this.errorMessage.set('Complete the required account fields.');
      return;
    }
    if (this.mode() === 'edit') {
      const existing = this.requireAccount();
      this.repo.updateAccount(
        existing.id,
        {
          name: raw.name.trim(),
          accountNumber: raw.accountNumber.trim() || existing.accountNumber,
          industry: raw.industry,
          annualRevenue: raw.annualRevenue,
          phone: raw.phone.trim(),
          website: raw.website.trim(),
          rating: raw.rating,
          billingAddress: {
            street: raw.billingStreet.trim(),
            city: raw.billingCity.trim(),
            state: raw.billingState.trim(),
            postalCode: raw.billingPostalCode.trim(),
            country: raw.billingCountry.trim()
          }
        },
        existing.version
      );
      return;
    }
    const model: AccountFormModel = raw;
    this.repo.createAccount(model);
  }

  private saveContact(): void {
    const raw = this.contactForm.getRawValue();
    this.contactForm.markAllAsTouched();
    if (this.contactForm.invalid) {
      this.errorMessage.set('Complete the required contact fields.');
      return;
    }
    if (this.mode() === 'edit') {
      const existing = this.requireContact();
      this.repo.updateContact(existing.id, { ...raw, email: raw.email.trim() }, existing.version);
      return;
    }
    const model: ContactFormModel = raw;
    this.repo.createContact(model);
  }

  private saveOpportunity(): void {
    const raw = this.opportunityForm.getRawValue();
    this.opportunityForm.markAllAsTouched();
    if (this.opportunityForm.invalid) {
      this.errorMessage.set('Complete the required opportunity fields.');
      return;
    }
    if (this.mode() === 'edit') {
      const existing = this.requireOpportunity();
      const losing = raw.stage === OpportunityStage.CLOSED_LOST;
      this.repo.updateOpportunity(
        existing.id,
        {
          name: raw.name.trim(),
          accountId: raw.accountId,
          primaryContactId: raw.primaryContactId,
          stage: raw.stage,
          amount: raw.amount,
          closeDate: raw.closeDate,
          nextStep: raw.nextStep.trim(),
          leadSource: raw.leadSource.trim(),
          // Sending `undefined` clears the key, which is how a reopened deal
          // loses the loss reason recorded on the previous close.
          lossReason: losing ? raw.lossReason.trim() : undefined
        },
        existing.version
      );
      return;
    }
    const model: OpportunityFormModel = {
      name: raw.name,
      accountId: raw.accountId,
      primaryContactId: raw.primaryContactId,
      stage: raw.stage,
      amount: raw.amount,
      closeDate: raw.closeDate,
      nextStep: raw.nextStep,
      leadSource: raw.leadSource,
      ...(raw.stage === OpportunityStage.CLOSED_LOST ? { lossReason: raw.lossReason } : {})
    };
    this.repo.createOpportunity(model);
  }

  private saveActivity(): void {
    const raw = this.activityForm.getRawValue();
    this.activityForm.markAllAsTouched();
    if (this.activityForm.invalid) {
      this.errorMessage.set('Complete the required activity fields.');
      return;
    }
    const entityType = this.contextType() ?? 'ACCOUNT';
    const entityId = this.contextId();
    if (entityId === null) {
      this.errorMessage.set('An activity must belong to a record. Open the record first.');
      return;
    }
    const dueDate = this.parseDueDate(raw.dueDate, raw.type);

    if (this.mode() === 'edit') {
      const existing = this.requireActivity();
      this.repo.updateActivity(
        existing.id,
        {
          type: raw.type,
          subject: raw.subject.trim(),
          status: raw.type === ActivityType.NOTE ? ActivityStatus.COMPLETED : raw.status,
          priority: raw.priority,
          dueDate: raw.type === ActivityType.NOTE ? null : dueDate,
          assignedToName: raw.assignedToName.trim(),
          notes: raw.notes.trim()
        },
        existing.version
      );
      return;
    }

    const model: ActivityFormModel = {
      entityType,
      entityId,
      type: raw.type,
      subject: raw.subject,
      status: raw.type === ActivityType.NOTE ? ActivityStatus.COMPLETED : raw.status,
      priority: raw.priority,
      dueDate,
      assignedToName: raw.assignedToName,
      notes: raw.notes
    };
    this.repo.createActivity(model);
  }

  /**
   * Converts a due-date control value into a stored ISO timestamp.
   *
   * The control is bound to a native date input, so today it only ever yields
   * `YYYY-MM-DD` or null. That is a property of *this* binding, not of the
   * repository: the value is typed `unknown` at this boundary so a caller that
   * supplies a `Date`, a full ISO string, a locale-formatted string or a
   * malformed value cannot reach `new Date(...).toISOString()` and raise
   * `RangeError: Invalid time value` on submit. Anything unparseable degrades
   * to "no due date" rather than failing the whole save.
   *
   * A date-only value is anchored at 09:00 local rather than midnight, so a
   * user west of UTC does not see the due date silently shift to the previous
   * day.
   */
  private parseDueDate(value: unknown, type: ActivityType): string | null {
    // A note records something that already happened: it carries no due date.
    if (type === ActivityType.NOTE || value === null || value === undefined) {
      return null;
    }

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }

    if (typeof value !== 'string') {
      return null;
    }

    const trimmed = value.trim();
    if (trimmed.length === 0) {
      return null;
    }

    // A string that already carries a time component is parsed as-is; a
    // date-only string gets the 09:00 local anchor.
    const candidate = trimmed.includes('T') ? trimmed : `${trimmed}T09:00:00`;
    const timestamp = Date.parse(candidate);
    return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
  }

  /* ---------------------------------------------------------------------- */
  /* Loading                                                                 */
  /* ---------------------------------------------------------------------- */

  private seedForms(
    entityType: DrawerEntityType,
    mode: DrawerMode,
    recordId: UUID | null,
    contextId: UUID | null,
    contextType: ContextType
  ): void {
    if (mode === 'create' || recordId === null) {
      this.resetForms(entityType, contextId, contextType);
      return;
    }
    switch (entityType) {
      case 'ACCOUNT': {
        const account = this.repo.account(recordId);
        if (!account) {
          this.resetForms(entityType, null, null);
          return;
        }
        this.accountForm.reset(
          {
            name: account.name,
            accountNumber: account.accountNumber,
            industry: account.industry,
            annualRevenue: account.annualRevenue,
            phone: account.phone,
            website: account.website,
            rating: account.rating,
            billingStreet: account.billingAddress.street,
            billingCity: account.billingAddress.city,
            billingState: account.billingAddress.state,
            billingPostalCode: account.billingAddress.postalCode,
            billingCountry: account.billingAddress.country
          },
          { emitEvent: false }
        );
        return;
      }
      case 'CONTACT': {
        const contact = this.repo.contact(recordId);
        if (!contact) {
          this.resetForms(entityType, null, null);
          return;
        }
        this.contactForm.reset(
          {
            accountId: contact.accountId,
            firstName: contact.firstName,
            lastName: contact.lastName,
            title: contact.title,
            department: contact.department,
            email: contact.email,
            phone: contact.phone,
            mobilePhone: contact.mobilePhone,
            isPrimary: contact.isPrimary,
            leadSource: contact.leadSource
          },
          { emitEvent: false }
        );
        return;
      }
      case 'OPPORTUNITY': {
        const opportunity = this.repo.opportunity(recordId);
        if (!opportunity) {
          this.resetForms(entityType, null, null);
          return;
        }
        this.opportunityForm.reset(
          {
            name: opportunity.name,
            accountId: opportunity.accountId,
            primaryContactId: opportunity.primaryContactId,
            stage: opportunity.stage,
            amount: opportunity.amount,
            closeDate: opportunity.closeDate,
            nextStep: opportunity.nextStep,
            leadSource: opportunity.leadSource,
            lossReason: opportunity.lossReason ?? ''
          },
          { emitEvent: true }
        );
        return;
      }
      case 'ACTIVITY': {
        const activity = this.repo.activity(recordId);
        if (!activity) {
          this.resetForms(entityType, null, null);
          return;
        }
        this.activityForm.reset(
          {
            type: activity.type,
            subject: activity.subject,
            status: activity.status,
            priority: activity.priority,
            dueDate: activity.dueDate === null ? null : activity.dueDate.slice(0, 10),
            assignedToName: activity.assignedToName,
            notes: activity.notes
          },
          { emitEvent: false }
        );
        return;
      }
    }
  }

  private resetForms(entityType: DrawerEntityType, contextId: UUID | null, contextType: ContextType): void {
    const accountId = contextType === 'ACCOUNT' ? contextId : null;
    const contactId = contextType === 'CONTACT' ? contextId : null;

    this.accountForm.reset(
      {
        name: '',
        accountNumber: '',
        industry: IndustryType.TECHNOLOGY,
        annualRevenue: 0,
        phone: '',
        website: '',
        rating: 'WARM',
        billingStreet: '',
        billingCity: '',
        billingState: '',
        billingPostalCode: '',
        billingCountry: ''
      },
      { emitEvent: false }
    );

    this.contactForm.reset(
      {
        accountId: accountId ?? '',
        firstName: '',
        lastName: '',
        title: '',
        department: '',
        email: '',
        phone: '',
        mobilePhone: '',
        isPrimary: false,
        leadSource: ''
      },
      { emitEvent: false }
    );

    // A contact created from inside its own account starts as the primary when
    // it would otherwise be the account's only contact; leaving the box ticked
    // makes that explicit to the user rather than surprising them later.
    this.opportunityForm.reset(
      {
        name: '',
        accountId: accountId ?? '',
        primaryContactId: contactId ?? '',
        stage: OpportunityStage.PROSPECTING,
        amount: 0,
        closeDate: toLocalDateOnly(),
        nextStep: '',
        leadSource: '',
        lossReason: ''
      },
      { emitEvent: true }
    );

    this.activityForm.reset(
      {
        type: ActivityType.TASK,
        subject: '',
        status: ActivityStatus.NOT_STARTED,
        priority: PriorityLevel.NORMAL,
        dueDate: null,
        assignedToName: '',
        notes: ''
      },
      { emitEvent: false }
    );
  }

  /** Edit mode targets a record that may have been deleted elsewhere. */
  private requireAccount() {
    const id = this.recordId();
    const account = id === null ? undefined : this.repo.account(id);
    if (!account) {
      throw new DomainRuleError('This account no longer exists. Reopen the record and try again.');
    }
    return account;
  }

  private requireContact() {
    const id = this.recordId();
    const contact = id === null ? undefined : this.repo.contact(id);
    if (!contact) {
      throw new DomainRuleError('This contact no longer exists. Reopen the record and try again.');
    }
    return contact;
  }

  private requireOpportunity() {
    const id = this.recordId();
    const opportunity = id === null ? undefined : this.repo.opportunity(id);
    if (!opportunity) {
      throw new DomainRuleError('This opportunity no longer exists. Reopen the record and try again.');
    }
    return opportunity;
  }

  private requireActivity() {
    const id = this.recordId();
    const activity = id === null ? undefined : this.repo.activity(id);
    if (!activity) {
      throw new DomainRuleError('This activity no longer exists. Reopen the record and try again.');
    }
    return activity;
  }
}

/** Turns a repository failure into a sentence a user can act on. */
function describeFailure(error: unknown): string {
  if (error instanceof ConflictError || error instanceof DomainRuleError || error instanceof StageTransitionError) {
    return error.message;
  }
  return 'The record could not be saved. Please try again.';
}
