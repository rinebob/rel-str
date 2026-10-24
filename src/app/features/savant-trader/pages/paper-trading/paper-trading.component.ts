/**
 * @topic #553 — Paper Trading Infra | @task #569, #1067, #671
 *
 * Paper trading dashboard. Reads the paper ledger via PaperTradingStore
 * (listPaperTrades / getPaperAccount) — client-side
 * group-by over the loaded trade list, expandable cohort sections,
 * account header (negative cash visible).
 * #1067: sortable columns + sticky table headers; equity curve removed
 * (forensics surface moves to the trade-analysis work, Thread #1059).
 * #671: per-row close/cancel actions (confirm dialog + acting spinner),
 * status chips, and the status filter select.
 */
import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';

import { PaperTradingStore } from '../../stores/paper-trading.store';
import {
  PaperTradeActionDialogComponent,
  type PaperTradeAction,
} from '../../components/paper-trade-action-dialog/paper-trade-action-dialog.component';
import { AppRoutes } from '../../../../core/common/interfaces';
import { LIFECYCLE_OPEN_TRADE_STATUSES, PaperTradeStatus } from '@paper-trading/contracts';
import type { PaperTrade } from '@paper-trading/contracts';

export type GroupByKey =
  | 'all' | 'instance' | 'cohort' | 'variant' | 'expression' | 'symbol'
  | 'signalType' | 'direction' | 'sector' | 'industry' | 'capTier' | 'signalStatus';

export type SortKey =
  | 'id' | 'symbol' | 'expression' | 'status' | 'qty' | 'variant'
  | 'realized' | 'unrealized';

type SortDir = 'asc' | 'desc';

/** Per-dimension config: the store grouping and an optional header label
 *  for dims whose raw keys need context ("Direction: long"). One table —
 *  a new dim touches one entry. */
interface GroupDim {
  label?: string;
  map: () => Map<string, PaperTrade[]>;
}

export interface TradeGroup {
  key: string;
  trades: PaperTrade[];
  realizedPnl: number;
  unrealizedPnl: number;
  openCount: number;
  pendingCount: number;
}

function toTradeGroup(key: string, trades: PaperTrade[]): TradeGroup {
  let realized = 0;
  let unrealized = 0;
  let openCount = 0;
  let pendingCount = 0;
  for (const t of trades) {
    realized += t.realizedPnl;
    unrealized += t.unrealizedPnl;
    if (t.status === PaperTradeStatus.OPEN || t.status === PaperTradeStatus.ASSIGNED) openCount += 1;
    if (t.status === PaperTradeStatus.PENDING) pendingCount += 1;
  }
  return { key, trades, realizedPnl: realized, unrealizedPnl: unrealized, openCount, pendingCount };
}

@Component({
  selector: 'app-paper-trading',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatFormFieldModule,
    RouterLink,
  ],
  templateUrl: './paper-trading.component.html',
  styleUrl: './paper-trading.component.scss',
})
export class PaperTradingComponent implements OnInit {
  readonly store = inject(PaperTradingStore);
  private readonly dialog = inject(MatDialog);
  protected readonly appRoutes = AppRoutes;

  /** Group-by dimension for the trades table. */
  readonly groupBy = signal<GroupByKey>('all');

  /** Status filter options — 'ALL' clears the server-side request;
   *  every PaperTradeStatus (incl. CANCELLED) is a selectable entry so
   *  cancelled trades are findable (#671). */
  protected readonly STATUS_OPTIONS: (PaperTradeStatus | 'ALL')[] = [
    'ALL',
    PaperTradeStatus.PENDING,
    PaperTradeStatus.OPEN,
    PaperTradeStatus.ASSIGNED,
    PaperTradeStatus.CLOSED,
    PaperTradeStatus.EXPIRED,
    PaperTradeStatus.CANCELLED,
  ];

  /** Active column sorts, in priority order — plain click replaces the
   *  list with a single sort; shift+click toggles a secondary key in or
   *  out of the chain (asc → desc → remove). */
  readonly sorts = signal<{ key: SortKey; dir: SortDir }[]>([]);

  /** Cohort section expanded open (cohortId), or null — cohort sections
   *  render collapsed (header + stats only) until toggled. */
  readonly selectedCohort = signal<string | null>(null);

  /** Table columns — label + sort accessor; the thead iterates this. */
  protected readonly COLUMNS: { key: SortKey; label: string; acc: (t: PaperTrade) => string | number }[] = [
    { key: 'id', label: 'ID', acc: (t) => t.id },
    { key: 'symbol', label: 'Symbol', acc: (t) => t.symbol },
    { key: 'expression', label: 'Expr', acc: (t) => t.expression },
    { key: 'status', label: 'Status', acc: (t) => t.status },
    { key: 'qty', label: 'Qty', acc: (t) => t.order.quantity },
    { key: 'variant', label: 'Variant', acc: (t) => t.governingVariant },
    { key: 'realized', label: 'Realized', acc: (t) => t.realizedPnl },
    { key: 'unrealized', label: 'Unrealized', acc: (t) => t.unrealizedPnl },
  ];

  /** One row per groupable dimension — drives groupedTrades and the group
   *  header label. */
  private readonly GROUP_DIMS: Partial<Record<GroupByKey, GroupDim>> = {
    instance: { map: () => this.store.tradesByInstance() },
    cohort: { map: () => this.store.tradesByCohort() },
    variant: { map: () => this.store.tradesByVariant() },
    expression: { map: () => this.store.tradesByExpression() },
    symbol: { map: () => this.store.tradesBySymbol() },
    signalType: { label: 'Signal Type', map: () => this.store.tradesBySignalType() },
    direction: { label: 'Direction', map: () => this.store.tradesByDirection() },
    sector: { label: 'Sector', map: () => this.store.tradesBySector() },
    industry: { label: 'Industry', map: () => this.store.tradesByIndustry() },
    capTier: { label: 'Cap Tier', map: () => this.store.tradesByCapTier() },
    signalStatus: { label: 'Signal Status', map: () => this.store.tradesBySignalStatus() },
  };

  /** Dimension label for group card headers, or null to show the raw key. */
  protected readonly dimLabel = computed(() => this.GROUP_DIMS[this.groupBy()]?.label ?? null);

  ngOnInit(): void {
    this.store.loadAll();
  }

  // ── Grouping + sorting ────────────────────────────────────────────────────

  /** Trades grouped per the selected dimension, each group's rows sorted
   *  per the active column sort. The store's tradesBy* computeds return
   *  Maps — iterate .entries(), not Object.entries. */
  readonly groupedTrades = computed<TradeGroup[]>(() => {
    const map =
      this.GROUP_DIMS[this.groupBy()]?.map()
      ?? new Map<string, PaperTrade[]>([['all', this.store.trades()]]);
    const sorts = this.sorts();
    const accFor = (key: SortKey) => this.COLUMNS.find((c) => c.key === key)!.acc;
    const sortTrades = (trades: PaperTrade[]): PaperTrade[] => {
      if (!sorts.length) return trades;
      return [...trades].sort((a, b) => {
        for (const s of sorts) {
          const acc = accFor(s.key);
          const va = acc(a);
          const vb = acc(b);
          const cmp =
            typeof va === 'number' && typeof vb === 'number'
              ? va - vb
              : String(va).localeCompare(String(vb));
          if (cmp !== 0) return (s.dir === 'asc' ? 1 : -1) * cmp;
        }
        return 0;
      });
    };
    return [...map.entries()]
      .map(([key, trades]) => toTradeGroup(key, sortTrades(trades)))
      .sort((a, b) => b.trades.length - a.trades.length || a.key.localeCompare(b.key));
  });

  // ── Account header ────────────────────────────────────────────────────────

  /** Unrealized P&L — the account doc has none, so sum the open trades. */
  readonly unrealizedPnl = computed(() =>
    this.store.openTrades().reduce((s, t) => s + t.unrealizedPnl, 0),
  );

  /** Capital required across lifecycle-active trades only — closed
   *  trades released their margin back to cash already. */
  readonly capitalRequired = computed(() =>
    this.store
      .trades()
      .filter((t) => LIFECYCLE_OPEN_TRADE_STATUSES.has(t.status))
      .reduce((s, t) => s + (t.capitalRequired ?? 0), 0),
  );

  // ── Template helpers ──────────────────────────────────────────────────────

  /** Header click: same column cycles asc → desc → removed; a new column
   *  starts asc. Shift+click (additive) keeps the existing sort chain and
   *  toggles this column as a lower-priority key. */
  toggleSort(key: SortKey, ev?: MouseEvent | KeyboardEvent | Event | boolean): void {
    const additive =
      typeof ev === 'boolean' ? ev
      : ev instanceof MouseEvent || ev instanceof KeyboardEvent ? ev.shiftKey
      : false;
    const cur = this.sorts();
    const i = cur.findIndex((s) => s.key === key);
    if (!additive) {
      // Plain click keeps only this column; cycles asc → desc → unsorted.
      this.sorts.set(
        i === -1 ? [{ key, dir: 'asc' }]
        : cur[i].dir === 'asc' ? [{ key, dir: 'desc' }]
        : [],
      );
      return;
    }
    const list = [...cur];
    if (i === -1) list.push({ key, dir: 'asc' });
    else if (list[i].dir === 'asc') list[i] = { key, dir: 'desc' };
    else list.splice(i, 1);
    this.sorts.set(list);
  }

  /** Header indicator: mat-icon name for the active column, '' otherwise
   *  (same convention as swing-table's sortIcon). */
  sortIcon(key: SortKey): string {
    const s = this.sorts().find((x) => x.key === key);
    return s ? (s.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : '';
  }

  /** aria-sort value for the column header. */
  sortAria(key: SortKey): 'ascending' | 'descending' | 'none' {
    const s = this.sorts().find((x) => x.key === key);
    return s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  /** 1-based priority badge — shown only when multiple sorts are active. */
  sortRank(key: SortKey): number | null {
    const list = this.sorts();
    if (list.length < 2) return null;
    const i = list.findIndex((s) => s.key === key);
    return i === -1 ? null : i + 1;
  }

  toggleCohort(cohortId: string): void {
    this.selectedCohort.set(this.selectedCohort() === cohortId ? null : cohortId);
  }

  // ── Row actions + status filter (#671) ──────────────────────────────────

  /** Status → row action. Only statuses with an action get a button —
   *  the domain rule "OPEN closes, PENDING cancels, terminal does
   *  nothing" lives here as data, not a template if-chain. */
  protected readonly ROW_ACTIONS: Partial<
    Record<
      PaperTradeStatus,
      { action: PaperTradeAction; icon: string; title: string; testId: string }
    >
  > = {
    [PaperTradeStatus.OPEN]: {
      action: 'close',
      icon: 'exit_to_app',
      title: 'Close at the live quote',
      testId: 'close-trade',
    },
    [PaperTradeStatus.PENDING]: {
      action: 'cancel',
      icon: 'cancel',
      title: 'Cancel before fill',
      testId: 'cancel-trade',
    },
  };

  /** Status filter change — 'ALL' clears the request; otherwise sets the
   *  single-status filter the store sends to listPaperTrades. */
  onStatusFilter(value: PaperTradeStatus | 'ALL'): void {
    this.store.setTradeFilters(value === 'ALL' ? {} : { status: value });
  }

  /** Row action → confirm dialog. The dialog owns the mutation + spinner;
   *  the row just opens it. One dialog at a time — suppressed while ANY
   *  dialog is open (app-wide `MatDialog.openDialogs`, deliberately
   *  conservative: stacking a second confirm serves no use case). */
  openActionDialog(trade: PaperTrade, action: PaperTradeAction): void {
    if (this.dialog.openDialogs.length > 0) return;
    this.dialog.open(PaperTradeActionDialogComponent, {
      data: { trade, action },
      width: '420px',
      autoFocus: false,
    });
  }
}
