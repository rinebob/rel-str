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
import { MatTabsModule } from '@angular/material/tabs';
import { UpperCasePipe } from '@angular/common';

import { OrderTicketStore } from '../../stores/order-ticket.store';
import { EquityPriceService } from '../../services/equity-price.service';
import { InstrumentType, OrderTicket, OrderTicketStatus, TradingConfig } from '../../services/order-ticket.types';
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
]);

@Component({
  selector: 'app-gallery-ticket-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    UpperCasePipe,
    MatDialogModule,
    MatButtonModule,
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

  constructor() {
    // Close when EITHER ticket is accepted (submitted/papered) or removed
    // by another surface — not on the transient SUBMITTING marker or a
    // FAILED status, where closing would swallow the error (#755 review).
    // The option ticket only counts once bound: a never-touched Option
    // tab must not hold the dialog open or close it (#964).
    effect(() => {
      const t = this.ticket();
      if (!t || DIALOG_DONE_STATUSES.has(t.status)) {
        this.dialogRef.close();
        return;
      }
      const opt = this.optionTicket();
      if (this.optionTicketId() && (!opt || DIALOG_DONE_STATUSES.has(opt.status))) {
        this.dialogRef.close();
      }
    });
  }

  ngOnInit(): void {
    const symbol = this.symbol();
    if (symbol) void this.priceService.fetchPrices([symbol]);
  }

  /** Option ticket staged/adopted — bind the id for close-on-done and
   *  forward the emit so the host can track session-created tickets for
   *  discard-on-cancel (#964). */
  onOptionStaged(e: { ticketId: string; created: boolean }): void {
    this.optionTicketId.set(e.ticketId);
    this.data.option?.onStaged(e);
  }
}
