import { ChangeDetectionStrategy, Component } from '@angular/core';
import { WorkspaceShellComponent } from '@features/workspace/workspace-shell.component';

/**
 * Application root.
 *
 * Deliberately thin: the shell owns navigation, the repository owns data, and
 * this component only decides what fills the viewport. Any state kept here would
 * outlive every tab inside it.
 */
@Component({
  selector: 'app-root',
  imports: [WorkspaceShellComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<app-workspace-shell />`,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `
  ]
})
export class AppComponent {}
