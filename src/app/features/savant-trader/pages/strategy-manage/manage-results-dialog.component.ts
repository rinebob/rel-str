import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  DS_DIALOG_DATA,
  DsDialogRef,
} from '../../../../shared/ds/ds-dialog';
import { OptionsStrategyService } from '../../services/options-strategy.service';
import { PaperTradingService } from '../../services/paper-trading.service';
import {
  OPTIONS_POSITION_STATUS_LABELS,
  type Position,
} from '../../services/options-strategy.types';
import type { ManageInstance } from '@manage/instance-contracts';
import type { PaperStats } from '@paper-trading/contracts';
import { statsScopeInstance } from '@paper-trading/ids';
import { AppRoutes } from '../../../../core/common/interfaces';

/**
 * @task #1549 — FE: Results summary popup. Per-instance stats block +
 *  open-position summary + compact equity sparkline, backed by the
 *  existing `getPaperStats` (scope 'inst-{id}' — the engine writes one
 *  stats doc per instance scope, carrying `equityCurve`) and
 *  `listStrategyPositions` (instanceId filter) callables. The Analysis
 *  action opens the backtest analysis route in a new tab.
 */

export interface ResultsDialogData {
  instance: ManageInstance;
}

const SPARK_W = 200;
const SPARK_H = 40;

@Component({
  selector: 'app-manage-results-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 class="title">Results — {{ data.instance.id }}</h2>
    <div class="content">
      @if (statsError()) {
        <p class="error-text" data-testid="stats-error">Failed to load results</p>
      } @else if (!statsLoaded()) {
        <p class="hint" data-testid="stats-loading">Loading results…</p>
      } @else if (!stats()) {
        <p class="hint" data-testid="stats-empty">No results yet — the
          instance has no stats doc (nothing has run).</p>
      } @else {
        <div class="stats-grid" data-testid="stats-block">
          @if (stats(); as s) {
            <div class="stat"><span class="stat-label">Realized P&L</span>
              <span class="stat-value" data-testid="stat-realized">{{ fmt(s.totalRealizedPnl) }}</span></div>
            <div class="stat"><span class="stat-label">Unrealized P&L</span>
              <span class="stat-value" data-testid="stat-unrealized">{{ fmt(s.totalUnrealizedPnl) }}</span></div>
            <div class="stat"><span class="stat-label">Premium collected</span>
              <span class="stat-value" data-testid="stat-premium">{{ fmt(s.totalPremiumCollected) }}</span></div>
            <div class="stat"><span class="stat-label">Open trades</span>
              <span class="stat-value" data-testid="stat-open-count">{{ s.openTradeCount ?? '—' }}</span></div>
            <div class="stat"><span class="stat-label">Closed trades</span>
              <span class="stat-value" data-testid="stat-closed-count">{{ s.closedTradeCount ?? '—' }}</span></div>
            <div class="stat"><span class="stat-label">Max drawdown</span>
              <span class="stat-value" data-testid="stat-max-dd">{{ fmt(s.maxDrawdown) }}</span></div>
          }
        </div>
        @if (sparkPoints()) {
          <svg class="sparkline" data-testid="equity-sparkline"
               [attr.viewBox]="'0 0 ' + sparkW + ' ' + sparkH"
               role="img" aria-label="Equity curve">
            <polyline [attr.points]="sparkPoints()" fill="none"
                      stroke="currentColor" stroke-width="1.5" />
          </svg>
        }
      }

      <h3 class="section-head">Open positions</h3>
      @if (positionsError()) {
        <p class="error-text" data-testid="positions-error">Failed to load positions</p>
      } @else if (!positionsLoaded()) {
        <p class="hint" data-testid="positions-loading">Loading positions…</p>
      } @else if (!positions().length) {
        <p class="hint" data-testid="positions-empty">No open positions.</p>
      } @else {
        <div class="positions">
          @for (p of positions(); track p.id) {
            <div class="position-row" data-testid="position-row">
              <span class="pos-symbol">{{ p.symbol }}</span>
              <span class="pos-meta">{{ statusLabel(p) }}</span>
              <span class="pos-meta">{{ p.legs?.length ?? '—' }} legs</span>
              <span class="pos-meta">premium {{ fmt(p.premiumCollected) }}</span>
              <span class="pos-meta">uP&L {{ fmt(p.unrealizedPnl) }}</span>
            </div>
          }
        </div>
      }
    </div>
    <div class="actions" align="end">
      <button class="ds-btn outline" type="button" data-testid="close-btn"
              (click)="ref.close()">Close</button>
      <button class="ds-btn fill" type="button" data-testid="analysis-btn"
              (click)="openAnalysis()">Analysis</button>
    </div>
  `,
  styleUrl: './manage-results-dialog.component.scss',
})
export class ManageResultsDialogComponent {
  protected readonly ref = inject(DsDialogRef);
  protected readonly data = inject(DS_DIALOG_DATA) as ResultsDialogData;
  protected readonly sparkW = SPARK_W;
  protected readonly sparkH = SPARK_H;

  protected readonly stats = signal<PaperStats | null>(null);
  protected readonly positions = signal<Position[]>([]);
  protected readonly statsError = signal(false);
  protected readonly positionsError = signal(false);
  protected readonly statsLoaded = signal(false);
  protected readonly positionsLoaded = signal(false);

  /** Compact sparkline points "x,y x,y …" — normalized to the viewBox
   *  with a 1px inset so a flat curve doesn't sit on the border; null
   *  until the curve has at least two finite points (increment-minted
   *  stats docs carry no `equityCurve` until the nightly recompute). */
  protected readonly sparkPoints = computed(() => {
    const curve = (this.stats()?.equityCurve ?? []).filter((p) =>
      Number.isFinite(p.cumulativePnl),
    );
    if (curve.length < 2) return null;
    const ys = curve.map((p) => p.cumulativePnl);
    const lo = Math.min(...ys);
    const span = Math.max(...ys) - lo || 1;
    return curve
      .map((p, i) => {
        const x = (i / (curve.length - 1)) * (SPARK_W - 2) + 1;
        const y = SPARK_H - 1 - ((p.cumulativePnl - lo) / span) * (SPARK_H - 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  });

  constructor() {
    const id = this.data.instance?.id ?? '';
    inject(PaperTradingService)
      .getPaperStats$({ scope: statsScopeInstance(id) })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (res) => {
          this.stats.set(res.stats[0] ?? null);
          this.statsLoaded.set(true);
        },
        error: () => {
          this.statsError.set(true);
          this.statsLoaded.set(true);
        },
      });
    inject(OptionsStrategyService)
      .listStrategyPositions$({ instanceId: id })
      .pipe(takeUntilDestroyed())
      .subscribe({
        next: (res) => {
          this.positions.set(res.openPositions);
          this.positionsLoaded.set(true);
        },
        error: () => {
          this.positionsError.set(true);
          this.positionsLoaded.set(true);
        },
      });
  }

  /** Non-finite-safe formatter — increment-minted stats docs carry no
   *  scalar P&L fields until the nightly recompute heals them. */
  protected fmt(n: number | undefined): string {
    return Number.isFinite(n) ? (n as number).toFixed(2) : '—';
  }

  protected statusLabel(p: Position): string {
    return OPTIONS_POSITION_STATUS_LABELS[p.status] ?? p.status;
  }

  /** US-7: analysis opens in a new tab so the manage page state survives.
   *  The instance id IS the contract-list doc id (PRD US-7). */
  protected openAnalysis(): void {
    const path = AppRoutes.STRATEGY_BACKTEST_ANALYSIS.replace(
      ':listDocId',
      encodeURIComponent(this.data.instance?.id ?? ''),
    );
    window.open('/' + path, '_blank');
  }
}
