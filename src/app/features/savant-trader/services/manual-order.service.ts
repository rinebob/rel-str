/**
 * Manual Order Service (Topic #1177 / task #1188)
 *
 * The single entry point for manual order entry — the header's New Order
 * button calls `open()` from any page. Mirrors the gallery Trade flow
 * minus card/run context: config warmup via the shared
 * TradingConfigService cache, pessimistic staging via
 * `stageTicketAndWait` (persist BEFORE the dialog binds it),
 * adopt-instead-of-duplicate for an existing STAGED manual ticket, and
 * discard-on-close for tickets this dialog session created.
 *
 * The dialog gets callbacks (`ManualOrderDialogSeed`) rather than this
 * service — same decoupling rule as the gallery's OptionTabSeed.
 */
import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';

import { OrderTicketStore } from '../stores/order-ticket.store';
import { TradingConfigService } from './trading-config.service';
import { EquityPriceService } from './equity-price.service';
import {
  GalleryTicketDialogComponent,
  GalleryTicketDialogData,
  ManualOrderDialogSeed,
  StagedTicketEvent,
} from '../components/gallery-ticket-dialog/gallery-ticket-dialog.component';
import {
  EquityOrderTicket,
  EtfOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
  TradingConfig,
} from './order-ticket.types';
import {
  buildManualEquityTicket,
  normalizeUnderlyingSymbol,
} from '../utils/manual-ticket-staging.util';
import { buildTicketId, DEFAULT_DOLLAR_AMOUNT } from '../utils/signal-order-staging.util';
import { stDocId } from './order-ticket-st-mapper';
import { computePositionSize } from '../utils/position-sizing.util';

const NO_ACCOUNT_SNACKBAR = 'Failed to stage order — configure the agentic account first';

/** Trade result — `created` marks a ticket this call staged, so close
 *  semantics can distinguish "discard" from "adopted — survives". */
export interface ManualStageResult {
  ticket: EquityOrderTicket | EtfOrderTicket;
  created: boolean;
}

@Injectable({ providedIn: 'root' })
export class ManualOrderService {
  private readonly dialog = inject(MatDialog);
  private readonly ticketStore = inject(OrderTicketStore);
  private readonly priceService = inject(EquityPriceService);
  private readonly configService = inject(TradingConfigService);
  private readonly snackBar = inject(MatSnackBar);

  /** Trading config — warmed lazily by open(), read by the dialog. */
  readonly config = this.configService.config;

  /** One manual dialog at a time — a second open() while one is up is a
   *  no-op (the close effect and ticket tracking assume a single session). */
  private _dialogOpen = false;

  /** Re-entry guard per symbol — a rapid double-resolve can't double-stage. */
  private readonly _staging = new Set<string>();

  /** Open the manual order ticket. Bails when no trading account is
   *  configured — load failure was already snackbar'd by ensureConfig;
   *  a config with no accountNumber gets the account-specific message
   *  (same as the gallery staging path). Tickets this dialog session
   *  creates AND still has STAGED are discarded on close; adopted
   *  pre-existing and advanced (submitted) tickets survive. */
  async open(): Promise<void> {
    if (this._dialogOpen) return;
    // Claim the slot before the config await — two rapid open() calls
    // must not both reach dialog.open.
    this._dialogOpen = true;
    let config: TradingConfig | null;
    try {
      config = await this.configService.ensureConfig();
    } catch (err) {
      // ensureConfig snackbars internally today — but a throw must never
      // wedge _dialogOpen (every later open() would silently no-op).
      this._dialogOpen = false;
      this.snackBar.open('Failed to load trading config', 'Dismiss', { duration: 4000 });
      console.error('[ManualOrderService] config ensure failed:', err);
      return;
    }
    if (!config?.accountNumber) {
      this._dialogOpen = false;
      this.snackBar.open(NO_ACCOUNT_SNACKBAR, 'Dismiss', { duration: 4000 });
      return;
    }

    const createdTicketIds = new Set<string>();
    const track = (e: StagedTicketEvent) => {
      if (e.created) createdTicketIds.add(e.ticketId);
    };
    const manual: ManualOrderDialogSeed = {
      stageEquityTicket: async (symbol) => {
        const r = await this.stageEquityTicket(symbol);
        if (r) track({ ticketId: r.ticket.id, created: r.created });
        // Stage resolved AFTER the dialog closed — the close pass already
        // drained createdTicketIds, so discard here or the persisted
        // STAGED ticket leaks past a "cancel".
        if (r?.created && !this._dialogOpen) this.ticketStore.discardIfStaged(r.ticket.id);
        return r?.ticket ?? null;
      },
      onStaged: (e) => {
        track(e);
        if (e.created && !this._dialogOpen) this.ticketStore.discardIfStaged(e.ticketId);
      },
    };

    const data: GalleryTicketDialogData = { manual, tradingConfig: this.config };
    let ref;
    try {
      ref = this.dialog.open(GalleryTicketDialogComponent, {
        data,
        width: '640px',
        maxHeight: '92vh',
        autoFocus: false,
      });
    } catch (err) {
      // A failed open must not wedge the flag — every later open() would
      // silently no-op.
      this._dialogOpen = false;
      throw err;
    }
    ref.afterClosed().subscribe(() => {
      this._dialogOpen = false;
      for (const id of createdTicketIds) this.ticketStore.discardIfStaged(id);
    });
  }

  /** Stage (or adopt) the manual equity ticket for a resolved symbol.
   *  Adopt: an existing STAGED MANUAL equity ticket is reopened rather
   *  than duplicated — a signal-pipeline or OPTION ticket for the same
   *  symbol does NOT count (different intent). Sizes whole shares from
   *  the quote + config default, same as the gallery card path; persists
   *  via `stageTicketAndWait` before returning.
   *
   *  The post-build id check guards the deterministic {SYM}-BUY-{minute}
   *  id: a same-minute ticket in ANY other state (submitted signal or
   *  manual ticket, or a STAGED one from a different flow) would be
   *  silently overwritten by the create — orphaning a live broker order
   *  — so this call bails instead of staging. */
  async stageEquityTicket(symbol: string): Promise<ManualStageResult | null> {
    const sym = normalizeUnderlyingSymbol(symbol);
    if (!sym) {
      this.snackBar.open(`${symbol}: not a valid ticker`, 'Dismiss', { duration: 4000 });
      return null;
    }
    if (this._staging.has(sym)) return null;
    this._staging.add(sym);
    try {
      // Adopt before any awaits — a cheap sync check that also serves the
      // double-resolve race (the second call lands after the first staged).
      // ANY STAGED equity ticket is adopted regardless of source (#1189
      // r3): a signal-sourced STAGED ticket for this symbol otherwise
      // gets a parallel manual duplicate — two submittable orders for one
      // underlying. A non-STAGED equity ticket means a live order is in
      // flight — same guard as signal-review's Trade path.
      const equityFor = (this.ticketStore.ticketsBySymbol()[sym] ?? []).filter(
        (t): t is EquityOrderTicket | EtfOrderTicket =>
          t.instrumentType !== InstrumentType.OPTION,
      );
      const staged = equityFor.find((t) => t.status === OrderTicketStatus.STAGED);
      if (staged) return { ticket: staged, created: false };
      if (equityFor.length) {
        this.snackBar.open(
          `${sym}: a live order already exists for this symbol`,
          'Dismiss',
          { duration: 5000 },
        );
        return null;
      }

      const config = await this.configService.ensureConfig();
      const accountNumber = config?.accountNumber ?? '';
      if (!accountNumber) {
        this.snackBar.open(NO_ACCOUNT_SNACKBAR, 'Dismiss', { duration: 4000 });
        return null;
      }

      let price = this.priceService.prices()[sym];
      if (!price) {
        await this.priceService.fetchPrices([sym]);
        price = this.priceService.prices()[sym];
      }
      const defaultDollarAmount = config?.defaultDollarAmount ?? DEFAULT_DOLLAR_AMOUNT;
      const shares = price ? computePositionSize(price, defaultDollarAmount).shares : 0;
      if (!price || shares <= 0) {
        this.snackBar.open(`${sym}: no price — cannot size ticket`, 'Dismiss', { duration: 4000 });
        return null;
      }

      const ticket = buildManualEquityTicket(sym, {
        accountNumber,
        quantity: String(shares),
        now: new Date(),
        buildId: buildTicketId,
        buildRefId: () => crypto.randomUUID(),
      });
      if (!ticket) return null;

      // Same-minute id collision — see the method doc. Probe both key
      // spellings: the map is mixed-keyed, so a hydrated twin sits under
      // liv_{id} while a same-session twin is bare. Adopt a STAGED manual
      // twin (the symbol check above raced it); anything else is an
      // in-flight ticket the create would clobber.
      const tickets = this.ticketStore.tickets();
      const twin = tickets[ticket.id] ?? tickets[stDocId(ticket.id)];
      if (twin) {
        if (
          twin.source === OrderSource.MANUAL &&
          twin.status === OrderTicketStatus.STAGED &&
          twin.instrumentType !== InstrumentType.OPTION
        ) {
          return { ticket: twin, created: false };
        }
        this.snackBar.open(
          `${sym}: a ticket for this symbol was just staged — try again in a moment`,
          'Dismiss',
          { duration: 4000 },
        );
        return null;
      }

      return (await this.ticketStore.stageTicketAndWait(ticket))
        ? { ticket, created: true }
        : null;
    } finally {
      this._staging.delete(sym);
    }
  }
}
