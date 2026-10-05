/**
 * Gallery Ticket Dialog
 *
 * MatDialog host for the shared OrderTicketComponent (#743/#759) — the
 * gallery card's Trade button stages a quantity ticket and opens it here
 * for editing/submission. The component binds reactively to the ticket
 * store so in-dialog edits and the order queue's view stay in sync. The
 * dialog closes itself when the ticket leaves STAGED (submitted, sent to
 * paper, or removed elsewhere); the caller decides whether a still-STAGED
 * ticket gets discarded on close.
 */
import { Component, ChangeDetectionStrategy, computed, effect, inject, OnInit, Signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { UpperCasePipe } from '@angular/common';

import { OrderTicketStore } from '../../stores/order-ticket.store';
import { EquityPriceService } from '../../services/equity-price.service';
import { InstrumentType, OrderTicket, OrderTicketStatus, TradingConfig } from '../../services/order-ticket.types';
import { OrderTicketComponent } from '../order-ticket/order-ticket.component';

export interface GalleryTicketDialogData {
  /** Staged ticket id (OrderTicketStore.tickets() key). */
  ticketId: string;
  /** Live trading-config signal from the action service — the host passes
   *  the signal itself so the dialog stays reactive without injecting
   *  the gallery's services (#755 review). */
  tradingConfig: Signal<TradingConfig | null>;
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
  imports: [UpperCasePipe, MatDialogModule, MatButtonModule, OrderTicketComponent],
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
  /** Gallery tickets are always equity/ETF — option tickets carry no `symbol`. */
  readonly symbol = computed(() => {
    const t = this.ticket();
    return t && t.instrumentType !== InstrumentType.OPTION ? t.symbol : null;
  });
  readonly price = computed(() => {
    const sym = this.symbol();
    return sym ? (this.priceService.prices()[sym.toUpperCase()] ?? null) : null;
  });
  readonly tradingConfig = this.data.tradingConfig;

  constructor() {
    // Close when the ticket is accepted (submitted/papered) or removed
    // by another surface — not on the transient SUBMITTING marker or a
    // FAILED status, where closing would swallow the error (#755 review).
    effect(() => {
      const t = this.ticket();
      if (!t || DIALOG_DONE_STATUSES.has(t.status)) this.dialogRef.close();
    });
  }

  ngOnInit(): void {
    const symbol = this.symbol();
    if (symbol) void this.priceService.fetchPrices([symbol]);
  }
}
