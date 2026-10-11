/**
 * @topic #553 — Paper Trading Infra | @task #569
 *
 * Paper trading dashboard. Reads the paper ledger via PaperTradingStore
 * (listPaperTrades / getPaperStats / getPaperAccount) — client-side
 * group-by over the loaded trade list, cohort drill-down with
 * variant-run outcomes, account header (negative cash visible).
 */
import { Component, ChangeDetectionStrategy, OnInit, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import {
  ChartModule,
  LineSeriesService,
  DateTimeService,
  TooltipService,
  LegendService,
} from '@syncfusion/ej2-angular-charts';

import { PaperTradingStore } from '../../stores/paper-trading.store';
import { AppRoutes } from '../../../../core/common/interfaces';
import type { PaperTrade, PaperTradeLeg, VariantRun } from '@paper-trading/contracts';
import {
  statsScopeCohort,
  statsScopeInstance,
  statsScopeSymbol,
  statsScopeVariant,
  statsScopeSignalType,
  statsScopeDirection,
  statsScopeSector,
  statsScopeIndustry,
  statsScopeCapTier,
  statsScopeSignalStatus,
} from '@paper-trading/ids';
import { TradeSide } from '@common';

export type GroupByKey =
  | 'all' | 'instance' | 'cohort' | 'variant' | 'expression' | 'symbol'
  | 'signalType' | 'direction' | 'sector' | 'industry' | 'capTier' | 'signalStatus';

/** Group keys that carry no stats scope — unstamped ('—') and legacy
 *  ungrouped ('none') buckets skip the equity-curve repivot. */
const NO_SCOPE_KEYS = new Set(['—', 'none']);

/** Per-dimension config: the store grouping, the stats-scope builder
 *  (absent for dims with no stats doc — 'all', 'expression'), and an
 *  optional header label for dims whose raw keys need context
 *  ("Direction: long"). One table — a new dim touches one entry. */
interface GroupDim {
  label?: string;
  map: () => Map<string, PaperTrade[]>;
  scope?: (key: string) => string;
}

export interface TradeGroup {
  key: string;
  trades: PaperTrade[];
  realizedPnl: number;
  unrealizedPnl: number;
  openCount: number;
  pendingCount: number;
}

interface ChartPoint {
  date: Date;
  value: number;
}

/** Convert stats equity-curve points to chart points. */
export function toChartPoints(
  points: { date: string; cumulativePnl: number }[] | undefined,
): ChartPoint[] {
  return (points ?? [])
    .filter((p) => p.date)
    .map((p) => ({ date: new Date(p.date), value: p.cumulativePnl }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

function toTradeGroup(key: string, trades: PaperTrade[]): TradeGroup {
  let realized = 0;
  let unrealized = 0;
  let openCount = 0;
  let pendingCount = 0;
  for (const t of trades) {
    realized += t.realizedPnl;
    unrealized += t.unrealizedPnl;
    if (t.status === 'OPEN') openCount += 1;
    if (t.status === 'PENDING') pendingCount += 1;
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
    MatTooltipModule,
    RouterLink,
    ChartModule,
  ],
  providers: [LineSeriesService, DateTimeService, TooltipService, LegendService],
  templateUrl: './paper-trading.component.html',
  styleUrl: './paper-trading.component.scss',
})
export class PaperTradingComponent implements OnInit {
  readonly store = inject(PaperTradingStore);
  protected readonly appRoutes = AppRoutes;

  /** Group-by dimension for the trades table. */
  readonly groupBy = signal<GroupByKey>('all');

  /** Stats scope for the equity curve — 'all' or a per-dimension scope key. */
  readonly statsScope = signal<string>('all');

  /** Cohort open in the drill-down panel (cohortId), or null. */
  readonly selectedCohort = signal<string | null>(null);

  /** One row per groupable dimension — drives groupedTrades, the group
   *  header label, and the scope-jump button. */
  private readonly GROUP_DIMS: Partial<Record<GroupByKey, GroupDim>> = {
    instance: { map: () => this.store.tradesByInstance(), scope: statsScopeInstance },
    cohort: { map: () => this.store.tradesByCohort(), scope: statsScopeCohort },
    variant: { map: () => this.store.tradesByVariant(), scope: statsScopeVariant },
    expression: { map: () => this.store.tradesByExpression() },
    symbol: { map: () => this.store.tradesBySymbol(), scope: statsScopeSymbol },
    signalType: { label: 'Signal Type', map: () => this.store.tradesBySignalType(), scope: statsScopeSignalType },
    direction: { label: 'Direction', map: () => this.store.tradesByDirection(), scope: (k) => statsScopeDirection(k as TradeSide) },
    sector: { label: 'Sector', map: () => this.store.tradesBySector(), scope: statsScopeSector },
    industry: { label: 'Industry', map: () => this.store.tradesByIndustry(), scope: statsScopeIndustry },
    capTier: { label: 'Cap Tier', map: () => this.store.tradesByCapTier(), scope: statsScopeCapTier },
    signalStatus: { label: 'Signal Status', map: () => this.store.tradesBySignalStatus(), scope: statsScopeSignalStatus },
  };

  /** Dimension label for group card headers, or null to show the raw key. */
  protected readonly dimLabel = computed(() => this.GROUP_DIMS[this.groupBy()]?.label ?? null);

  // Chart config (same Syncfusion setup as the options dashboard).
  readonly primaryXAxis = {
    valueType: 'DateTime' as const,
    labelFormat: 'MMM d',
    majorGridLines: { width: 0 },
  };
  readonly primaryYAxis = {
    labelFormat: '${value}',
    rangePadding: 'Round' as const,
  };
  readonly tooltip = { enable: true };
  readonly animation = { enable: false };

  ngOnInit(): void {
    this.store.loadAll();
  }

  // ── Grouping ──────────────────────────────────────────────────────────────

  /** Trades grouped per the selected dimension. The store's tradesBy*
   *  computeds return Maps — iterate .entries(), not Object.entries. */
  readonly groupedTrades = computed<TradeGroup[]>(() => {
    const map =
      this.GROUP_DIMS[this.groupBy()]?.map()
      ?? new Map<string, PaperTrade[]>([['all', this.store.trades()]]);
    return [...map.entries()]
      .map(([key, trades]) => toTradeGroup(key, trades))
      .sort((a, b) => b.trades.length - a.trades.length || a.key.localeCompare(b.key));
  });

  /** Cohort's trades grouped by expression (drill-down view). */
  readonly cohortExpressions = computed<{ expression: string; trades: PaperTrade[] }[]>(() => {
    const cohortId = this.selectedCohort();
    if (!cohortId) return [];
    const byExpression = new Map<string, PaperTrade[]>();
    for (const t of this.store.trades().filter((x) => x.cohortId === cohortId)) {
      const key = t.expression ?? '—';
      const list = byExpression.get(key) ?? [];
      list.push(t);
      byExpression.set(key, list);
    }
    return [...byExpression.entries()]
      .map(([expression, trades]) => ({ expression, trades }))
      .sort((a, b) => a.expression.localeCompare(b.expression));
  });

  // ── Account header ────────────────────────────────────────────────────────

  /** Unrealized P&L — the account doc has none, so sum the open trades. */
  readonly unrealizedPnl = computed(() =>
    this.store.openTrades().reduce((s, t) => s + t.unrealizedPnl, 0),
  );

  /** Capital required across open/pending trades only — closed trades
   *  released their margin back to cash already. */
  readonly capitalRequired = computed(() =>
    this.store
      .trades()
      .filter((t) => t.status === 'OPEN' || t.status === 'PENDING')
      .reduce((s, t) => s + (t.capitalRequired ?? 0), 0),
  );

  // ── Equity curve ──────────────────────────────────────────────────────────

  /** Effective scope — falls back to 'all' when the selected scope no
   *  longer exists in the stats set (e.g. after a reload). */
  readonly effectiveScope = computed(() => {
    const scopes = this.store.statsByScope();
    return this.statsScope() in scopes ? this.statsScope() : 'all';
  });

  /** Stats doc for the selected scope (equity curve source). */
  readonly scopedStats = computed(() => this.store.statsByScope()[this.effectiveScope()] ?? null);

  readonly chartPoints = computed(() => toChartPoints(this.scopedStats()?.equityCurve));

  /** Stable scope list for the scope selector (sorted, 'all' first). */
  readonly scopeOptions = computed(() =>
    this.store.statsList().map((s) => s.scope).sort((a, b) =>
      a === 'all' ? -1 : b === 'all' ? 1 : a.localeCompare(b),
    ),
  );

  // ── Template helpers ──────────────────────────────────────────────────────

  /** Stats scope for a group key under the active dimension, or null when
   *  the dim has no scope mapping, the key is a placeholder ('—'/'none'),
   *  or the scope builder rejects the key. The template uses the same
   *  check to hide the jump button, so a rendered button always repivots. */
  scopeForGroup(key: string): string | null {
    const fn = this.GROUP_DIMS[this.groupBy()]?.scope;
    if (!fn || NO_SCOPE_KEYS.has(key)) return null;
    try {
      return fn(key);
    } catch {
      return null; // un-sluggable key (scopeSlug throws on empty slugs)
    }
  }

  /** Point the equity-curve scope at a group (couples group-by selection
   *  to the chart per AC "repivots trades + curve per dimension"). */
  selectGroupScope(key: string): void {
    const scope = this.scopeForGroup(key);
    if (scope) this.statsScope.set(scope);
  }

  currency(value: number | undefined): string {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
  }

  /** Legs summary for the drill-down — "long 1x100 @0.42→0.55". */
  legsSummary(trade: PaperTrade): string {
    if (!trade.legs?.length) return '—';
    return trade.legs
      .map((l: PaperTradeLeg) => `${l.side} ${l.quantity}×${l.multiplier} @${l.entryMark}→${l.lastMark}`)
      .join(', ');
  }

  /** Latest mark date + price, or '—' when unmarked. */
  lastMark(trade: PaperTrade): string {
    const dates = Object.keys(trade.marks ?? {}).sort();
    if (!dates.length) return '—';
    const day = dates[dates.length - 1];
    const mark = trade.marks[day]?.mark;
    return mark != null ? `${day} @ $${mark.toFixed(2)}` : day;
  }

  /** Variant outcome label for the drill-down (exit event or ACTIVE). */
  variantOutcome(run: VariantRun): string {
    if (run.exitEvent) {
      const e = run.exitEvent;
      const pnl = e.pnl >= 0 ? `+$${e.pnl.toFixed(2)}` : `-$${Math.abs(e.pnl).toFixed(2)}`;
      return `${e.date} @ $${e.price.toFixed(2)} (${e.daysHeld}d, ${pnl})`;
    }
    return 'active';
  }

  toggleCohort(cohortId: string): void {
    this.selectedCohort.set(this.selectedCohort() === cohortId ? null : cohortId);
  }
}
