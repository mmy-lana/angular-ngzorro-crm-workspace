import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NzCheckboxModule } from 'ng-zorro-antd/checkbox';
import { NzEmptyModule } from 'ng-zorro-antd/empty';
import { NzIconModule } from 'ng-zorro-antd/icon';
import {
  Activity,
  ActivityStatus,
  ActivityType,
  ISO8601Date,
  PriorityLevel,
  SupportedIcon,
  UUID
} from '@core/models/crm.models';
import { CompactBadgeComponent, CompactBadgeColor } from '@shared/ui/compact-badge/compact-badge.component';
import { toLocalDateOnly } from '@core/utils/pipeline-calc';

interface ActivityEntry {
  readonly activity: Activity;
  readonly icon: SupportedIcon;
  readonly completed: boolean;
  readonly completedDay: string;
  readonly priorityTone: CompactBadgeColor;
  readonly dueTone: 'overdue' | 'today' | 'upcoming' | 'none';
  readonly dueText: string;
}

/** One icon per activity kind, drawn from the set registered in `appConfig`. */
const TYPE_ICONS: Record<ActivityType, SupportedIcon> = {
  [ActivityType.TASK]: 'check-circle',
  [ActivityType.CALL]: 'right',
  [ActivityType.MEETING]: 'calendar',
  [ActivityType.EMAIL]: 'file-text',
  [ActivityType.NOTE]: 'edit'
};

const PRIORITY_TONES: Record<PriorityLevel, CompactBadgeColor> = {
  [PriorityLevel.CRITICAL]: 'error',
  [PriorityLevel.HIGH]: 'warning',
  [PriorityLevel.NORMAL]: 'default',
  [PriorityLevel.LOW]: 'default'
};

/**
 * Chronological activity feed for a record.
 *
 * Completion is a local intent, not a dialog: the checkbox emits and the parent
 * calls the repository, so a tap is reflected immediately through the signal
 * store. Overdue work is called out by colour and by an explicit "overdue"
 * label rather than by colour alone, so the state survives a monochrome
 * rendering and a screen reader.
 */
@Component({
  selector: 'app-activity-timeline',
  imports: [NzCheckboxModule, NzEmptyModule, NzIconModule, CompactBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: './activity-timeline.component.scss',
  template: `
    @if (entries().length === 0) {
      <nz-empty nzNotFoundContent="No activity logged for this record yet."></nz-empty>
    } @else {
      <ol class="timeline" role="list">
        @for (entry of entries(); track entry.activity.id) {
          <li class="timeline__item" [class.is-completed]="entry.completed">
            <label class="timeline__check">
              <input
                type="checkbox"
                [checked]="entry.completed"
                [attr.aria-label]="(entry.completed ? 'Mark incomplete: ' : 'Mark complete: ') + entry.activity.subject"
                (change)="toggle(entry)"
              />
            </label>

            <div class="timeline__body">
              <div class="timeline__head">
                <nz-icon [nzType]="entry.icon" class="timeline__icon" />
                <span class="timeline__subject">{{ entry.activity.subject }}</span>
                @if (entry.activity.priority !== 'NORMAL' && entry.activity.priority !== 'LOW') {
                  <app-compact-badge [status]="entry.activity.priority" [colorType]="entry.priorityTone" />
                }
              </div>

              @if (entry.activity.notes) {
                <p class="timeline__notes">{{ entry.activity.notes }}</p>
              }

              <div class="timeline__meta">
                <span class="timeline__meta-item">{{ entry.activity.type }}</span>
                <span class="timeline__meta-sep" aria-hidden="true">·</span>
                <span class="timeline__meta-item">{{ entry.activity.assignedToName }}</span>
                @if (entry.dueTone !== 'none') {
                  <span class="timeline__meta-sep" aria-hidden="true">·</span>
                  <span class="timeline__due" [class]="'timeline__due is-' + entry.dueTone">{{ entry.dueText }}</span>
                }
                @if (entry.completed && entry.completedDay) {
                  <span class="timeline__meta-sep" aria-hidden="true">·</span>
                  <span class="timeline__meta-item">Completed {{ entry.completedDay }}</span>
                }
              </div>
            </div>
          </li>
        }
      </ol>
    }
  `
})
export class ActivityTimelineComponent {
  public readonly activities = input.required<Activity[]>();
  public readonly statusToggle = output<{ id: UUID; completed: boolean }>();

  protected readonly entries = computed<ActivityEntry[]>(() =>
    this.activities().map(activity => {
      const completed = activity.status === ActivityStatus.COMPLETED;
      const due = describeDueDate(activity.dueDate, completed);
      return {
        activity,
        icon: TYPE_ICONS[activity.type],
        completed,
        completedDay: activity.completedDate === null ? '' : activity.completedDate.slice(0, 10),
        priorityTone: PRIORITY_TONES[activity.priority],
        dueTone: due.tone,
        dueText: due.text
      };
    })
  );

  protected toggle(entry: ActivityEntry): void {
    this.statusToggle.emit({ id: entry.activity.id, completed: !entry.completed });
  }
}

type DueTone = 'overdue' | 'today' | 'upcoming' | 'none';

/**
 * Describes a due date relative to today. Completed work never reports an
 * overdue date: a task that was finished late is not a task that is still late.
 */
function describeDueDate(dueDate: ISO8601Date | null, completed: boolean): { tone: DueTone; text: string } {
  if (dueDate === null) {
    return { tone: 'none', text: '' };
  }
  const today = toLocalDateOnly();
  const dueDay = dueDate.slice(0, 10);
  if (dueDay === today) {
    return { tone: 'today', text: 'Due today' };
  }
  const deltaDays = Math.round((Date.parse(`${dueDay}T00:00:00`) - Date.parse(`${today}T00:00:00`)) / 86_400_000);

  if (deltaDays < 0) {
    const overdueBy = Math.abs(deltaDays);
    return {
      tone: completed ? 'none' : 'overdue',
      text: completed ? '' : `${overdueBy} day${overdueBy === 1 ? '' : 's'} overdue`
    };
  }
  return {
    tone: 'upcoming',
    text: `Due in ${deltaDays} day${deltaDays === 1 ? '' : 's'}`
  };
}
