/**
 * Order Queue Component
 *
 * Left panel of the signal order screen. Lists all staged tickets grouped
 * by status. Each row shows source badge, symbol, side, order type, quantity,
 * and status. Clicking a row selects it (emits ticket id). Batch select with
 * checkboxes + remove action.
 *
 * Ref: IMPL-savant-trader-order-placement-fe.md §8 (Signal order screen)
 */
import {
  Component,
  input,
  output,
  signal,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltipModule } from '@angular/material/tooltip';

import {
  OrderTicket,
  OrderTicketStatus,
  OrderSource,
  InstrumentType,
} from '../../services/order-ticket.types';
import { computePositionSize } from '../../utils/position-sizing.util';

interface StatusGroup {
  label: string;
  status: OrderTicketStatus[];
  tickets: OrderTicket[];
  cssClass: string;
}

interface StagedAggregate {
  shares: number;
  units: number;
  dollars: number;
}

@Component({
  selector: 'app-order-queue',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatCheckboxModule, MatButtonModule, MatTooltipModule],
  templateUrl: './order-queue.component.html',
  styleUrl: './order-queue.component.scss',
})
export class OrderQueueComponent {
  /** All tickets to display in the queue. */
  tickets = input<OrderTicket[]>([]);

  /** Currently selected ticket id. */
  selectedId = input<string | null>(null);

  /** Price map: symbol → price. */
  prices = input<Record<string, number>>({});

  /** Default dollar amount from trading config, used as fallback display. */
  defaultDollarAmount = input<number>(100);

  /** Set of symbols that have an active protective stop-loss at RH.
   *  Used to show the PROTECTED badge on open positions. */
  protectedSymbols = input<Set<string>>(new Set());

  /** Emitted when a row is clicked. */
  ticketSelected = output<string>();

  /** Emitted when the user batch-removes selected tickets. */
  removeTickets = output<string[]>();

  /** Emitted when the user clicks "Requeue" on a cancelled ticket. */
  requeueTicket = output<string>();

  /** Track selected checkbox state per ticket id. */
  private checkedIds = signal<Set<string>>(new Set());

  /** Track which group labels are collapsed. */
  private collapsedGroups = signal<Set<string>>(new Set());

  /** Whether any checkboxes are checked (controls remove button visibility). */
  hasChecked = computed(() => this.checkedIds().size > 0);

  /** Toggle a group's expand/collapse state. */
  toggleGroup(label: string): void {
    this.collapsedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });
  }

  /** Check if a group is collapsed. */
  isGroupCollapsed(label: string): boolean {
    return this.collapsedGroups().has(label);
  }

  /** Whether an entry has an active RH stop order protecting it. */
  hasProtection(ticket: OrderTicket): boolean {
    const sym = this.symbolFor(ticket);
    return this.protectedSymbols().has(sym);
  }

  /** tickets grouped by status category, in display order. Every broker ticket appears once. */
  groups = computed<StatusGroup[]>(() => {
    const all = this.tickets();
    const sortTickets = (tickets: OrderTicket[]) =>
      [...tickets].sort((a, b) => {
        // Buy before sell
        if (a.side !== b.side) return a.side === 'buy' ? -1 : 1;
        // Then by createdAt ascending (oldest first)
        return a.createdAt.localeCompare(b.createdAt);
      });
    return [
      {
        label: 'Staged',
        status: [OrderTicketStatus.STAGED],
        tickets: sortTickets(all.filter((i) => i.status === OrderTicketStatus.STAGED)),
        cssClass: 'group-staged',
      },
      {
        label: 'Submitting',
        status: [OrderTicketStatus.SUBMITTING],
        tickets: sortTickets(all.filter((i) => i.status === OrderTicketStatus.SUBMITTING)),
        cssClass: 'group-submitting',
      },
      {
        label: 'Submitted',
        status: [OrderTicketStatus.SUBMITTED],
        tickets: sortTickets(all.filter((i) => i.status === OrderTicketStatus.SUBMITTED)),
        cssClass: 'group-submitted',
      },
      {
        label: 'Queued',
        status: [OrderTicketStatus.QUEUED],
        tickets: sortTickets(all.filter((i) => i.status === OrderTicketStatus.QUEUED)),
        cssClass: 'group-queued',
      },
      {
        label: 'Resting',
        status: [OrderTicketStatus.RESTING],
        tickets: sortTickets(all.filter((i) => i.status === OrderTicketStatus.RESTING)),
        cssClass: 'group-resting',
      },
      {
        label: 'Open Positions',
        status: [OrderTicketStatus.FILLED],
        tickets: sortTickets(all.filter((i) => i.status === OrderTicketStatus.FILLED)),
        cssClass: 'group-filled',
      },
      {
        label: 'Failed',
        status: [OrderTicketStatus.FAILED],
        tickets: sortTickets(all.filter((i) => i.status === OrderTicketStatus.FAILED)),
        cssClass: 'group-failed',
      },
      {
        label: 'Cancelled',
        status: [OrderTicketStatus.CANCELLED],
        tickets: sortTickets(all.filter((i) => i.status === OrderTicketStatus.CANCELLED)),
        cssClass: 'group-cancelled',
      },
    ].filter((g) => g.tickets.length > 0);
  });

  /** Total count for header. */
  totalCount = computed(() => this.tickets().length);

  /** Enums for template comparisons. */
  protected readonly TicketStatus = OrderTicketStatus;
  protected readonly Source = OrderSource;

  /** Staged-group aggregates shown in the Staged group header, split by
   *  side so staged sells never inflate the buy total. Only tickets with
   *  real data (quantity or dollarAmount) contribute — a ticket carrying
   *  neither would add a pure default-dollar estimate. Option tickets
   *  excluded (quantity is contracts, not shares/dollars). */
  stagedAggregate = computed<{ buy: StagedAggregate; sell: StagedAggregate }>(() => {
    const zero = (): StagedAggregate => ({ shares: 0, units: 0, dollars: 0 });
    const buy = zero();
    const sell = zero();
    for (const t of this.tickets()) {
      if (t.status !== OrderTicketStatus.STAGED || t.instrumentType === InstrumentType.OPTION) continue;
      if (this.num(t.quantity) == null && this.num(t.dollarAmount) == null) continue;
      const bucket = t.side === 'sell' ? sell : buy;
      bucket.shares += this.sharesFor(t) ?? 0;
      bucket.dollars += this.dollarsFor(t) ?? 0;
    }
    const def = this.defaultDollarAmount();
    for (const b of [buy, sell]) {
      b.units = def > 0 ? Math.round((b.dollars / def) * 100) / 100 : 0;
      b.shares = Math.round(b.shares * 100) / 100;
      b.dollars = Math.round(b.dollars * 100) / 100;
    }
    return { buy, sell };
  });

  /** Extract the display symbol from a ticket (equity/etf: symbol, option: first leg symbol). */
  symbolFor(ticket: OrderTicket): string {
    if (ticket.instrumentType === InstrumentType.OPTION) {
      return ticket.legs[0]?.symbol ?? '?';
    }
    return ticket.symbol;
  }

  /** Short source badge text; null when the source is unrecognized (badge omitted). */
  sourceBadge(ticket: OrderTicket): string | null {
    switch (ticket.source) {
      case OrderSource.SIGNAL_PIPELINE: return 'SIG';
      case OrderSource.MANUAL: return 'MAN';
      case OrderSource.POSITION_MANAGEMENT: return 'POS';
      default: return null;
    }
  }

  /** Parse a ticket numeric field; null when absent or NaN. */
  private num(v: string | undefined): number | null {
    const n = parseFloat(v ?? '');
    return isNaN(n) ? null : n;
  }

  /** Contract count for option tickets; null otherwise. */
  contractsFor(ticket: OrderTicket): string | null {
    if (ticket.instrumentType !== InstrumentType.OPTION) return null;
    return `${ticket.quantity} contract${ticket.quantity === '1' ? '' : 's'}`;
  }

  /** Share count — the ticket's quantity verbatim (fractional shares are
   *  real: fractional_close tickets, DRIP positions), else the whole-share
   *  sizing (computePositionSize) of its dollarAmount target at the
   *  current price. Null for options or when uncomputable. */
  sharesFor(ticket: OrderTicket): number | null {
    if (ticket.instrumentType === InstrumentType.OPTION) return null;
    const q = this.num(ticket.quantity);
    if (q != null) return q;
    const price = this.priceFor(ticket);
    const target = this.num(ticket.dollarAmount) ?? this.defaultDollarAmount();
    if (price == null || price <= 0) return null;
    return computePositionSize(price, target).shares;
  }

  /** Order dollar amount — quantity × price when both exist (what the
   *  share order would cost now), else whole-share cost of the
   *  dollarAmount target, else the stored dollarAmount itself. Null for
   *  options or when nothing is computable. */
  dollarsFor(ticket: OrderTicket): number | null {
    if (ticket.instrumentType === InstrumentType.OPTION) return null;
    const q = this.num(ticket.quantity);
    const price = this.priceFor(ticket);
    if (q != null && price != null && price > 0) {
      return Math.round(q * price * 100) / 100;
    }
    if (q == null && price != null && price > 0) {
      const target = this.num(ticket.dollarAmount) ?? this.defaultDollarAmount();
      return computePositionSize(price, target).actualCost;
    }
    return this.num(ticket.dollarAmount);
  }

  /** Units for equity/ETF tickets: notional / defaultDollarAmount. */
  unitsFor(ticket: OrderTicket): number | null {
    const d = this.dollarsFor(ticket);
    const def = this.defaultDollarAmount();
    if (d == null || def <= 0) return null;
    return Math.round((d / def) * 100) / 100;
  }

  /** True when every displayed field derives from the configured default
   *  dollar amount — the ticket carries neither quantity nor dollarAmount,
   *  so all three values are estimates, not ticket data. */
  isDefaultEstimate(ticket: OrderTicket): boolean {
    return (
      ticket.instrumentType !== InstrumentType.OPTION &&
      this.num(ticket.quantity) == null &&
      this.num(ticket.dollarAmount) == null
    );
  }

  /** Price for the ticket's symbol, or null if not loaded. */
  priceFor(ticket: OrderTicket): number | null {
    const sym = this.symbolFor(ticket);
    return this.prices()[sym.toUpperCase()] ?? null;
  }

  /** Date display: signal bar date if signal-sourced, otherwise createdAt date; null when neither exists. */
  dateFor(ticket: OrderTicket): string | null {
    const signalDate = ticket.signalContext?.barDate;
    if (signalDate) return signalDate;
    return ticket.createdAt?.slice(0, 10) || null;
  }

  /** Row click handler. */
  onRowClick(ticket: OrderTicket, event: Event): void {
    // Don't select when clicking the checkbox
    if ((event.target as HTMLElement).closest('mat-checkbox')) return;
    this.ticketSelected.emit(ticket.id);
  }

  /** Toggle checkbox for a ticket. */
  toggleCheck(id: string, checked: boolean): void {
    this.checkedIds.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Check if a ticket id is checked. */
  isChecked(id: string): boolean {
    return this.checkedIds().has(id);
  }

  /** Select all tickets. */
  selectAll(): void {
    this.checkedIds.set(new Set(this.tickets().map((i) => i.id)));
  }

  /** Clear all checkboxes. */
  clearSelection(): void {
    this.checkedIds.set(new Set());
  }

  /** Emit remove event for all checked tickets. */
  removeChecked(): void {
    const ids = Array.from(this.checkedIds());
    if (ids.length === 0) return;
    this.removeTickets.emit(ids);
    this.checkedIds.set(new Set());
  }
}
