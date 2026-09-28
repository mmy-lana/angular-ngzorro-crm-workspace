import { Injectable, Signal, inject } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

/**
 * Reactive viewport classification shared by every responsive surface.
 *
 * Layout decisions are driven by width *and* input modality: the high-density
 * console tokens only make sense for a fine pointer on a wide screen, while a
 * coarse pointer always needs 44px targets regardless of screen size.
 */
@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly breakpointObserver = inject(BreakpointObserver);

  private readonly mobileQuery = '(max-width: 767px)';
  private readonly tabletQuery = '(min-width: 768px) and (max-width: 1023px)';
  private readonly desktopQuery = '(min-width: 1024px)';
  private readonly coarsePointerQuery = '(pointer: coarse)';
  private readonly finePointerQuery = '(pointer: fine)';

  public readonly isMobile: Signal<boolean> = toSignal(
    this.breakpointObserver.observe(this.mobileQuery).pipe(map(state => state.matches)),
    { initialValue: this.breakpointObserver.isMatched(this.mobileQuery) }
  );

  public readonly isTablet: Signal<boolean> = toSignal(
    this.breakpointObserver.observe(this.tabletQuery).pipe(map(state => state.matches)),
    { initialValue: this.breakpointObserver.isMatched(this.tabletQuery) }
  );

  public readonly isDesktop: Signal<boolean> = toSignal(
    this.breakpointObserver.observe(this.desktopQuery).pipe(map(state => state.matches)),
    { initialValue: this.breakpointObserver.isMatched(this.desktopQuery) }
  );

  public readonly isCoarsePointer: Signal<boolean> = toSignal(
    this.breakpointObserver.observe(this.coarsePointerQuery).pipe(map(state => state.matches)),
    { initialValue: this.breakpointObserver.isMatched(this.coarsePointerQuery) }
  );

  /**
   * `true` only on the desktop console with a mouse or trackpad, i.e. where the
   * compact 24px/28px density tokens are safe to apply.
   *
   * `BreakpointObserver.observe` merges an array of queries into a single state
   * whose `matches` is true only when every query matches.
   */
  public readonly isHighDensity: Signal<boolean> = toSignal(
    this.breakpointObserver
      .observe([this.desktopQuery, this.finePointerQuery])
      .pipe(map(state => state.matches)),
    {
      initialValue:
        this.breakpointObserver.isMatched(this.desktopQuery) &&
        this.breakpointObserver.isMatched(this.finePointerQuery)
    }
  );
}
