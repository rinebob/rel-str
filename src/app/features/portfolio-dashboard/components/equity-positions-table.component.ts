/**
 * EquityPositionsTableComponent — table of equity positions with PnL.
 *
 * Columns: Symbol, Quantity, Avg Cost, Entry, Cost Basis, Current Price,
 * Value, PnL, PnL%, Stop, Dist, Peak, Retr% (#1414).
 * Shows loading, error with retry, and empty states. Closed positions
 * (quantity === 0) are filtered out — realized-P&L history is a separate
 * concern from the open-positions view.
 */
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';


import { EquityPositionWithPnL } from '../portfolio-dashboard.types';
import { BrokerOrder } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { PositionPeak } from '../utils/position-peak.util';
import { compareSortable, SortDirection } from '../utils/table-sort.util';

/** Sortable column keys — Actions is intentionally excluded. */
type SortKey =
  | 'symbol'
  | 'quantity'
  | 'avgCost'
  | 'entry'
  | 'costBasis'
  | 'currentPrice'
  | 'value'
  | 'pnl'
  | 'stop'
  | 'peak';

@Component({
  selector: 'app-equity-positions-table',
  standalone: true,
  imports: [],
  templateUrl: './equity-positions-table.component.html',
  styleUrl: './equity-positions-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EquityPositionsTableComponent {
  readonly positions = input<EquityPositionWithPnL[]>([]);
  readonly loading = input(false);
  readonly error = input<string | null>(null);
  /** Symbols with active stop-loss protection — disables the Add Stop button. */
  readonly protectedSymbols = input<Set<string>>(new Set());
  /** Symbols whose protective stop can be updated — swaps Add Stop for Update Stop. */
  readonly updatableSymbols = input<Set<string>>(new Set());
  /** Display stop order per symbol (#1414) — the Stop column's source;
   *  reconciles with Open Orders (same live order). */
  readonly stopOrders = input<Map<string, BrokerOrder>>(new Map());
  /** Peak Since Entry per symbol (#1414) — missing key = still deriving;
   *  `lifetime: null` = underivable → '—'. */
  readonly positionPeaks = input<Record<string, PositionPeak>>({});
  /** Non-null when the peaks derive failed — cells render '—' instead of
   *  spinning '…' forever (review pass 2). */
  readonly peaksError = input<string | null>(null);
  /** Whether the selected account is agent-enabled (controls action button visibility). */
  readonly agenticAllowed = input(true);
  readonly retry = output<void>();
  readonly closePosition = output<EquityPositionWithPnL>();
  /** Emits the position when the user clicks Add Stop. */
  readonly addStopLoss = output<EquityPositionWithPnL>();
  /** Emits the position when the user clicks Update Stop. */
  readonly updateStopLoss = output<EquityPositionWithPnL>();

  /** Open positions only — closed rows are out of scope for this table. */
  readonly visiblePositions = computed(() => this.positions().filter((p) => !p.closed));

  readonly sortKey = signal<SortKey>('symbol');
  readonly sortDir = signal<SortDirection>('asc');

  /** Rows rendered by the table — visible positions in the active sort order. */
  readonly sortedPositions = computed(() => {
    const key = this.sortKey();
    const dir = this.sortDir();
    return [...this.visiblePositions()].sort((a, b) =>
      compareSortable(this.sortValue(a, key), this.sortValue(b, key), dir),
    );
  });

  readonly hasPositions = computed(() => this.visiblePositions().length > 0);

  /** Click a header: first click sorts ascending, repeat toggles direction. */
  setSort(key: SortKey): void {
    if (this.sortKey() === key) {
      this.sortDir.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortKey.set(key);
      this.sortDir.set('asc');
    }
  }

  ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (this.sortKey() !== key) return 'none';
    return this.sortDir() === 'asc' ? 'ascending' : 'descending';
  }

  sortIcon(key: SortKey): string {
    if (this.sortKey() !== key) return 'unfold_more';
    return this.sortDir() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  private sortValue(p: EquityPositionWithPnL, key: SortKey): string | number | null {
    switch (key) {
      case 'symbol': return p.symbol;
      case 'quantity': return p.quantity;
      case 'avgCost': return p.averageBuyPrice;
      case 'entry': return p.entryDate;
      case 'costBasis': return this.costBasis(p);
      case 'currentPrice': return p.currentPrice;
      case 'value': return this.currentValue(p);
      case 'pnl': return p.pnl;
      case 'stop': return this.stopFor(p)?.stopPrice ?? null;
      case 'peak': return this.peakFor(p)?.lifetime?.price ?? null;
    }
  }

  private readonly currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
  });

  private readonly numberFormatter = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 4,
  });

  formatCurrency(value: number | null | undefined): string {
    if (value == null) return '—';
    return this.currencyFormatter.format(value);
  }

  formatNumber(value: number | null | undefined): string {
    if (value == null) return '—';
    return this.numberFormatter.format(value);
  }

  /** ISO timestamp → date-only display (yyyy-MM-dd). */
  formatDate(value: string | null | undefined): string {
    if (!value) return '—';
    const date = value.slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '—';
  }

  formatPnl(value: number | null | undefined): string {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '';
    return sign + this.currencyFormatter.format(value);
  }

  formatPnlPercent(value: number | null | undefined): string {
    if (value == null) return '—';
    const sign = value >= 0 ? '+' : '';
    return sign + value.toFixed(2) + '%';
  }

  /** Cost basis = average buy price × |quantity|. */
  costBasis(pos: EquityPositionWithPnL): number | null {
    if (pos.averageBuyPrice == null || pos.quantity == null) return null;
    return pos.averageBuyPrice * Math.abs(pos.quantity);
  }

  /** Current value = current price × |quantity|. */
  currentValue(pos: EquityPositionWithPnL): number | null {
    if (pos.currentPrice == null || pos.quantity == null) return null;
    return pos.currentPrice * Math.abs(pos.quantity);
  }

  // ── Stop surfacing (#1414) ─────────────────────────────────────────────

  /** The live protective stop for a row's symbol, if any. */
  stopFor(pos: EquityPositionWithPnL): BrokerOrder | undefined {
    return this.stopOrders().get(pos.symbol);
  }

  /** Distance current→stop: negative dollars = stop sits below price. */
  stopDist(pos: EquityPositionWithPnL): { dollars: number; percent: number } | null {
    const stop = this.stopFor(pos)?.stopPrice;
    const cur = pos.currentPrice;
    if (stop == null || cur == null || cur === 0) return null;
    return { dollars: stop - cur, percent: ((stop - cur) / cur) * 100 };
  }

  formatDist(d: { dollars: number; percent: number } | null): string {
    if (!d) return '—';
    return `${this.currencyFormatter.format(d.dollars)} (${d.percent.toFixed(1)}%)`;
  }

  /** Stop-cell tooltip: type · qty · TIF · age (IMPL 219-1403-1405 Phase 3). */
  stopTooltip(order: BrokerOrder): string {
    const type = order.type?.replace(/_/g, '-') ?? 'stop';
    const qty = order.quantity ?? '—';
    const tif = order.timeInForce?.toUpperCase() ?? '—';
    return `${type} · qty ${qty} · ${tif} · since ${this.formatDate(order.createdAt)}`;
  }

  /** Peak Since Entry record — undefined while the derive is still running. */
  peakFor(pos: EquityPositionWithPnL): PositionPeak | undefined {
    return this.positionPeaks()[pos.symbol];
  }

  /** True while the symbol's peak is still being derived — and the derive
   *  hasn't failed (a failure settles to '—', not a perpetual '…'). */
  peakPending(pos: EquityPositionWithPnL): boolean {
    return this.peaksError() === null && this.peakFor(pos) === undefined;
  }

  /** % pulled back from the peak — positive = drawdown, negative = new high. */
  retraced(pos: EquityPositionWithPnL): number | null {
    const peak = this.peakFor(pos)?.lifetime?.price;
    const cur = pos.currentPrice;
    if (peak == null || peak === 0 || cur == null) return null;
    return ((peak - cur) / peak) * 100;
  }

  formatRetraced(value: number | null): string {
    if (value == null) return '—';
    return value.toFixed(1) + '%';
  }

  /** Sum of cost basis across visible positions. */
  readonly totalCostBasis = computed(() => {
    let total = 0;
    let has = false;
    for (const p of this.visiblePositions()) {
      const cb = this.costBasis(p);
      if (cb != null) { total += cb; has = true; }
    }
    return has ? total : null;
  });

  /** Sum of current value across visible positions. */
  readonly totalValue = computed(() => {
    let total = 0;
    let has = false;
    for (const p of this.visiblePositions()) {
      const cv = this.currentValue(p);
      if (cv != null) { total += cv; has = true; }
    }
    return has ? total : null;
  });

  /** Sum of PnL across visible positions. */
  readonly totalPnL = computed(() => {
    let total = 0;
    let has = false;
    for (const p of this.visiblePositions()) {
      if (p.pnl != null) { total += p.pnl; has = true; }
    }
    return has ? total : null;
  });

  /** Weighted-average PnL% = total PnL / total cost basis. */
  readonly avgPnlPercent = computed(() => {
    const pnl = this.totalPnL();
    const cost = this.totalCostBasis();
    if (pnl == null || cost == null || cost === 0) return null;
    return (pnl / cost) * 100;
  });
}
