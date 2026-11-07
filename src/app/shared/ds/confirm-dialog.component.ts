/**
 * ConfirmDialogComponent — generic yes/no confirmation opened through
 * DsDialogService. Returns true (confirm) or false (dismiss).
 * Canonical home for the confirm-dialog pattern (was duplicated per
 * feature — consolidated under shared/ds for task #1439).
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DS_DIALOG_DATA, DsDialogRef } from './ds-dialog';

export interface ConfirmDialogData {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

@Component({
  selector: 'app-ds-confirm-dialog',
  standalone: true,
  imports: [],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">{{ data.title ?? 'Confirm' }}</h2>
    <div class="content">
      <p>{{ data.message }}</p>
    </div>
    <div class="actions">
      <button class="ds-btn outline" (click)="ref.close(false)">
        {{ data.cancelLabel ?? 'Back' }}
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
