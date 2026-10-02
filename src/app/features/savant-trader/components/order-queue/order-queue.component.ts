/**
 * Order Queue Component
 *
 * Left panel of the signal order screen. Lists all non-paper tickets grouped
 * by status. Each row shows symbol, side, order type, quantity, and status.
 * Clicking a row selects it (emits ticket id). Batch select with
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
  effect,
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
  InstrumentType,
} from '../../services/order-ticket.types';
import { computePositionSize, ticketCostBasisPrice } from '../../utils/position-sizing.util';
import { isPaperEligibleTicket } from '../../utils/paper-ticket.util';

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

  /** Emitted when the user clicks "Send N to paper" — checked staged ids
   *  (#709). Batch conversion to paper trading; eligibility (signal
   *  context, instrument type) is enforced by the page handler. */
  sendTicketsToPaper = output<string[]>();

  /** True while a batch paper send is in flight — disables the button so
   *  a second batch can't start silently. */
  sendingToPaper = input(false);

  /** Track selected checkbox state per ticket id. */
  private checkedIds = signal<Set<string>>(new Set());

  /** Track which group labels are collapsed. */
  private collapsedGroups = signal<Set<string>>(new Set());

  constructor() {
    // A checked id must not outlive its row's staged membership: a ticket
    // that leaves STAGED and later returns (cancel → requeue) would
    // otherwise silently regain its checkmark and ride the next batch
    // action without the user re-selecting it (#709).
    effect(() => {
      const staged = new Set(this.stagedVisible().map((t) => t.id));
      this.checkedIds.update((ids) => {
        if ([...ids].every((id) => staged.has(id))) return ids;
        return new Set([...ids].filter((id) => staged.has(id)));
      });
    });
  }

  /** Currently-visible staged tickets — the only rows with checkboxes
   *  and the only batch-action targets (#709). */
  private stagedVisible = computed(() =>
    this.visibleTickets().filter((t) => t.status === OrderTicketStatus.STAGED),
  );

  /** Checked ids restricted to currently-visible STAGED tickets (#709).
   *  Checkboxes only exist on staged rows, but a checked id can linger
   *  after its ticket leaves STAGED (submitted elsewhere, paper-ed) —
   *  those are excluded so the batch actions only ever touch truly-staged
   *  tickets (a checked ticket that goes SUBMITTING can never be
   *  removed mid-flight). */
  stagedChecked = computed(() => {
    const staged = new Set(this.stagedVisible().map((t) => t.id));
    return Array.from(this.checkedIds()).filter((id) => staged.has(id));
  });

  /** Count of checked staged tickets that are actually paper-eligible —
   *  the send button's N. Staged manual/option tickets can be checked
   *  (for batch remove) but can't go to paper, so counting them would
   *  overstate what the button sends. */
  paperSendCount = computed(() =>
    this.stagedChecked()
      .map((id) => this.stagedVisible().find((t) => t.id === id))
      .filter((t): t is OrderTicket => !!t)
      .filter(isPaperEligibleTicket).length,
  );

  /** Whether any staged tickets are checked — controls the batch-bar
   *  actions. Raw checkedIds is deliberately not consulted: every batch
   *  action is staged-scoped. */
  hasChecked = computed(() => this.stagedChecked().length > 0);

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

  /** Terminal rows (cancelled / broker-failed) — they have no checkbox,
   *  so they get per-row Requeue and dismiss affordances instead (#717,
   *  #709). FAILED only ever comes from RH terminal reconciliation, so
   *  its refId is always burned and Requeue is the right path back. */
  isTerminalRow(ticket: OrderTicket): boolean {
    return ticket.status === OrderTicketStatus.CANCELLED ||
      ticket.status === OrderTicketStatus.FAILED;
  }

  /** Tickets this page displays. PAPER tickets never render — once an order
   *  is paper it belongs to the paper-trading dashboard, not this queue. */
  private visibleTickets = computed(() =>
    this.tickets().filter((t) => t.status !== OrderTicketStatus.PAPER),
  );

  /** tickets grouped by status category, in display order. Every broker ticket appears once. */
  groups = computed<StatusGroup[]>(() => {
    const all = this.visibleTickets();
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
  totalCount = computed(() => this.visibleTickets().length);

  /** Enums for template comparisons. */
  protected readonly TicketStatus = OrderTicketStatus;

  /** Staged-group aggregates shown in the Staged group header, split by
   *  side so staged sells never inflate the buy total. Only tickets with
   *  real data (quantity or dollarAmount) contribute — a ticket carrying
   *  neither would add a pure default-dollar estimate. Option tickets
   *  excluded (quantity is contracts, not shares/dollars). */
  stagedAggregate = computed<{ buy: StagedAggregate; sell: StagedAggregate }>(() => {
    const zero = (): StagedAggregate => ({ shares: 0, units: 0, dollars: 0 });
    const buy = zero();
    const sell = zero();
    for (const t of this.stagedVisible()) {
      if (t.instrumentType === InstrumentType.OPTION) continue;
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
   *  sizing (computePositionSize) of its dollarAmount target at the cost
   *  basis (limit price for limit tickets, live quote otherwise — #723).
   *  Null for options or when uncomputable. */
  sharesFor(ticket: OrderTicket): number | null {
    if (ticket.instrumentType === InstrumentType.OPTION) return null;
    const q = this.num(ticket.quantity);
    if (q != null) return q;
    const price = ticketCostBasisPrice(ticket, this.priceFor(ticket));
    const target = this.num(ticket.dollarAmount) ?? this.defaultDollarAmount();
    if (price == null || price <= 0) return null;
    return computePositionSize(price, target).shares;
  }

  /** Order dollar amount — quantity × price when both exist (what the
   *  share order would cost at its committed basis), else whole-share
   *  cost of the dollarAmount target, else the stored dollarAmount
   *  itself. Null for options or when nothing is computable. */
  dollarsFor(ticket: OrderTicket): number | null {
    if (ticket.instrumentType === InstrumentType.OPTION) return null;
    const q = this.num(ticket.quantity);
    const price = ticketCostBasisPrice(ticket, this.priceFor(ticket));
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

  /** Reference price for the row's % change, with a label describing what
   *  the anchor is. Precedence: price at signal generation (signal tickets)
   *  → broker fill/avg cost (position rows) → the ticket's own order price
   *  (resting stops show distance-to-trigger). Null for options or tickets
   *  carrying no price reference (e.g. staged before signalPrice existed). */
  anchorFor(ticket: OrderTicket): { price: number; label: string } | null {
    if (ticket.instrumentType === InstrumentType.OPTION) return null;
    const signalPrice = ticket.signalContext?.signalPrice;
    if (signalPrice != null && signalPrice > 0) {
      return { price: signalPrice, label: 'At signal' };
    }
    // fillPrice is only an average cost on FILLED rows — the RH merge also
    // writes the order's limit price there for submitted/resting tickets.
    if (ticket.status === OrderTicketStatus.FILLED) {
      const fill = this.num(ticket.result?.fillPrice);
      if (fill != null && fill > 0) {
        return { price: fill, label: ticket.side === 'sell' ? 'Fill' : 'Avg cost' };
      }
    }
    const stop = this.num(ticket.stopPrice);
    if (stop != null && stop > 0) return { price: stop, label: 'Stop' };
    const limit = this.num(ticket.limitPrice);
    if (limit != null && limit > 0) return { price: limit, label: 'Limit' };
    return null;
  }

  /** Signed % change from the anchor to the current price; null when either
   *  side is missing. Raw price move — the sign conveys direction only;
   *  whether that move is good depends on intent (a short entry wants down,
   *  a protective stop wants up), which the row doesn't adjudicate. */
  pctFor(ticket: OrderTicket): number | null {
    const anchor = this.anchorFor(ticket)?.price;
    const price = this.priceFor(ticket);
    if (anchor == null || price == null || price <= 0) return null;
    return Math.round(((price - anchor) / anchor) * 1000) / 10;
  }

  /** Color class for the % chip: green when price rose since the anchor,
   *  red when it fell. Direction, not judgement. */
  pctClassFor(ticket: OrderTicket): 'pct-pos' | 'pct-neg' | '' {
    const pct = this.pctFor(ticket);
    if (pct == null) return '';
    return pct >= 0 ? 'pct-pos' : 'pct-neg';
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

  /** Select all staged tickets — checkboxes are scoped to the Staged
   *  group (#709: batch actions target staged orders only). */
  selectAll(): void {
    this.checkedIds.set(new Set(this.stagedVisible().map((i) => i.id)));
  }

  /** Clear all checkboxes. */
  clearSelection(): void {
    this.checkedIds.set(new Set());
  }

  /** Emit remove event for checked STAGED tickets (#709 — checkboxes are
   *  staged-group scoped, so removal is too). Stale ids that left STAGED
   *  or the view are silently dropped. */
  removeChecked(): void {
    const ids = this.stagedChecked();
    this.checkedIds.set(new Set());
    if (ids.length === 0) return;
    this.removeTickets.emit(ids);
  }

  /** Emit the checked staged ids for batch paper conversion and clear
   *  their checkboxes — the queue no longer owns the outcome. */
  sendCheckedToPaper(): void {
    const ids = this.stagedChecked();
    if (ids.length === 0) return;
    this.checkedIds.set(new Set());
    this.sendTicketsToPaper.emit(ids);
  }
}
