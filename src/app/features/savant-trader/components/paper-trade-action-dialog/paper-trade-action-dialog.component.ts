/**
 * @topic #553 — Paper Trading Infra | @task #671
 *
 * Confirm dialog for close/cancel on the paper-trading dashboard.
 * Shows the trade summary (id, symbol, expression, qty, variant, latest
 * mark) and performs the mutation itself via the store's close/cancel
 * actions (#670) — unlike the presentational order-confirm-dialog, the
 * spinner must bind the store's `actingIds`, so the store lives here.
 * It closes once the action settles; the store surfaces failures via
 * the error signal + snackbar, so the dialog carries no result value
 * and stays dumb about outcome.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { PaperTradingStore } from '../../stores/paper-trading.store';
import type { PaperTrade } from '@paper-trading/contracts';

export type PaperTradeAction = 'close' | 'cancel';

export interface PaperTradeActionDialogData {
  trade: PaperTrade;
  action: PaperTradeAction;
}

const COPY: Record<PaperTradeAction, { title: string; verb: string; note: string }> = {
  close: {
    title: 'Close paper trade',
    verb: 'Close',
    note: 'Closes the whole unit at the live quote and books the realized P&L to the account.',
  },
  cancel: {
    title: 'Cancel pending trade',
    verb: 'Cancel',
    note: 'Cancels before the fill pass — the trade flips to CANCELLED and never reaches the ledger.',
  },
};

@Component({
  selector: 'app-paper-trade-action-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatDialogModule,
    MatProgressSpinnerModule,
  ],
  templateUrl: './paper-trade-action-dialog.component.html',
  styleUrl: './paper-trade-action-dialog.component.scss',
})
export class PaperTradeActionDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<PaperTradeActionDialogComponent>);
  private readonly store = inject(PaperTradingStore);

  readonly data = inject(MAT_DIALOG_DATA) as PaperTradeActionDialogData;
  readonly copy = COPY[this.data.action];

  /** True once the user confirms — gates the settle-close effect. */
  private readonly confirmed = signal(false);

  /** The store's in-flight flag for this trade — drives the spinner and
   *  the disabled confirm. A second dialog while the first action is
   *  still running reads busy too (the store ignores the re-entry). */
  readonly busy = computed(() => this.store.actingIds().has(this.data.trade.id));

  /** Latest mark, or null when no dated entry carries one. A mark entry
   *  may carry only `underlyingClose` — scan descending until a real
   *  `mark` is found rather than trusting the newest date. */
  readonly latestMark = computed<number | null>(() => {
    const marks = this.data.trade.marks;
    for (const date of Object.keys(marks).sort().reverse()) {
      const mark = marks[date].mark;
      if (mark !== undefined) return mark;
    }
    return null;
  });

  constructor() {
    // Settle-close: once the acting flag clears after a confirm, the
    // action is done — success reloaded the list; failure already
    // surfaced via the store's error signal + snackbar. Relies on the
    // store flagging `actingIds` synchronously inside close/cancelTrade
    // (effects coalesce, so `busy()` reads true when this next runs).
    effect(() => {
      if (this.confirmed() && !this.busy()) {
        this.dialogRef.close();
      }
    });
  }

  confirm(): void {
    if (this.busy()) return;
    this.confirmed.set(true);
    if (this.data.action === 'close') {
      this.store.closeTrade(this.data.trade.id);
    } else {
      this.store.cancelTrade(this.data.trade.id);
    }
  }

  dismiss(): void {
    this.dialogRef.close();
  }
}
