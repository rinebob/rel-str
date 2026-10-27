/**
 * Gallery Ticket Dialog
 *
 * MatDialog host for the shared OrderTicketComponent (#743/#759) plus the
 * OptionOrderTicketComponent (#963) under a Stock/Option tab group (#964).
 * Card mode: the gallery card's Trade button stages a quantity ticket and
 * opens it here for editing/submission. Manual mode (#1177/#1189): a
 * symbol-entry row resolves a free-text ticker through the `manual` seed
 * (stage-or-adopt), then binds the resulting ticket to the same Stock
 * tab — same review-then-place path as card mode. The component binds
 * reactively to the ticket store so in-dialog edits and the order
 * queue's view stay in sync. The dialog closes itself when EITHER the
 * equity or the option ticket leaves STAGED (submitted, sent to paper,
 * or removed elsewhere); the caller decides whether still-STAGED tickets
 * get discarded on close.
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
import { normalizeUnderlyingSymbol } from '../../utils/manual-ticket-staging.util';
import { stDocId } from '../../services/order-ticket-st-mapper';
import { StSignalItem } from '../../services/types';
import { OrderTicketComponent } from '../order-ticket/order-ticket.component';
import { OptionOrderTicketComponent } from '../option-order-ticket/option-order-ticket.component';

/** A ticket stage/adopt emit — `created` marks a ticket this dialog
 *  session staged (discard on cancel) vs a pre-existing one it adopted
 *  (survives close). */
export interface StagedTicketEvent {
  ticketId: string;
  created: boolean;
}

/** Everything the Option tab needs from the card — precomputed by the
 *  caller so the component never re-derives card context. `onStaged`
 *  reports each stage/adopt emit so the host tracks which tickets this
 *  session created (created → discard on cancel). */
export interface OptionTabSeed {
  /** Underlying ticker — the card's symbol. */
  symbol: string;
  /** The viewed run — decision ids are scoped to it. */
  runId: string;
  /** The card's FULL occurrence set (`allOccurrences`). */
  signals: StSignalItem[];
  /** Forwards the option ticket's `(staged)` emit to the dialog opener. */
  onStaged: (e: StagedTicketEvent) => void;
}

/** Everything the dialog's manual mode needs — callbacks instead of
 *  injected services, same decoupling rule as `tradingConfig`/`OptionTabSeed`
 *  (#1177/#1188). The host tracks session-created ids via `onStaged` for
 *  discard-on-close. */
export interface ManualOrderDialogSeed {
  /** Symbol pre-filled into the entry row (#1017 — the review pages'
   *  Trade button seeds the selected symbol so the dialog opens
   *  resolving, not blank). */
  initialSymbol?: string;
  /** Stage (or adopt) the manual equity ticket for a resolved symbol —
   *  resolves null when staging can't proceed (no account, no price). */
  stageEquityTicket: (symbol: string) => Promise<OrderTicket | null>;
  /** Forwards stage/adopt emits so the opener tracks which tickets this
   *  session created (created → discard on close). */
  onStaged: (e: StagedTicketEvent) => void;
  /** Re-resolve (#1191): release a previously bound STAGED ticket after
   *  the new symbol stages — the opener decides created → discard vs
   *  adopted → survives in the queue. */
  releaseTicket: (ticketId: string) => void;
}

/** Dialog input — exactly one mode: a bound ticket (card mode) or the
 *  manual seed. The union makes "mutually exclusive" compile-time — a
 *  `{ ticketId, manual }` mix can't be constructed. */
export type GalleryTicketDialogData = {
  /** Live trading-config signal from the host — the dialog stays reactive
   *  without injecting the caller's services (#755 review). */
  tradingConfig: Signal<TradingConfig | null>;
} & (
  | {
      /** Staged equity/ETF ticket id (OrderTicketStore.tickets() key) —
       *  card mode. */
      ticketId: string;
      /** Option-tab seed — absent renders the dialog Stock-only (no tabs). */
      option?: OptionTabSeed;
      manual?: never;
    }
  | {
      /** Manual-mode seed — renders the dialog in manual entry mode;
       *  the equity ticket is bound once symbol-resolve stages it
       *  (#1177). */
      manual: ManualOrderDialogSeed;
      ticketId?: never;
      option?: never;
    }
);

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

  /** The manually staged ticket's id — set by `resolveSymbol` once the
   *  seed stage lands (#1177/#1189). Writable because manual mode has no
   *  ticket at open. */
  private readonly manualTicketId = signal<string | null>(null);

  /** The tickets map is mixed-keyed (bare session ids vs hydrated
   *  `liv_`/`pap_` doc ids) — a mid-dialog `loadTickets()` rehydrate
   *  rekeys in-flight tickets, so every binding lookup probes both
   *  spellings or it would read null while the ticket survives. */
  private ticketById(id: string): OrderTicket | null {
    const m = this.ticketStore.tickets();
    return m[id] ?? m[stDocId(id)] ?? null;
  }

  /** Reactive ticket lookup — reflects in-dialog edits and queue changes.
   *  Null in manual mode until the symbol-resolve flow stages a ticket. */
  readonly ticket = computed(
    (): OrderTicket | null => {
      const id = this.data.ticketId ?? this.manualTicketId();
      return id ? this.ticketById(id) : null;
    },
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
   *  (the card's symbol, independent of which ticket is bound); manual
   *  mode takes the resolved entry, and the equity ticket's symbol is
   *  the fallback. */
  readonly displaySymbol = computed(
    () => this.data.option?.symbol ?? this.enteredSymbol() ?? this.symbol(),
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
      return id ? this.ticketById(id) : null;
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

  // ------------------------------------------------------------------
  // Manual mode — symbol entry + resolve (#1177/#1189)
  // ------------------------------------------------------------------

  /** The user-typed symbol (raw, normalized on resolve) — pre-filled
   *  when the opener seeds `initialSymbol` (#1017). */
  readonly symbolInput = signal(this.data.manual?.initialSymbol ?? '');
  /** The resolved symbol — set only after the seed stage lands; drives
   *  displaySymbol, the quote strip, and tab rendering. */
  readonly enteredSymbol = signal<string | null>(null);
  /** True while a resolve is in flight — guards double-submits. */
  readonly resolving = signal(false);
  /** Inline resolve error — invalid ticker, no quote, or a seed-side
   *  stage failure (the seed already snackbar'd the reason). */
  readonly symbolError = signal<string | null>(null);

  /** Re-resolve lock (#1191): a bound ticket owns the entry row only
   *  while it ISN'T STAGED — a resolve during SUBMITTING/done would hide
   *  the real order's confirmation. A STAGED binding is session-scratch:
   *  re-resolve releases it (created → discard, adopted → stays queued). */
  readonly resolveLocked = computed(() => {
    const t = this.ticket();
    if (t && t.status !== OrderTicketStatus.STAGED) return true;
    const o = this.optionTicket();
    return !!o && o.status !== OrderTicketStatus.STAGED;
  });

  /** Resolve the entered ticker: validate the charset before any work,
   *  then stage-or-adopt through the manual seed (the seed does its own
   *  quote fetch for sizing — a ticker RH can't price returns null).
   *  Success binds the ticket and reveals the tabs; failure shows an
   *  inline error and leaves the field editable. The strip warm is
   *  fire-and-forget — `fetchPrices` dedupes an identical in-flight
   *  request, so awaiting it can't prove a quote landed (and a stale
   *  cached price would pass anyway); `quote()` fills reactively. */
  async resolveSymbol(): Promise<void> {
    const manual = this.data.manual;
    if (!manual || this.resolving() || this.resolveLocked()) return;
    const sym = normalizeUnderlyingSymbol(this.symbolInput());
    if (!sym) {
      this.symbolError.set('Enter a valid ticker — letters, digits, dots, hyphens');
      return;
    }
    this.resolving.set(true);
    this.symbolError.set(null);
    try {
      const staged = await manual.stageEquityTicket(sym);
      if (!staged) {
        this.symbolError.set(`${sym}: couldn't stage an order ticket`);
        return;
      }
      // Swap the previous binding (#1191): release the old STAGED
      // tickets — the seed discards session-created ones and leaves
      // adopted ones queued. A same-id result is adoption, not a swap —
      // release nothing or the ticket we just bound (and its option
      // leg, still valid for the same symbol) would discard itself. A
      // null prev still releases a bound option ticket — it's stale
      // state from a vanished equity binding, not a same-symbol adopt.
      // Keep this block synchronous — an await inserted between the
      // releases and the signal writes would expose the transiently-
      // unbound optionTicketId to the close effect (#1191 review).
      const prev = this.manualTicketId();
      if (prev !== staged.id) {
        if (prev) manual.releaseTicket(prev);
        const prevOpt = this.optionTicketId();
        if (prevOpt) manual.releaseTicket(prevOpt);
        this.optionTicketId.set(null);
      }
      this.enteredSymbol.set(sym);
      this.manualTicketId.set(staged.id);
      void this.priceService.fetchPrices([sym]);
    } catch {
      this.symbolError.set(`${sym}: couldn't stage an order ticket`);
    } finally {
      this.resolving.set(false);
    }
  }

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
        // Card mode: the bound ticket vanished (discarded elsewhere).
        // Manual mode: null means pre-resolve (or the session ticket was
        // discarded elsewhere) — the dialog stays open either way so the
        // user can resolve or re-resolve; a stale confirmation for the
        // gone ticket must clear or it would mask the entry row (#1189).
        if (!this.data.manual) {
          this.dialogRef.close();
          return;
        }
        this.confirmation.set(null);
        // A vanished bound ticket also resets the entry row — the tabs
        // would otherwise render OrderTicket on a null ticket.
        this.enteredSymbol.set(null);
        this.manualTicketId.set(null);
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
    // A seeded initialSymbol (#1017 — the review pages' Trade) resolves
    // straight through the manual stage path instead of waiting on the
    // entry row.
    if (this.data.manual?.initialSymbol) void this.resolveSymbol();
  }

  onDone(): void {
    this.dialogRef.close();
  }

  /** Follow the accepted order — card mode deep-links the ticket on the
   *  live-order page via the `ticket` query param (#762); manual mode
   *  lands on the portfolio dashboard, where resting/filled orders live
   *  (the queue view isn't wired for manual tickets — #1177). */
  onViewOrder(): void {
    const t = this.confirmation();
    if (this.data.manual) {
      void this.router.navigate(['/', AppRoutes.PORTFOLIO_DASHBOARD]);
    } else {
      void this.router.navigate(
        ['/', AppRoutes.SIGNAL_ORDER],
        t ? { queryParams: { ticket: t.id } } : undefined,
      );
    }
    this.dialogRef.close();
  }

  /** Option ticket staged/adopted — bind the id for close-on-done and
   *  forward the emit so the host can track session-created tickets for
   *  discard-on-cancel (#964). */
  onOptionStaged(e: StagedTicketEvent): void {
    // A stale in-flight stage can emit AFTER a re-resolve swapped the
    // underlying (#1191 review): bind only when the emitted ticket's
    // underlying still matches the resolved symbol — the ghost still
    // reaches `onStaged` so the opener tracks (and discards) it, but it
    // never binds.
    const t = this.ticketById(e.ticketId);
    const expected = this.displaySymbol();
    if (t && expected && t.symbol.toUpperCase() === expected.toUpperCase()) {
      this.optionTicketId.set(e.ticketId);
    }
    this.data.option?.onStaged(e);
    this.data.manual?.onStaged(e);
  }
}
