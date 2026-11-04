/**
 * Confirm Dialog
 *
 * A simple generic confirmation dialog using Angular Material.
 * Displays a message and returns true (confirm) or false (cancel).
 */
import { Component, inject, ChangeDetectionStrategy } from '@angular/core';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../../shared/ds/ds-dialog';

/** Data injected into the confirm dialog. */
export interface ConfirmDialogData {
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">Confirm</h2>
    <div class="content">
      <p>{{ data.message }}</p>
    </div>
    <div class="actions">
      <button class="ds-btn outline" (click)="ref.close(false)">
        {{ data.cancelLabel ?? 'Cancel' }}
      </button>
      <button class="ds-btn fill" (click)="ref.close(true)" cdkFocusInitial>
        {{ data.confirmLabel ?? 'Confirm' }}
      </button>
    </div>
  `,
})
export class ConfirmDialogComponent {
  readonly data = inject(DS_DIALOG_DATA) as ConfirmDialogData;
  protected readonly ref = inject(DsDialogRef<ConfirmDialogComponent, boolean>);
}
