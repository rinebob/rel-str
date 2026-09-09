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

interface StatusGroup {
  label: string;
  status: OrderTicketStatus[];
  tickets: OrderTicket[];
  cssClass: string;
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

  /** Extract the display symbol from an ticket (equity/etf: symbol, option: first leg symbol). */
  symbolFor(ticket: OrderTicket): string {
    if (ticket.instrumentType === InstrumentType.OPTION) {
      return ticket.legs[0]?.symbol ?? '?';
    }
    return ticket.symbol;
  }

  /** Short source badge text. */
  sourceBadge(ticket: OrderTicket): string {
    switch (ticket.source) {
      case OrderSource.SIGNAL_PIPELINE: return 'SIG';
      case OrderSource.MANUAL: return 'MAN';
      case OrderSource.POSITION_MANAGEMENT: return 'POS';
      default: return '???';
    }
  }

  /** Quantity or dollar amount display string. Shows shares when available, otherwise dollar amount. */
  quantityFor(ticket: OrderTicket): string {
    if (ticket.instrumentType === InstrumentType.OPTION) {
      return ticket.quantity;
    }
    if (ticket.quantity) {
      const n = Number(ticket.quantity);
      if (!isNaN(n)) return parseFloat(n.toFixed(2)).toString();
      return ticket.quantity;
    }
    if (ticket.dollarAmount) return `$${ticket.dollarAmount}`;
    return `$${this.defaultDollarAmount()}`;
  }

  /** Price for the ticket's symbol, or null if not loaded. */
  priceFor(ticket: OrderTicket): number | null {
    const sym = this.symbolFor(ticket);
    return this.prices()[sym.toUpperCase()] ?? null;
  }

  /** Date display: signal bar date if signal-sourced, otherwise createdAt date. */
  dateFor(ticket: OrderTicket): string {
    const signalDate = ticket.signalContext?.barDate;
    if (signalDate) return signalDate;
    return ticket.createdAt?.slice(0, 10) ?? '—';
  }

  /** Row click handler. */
  onRowClick(ticket: OrderTicket, event: Event): void {
    // Don't select when clicking the checkbox
    if ((event.target as HTMLElement).closest('mat-checkbox')) return;
    this.ticketSelected.emit(ticket.id);
  }

  /** Toggle checkbox for an ticket. */
  toggleCheck(id: string, checked: boolean): void {
    this.checkedIds.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Check if an ticket id is checked. */
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
