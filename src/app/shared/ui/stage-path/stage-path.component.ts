import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NzDrawerModule } from 'ng-zorro-antd/drawer';
import { NzIconModule } from 'ng-zorro-antd/icon';
import { OpportunityStage } from '@core/models/crm.models';
import { ViewportService } from '@core/services/viewport.service';
import { PIPELINE_STAGES, STAGE_CONFIG, isClosedStage } from '@core/utils/pipeline-calc';
import { StageColorPipe } from '@shared/pipes/stage-color.pipe';
import { CompactBadgeComponent } from '@shared/ui/compact-badge/compact-badge.component';

/** Ribbon label: the full stage name does not fit inside a chevron. */
const RIBBON_LABELS: Record<OpportunityStage, string> = {
  [OpportunityStage.PROSPECTING]: 'Prospecting',
  [OpportunityStage.QUALIFICATION]: 'Qualify',
  [OpportunityStage.NEEDS_ANALYSIS]: 'Analysis',
  [OpportunityStage.VALUE_PROPOSITION]: 'Value',
  [OpportunityStage.DECISION_MAKERS]: 'Decision',
  [OpportunityStage.NEGOTIATION]: 'Negotiate',
  [OpportunityStage.CLOSED_WON]: 'Won',
  [OpportunityStage.CLOSED_LOST]: 'Lost'
};

interface StageStep {
  readonly stage: OpportunityStage;
  readonly shortLabel: string;
  readonly fullLabel: string;
  readonly order: number;
  readonly terminal: boolean;
}

type StepState = 'reached' | 'current' | 'upcoming' | 'closed';

/**
 * Eight-step opportunity stage ribbon.
 *
 * On a pointer-accurate screen the whole progression is one horizontal strip,
 * because seeing the distance remaining to Closed Won is the point. On a phone
 * the strip cannot fit and collapses to a current-stage button opening a bottom
 * sheet, per the breakpoint matrix.
 *
 * The component owns no business rule beyond presentation: it emits the stage
 * the user picked and lets the parent decide. That is what lets Closed Lost
 * route through a loss-reason dialog instead of committing directly.
 */
@Component({
  selector: 'app-stage-path',
  imports: [NzDrawerModule, NzIconModule, CompactBadgeComponent, StageColorPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './stage-path.component.scss',
  template: `
    @if (viewport.isMobile()) {
      <button
        type="button"
        class="stage-path-mobile"
        [disabled]="readOnly()"
        [attr.aria-haspopup]="readOnly() ? null : 'dialog'"
        [attr.aria-expanded]="sheetOpen()"
        (click)="openSheet()"
      >
        <span class="stage-path-mobile__dot" [style.background]="currentStage() | stageColor"></span>
        <span class="stage-path-mobile__label">{{ currentFullLabel() }}</span>
        @if (!readOnly()) {
          <span class="stage-path-mobile__action">Change stage</span>
          <nz-icon nzType="down" />
        }
      </button>
    } @else {
      <ol class="stage-ribbon" role="list">
        @for (step of steps(); track step.stage) {
          <li class="stage-ribbon__item">
            <button
              type="button"
              class="stage-ribbon__chevron"
              [class.is-current]="stateOf(step.stage) === 'current'"
              [class.is-reached]="stateOf(step.stage) === 'reached'"
              [class.is-upcoming]="stateOf(step.stage) === 'upcoming'"
              [class.is-closed]="stateOf(step.stage) === 'closed'"
              [style.--stage-color]="step.stage | stageColor"
              [disabled]="readOnly()"
              [attr.aria-current]="stateOf(step.stage) === 'current' ? 'step' : null"
              [attr.aria-label]="step.fullLabel"
              (click)="select(step.stage)"
            >
              <span class="stage-ribbon__text">{{ step.shortLabel }}</span>
            </button>
          </li>
        }
      </ol>
    }

    <nz-drawer
      [nzVisible]="sheetOpen()"
      nzPlacement="bottom"
      nzHeight="80dvh"
      nzTitle="Change stage"
      (nzOnClose)="closeSheet()"
    >
      <ng-container *nzDrawerContent>
        <ul class="stage-sheet" role="list">
          @for (step of steps(); track step.stage) {
            <li>
              <button
                type="button"
                class="stage-sheet__option"
                [class.is-current]="step.stage === currentStage()"
                [disabled]="readOnly()"
                (click)="select(step.stage)"
              >
                <span class="stage-sheet__dot" [style.background]="step.stage | stageColor"></span>
                <span class="stage-sheet__label">{{ step.fullLabel }}</span>
                @if (step.terminal) {
                  <app-compact-badge
                    [status]="step.fullLabel"
                    [colorType]="step.stage === 'CLOSED_WON' ? 'success' : 'error'"
                  />
                }
              </button>
            </li>
          }
        </ul>
      </ng-container>
    </nz-drawer>
  `
})
export class StagePathComponent {
  protected readonly viewport = inject(ViewportService);

  public readonly currentStage = input.required<OpportunityStage>();
  public readonly readOnly = input<boolean>(false);
  public readonly stageChange = output<OpportunityStage>();

  private readonly sheetOpenSignal = signal<boolean>(false);
  protected readonly sheetOpen = this.sheetOpenSignal.asReadonly();

  protected readonly steps = computed<StageStep[]>(() =>
    PIPELINE_STAGES.map(stage => ({
      stage,
      shortLabel: RIBBON_LABELS[stage],
      fullLabel: STAGE_CONFIG[stage].label,
      order: STAGE_CONFIG[stage].order,
      terminal: isClosedStage(stage)
    }))
  );

  protected readonly currentFullLabel = computed(() => STAGE_CONFIG[this.currentStage()].label);

  protected stateOf(stage: OpportunityStage): StepState {
    if (isClosedStage(stage)) {
      return 'closed';
    }
    if (stage === this.currentStage()) {
      return 'current';
    }
    return STAGE_CONFIG[stage].order < STAGE_CONFIG[this.currentStage()].order ? 'reached' : 'upcoming';
  }

  protected select(stage: OpportunityStage): void {
    if (this.readOnly()) {
      return;
    }
    this.sheetOpenSignal.set(false);
    this.stageChange.emit(stage);
  }

  protected openSheet(): void {
    if (this.readOnly()) {
      return;
    }
    this.sheetOpenSignal.set(true);
  }

  protected closeSheet(): void {
    this.sheetOpenSignal.set(false);
  }
}
