/**
 * Gallery Ticket Dialog
 *
 * MatDialog host for the shared OrderTicketComponent (#743/#759) plus the
 * OptionOrderTicketComponent (#963) under a Stock/Option tab group (#964) —
 * the gallery card's Trade button stages a quantity ticket and opens it here
 * for editing/submission. The component binds reactively to the ticket
 * store so in-dialog edits and the order queue's view stay in sync. The
 * dialog closes itself when EITHER the equity or the option ticket leaves
 * STAGED (submitted, sent to paper, or removed elsewhere); the caller
 * decides whether still-STAGED tickets get discarded on close.
 */
import { Component, ChangeDetectionStrategy, computed, effect, inject, OnInit, Signal, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import { CurrencyPipe, DecimalPipe } from '@angular/common';
import { AppRoutes } from '../../../../core/common/interfaces';

import { OrderTicketStore } from '../../stores/order-ticket.store';
import { EquityPriceService } from '../../services/equity-price.service';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { InstrumentType, OrderTicket, OrderTicketStatus, TradingConfig } from '../../services/order-ticket.types';
import { orderTicketTerms } from '../../utils/signal-order-staging.util';
import { StOccurrenceDecision, StSignalItem } from '../../services/types';
import { OrderTicketComponent } from '../order-ticket/order-ticket.component';
import { OptionOrderTicketComponent } from '../option-order-ticket/option-order-ticket.component';

/** Everything the Option tab needs from the card — precomputed by the
 *  caller so the component never re-derives card context. `decisions` is
 *  a LIVE signal: the option ticket's self-healing retry effect re-checks
 *  staging blocks when an occurrence is un-rejected while the dialog is
 *  open. `onStaged` reports each stage/adopt emit so the host tracks
 *  which tickets this session created (created → discard on cancel). */
export interface OptionTabSeed {
  /** Underlying ticker — the card's symbol. */
  symbol: string;
  /** The viewed run — decision ids are scoped to it. */
  runId: string;
  /** The card's FULL occurrence set (`allOccurrences`). */
  signals: StSignalItem[];
  /** Live durable occurrence decisions keyed by canonical id. */
  decisions: Signal<Record<string, StOccurrenceDecision>>;
  /** Forwards the option ticket's `(staged)` emit to the dialog opener. */
  onStaged: (e: { ticketId: string; created: boolean }) => void;
}

export interface GalleryTicketDialogData {
  /** Staged equity/ETF ticket id (OrderTicketStore.tickets() key). */
  ticketId: string;
  /** Live trading-config signal from the action service — the host passes
   *  the signal itself so the dialog stays reactive without injecting
   *  the gallery's services (#755 review). */
  tradingConfig: Signal<TradingConfig | null>;
  /** Option-tab seed — absent renders the dialog Stock-only (no tabs). */
  option?: OptionTabSeed;
}

/** Ticket states that mean the dialog's work is done — the broker or the
 *  paper callable accepted the order. STAGED stays open (a failed submit
 *  reverts here), and SUBMITTING/FAILED keep the dialog alive so the
 *  error isn't silently lost mid-flight (#755 review). */
const DIALOG_DONE_STATUSES: ReadonlySet<OrderTicketStatus> = new Set([
  OrderTicketStatus.SUBMITTED,
  OrderTicketStatus.QUEUED,
  OrderTicketStatus.RESTING,
  OrderTicketStatus.FILLED,
  OrderTicketStatus.PAPER,
  OrderTicketStatus.CANCELLED,
  OrderTicketStatus.CANCEL_PENDING,
  OrderTicketStatus.EXPIRED,
]);

/** Confirmation copy per done status — the dialog now shows this instead
 *  of closing on submit so the order's landing is explicit (#762). */
const CONFIRMATION_MESSAGES: Partial<Record<OrderTicketStatus, string>> = {
  [OrderTicketStatus.SUBMITTED]: 'Order submitted',
  [OrderTicketStatus.QUEUED]: 'Order queued with the broker',
  [OrderTicketStatus.RESTING]: 'Order resting with the broker',
  [OrderTicketStatus.FILLED]: 'Order filled',
  [OrderTicketStatus.PAPER]: 'Sent to paper trade',
  [OrderTicketStatus.CANCELLED]: 'Order cancelled',
  [OrderTicketStatus.CANCEL_PENDING]: 'Cancelling with the broker',
  [OrderTicketStatus.EXPIRED]: 'Order expired at the broker',
};

@Component({
  selector: 'app-gallery-ticket-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CurrencyPipe,
    DecimalPipe,
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatTabsModule,
    OrderTicketComponent,
    OptionOrderTicketComponent,
  ],
  templateUrl: './gallery-ticket-dialog.component.html',
  styleUrl: './gallery-ticket-dialog.component.scss',
})
export class GalleryTicketDialogComponent implements OnInit {
  private readonly dialogRef = inject(MatDialogRef<GalleryTicketDialogComponent>);
  private readonly ticketStore = inject(OrderTicketStore);
  private readonly priceService = inject(EquityPriceService);
  private readonly lists = inject(SymbolListStore);
  private readonly router = inject(Router);

  readonly data = inject(MAT_DIALOG_DATA) as GalleryTicketDialogData;

  /** Reactive ticket lookup — reflects in-dialog edits and queue changes. */
  readonly ticket = computed(
    (): OrderTicket | null => this.ticketStore.tickets()[this.data.ticketId] ?? null,
  );
  /** Equity/ETF tickets only — option tickets also carry `symbol` (the
   *  underlying), but the equity price binding doesn't apply to them. */
  readonly symbol = computed(() => {
    const t = this.ticket();
    return t && t.instrumentType !== InstrumentType.OPTION ? t.symbol : null;
  });
  readonly price = computed(() => {
    const sym = this.symbol();
    return sym ? (this.priceService.prices()[sym.toUpperCase()] ?? null) : null;
  });
  readonly tradingConfig = this.data.tradingConfig;

  /** The dialog's underlying — the option seed carries it when present
   *  (the card's symbol, independent of which ticket is bound); the
   *  equity ticket's symbol is the fallback. */
  readonly displaySymbol = computed(
    () => this.data.option?.symbol ?? this.symbol(),
  );
  /** Company display name from the tracked-symbol profiles. */
  readonly companyName = computed(() => {
    const sym = this.displaySymbol();
    return sym ? (this.lists.profilesBySymbol().get(sym.toUpperCase())?.name ?? null) : null;
  });
  /** The full equity quote for the header strip (last/prev/bid/ask). */
  readonly quote = computed(() => {
    const sym = this.displaySymbol();
    return sym ? (this.priceService.quotes()[sym.toUpperCase()] ?? null) : null;
  });
  /** Change vs previous close — null until both prices land. */
  readonly change = computed(() => {
    const q = this.quote();
    if (!q || q.lastTradePrice === null || q.previousClose === null || q.previousClose === 0) {
      return null;
    }
    const abs = q.lastTradePrice - q.previousClose;
    return { abs, pct: (abs / q.previousClose) * 100 };
  });

  /** The option tab's bound ticket id — set when the option component
   *  stages (created) or adopts (created:false) a ticket. Drives the
   *  second close-on-done watcher. */
  readonly optionTicketId = signal<string | null>(null);
  readonly optionTicket = computed(
    (): OrderTicket | null => {
      const id = this.optionTicketId();
      return id ? (this.ticketStore.tickets()[id] ?? null) : null;
    },
  );

  /** The bound ticket in a done status — drives the confirmation panel
   *  (#762). Live-read, so a later status change updates the message
   *  (SUBMITTED→RESTING); cleared if the ticket leaves done-status
   *  (requeue to STAGED, or reconcile to FAILED) so the form — and its
   *  error — comes back. */
  readonly confirmation = signal<OrderTicket | null>(null);

  readonly confirmationMessage = computed(() => {
    const t = this.confirmation();
    return t ? (CONFIRMATION_MESSAGES[t.status] ?? 'Order accepted') : '';
  });
  readonly confirmationIcon = computed(() => {
    const s = this.confirmation()?.status;
    if (s === OrderTicketStatus.CANCEL_PENDING) return 'hourglass_top';
    if (s === OrderTicketStatus.CANCELLED || s === OrderTicketStatus.EXPIRED) return 'cancel';
    return 'task_alt';
  });
  /** `buy limit 10 @ 210.50` / `buy market $200` / `opt 2 @ 1.25` — the
   *  accepted terms on the confirmation line (shared formatter, #762). */
  readonly confirmationTerms = computed(() => {
    const t = this.confirmation();
    if (!t) return '';
    return `${t.side} ${t.orderType} ${orderTicketTerms(t)}`;
  });

  constructor() {
    // A done ticket shows the confirmation panel — the user closes with
    // Done or follows through to the order page (#762). Removal closes
    // outright (cancel/discard semantics); SUBMITTING and FAILED keep the
    // dialog in the ticket view so the error isn't swallowed (#755
    // review). A FAILED leg outranks a done leg — equity submitted +
    // option failed must surface the error, not the confirmation (#762
    // review round 2). A confirmed ticket that reverts drops back to the
    // form. The option ticket only counts once bound (#964).
    effect(() => {
      const t = this.ticket();
      if (!t) {
        this.dialogRef.close();
        return;
      }
      const opt = this.optionTicket();
      if (this.optionTicketId() && !opt) {
        this.dialogRef.close();
        return;
      }
      if (t.status === OrderTicketStatus.FAILED || opt?.status === OrderTicketStatus.FAILED) {
        this.confirmation.set(null);
        return;
      }
      if (DIALOG_DONE_STATUSES.has(t.status)) {
        this.confirmation.set(t);
        return;
      }
      if (this.optionTicketId() && opt && DIALOG_DONE_STATUSES.has(opt.status)) {
        this.confirmation.set(opt);
        return;
      }
      // Neither bound ticket is done — a confirmed ticket reverted
      // (FAILED-after-done or requeue): drop back to the form (#762
      // review).
      this.confirmation.set(null);
    });
  }

  ngOnInit(): void {
    const symbol = this.displaySymbol();
    if (symbol) void this.priceService.fetchPrices([symbol]);
    void this.lists.loadProfiles();
  }

  onDone(): void {
    this.dialogRef.close();
  }

  /** Follow the accepted order to the live-order page — deep-links the
   *  ticket via the `ticket` query param (#762). */
  onViewOrder(): void {
    const t = this.confirmation();
    void this.router.navigate(
      ['/', AppRoutes.SIGNAL_ORDER],
      t ? { queryParams: { ticket: t.id } } : undefined,
    );
    this.dialogRef.close();
  }

  /** Option ticket staged/adopted — bind the id for close-on-done and
   *  forward the emit so the host can track session-created tickets for
   *  discard-on-cancel (#964). */
  onOptionStaged(e: { ticketId: string; created: boolean }): void {
    this.optionTicketId.set(e.ticketId);
    this.data.option?.onStaged(e);
  }
}
