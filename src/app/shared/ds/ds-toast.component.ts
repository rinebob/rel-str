/**
 * DsToastComponent — the `.dse-toast` bar rendered by {@link DsToastService}
 * inside a CDK overlay. Text + optional action slot; `role="status"` for
 * polite announcements.
 */
import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

@Component({
  selector: 'app-ds-toast',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="dse-toast" role="status">
      <span class="toast-text">{{ message() }}</span>
      @if (action(); as label) {
        <button type="button" class="action" (click)="actionClick.emit()">{{ label }}</button>
      }
    </div>
  `,
})
export class DsToastComponent {
  /** Toast body text. */
  message = input.required<string>();
  /** Action button label; null hides the slot. */
  action = input<string | null>(null);
  /** Fired when the action button is pressed — the service dismisses. */
  actionClick = output<void>();
}
