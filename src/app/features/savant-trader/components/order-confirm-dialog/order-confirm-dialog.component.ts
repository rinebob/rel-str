/**
 * Order Confirm Dialog
 *
 * Confirmation dialog shown before submitting an order to the broker.
 * Displays a summary of the order parameters and asks the user to confirm.
 */
import { Component, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { OrderTicket, InstrumentType } from '../../services/order-ticket.types';
import { GuardrailWarning } from '../../utils/order-guardrails.util';
import { parseOptionPaste, premiumNotional } from '../../utils/option-contract.util';

/** Data injected into the confirm dialog. */
export interface OrderConfirmDialogData {
  ticket: OrderTicket;
  warnings?: GuardrailWarning[];
  /** Paper-acceptance mode — the action writes to the paper ledger via the
   *  paperSignalOrder callable; no broker order is placed. */
  paper?: boolean;
}

@Component({
  selector: 'app-order-confirm-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatDialogModule, MatIconModule],
  templateUrl: './order-confirm-dialog.component.html',
  styleUrl: './order-confirm-dialog.component.scss',
})
export class OrderConfirmDialogComponent {
  private readonly dialogRef = inject(MatDialogRef<OrderConfirmDialogComponent, boolean>);

  /** The ticket data injected via MAT_DIALOG_DATA. */
  readonly data = inject(MAT_DIALOG_DATA) as OrderConfirmDialogData;

  /** The ticket to confirm. */
  readonly ticket = computed(() => this.data.ticket);

  /** Guardrail warnings. */
  readonly warnings = computed(() => this.data.warnings ?? []);

  /** Whether the submit is blocked (hard stop). */
  readonly isBlocked = computed(() => this.warnings().some((w) => w.severity === 'block'));

  /** Paper-acceptance mode — dialog copy distinguishes it from a real
   *  broker submission. */
  readonly isPaper = computed(() => this.data.paper === true);

  /** Option-contract detail for the summary — null for equity/ETF tickets.
   *  `parsed` is null when the leg's OCC symbol fails to parse (legacy or
   *  malformed ticket): the raw symbol still renders, the expiry row is
   *  just skipped. */
  readonly optionContract = computed(() => {
    const i = this.ticket();
    if (i.instrumentType !== InstrumentType.OPTION) return null;
    const leg = i.legs[0];
    return {
      underlying: i.symbol,
      occSymbol: leg?.symbol ?? '?',
      legSide: leg?.side ?? i.side,
      positionEffect: leg?.positionEffect ?? 'open',
      parsed: leg?.symbol ? parseOptionPaste(leg.symbol) : null,
    };
  });

  /** Display symbol for the ticket — rendered only by the non-option
   *  branch (options use the Underlying/Contract rows). */
  readonly symbol = computed(() => this.ticket().symbol);

  /** Side label — options carry the leg's side + position effect ('BUY TO OPEN'). */
  readonly sideLabel = computed(() => {
    const i = this.ticket();
    const opt = this.optionContract();
    if (opt) return `${opt.legSide} to ${opt.positionEffect}`;
    return i.side;
  });

  /** Market hours as actually sent — the option wire pins regular_hours
   *  (OrderExecutionService.buildOptionOrderArgs), so render the pinned
   *  value rather than the ticket's equity-typed field. */
  readonly marketHours = computed(() =>
    this.ticket().instrumentType === InstrumentType.OPTION
      ? 'regular_hours'
      : this.ticket().marketHours,
  );

  /** Quantity display. */
  readonly quantity = computed(() => {
    const i = this.ticket();
    if (i.instrumentType === InstrumentType.OPTION) return i.quantity;
    return i.quantity ?? i.dollarAmount ?? '—';
  });

  /** Limit price (equity/etf only). */
  readonly limitPrice = computed(() => {
    const i = this.ticket();
    if (i.instrumentType === InstrumentType.OPTION) return undefined;
    return i.limitPrice;
  });

  /** Stop price — equity/ETF read `stopPrice`; option tickets only send
   *  `stop_price` for stop types, so the row gates the same way (a stale
   *  field on a limit ticket isn't sent and shouldn't render). */
  readonly stopPrice = computed(() => {
    const i = this.ticket();
    if (i.instrumentType === InstrumentType.OPTION) {
      return i.orderType === 'stop_market' || i.orderType === 'stop_limit'
        ? i.stopPrice
        : undefined;
    }
    return i.stopPrice;
  });

  /** Limit price per contract — option tickets carry it on `price`, and
   *  the wire only sends it for priced types (limit/stop_limit), so the
   *  row hides on market/stop tickets even if a stale price persists. */
  readonly optionLimitPrice = computed(() => {
    const i = this.ticket();
    if (i.instrumentType !== InstrumentType.OPTION) return undefined;
    if (i.orderType !== 'limit' && i.orderType !== 'stop_limit') return undefined;
    return i.price;
  });

  /** Estimated total premium for a priced buy-to-open: qty × price × 100,
   *  cent-rounded. Undefined on market/stop or non-finite inputs — the
   *  wire omits the price there, so no premium to confirm. */
  readonly optionPremium = computed(() => {
    const i = this.ticket();
    if (i.instrumentType !== InstrumentType.OPTION) return undefined;
    const qty = parseFloat(i.quantity);
    const price = parseFloat(this.optionLimitPrice() ?? '');
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return undefined;
    return premiumNotional(qty, price);
  });

  onConfirm(): void {
    this.dialogRef.close(true);
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }
}
