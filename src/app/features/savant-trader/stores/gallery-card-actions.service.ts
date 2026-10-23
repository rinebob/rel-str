/**
 * Gallery Card Actions Service
 *
 * Owns the gallery card's action mutations (#755) — extracted from
 * GalleryFacade so the facade stays a view-model seam. Actions per card:
 * Trade stages a quantity ticket and opens it for editing, Reject parks
 * the card in Actioned for the session (ephemeral — no writes; #1017),
 * Paper sends the staged ticket through the paperSignalOrder callable.
 * Actioned-section exit: Requeue regenerates a failed card's terminal
 * ticket to STAGED.
 *
 * Guards (re-checks alongside the card's disabled buttons):
 * - `isActionableRun` — mutations require the viewed run to be completed.
 * - `canTradeCard`/`canRejectCard`/`canRequeueCard` —
 *   each actioned card exposes only the inverse of its sinking action;
 *   settled is terminal.
 * - `busyCardKeys` — an in-flight action per card blocks re-entry so a
 *   double-click can't double-stage or double-send (#755 review).
 *
 * Ticket provenance operates on the card's FULL occurrence set —
 * `card.allOccurrences`, not the timeframe-trimmed `occurrences` (#819 r2
 * consolidated every full-set reader onto the card field).
 */
import { computed, inject, Injectable, signal } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GroupStore } from './group.store';
import { OrderTicketStore } from './order-ticket.store';
import { TradingConfigService } from '../services/trading-config.service';
import { EquityPriceService } from '../services/equity-price.service';
import {
  EquityOrderTicket,
  EtfOrderTicket,
  InstrumentType,
  isLiveOrderTicket,
  OrderTicketStatus,
  REQUEUEABLE_TICKET_STATUSES,
  TERMINAL_TICKET_STATUSES,
} from '../services/order-ticket.types';
import {
  buildSignalOrderTickets,
  buildTicketId,
  DEFAULT_DOLLAR_AMOUNT,
  NO_ACCOUNT_SNACKBAR,
  requeueTicketPatch,
} from '../utils/signal-order-staging.util';
import {
  isPaperEligibleTicket,
  paperQuantityFor,
} from '../utils/paper-ticket.util';
import { computePositionSize } from '../utils/position-sizing.util';
import { formatError } from '../utils/format-error.util';
import {
  GalleryActionContext,
  GalleryCard,
} from '../utils/gallery-cards.util';
import {
  canRejectCard,
  canRequeueCard,
  canTradeCard,
  findCardTickets,
} from '../utils/gallery-card-actions.util';

@Injectable({ providedIn: 'root' })
export class GalleryCardActionsService {
  private readonly groupStore = inject(GroupStore);
  private readonly ticketStore = inject(OrderTicketStore);
  private readonly priceService = inject(EquityPriceService);
  private readonly configService = inject(TradingConfigService);
  private readonly snackBar = inject(MatSnackBar);

  /** Trading config — warmed on page enter, read by ticket staging and
   *  the ticket dialog. Lives on TradingConfigService (#1177) so every
   *  order-staging surface shares one cache. */
  readonly config = this.configService.config;

  /** Mutation actions require the viewed run to be completed. */
  readonly isActionableRun = computed(() => this.groupStore.isActionableRun());

  /** Viewed run id — exposed for the option-tab seed the ticket dialog
   *  binds (#964). */
  readonly activeRunId = this.groupStore.activeRunId;

  /** Session-rejected cards — `${runId}:${card.key}` → reject timestamp
   *  (#1017 — replaced the durable REJECT write). Run-scoped so a card
   *  rejected under one run can't sink the same symbol+side's card under
   *  a later run — the durable model got run scope free from the doc id,
   *  the session map carries it explicitly. Clears only on full reload. */
  private readonly _rejectedByRun = signal<ReadonlyMap<string, string>>(new Map());

  /** Rejected cards for the ACTIVE run, projected back to plain card
   *  keys — the pipeline reads `${symbol}:${side}`, never the run-scoped
   *  storage key. */
  readonly rejectedCards = computed((): ReadonlyMap<string, string> => {
    const runId = this.groupStore.activeRunId();
    const out = new Map<string, string>();
    if (!runId) return out;
    const prefix = `${runId}:`;
    for (const [key, ts] of this._rejectedByRun()) {
      if (key.startsWith(prefix)) out.set(key.slice(prefix.length), ts);
    }
    return out;
  });

  /** Card keys with an action in flight — the page binds these to each
   *  card's `actionBusy` input; methods also re-check them so a rapid
   *  second click can't double-stage or double-send. */
  private readonly _busyKeys = signal<ReadonlySet<string>>(new Set());
  readonly busyCardKeys = this._busyKeys.asReadonly();

  /** The card pipeline's action context — public so facades feeding the
   *  same enrich/filter utils share one derivation (#1017 r1). */
  readonly actionContext = computed((): GalleryActionContext => ({
    runId: this.groupStore.activeRunId() ?? '',
    rejectedCards: this.rejectedCards(),
    ticketsBySymbol: this.ticketStore.ticketsBySymbol(),
  }));

  /** Eagerly load the trading config on page enter so the first Trade
   *  click doesn't wait on it. Deliberately does NOT touch `busyCardKeys`
   *  — a key can be legitimately held by an action that outlived the page
   *  (this service is root-scoped; `withBusy`'s finally releases it when
   *  the in-flight work actually finishes). Clearing mid-flight would
   *  re-open the double-stage/double-send window the keys exist to close
   *  (#755 review r3). */
  warmConfig(): void {
    this.configService.warmConfig();
  }

  /** Trade result — `created` marks a ticket staged by this click, so the
   *  caller (dialog close) can distinguish "cancel removes it" from a
   *  reopened pre-existing ticket, which must survive (#759). */
  async tradeCard(
    card: GalleryCard,
  ): Promise<{ ticket: EquityOrderTicket | EtfOrderTicket; created: boolean } | null> {
    if (!this.isActionableRun() || !canTradeCard(card)) return null;
    const runId = this.groupStore.activeRunId();
    if (!runId || this._busyKeys().has(card.key)) return null;
    // Reopen-check inside the busy window — two rapid clicks must not
    // both pass the staged-ticket check and open two dialogs (#755
    // review). The check sees ANY matching ticket — the card argument is
    // a render snapshot, so a ticket submitted elsewhere between render
    // and click must stop a duplicate stage, not just the STAGED reopen.
    return this.withBusy(card.key, async () => {
      // Re-check session rejection inside the busy window — a Reject
      // click may have landed after the card snapshot rendered (#1017 r1).
      if (this.rejectedCards().has(card.key)) return null;
      // Symbol-wide equity probe BEFORE the card-scoped reopen: a live
      // ticket for this symbol from ANY surface (manual, other run, the
      // review rows) must block re-staging — provenance-scoped matching
      // alone is blind to tickets without this card's decisionIds
      // (#1017 r2). Live = non-terminal and not STAGED; terminal-only
      // tickets don't block.
      const symbolEquity = (this.ticketStore.ticketsBySymbol()[card.symbol] ?? []).filter(
        (t): t is EquityOrderTicket | EtfOrderTicket => t.instrumentType !== InstrumentType.OPTION,
      );
      if (symbolEquity.some(isLiveOrderTicket)) {
        this.snackBar.open(`${card.symbol}: a live order already exists for this symbol`, 'Dismiss', { duration: 5000 });
        return null;
      }
      // Equity-scope the reopen check — findCardTickets admits OPTION
      // tickets (#964), but they never gate the stock tab: an existing
      // STAGED option ticket is adopted by the option component itself,
      // and a live option ticket already sank the card (canTradeCard).
      const equity = findCardTickets(card, this.actionContext()).filter(
        (t): t is EquityOrderTicket | EtfOrderTicket => t.instrumentType !== InstrumentType.OPTION,
      );
      const existing = equity.find((t) => t.status === OrderTicketStatus.STAGED)
        // Adopt a same-side STAGED twin even without matching provenance
        // (manual or prior-run ticket — don't stage a parallel duplicate).
        ?? symbolEquity.find((t) => t.status === OrderTicketStatus.STAGED && t.side === card.side);
      if (existing) return { ticket: existing, created: false };
      const ticket = await this.stageCardTicket(card, runId);
      return ticket ? { ticket, created: true } : null;
    });
  }

  /** Reject toggle — session-ephemeral (#1017): parks the card in
   *  Actioned for the session only, no decision writes (removing the
   *  card's staged tickets IS a durable write — ticket existence is the
   *  decision). Clicking Restore on a rejected card returns it to
   *  pending. Synchronous — no busy key of its own; a reject landing
   *  while Trade/Paper is mid-flight is dropped (the card's buttons are
   *  busy-disabled anyway) so the in-flight stage can't complete into a
   *  submittable ticket on a card the user just rejected (#1017 r1). */
  rejectCard(card: GalleryCard): void {
    if (!this.isActionableRun() || !canRejectCard(card)) return;
    const runId = this.groupStore.activeRunId();
    if (!runId) return;
    if (this._busyKeys().has(card.key)) {
      this.snackBar.open(`${card.symbol}: action in flight — reject after it finishes`, 'Dismiss', { duration: 3000 });
      return;
    }
    const scopedKey = `${runId}:${card.key}`;
    const next = new Map(this._rejectedByRun());
    if (card.status === 'rejected' || card.allRejected) {
      next.delete(scopedKey);
      this._rejectedByRun.set(next);
      return;
    }
    next.set(scopedKey, new Date().toISOString());
    this._rejectedByRun.set(next);
    this.removeStagedTickets(card);
  }

  /** Send the card's ticket to paper trade: stage one if needed, then run
   *  the shared paperSignalOrder transaction the order queue uses (#709).
   *  A successful send flips the ticket to PAPER → the card settles and
   *  sinks. A failed send on a ticket this click created discards it —
   *  same cancel semantics as the Trade dialog. */
  async paperCard(card: GalleryCard): Promise<void> {
    if (!this.isActionableRun() || !canTradeCard(card)) return;
    const runId = this.groupStore.activeRunId();
    if (!runId || this._busyKeys().has(card.key)) return;
    await this.withBusy(card.key, async () => {
      // Same stale-snapshot guard as tradeCard — the card may have been
      // session-rejected after render (#1017 r1), and any non-STAGED
      // matching EQUITY ticket means the card's state moved on.
      if (this.rejectedCards().has(card.key)) return;
      // Option tickets are excluded: they can't go to paper and must not
      // masquerade as the staged equity ticket (#964).
      const equity = findCardTickets(card, this.actionContext()).filter(
        (t): t is EquityOrderTicket | EtfOrderTicket => t.instrumentType !== InstrumentType.OPTION,
      );
      const existing = equity.find((t) => t.status === OrderTicketStatus.STAGED);
      if (!existing && equity.length) return;
      const created = !existing;
      const staged = existing ?? (await this.stageCardTicket(card, runId));
      if (!staged) return;

      // Re-read post-await — the ticket could have been submitted or
      // removed elsewhere while staging was in flight.
      const t = this.ticketStore.tickets()[staged.id];
      if (!isPaperEligibleTicket(t)) {
        if (created) this.discardStagedTicket(staged.id);
        return;
      }

      // A quantity ticket skips the live-quote fetch — its share count is
      // already the paper quantity. Dollar tickets need the config's
      // sizing default (fallback only when their dollarAmount is absent)
      // — load it, don't read a possibly-cold `_config` (#755 review).
      let livePrice: number | undefined;
      let defaultDollarAmount = DEFAULT_DOLLAR_AMOUNT;
      if (!t.quantity) {
        const config = await this.configService.ensureConfig();
        defaultDollarAmount = config?.defaultDollarAmount ?? DEFAULT_DOLLAR_AMOUNT;
        await this.priceService.fetchPrices([t.symbol]);
        livePrice = this.priceService.prices()[t.symbol.toUpperCase()];
      }
      const qty = paperQuantityFor(t, livePrice, defaultDollarAmount);
      if (qty === undefined) {
        // Keep a created ticket even though the send can't proceed —
        // Trade reopens it so the user can fix quantity rather than
        // losing the staged context (#755 review r3).
        this.ticketStore.updateTicket(t.id, {
          error: { message: 'no usable quantity — set a quantity or dollar amount first', retryable: true },
          updatedAt: new Date().toISOString(),
        });
        this.snackBar.open(`${t.symbol}: no usable quantity for paper send`, 'Dismiss', { duration: 4000 });
        return;
      }

      try {
        await this.ticketStore.sendTicketToPaper(t, qty);
        this.snackBar.open(`${t.symbol} sent to paper trade`, 'Dismiss', { duration: 3000 });
      } catch (err) {
        console.error(`[GalleryCardActions] paper send failed for ${t.symbol}:`, err);
        if (created) this.discardStagedTicket(t.id);
        // The store's eligibility guard throws internal wording — map it
        // to something actionable.
        const msg = formatError(err);
        const friendly = msg.includes('no longer paper-eligible')
          ? `${t.symbol}: ticket changed before send — re-check the card`
          : `${t.symbol} paper send failed: ${msg}`;
        this.snackBar.open(friendly, 'Dismiss', { duration: 5000 });
      }
    });
  }

  /** Requeue: regenerate the failed card's terminal ticket to STAGED —
   *  the card returns to pending and Trade reopens the ticket for
   *  resubmission. The patch mints a fresh refId (RH burns a terminal
   *  order's refId, #717) via the shared requeueTicketPatch. */
  async requeueCard(card: GalleryCard): Promise<void> {
    if (!this.isActionableRun() || !canRequeueCard(card)) return;
    if (this._busyKeys().has(card.key)) return;
    const ticket = findCardTickets(card, this.actionContext()).find(
      (t) => REQUEUEABLE_TICKET_STATUSES.has(t.status),
    );
    if (!ticket) return;
    await this.withBusy(card.key, async () => {
      // Re-read inside the busy window — the resolved snapshot may have
      // advanced past a requeueable status; requeueTicketPatch would
      // otherwise revert a live-order ticket and strip brokerOrderId
      // (#1017 r2).
      const cur = this.ticketStore.tickets()[ticket.id];
      if (!cur || !REQUEUEABLE_TICKET_STATUSES.has(cur.status)) return;
      const ok = await this.ticketStore.updateTicketAndWait(ticket.id, requeueTicketPatch());
      if (ok) this.snackBar.open(`${card.symbol} moved to staged`, 'Dismiss', { duration: 3000 });
    });
  }

  /** Remove a ticket the card's Trade click staged — the ticket-dialog
   *  close path calls this when the dialog was cancelled (still STAGED),
   *  restoring the card to pending (#759). */
  discardStagedTicket(ticketId: string): void {
    this.ticketStore.discardIfStaged(ticketId);
  }

  private async withBusy<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const entered = new Set(this._busyKeys());
    entered.add(key);
    this._busyKeys.set(entered);
    try {
      return await fn();
    } finally {
      const next = new Set(this._busyKeys());
      next.delete(key);
      this._busyKeys.set(next);
    }
  }

  /** Stage the card's side-scoped ticket — whole-share quantity sized on
   *  the signal's close price (live quote fallback), no decision writes
   *  (#759). Same shared builder as signal-review — provenance/decisionIds
   *  parity, only the sizing differs. The ticket is persisted BEFORE this
   *  resolves (`stageTicketAndWait`) so a following backend callable
   *  never races the write. Reject is card-level and session-ephemeral
   *  (#1017) — `canTradeCard` already gates a rejected card, so the FULL
   *  occurrence set always reaches the builder. */
  private async stageCardTicket(
    card: GalleryCard,
    runId: string,
  ): Promise<EquityOrderTicket | EtfOrderTicket | null> {
    const config = await this.configService.ensureConfig();
    // Run switch or reject mid-stage — the config await is a live
    // interleave point; a ticket persisted under the stale run id or
    // for a just-rejected card would strand (#1017 r2).
    if (this.groupStore.activeRunId() !== runId || this.rejectedCards().has(card.key)) return null;
    const accountNumber = config?.accountNumber ?? '';
    const defaultDollarAmount = config?.defaultDollarAmount ?? DEFAULT_DOLLAR_AMOUNT;
    if (!accountNumber) {
      this.snackBar.open(NO_ACCOUNT_SNACKBAR, 'Dismiss', { duration: 4000 });
      return null;
    }

    const occurrences = card.allOccurrences;
    let price = occurrences.find((o) => o.closePrice)?.closePrice;
    if (!price) {
      await this.priceService.fetchPrices([card.symbol]);
      price = this.priceService.prices()[card.symbol.toUpperCase()];
    }
    const shares = price ? computePositionSize(price, defaultDollarAmount).shares : 0;
    if (!price || shares <= 0) {
      this.snackBar.open(`${card.symbol}: no price — cannot size ticket`, 'Dismiss', { duration: 4000 });
      return null;
    }

    // Last async boundary before the write — a live equity ticket that
    // appeared during the config/price awaits must veto the stage, the
    // caller's probe ran before them (#1017 r3).
    const liveNow = (this.ticketStore.ticketsBySymbol()[card.symbol] ?? []).some(
      (t) => t.instrumentType !== InstrumentType.OPTION && isLiveOrderTicket(t),
    );
    if (liveNow) {
      this.snackBar.open(`${card.symbol}: a live order already exists for this symbol`, 'Dismiss', { duration: 5000 });
      return null;
    }

    const [ticket] = buildSignalOrderTickets(card.symbol, occurrences, {
      runId,
      accountNumber,
      defaultDollarAmount,
      quantity: String(shares),
      now: new Date(),
      buildId: buildTicketId,
      buildRefId: () => crypto.randomUUID(),
    });
    if (!ticket) return null;
    const persisted = await this.ticketStore.stageTicketAndWait(ticket);
    return persisted ? ticket : null;
  }

  /** Remove the card's staged tickets (reject path). Matches by canonical
   *  occurrence ids — not just symbol+side — so a same-symbol
   *  staged ticket from a DIFFERENT run survives (#755 review).
   *  findCardTickets reads allOccurrences, so a hidden timeframe leg can't
   *  hide a matching id. */
  private removeStagedTickets(card: GalleryCard): void {
    for (const t of findCardTickets(card, this.actionContext())) {
      if (t.status === OrderTicketStatus.STAGED) {
        this.ticketStore.removeTicket(t.id);
      }
    }
  }
}
