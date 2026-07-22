/**
 * Backtest Run Summary Component
 *
 * Displays run-level aggregate metrics and a sortable list of permutations.
 * Emits user actions on selected permutations and run-level actions.
 */
import { Component, input, output, ChangeDetectionStrategy, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import type { BacktestPermutationUi, BacktestRunUi } from '../../common/backtest.types';
import { computeRunAggregates, type RunAggregateMetrics } from '../../utils/backtest-aggregate.utils';
import { formatBacktestRunId, getBacktestStatusVisuals } from '../../utils/backtest.utils';
import { BacktestEquityCurveComponent, type EquityCurvePoint } from '../backtest-equity-curve/backtest-equity-curve.component';

type SummarySortBy = 'symbol' | 'status' | 'totalReturnPct' | 'tradeCount';

export interface SummaryPermutationRow extends BacktestPermutationUi {
  statusColorName: string;
  statusIconName: string;
}

@Component({
  selector: 'app-backtest-run-summary',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatIconModule, MatTooltipModule, BacktestEquityCurveComponent],
  templateUrl: './backtest-run-summary.component.html',
  styleUrl: './backtest-run-summary.component.scss',
})
export class BacktestRunSummaryComponent {
  readonly run = input<BacktestRunUi | null>(null);
  readonly permutations = input<BacktestPermutationUi[]>([]);
  readonly selectedPermutationId = input<string | null>(null);
  readonly isLoadingPermutations = input<boolean>(false);

  readonly selectPermutation = output<string>();

  private readonly sortBy = signal<SummarySortBy>('symbol');
  private readonly sortDirection = signal<'asc' | 'desc'>('asc');

  readonly aggregates = computed((): RunAggregateMetrics => computeRunAggregates(this.permutations()));

  readonly viewPermutations = computed((): SummaryPermutationRow[] => {
    const permutations = this.permutations().map((p) => ({
      ...p,
      statusColorName: getBacktestStatusVisuals(p.status).color,
      statusIconName: getBacktestStatusVisuals(p.status).icon,
    }));

    const sortBy = this.sortBy();
    const direction = this.sortDirection();
    const sorted = [...permutations].sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'symbol') cmp = a.symbol.localeCompare(b.symbol);
      else if (sortBy === 'status') cmp = a.status.localeCompare(b.status);
      else if (sortBy === 'totalReturnPct') cmp = a.totalReturnPct - b.totalReturnPct;
      else if (sortBy === 'tradeCount') cmp = a.tradeCount - b.tradeCount;
      return direction === 'asc' ? cmp : -cmp;
    });
    return sorted;
  });

  readonly formattedRunId = computed(() => (this.run() ? formatBacktestRunId(this.run()!.runId) : '—'));

  readonly aggregateChartData = computed((): EquityCurvePoint[] => {
    const permutations = this.permutations();
    if (permutations.length === 0) return [];

    const initialCash = this.run()?.initialCash ?? 0;
    const byDate = new Map<string, number>();

    for (const permutation of permutations) {
      for (const point of permutation.equityCurve ?? []) {
        if (!point.date) continue;
        const value = initialCash > 0 ? point.equity - initialCash : point.equity;
        byDate.set(point.date, (byDate.get(point.date) ?? 0) + value);
      }
    }

    const baseline = initialCash > 0 ? initialCash : 0;
    return Array.from(byDate.entries())
      .map(([date, value]) => ({ date: new Date(date), value: value + baseline }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  });

  onSelectPermutation(permutation: SummaryPermutationRow): void {
    this.selectPermutation.emit(permutation.permutationId);
  }

  onSort(by: SummarySortBy): void {
    if (this.sortBy() === by) {
      this.sortDirection.update((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      this.sortBy.set(by);
      this.sortDirection.set('asc');
    }
  }
}
