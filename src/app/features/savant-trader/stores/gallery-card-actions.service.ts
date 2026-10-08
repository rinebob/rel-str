/**
 * Gallery Card Actions Service
 *
 * Owns the gallery card's decision mutations (#755) — extracted from
 * GalleryFacade so the facade stays a view-model seam. Three labeled
 * actions per card: Trade stages a quantity ticket and opens it for
 * editing, Reject writes durable REJECTs (toggle — click again on the
 * sunk card restores it), Paper sends the staged ticket through the
 * paperSignalOrder callable.
 *
 * Guards (re-checks alongside the card's disabled buttons):
 * - `isActionableRun` — mutations require the viewed run to be completed.
 * - `canTradeCard`/`canRejectCard` — sunk/in-flight cards expose only
 *   Restore.
 * - `busyCardKeys` — an in-flight action per card blocks re-entry so a
 *   double-click can't double-stage or double-send (#755 review).
 *
 * Decisions and ticket provenance operate on the card's FULL occurrence
 * set — `card.allOccurrences`, not the timeframe-trimmed `occurrences`
 * (#755 review: under the Daily filter a merged D+W card otherwise only
 * rejected its daily leg; #819 r2 consolidated every full-set reader onto
 * the card field).
 */
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { GroupStore } from './group.store';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { OrderTicketStore } from './order-ticket.store';
import { TradingConfigService } from '../services/trading-config.service';
import { EquityPriceService } from '../services/equity-price.service';
import {
  EquityOrderTicket,
  EtfOrderTicket,
  OrderTicketStatus,
  TradingConfig,
} from '../services/order-ticket.types';
import {
  buildSignalOrderTickets,
  buildTicketId,
  DEFAULT_DOLLAR_AMOUNT,
} from '../utils/signal-order-staging.util';
import {
  isPaperEligibleTicket,
  paperQuantityFor,
} from '../utils/paper-ticket.util';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';
import { computePositionSize } from '../utils/position-sizing.util';
import { formatError } from '../utils/format-error.util';
import { SYSTEM_LIST_KEYS } from '../common/symbol-list-defs';
import { ReviewDecision } from '../common/constants';
import {
  GalleryActionContext,
  GalleryCard,
} from '../utils/gallery-cards.util';
import {
  canRejectCard,
  canTradeCard,
  findCardTickets,
} from '../utils/gallery-card-actions.util';

@Injectable({ providedIn: 'root' })
export class GalleryCardActionsService {
  private readonly groupStore = inject(GroupStore);
  private readonly occurrenceStore = inject(OccurrenceDecisionStore);
  private readonly symbolListStore = inject(SymbolListStore);
  private readonly ticketStore = inject(OrderTicketStore);
  private readonly priceService = inject(EquityPriceService);
  private readonly configService = inject(TradingConfigService);
  private readonly snackBar = inject(MatSnackBar);

  /** Trading config — warmed on page enter, read by ticket staging and
   *  the ticket dialog. */
  private readonly _config = signal<TradingConfig | null>(null);
  readonly config = this._config.asReadonly();

  /** Mutation actions require the viewed run to be completed. */
  readonly isActionableRun = computed(() => this.groupStore.isActionableRun());

  /** Card keys with an action in flight — the page binds these to each
   *  card's `actionBusy` input; methods also re-check them so a rapid
   *  second click can't double-stage or double-send. */
  private readonly _busyKeys = signal<ReadonlySet<string>>(new Set());
  readonly busyCardKeys = this._busyKeys.asReadonly();

  private readonly actionContext = computed((): GalleryActionContext => ({
    runId: this.groupStore.activeRunId() ?? '',
    decisions: this.occurrenceStore.occurrenceDecisions(),
    ticketsBySymbol: this.ticketStore.ticketsBySymbol(),
    monitorSymbols: new Set(this.symbolListStore.symbolLists()[SYSTEM_LIST_KEYS.MONITOR] ?? []),
  }));

  /** Eagerly load the trading config on page enter so the first Trade
   *  click doesn't wait on it. Deliberately does NOT touch `busyCardKeys`
   *  — a key can be legitimately held by an action that outlived the page
   *  (this service is root-scoped; `withBusy`'s finally releases it when
   *  the in-flight work actually finishes). Clearing mid-flight would
   *  re-open the double-stage/double-send window the keys exist to close
   *  (#755 review r3). */
  warmConfig(): void {
    this.configService.loadConfig().subscribe({
      next: (config) => this._config.set(config),
      error: (err: unknown) => {
        console.error('[GalleryCardActions] Failed to load trading config:', err);
        this.snackBar.open('Failed to load trading config', 'Dismiss', { duration: 5000 });
      },
    });
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
      const all = findCardTickets(card, this.actionContext());
      const existing = all.find((t) => t.status === OrderTicketStatus.STAGED);
      if (existing) return { ticket: existing, created: false };
      if (all.length) return null; // ticket advanced past STAGED — stale snapshot
      const ticket = await this.stageCardTicket(card, runId);
      return ticket ? { ticket, created: true } : null;
    });
  }

  /** Reject toggle: writes durable REJECTs and sinks the card; clicking
   *  Restore on the sunk card clears them back to pending (#755). */
  rejectCard(card: GalleryCard): void {
    if (!this.isActionableRun() || !canRejectCard(card)) return;
    if (this._busyKeys().has(card.key)) return;
    const runId = this.groupStore.activeRunId();
    const marketDate = this.groupStore.activeRunMarketDate();
    if (!runId || !marketDate) return;
    const occurrences = card.allOccurrences;
    // 'watched' cards can also be fully rejected — Monitor wins status
    // precedence, so `allRejected` is the restore condition there (#755
    // review: otherwise a watched+rejected card exposes Reject again and
    // its REJECTs are unreachable).
    if (card.status === 'rejected' || card.allRejected) {
      this.occurrenceStore.resetSignals(occurrences, runId);
      return;
    }
    this.occurrenceStore.rejectSignals(occurrences, runId, marketDate);
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
      // Same stale-snapshot guard as tradeCard — any non-STAGED matching
      // ticket means the card's state moved on since render.
      const all = findCardTickets(card, this.actionContext());
      const existing = all.find((t) => t.status === OrderTicketStatus.STAGED);
      if (!existing && all.length) return;
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
        const config = await this.ensureConfig();
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

  /** Remove a ticket the card's Trade click staged — the ticket-dialog
   *  close path calls this when the dialog was cancelled (still STAGED),
   *  restoring the card to pending (#759). */
  discardStagedTicket(ticketId: string): void {
    const ticket = this.ticketStore.tickets()[ticketId];
    if (ticket?.status === OrderTicketStatus.STAGED) {
      this.ticketStore.removeTicket(ticketId);
    }
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

  /** Config for sizing paths — the warmed value or a fresh load. Null on
   *  load failure (snackbar shown here) so callers share one error path. */
  private async ensureConfig(): Promise<TradingConfig | null> {
    const cached = this._config();
    if (cached) return cached;
    try {
      const config = await firstValueFrom(this.configService.loadConfig());
      this._config.set(config);
      return config;
    } catch (err) {
      console.error('[GalleryCardActions] Failed to load trading config:', err);
      this.snackBar.open('Failed to load trading config', 'Dismiss', { duration: 4000 });
      return null;
    }
  }

  /** Stage the card's side-scoped ticket — whole-share quantity sized on
   *  the signal's close price (live quote fallback), no decision writes
   *  (#759). Same shared builder as signal-review — provenance/decisionIds
   *  parity, only the sizing differs. The ticket is persisted BEFORE this
   *  resolves (`stageTicketAndWait`) so a following backend callable
   *  never races the write.
   *
   *  REJECTed occurrences are excluded before the builder maps ids into
   *  `signalContext.decisionIds` — a ticket removal clears every id it
   *  carries, so a REJECT id reaching the ticket would be silently
   *  un-rejected if the ticket is later discarded (#755 review). */
  private async stageCardTicket(
    card: GalleryCard,
    runId: string,
  ): Promise<EquityOrderTicket | EtfOrderTicket | null> {
    const config = await this.ensureConfig();
    const accountNumber = config?.accountNumber ?? '';
    const defaultDollarAmount = config?.defaultDollarAmount ?? DEFAULT_DOLLAR_AMOUNT;
    if (!accountNumber) {
      this.snackBar.open('Failed to stage order — configure the agentic account first', 'Dismiss', { duration: 4000 });
      return null;
    }

    const decisions = this.actionContext().decisions;
    const occurrences = card.allOccurrences.filter(
      (o) =>
        decisions[buildStOccurrenceDecisionId(runId, o.symbol, o.timeframe, o.signalType)]
          ?.decisionType !== ReviewDecision.REJECT,
    );
    if (!occurrences.length) {
      this.snackBar.open(`${card.symbol}: all occurrences rejected — restore to trade`, 'Dismiss', { duration: 4000 });
      return null;
    }
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
   *  occurrence-decision ids — not just symbol+side — so a same-symbol
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
