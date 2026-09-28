import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzDatePickerModule } from 'ng-zorro-antd/date-picker';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzSelectModule } from 'ng-zorro-antd/select';
import { NzTabsModule } from 'ng-zorro-antd/tabs';
import {
  ActivityFormModel,
  ActivityStatus,
  ActivityType,
  ConflictError,
  DomainRuleError,
  PriorityLevel,
  StageTransitionError,
  UUID
} from '@core/models/crm.models';
import { CrmRepositoryService } from '@core/services/crm-repository.service';
import { toLocalDateOnly } from '@core/utils/pipeline-calc';

type ComposerTab = 'CALL' | 'TASK' | 'NOTE';
type SupportedEntityType = 'ACCOUNT' | 'OPPORTUNITY' | 'CONTACT';

interface ComposerTabDefinition {
  readonly key: ComposerTab;
  readonly title: string;
  readonly activityType: ActivityType;
  readonly subjectLabel: string;
  readonly subjectPlaceholder: string;
  readonly requiresDueDate: boolean;
}

const COMPOSER_TABS: readonly ComposerTabDefinition[] = [
  {
    key: 'CALL',
    title: 'Log a Call',
    activityType: ActivityType.CALL,
    subjectLabel: 'Call summary',
    subjectPlaceholder: 'What was discussed',
    requiresDueDate: false
  },
  {
    key: 'TASK',
    title: 'Create Task',
    activityType: ActivityType.TASK,
    subjectLabel: 'Task',
    subjectPlaceholder: 'What needs doing',
    requiresDueDate: true
  },
  {
    key: 'NOTE',
    title: 'Add Note',
    activityType: ActivityType.NOTE,
    subjectLabel: 'Note title',
    subjectPlaceholder: 'Short title for this note',
    requiresDueDate: false
  }
];

/**
 * Tabbed composer for logging an activity against one record.
 *
 * A single form serves the three tabs rather than three separate forms: the
 * shared fields stay in one place, and the only per-tab difference is whether a
 * due date is required. Switching tabs re-validates the form, so a Task cannot
 * be submitted without a date even though the field is hidden on the other two
 * tabs.
 *
 * A submitted activity is written straight through the repository, so the
 * activity feed on the same screen updates from the signal store in the same
 * change-detection pass.
 */
@Component({
  selector: 'app-activity-composer',
  imports: [
    ReactiveFormsModule,
    NzButtonModule,
    NzDatePickerModule,
    NzFormModule,
    NzInputModule,
    NzSelectModule,
    NzTabsModule
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nz-tabs
      class="composer"
      nzSize="small"
      [nzSelectedIndex]="activeTabIndex()"
      (nzSelectedIndexChange)="selectTabIndex($event)"
    >
      @for (tab of tabs; track tab.key) {
        <nz-tab [nzTitle]="tab.title">
          <form class="composer__form" [formGroup]="form" (ngSubmit)="submit(tab)">
            <nz-form-item>
              <nz-form-label [nzFor]="tab.key + '-subject'" [nzRequired]="true">{{ tab.subjectLabel }}</nz-form-label>
              <nz-form-control>
                <input
                  nz-input
                  [id]="tab.key + '-subject'"
                  [placeholder]="tab.subjectPlaceholder"
                  formControlName="subject"
                  autocomplete="off"
                />
              </nz-form-control>
            </nz-form-item>

            @if (tab.key !== 'NOTE') {
              <nz-form-item>
                <nz-form-label nzFor="composer-due">Due date</nz-form-label>
                <nz-form-control>
                  <nz-date-picker
                    nzId="composer-due"
                    formControlName="dueDate"
                    [nzDisabledDate]="disabledPastDates"
                  />
                </nz-form-control>
              </nz-form-item>

              <fieldset class="composer__priority">
                <legend class="composer__legend">Priority</legend>
                @for (option of priorityOptions; track option.value) {
                  <label class="composer__radio">
                    <input type="radio" formControlName="priority" [value]="option.value" />
                    <span>{{ option.label }}</span>
                  </label>
                }
              </fieldset>

              <nz-form-item>
                <nz-form-label>Status</nz-form-label>
                <nz-form-control>
                  <nz-select formControlName="status">
                    @for (option of openStatusOptions; track option.value) {
                      <nz-option [nzValue]="option.value" [nzLabel]="option.label" />
                    }
                  </nz-select>
                </nz-form-control>
              </nz-form-item>
            }

            <nz-form-item>
              <nz-form-label nzFor="composer-assignee">Assigned to</nz-form-label>
              <nz-form-control>
                <nz-select
                  nzId="composer-assignee"
                  formControlName="assignedToName"
                  nzShowSearch
                  nzPlaceHolder="Unassigned"
                  [nzOptions]="assigneeOptions()"
                />
              </nz-form-control>
            </nz-form-item>

            <nz-form-item>
              <nz-form-label nzFor="composer-notes">Notes</nz-form-label>
              <nz-form-control>
                <textarea
                  nz-input
                  id="composer-notes"
                  formControlName="notes"
                  rows="3"
                  placeholder="Optional detail"
                ></textarea>
              </nz-form-control>
            </nz-form-item>

            @if (errorMessage()) {
              <p class="composer__error" role="alert">{{ errorMessage() }}</p>
            }

            <div class="composer__actions">
              <button nz-button nzType="primary" nzBlock [disabled]="submitting()">
                {{ submitting() ? 'Saving...' : tab.title }}
              </button>
            </div>
          </form>
        </nz-tab>
      }
    </nz-tabs>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .composer__form {
        padding-top: 8px;
      }

      .composer__priority {
        display: flex;
        flex-wrap: wrap;
        gap: 12px;
        margin: 0 0 8px;
        padding: 4px 0 0;
        border: 0;
      }

      .composer__legend {
        padding: 0;
        font-size: var(--slds-font-size-label);
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--slds-text-secondary);
      }

      .composer__radio {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        cursor: pointer;
      }

      .composer__radio input {
        margin: 0;
        accent-color: var(--slds-brand);
      }

      .composer__error {
        margin: 0 0 8px;
        padding: 6px 8px;
        border-left: 3px solid var(--slds-error);
        background: color-mix(in srgb, var(--slds-error) 8%, transparent);
        color: var(--slds-error);
        font-size: var(--slds-font-size-body);
      }

      .composer__actions {
        margin-top: 4px;
      }
    `
  ]
})
export class ActivityComposerComponent {
  private readonly repo = inject(CrmRepositoryService);
  private readonly message = inject(NzMessageService);

  public readonly entityType = input.required<SupportedEntityType>();
  public readonly entityId = input.required<UUID>();
  public readonly activityAdded = output<void>();

  protected readonly tabs = COMPOSER_TABS;
  protected readonly errorMessage = signal<string>('');
  protected readonly submitting = signal<boolean>(false);

  private readonly activeTabIndexSignal = signal<number>(0);
  protected readonly activeTabIndex = this.activeTabIndexSignal.asReadonly();

  protected readonly form = new FormGroup({
    subject: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(120)] }),
    notes: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(2000)] }),
    dueDate: new FormControl<Date | null>(null),
    priority: new FormControl<PriorityLevel>(PriorityLevel.NORMAL, { nonNullable: true }),
    status: new FormControl<ActivityStatus>(ActivityStatus.NOT_STARTED, { nonNullable: true }),
    assignedToName: new FormControl('', { nonNullable: true, validators: [Validators.maxLength(80)] })
  });

  protected readonly priorityOptions = [
    { label: 'Low', value: PriorityLevel.LOW },
    { label: 'Normal', value: PriorityLevel.NORMAL },
    { label: 'High', value: PriorityLevel.HIGH },
    { label: 'Critical', value: PriorityLevel.CRITICAL }
  ];

  protected readonly openStatusOptions = [
    { label: 'Not started', value: ActivityStatus.NOT_STARTED },
    { label: 'In progress', value: ActivityStatus.IN_PROGRESS },
    { label: 'Deferred', value: ActivityStatus.DEFERRED }
  ];

  protected readonly assigneeOptions = computed(() => {
    const names = new Set<string>();
    for (const account of this.repo.accounts()) {
      names.add(account.ownerName);
    }
    return [...names]
      .sort((a, b) => a.localeCompare(b))
      .map(name => ({ label: name, value: name }));
  });

  constructor() {
    // The tab decides whether a due date is required, so validation has to be
    // re-applied whenever the tab changes.
    effect(() => {
      const tab = COMPOSER_TABS[this.activeTabIndexSignal()] ?? COMPOSER_TABS[0];
      this.applyTabRules(tab);
    });
  }

  protected selectTabIndex(index: number): void {
    this.activeTabIndexSignal.set(index);
    this.errorMessage.set('');
  }

  protected disabledPastDates = (date: Date): boolean => date.getTime() < Date.parse(`${toLocalDateOnly()}T00:00:00`);

  protected submit(tab: ComposerTabDefinition): void {
    if (this.submitting()) {
      return;
    }
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      this.errorMessage.set('Complete the required fields before saving.');
      return;
    }

    const raw = this.form.getRawValue();
    const model: ActivityFormModel = {
      entityType: this.entityType(),
      entityId: this.entityId(),
      type: tab.activityType,
      subject: raw.subject.trim(),
      status: tab.key === 'NOTE' ? ActivityStatus.COMPLETED : raw.status,
      priority: tab.key === 'NOTE' ? PriorityLevel.NORMAL : raw.priority,
      dueDate: tab.key === 'NOTE' || raw.dueDate === null ? null : raw.dueDate.toISOString(),
      assignedToName: raw.assignedToName.trim(),
      notes: raw.notes.trim()
    };

    this.submitting.set(true);
    try {
      this.repo.createActivity(model);
      this.message.success(`${tab.title} saved`);
      this.form.reset({
        subject: '',
        notes: '',
        dueDate: null,
        priority: PriorityLevel.NORMAL,
        status: ActivityStatus.NOT_STARTED,
        assignedToName: ''
      });
      this.errorMessage.set('');
      this.activityAdded.emit();
    } catch (error) {
      this.errorMessage.set(describeFailure(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private applyTabRules(tab: ComposerTabDefinition): void {
    if (tab.requiresDueDate) {
      this.form.controls.dueDate.addValidators(Validators.required);
    } else {
      this.form.controls.dueDate.clearValidators();
      if (tab.key === 'NOTE') {
        this.form.controls.status.setValue(ActivityStatus.COMPLETED, { emitEvent: false });
        this.form.controls.dueDate.setValue(null, { emitEvent: false });
      }
    }
    this.form.controls.dueDate.updateValueAndValidity({ emitEvent: false });
  }
}

/** Turns a repository failure into a sentence a user can act on. */
function describeFailure(error: unknown): string {
  if (error instanceof ConflictError || error instanceof DomainRuleError || error instanceof StageTransitionError) {
    return error.message;
  }
  return 'The activity could not be saved. Please try again.';
}
