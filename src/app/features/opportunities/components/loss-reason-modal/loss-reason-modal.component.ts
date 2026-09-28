import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NzButtonModule } from 'ng-zorro-antd/button';
import { NzFormModule } from 'ng-zorro-antd/form';
import { NzInputModule } from 'ng-zorro-antd/input';
import { NzModalModule } from 'ng-zorro-antd/modal';

const MIN_REASON_LENGTH = 5;

/**
 * Loss-reason capture for the Closed Lost transition.
 *
 * Closing a deal as lost is irreversible in the domain model: the reason is
 * required, and reopening clears it. That makes this the one stage change that
 * must not be a single mis-click on a chevron, so it gets its own dialog with a
 * real text field, a minimum length, and an explicit escape.
 *
 * The dialog is declarative rather than service-driven because the shell already
 * owns its visibility; routing it through `NzModalService` would add a second
 * owner for the same piece of state.
 */
@Component({
  selector: 'app-loss-reason-modal',
  imports: [ReactiveFormsModule, NzButtonModule, NzFormModule, NzInputModule, NzModalModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nz-modal
      [nzVisible]="visible()"
      nzTitle="Mark opportunity Closed Lost"
      [nzOkLoading]="submitting()"
      [nzOkDisabled]="!canSubmit()"
      nzOkText="Mark Closed Lost"
      nzCancelText="Keep open"
      [nzMaskClosable]="false"
      (nzOnCancel)="cancel()"
      (nzOnOk)="confirm()"
    >
      <ng-container *nzModalContent>
        <p class="loss-modal__intro">
          A loss reason is required and will be stored on the opportunity. Reopening the deal later
          clears the reason.
        </p>

        <nz-form-item>
          <nz-form-label nzFor="loss-reason" nzRequired>Loss reason</nz-form-label>
          <nz-form-control>
            <textarea
              nz-input
              id="loss-reason"
              rows="3"
              [formControl]="reason"
              placeholder="e.g. Lost to an incumbent after a budget freeze"
            ></textarea>
            <div class="loss-modal__hint">
              @if (tooShort()) {
                <span class="loss-modal__error">Enter at least {{ minLength }} characters.</span>
              } @else {
                <span>Describe why the deal was lost.</span>
              }
            </div>
          </nz-form-control>
        </nz-form-item>
      </ng-container>
    </nz-modal>
  `,
  styles: [
    `
      .loss-modal__intro {
        margin: 0 0 8px;
        font-size: var(--slds-font-size-body);
        color: var(--slds-text-secondary);
      }

      .loss-modal__hint {
        margin-top: 2px;
        font-size: var(--slds-font-size-label);
        color: var(--slds-text-secondary);
      }

      .loss-modal__error {
        color: var(--slds-error);
      }
    `
  ]
})
export class LossReasonModalComponent {
  public readonly visible = input.required<boolean>();
  /** Pre-fills the field when reopening a deal that already carries a reason. */
  public readonly initialReason = input<string>('');

  public readonly confirmed = output<string>();
  public readonly cancelled = output<void>();

  private readonly submittingSignal = signal<boolean>(false);
  protected readonly submitting = this.submittingSignal.asReadonly();
  protected readonly minLength = MIN_REASON_LENGTH;

  protected readonly reason = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.minLength(MIN_REASON_LENGTH)]
  });

  private readonly valueSignal = signal<string>('');
  protected readonly tooShort = computed(
    () => this.valueSignal().trim().length > 0 && this.valueSignal().trim().length < MIN_REASON_LENGTH
  );
  protected readonly canSubmit = computed(
    () => this.valueSignal().trim().length >= MIN_REASON_LENGTH && !this.submittingSignal()
  );

  constructor() {
    // Track the control so the disabled state of the confirm button is a
    // computed value rather than a subscription.
    this.reason.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(value => this.valueSignal.set(value));
  }

  protected confirm(): void {
    const value = this.reason.value.trim();
    if (this.submittingSignal()) {
      return;
    }
    this.reason.markAsTouched();
    if (value.length < MIN_REASON_LENGTH) {
      return;
    }
    this.submittingSignal.set(true);
    this.confirmed.emit(value);
    this.reset();
  }

  protected cancel(): void {
    if (this.submittingSignal()) {
      return;
    }
    this.cancelled.emit();
    this.reset();
  }

  /** Clears the field so the next transition starts from a blank dialog. */
  private reset(): void {
    this.reason.setValue(this.initialReason(), { emitEvent: true });
    this.reason.markAsUntouched();
    this.submittingSignal.set(false);
  }
}
