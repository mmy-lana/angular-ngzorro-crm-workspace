import { Injectable, Signal, signal } from '@angular/core';
import { UUID } from '@core/models/crm.models';

export type DrawerEntityType = 'ACCOUNT' | 'CONTACT' | 'OPPORTUNITY' | 'ACTIVITY';
export type DrawerMode = 'create' | 'edit';
export type DrawerContextType = 'ACCOUNT' | 'OPPORTUNITY' | 'CONTACT' | null;

/**
 * Single owner of the quick-create drawer's request.
 *
 * The workspace shell instantiates exactly one `QuickCreateDrawerComponent`, but
 * the request to open it originates in three unrelated places: the utility bar's
 * quick actions, an entity's Record Banner, and a related-list "Add" button.
 * Threading an `open` event back from a dynamically created outlet to the shell
 * is not possible without an event bus, so the request lives here instead and
 * both ends read the same signals.
 *
 * Keeping this a plain service rather than a signal inside the drawer component
 * is what guarantees a single drawer: two independent "open" paths cannot
 * produce two drawers, and the last request simply wins.
 */
@Injectable({ providedIn: 'root' })
export class QuickCreateStateService {
  private readonly visibleSignal = signal<boolean>(false);
  private readonly modeSignal = signal<DrawerMode>('create');
  private readonly entityTypeSignal = signal<DrawerEntityType>('ACCOUNT');
  private readonly recordIdSignal = signal<UUID | null>(null);
  private readonly contextIdSignal = signal<UUID | null>(null);
  private readonly contextTypeSignal = signal<DrawerContextType>(null);

  public readonly visible: Signal<boolean> = this.visibleSignal.asReadonly();
  public readonly mode: Signal<DrawerMode> = this.modeSignal.asReadonly();
  public readonly entityType: Signal<DrawerEntityType> = this.entityTypeSignal.asReadonly();
  public readonly recordId: Signal<UUID | null> = this.recordIdSignal.asReadonly();
  public readonly contextId: Signal<UUID | null> = this.contextIdSignal.asReadonly();
  public readonly contextType: Signal<DrawerContextType> = this.contextTypeSignal.asReadonly();

  /**
   * Opens the drawer to create a record.
   *
   * @param contextId parent record, pre-filling the foreign key. Creating a
   *   contact from inside an account should not make the user pick the account
   *   again, and the repository's primary-contact rule then applies to the
   *   account they are already looking at.
   * @param contextType the parent entity type, or `null` for a top-level create.
   */
  public openCreate(entityType: DrawerEntityType, contextId: UUID | null = null, contextType: DrawerContextType = null): void {
    this.modeSignal.set('create');
    this.entityTypeSignal.set(entityType);
    this.recordIdSignal.set(null);
    this.contextIdSignal.set(contextId);
    this.contextTypeSignal.set(contextType);
    this.visibleSignal.set(true);
  }

  public openEdit(entityType: DrawerEntityType, recordId: UUID): void {
    this.modeSignal.set('edit');
    this.entityTypeSignal.set(entityType);
    this.recordIdSignal.set(recordId);
    this.contextIdSignal.set(null);
    this.contextTypeSignal.set(null);
    this.visibleSignal.set(true);
  }

  public close(): void {
    this.visibleSignal.set(false);
  }
}
