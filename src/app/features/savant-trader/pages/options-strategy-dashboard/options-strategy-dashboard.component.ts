/**
 * @topic #137 — Strategy Builder UI
 *
 * Dashboard component for the options strategy engine. Shows open/closed
 * position tables and an equity curve chart with per-symbol/combined toggle.
 * Follows the existing DashboardComponent pattern.
 */

import { Component, ChangeDetectionStrategy, inject, OnInit, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatFormFieldModule } from '@angular/material/form-field';
import { RouterLink } from '@angular/router';
import {
  ChartModule,
  LineSeriesService,
  DateTimeService,
  TooltipService,
  LegendService,
} from '@syncfusion/ej2-angular-charts';

import { OptionsStrategyDashboardStore } from '../../stores/options-strategy-dashboard.store';
import { AppRoutes } from '../../../../core/common/interfaces';
import {
  OPTIONS_POSITION_STATUS_LABELS,
  type Position,
  type PositionLeg,
} from '../../services/options-strategy.types';

// ── Chart point transform ────────────────────────────────────────────────────

interface ChartPoint {
  date: Date;
  value: number;
}

export function toChartPoints(
  points: { date: string; cumulativePnl: number }[],
): ChartPoint[] {
  return points
    .filter((p) => p.date)
    .map((p) => ({ date: new Date(p.date), value: p.cumulativePnl }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'app-options-strategy-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatFormFieldModule,
    RouterLink,
    ChartModule,
  ],
  providers: [
    LineSeriesService,
    DateTimeService,
    TooltipService,
    LegendService,
  ],
  templateUrl: './options-strategy-dashboard.component.html',
  styleUrl: './options-strategy-dashboard.component.scss',
})
export class OptionsStrategyDashboardComponent implements OnInit {
  readonly store = inject(OptionsStrategyDashboardStore);
  protected readonly appRoutes = AppRoutes;

  // Chart config
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

  // ── Template helpers ───────────────────────────────────────────────────────

  /** Transform equity curve points for the chart. */
  readonly chartPoints = computed(() => toChartPoints(this.store.equityCurve()));

  /** DTE remaining from expiration date string. */
  dteRemaining(expiration: string | undefined): number | null {
    if (!expiration) return null;
    const exp = new Date(expiration);
    const now = new Date();
    const diffMs = exp.getTime() - now.getTime();
    return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  }

  /** Format expiration as "Fri 09/12" instead of full ISO string. */
  formatDate(expiration: string | undefined): string {
    if (!expiration) return '—';
    const d = new Date(expiration);
    const dow = d.toLocaleDateString('en-US', { weekday: 'short' });
    const date = d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
    return `${dow} ${date}`;
  }

  /** Format currency for display. */
  currency(value: number | undefined): string {
    if (value == null) return '—';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(value);
  }

  /** Human-readable status label. */
  statusLabel(pos: Position): string {
    return OPTIONS_POSITION_STATUS_LABELS[pos.status] ?? pos.status;
  }

  /** Primary leg (first leg) for strike/expiration display. */
  primaryLeg(pos: Position): PositionLeg | null {
    return pos.legs?.[0] ?? null;
  }

  /** Realized P&L for a closed position. */
  realizedPnl(pos: Position): number {
    return pos.realizedPnl ?? pos.premiumCollected;
  }
}
