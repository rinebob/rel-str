/**
 * Analysis stats block (Thread #1059, task #1084) — metric grid +
 * per-signalType breakdown over the workbench's filtered row set.
 * Input-driven (no store dep) like the table; the math lives in
 * analysis-stats.util (pure + spec'd).
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import type { TradeAnalysisRow } from '@paper-trading/analysis';
import { computeAnalysisStats } from '../../utils/analysis-stats.util';

@Component({
  selector: 'app-analysis-stats',
  standalone: true,
  templateUrl: './analysis-stats.component.html',
  styleUrl: './analysis-stats.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisStatsComponent {
  rows = input.required<TradeAnalysisRow[]>();

  protected readonly stats = computed(() => computeAnalysisStats(this.rows()));

  protected fmt(v: number | null, digits = 2, suffix = ''): string {
    if (v === null) return '—';
    if (v === Infinity) return '∞';
    return `${v.toFixed(digits)}${suffix}`;
  }

  protected pctCls(v: number | null): string {
    if (v === null || v === 0) return '';
    return v > 0 ? 'positive' : 'negative';
  }
}
