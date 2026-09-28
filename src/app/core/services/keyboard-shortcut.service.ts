import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Subject, fromEvent } from 'rxjs';

/**
 * Global keyboard shortcuts, published as observables.
 *
 * Matching is on physical key codes rather than the produced character, so the
 * shortcuts keep working on layouts where `/` and `S` are not where a US
 * keyboard puts them. Subjects rather than a single multiplexed event because
 * the three consumers are independent: the active detail view listens for save,
 * the shell listens for tab close, and list views listen for search focus.
 *
 * Typing in a field is never intercepted. `/` is the only shortcut that could
 * collide with ordinary typing, so it is suppressed inside an input, textarea,
 * select or contenteditable; the modifier-based shortcuts call `preventDefault`
 * explicitly to stop the browser's own save dialog.
 */
@Injectable({ providedIn: 'root' })
export class KeyboardShortcutService {
  private readonly destroyRef = inject(DestroyRef);
  private initialized = false;

  private readonly saveSubject = new Subject<void>();
  private readonly searchSubject = new Subject<void>();
  private readonly tabCloseSubject = new Subject<void>();

  /** Ctrl/Cmd+S — the active detail view saves. */
  public readonly saveRequested$ = this.saveSubject.asObservable();
  /** `/` — a list view focuses its search box. */
  public readonly searchFocusRequested$ = this.searchSubject.asObservable();
  /** Alt+Shift+W — the shell closes the active tab. */
  public readonly tabCloseRequested$ = this.tabCloseSubject.asObservable();

  /**
   * Binds the document listener. Idempotent, because the shell calls this from
   * its constructor and the service is a root singleton that may be constructed
   * again by an eager injector without a second listener being added.
   */
  public init(): void {
    if (this.initialized || typeof document === 'undefined') {
      return;
    }
    this.initialized = true;

    fromEvent<KeyboardEvent>(document, 'keydown')
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(event => this.handle(event));
  }

  private handle(event: KeyboardEvent): void {
    if (event.altKey && event.shiftKey && event.code === 'KeyW') {
      event.preventDefault();
      this.tabCloseSubject.next();
      return;
    }

    if ((event.ctrlKey || event.metaKey) && event.code === 'KeyS') {
      event.preventDefault();
      this.saveSubject.next();
      return;
    }

    if (event.key === '/' && !isTypingTarget(event.target)) {
      event.preventDefault();
      this.searchSubject.next();
    }
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}
