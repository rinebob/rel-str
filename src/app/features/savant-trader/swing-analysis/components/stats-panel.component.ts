/**
 * StatsPanelComponent — distribution summary + histograms for ZigZag swings.
 *
 * Renders distribution summary (mean, median, std dev, percentiles, min, max)
 * per direction, plus magnitude % and duration histograms using Syncfusion
 * column charts. Only confirmed swings are included (stats are pre-filtered
 * by computeSwingStats).
 *
 * Dual mode: when `statsSets` is non-null the panel shows a Large / Small /
 * All segmented toggle. `statsSets` is `[large, small, all]` — indices 0/1
 * are the per-config stats, index 2 is the precomputed combined stats.
 * The toggle selection is component state only (not persisted).
 *
 * Note: `input()` signals are not recognized in this repo's Jest setup
 * (jest-preset-angular). Inputs use `@Input()` decorators mirrored into
 * private signals via `OnChanges` so `computed()` reactivity works.
 */
import { ChangeDetectionStrategy, Component, computed, Input, OnChanges, signal, SimpleChanges } from '@angular/core';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import {
  ChartModule,
  ColumnSeriesService,
  CategoryService,
  TooltipService,
  LegendService,
} from '@syncfusion/ej2-angular-charts';

import type { SwingStats, DistributionSummary, Histogram, DirectionStats } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';

interface HistogramPoint {
  label: string;
  count: number;
}

/** Stats source in dual mode — maps to StatsSets via STATS_MODE_INDEX. */
export type StatsMode = 'large' | 'small' | 'all';

/** Dual-mode stats sets — [large, small, all]. Index 0/1 are per-config
 *  stats, index 2 is the combined stats recomputed from merged swings. */
export type StatsSets = [SwingStats | null, SwingStats | null, SwingStats | null];

const STATS_MODE_INDEX: Record<StatsMode, 0 | 1 | 2> = { large: 0, small: 1, all: 2 };

@Component({
  selector: 'app-stats-panel',
  standalone: true,
  imports: [ChartModule, MatProgressSpinnerModule],
  providers: [ColumnSeriesService, CategoryService, TooltipService, LegendService],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="stats-panel-section">
  @if (isDualMode()) {
    <div class="stats-toggle" role="group" aria-label="Stats source">
      <button
        type="button"
        class="stats-toggle-btn"
        [class.active]="statsMode() === 'large'"
        [attr.aria-pressed]="statsMode() === 'large'"
        data-testid="stats-mode-large"
        (click)="setStatsMode('large')"
      >Large</button>
      <button
        type="button"
        class="stats-toggle-btn"
        [class.active]="statsMode() === 'small'"
        [attr.aria-pressed]="statsMode() === 'small'"
        data-testid="stats-mode-small"
        (click)="setStatsMode('small')"
      >Small</button>
      <button
        type="button"
        class="stats-toggle-btn"
        [class.active]="statsMode() === 'all'"
        [attr.aria-pressed]="statsMode() === 'all'"
        data-testid="stats-mode-all"
        (click)="setStatsMode('all')"
      >All</button>
    </div>
  }
  @if (isLoading()) {
    <div class="stats-panel-loading" aria-live="polite">
      <mat-progress-spinner diameter="24" mode="indeterminate" />
      <span>Computing stats…</span>
    </div>
  } @else if (!activeStats() || !hasSwings()) {
    <div class="stats-panel-empty" aria-live="polite">
      <span>No stats — enter a symbol to compute pivots</span>
    </div>
  } @else {
    <div class="stats-panel-content">
      @for (dir of directions(); track dir.key) {
        <section class="stats-direction" [class.stats-direction-up]="dir.key === 'up'" [class.stats-direction-down]="dir.key === 'down'">
          <h3 class="stats-direction-title">{{ dir.label }} ({{ dir.count }})</h3>

          <div class="stats-block stats-block-magnitude-percent">
            <h4>Magnitude %</h4>
            <dl class="stats-fields">
              @for (field of dir.magnitudePercentFields; track field.label) {
                <div class="stats-field">
                  <dt class="stats-field-label">{{ field.label }}</dt>
                  <dd class="stats-field-value">{{ field.value }}</dd>
                </div>
              }
            </dl>
          </div>

          <div class="stats-block stats-block-magnitude-absolute">
            <h4>Magnitude $</h4>
            <dl class="stats-fields">
              @for (field of dir.magnitudeAbsoluteFields; track field.label) {
                <div class="stats-field">
                  <dt class="stats-field-label">{{ field.label }}</dt>
                  <dd class="stats-field-value">{{ field.value }}</dd>
                </div>
              }
            </dl>
          </div>

          <div class="stats-block stats-block-duration">
            <h4>Duration (bars)</h4>
            <dl class="stats-fields">
              @for (field of dir.durationFields; track field.label) {
                <div class="stats-field">
                  <dt class="stats-field-label">{{ field.label }}</dt>
                  <dd class="stats-field-value">{{ field.value }}</dd>
                </div>
              }
            </dl>
          </div>

          <div class="stats-histogram stats-histogram-magnitude">
            <h5>Magnitude % Histogram</h5>
            @if (dir.magnitudeHistogram.bins.length > 0) {
              <ejs-chart
                [primaryXAxis]="histogramXAxis"
                [primaryYAxis]="histogramYAxis"
                [tooltip]="histogramTooltip"
                [legendSettings]="histogramLegend"
                height="180px">
                <e-series-collection>
                  <e-series
                    type="Column"
                    [dataSource]="dir.magnitudeHistogramData"
                    xName="label"
                    yName="count"
                    name="Count"
                    [animation]="histogramAnimation">
                  </e-series>
                </e-series-collection>
              </ejs-chart>
            } @else {
              <span class="stats-histogram-empty">No data</span>
            }
          </div>

          <div class="stats-histogram stats-histogram-duration">
            <h5>Duration Histogram</h5>
            @if (dir.durationHistogram.bins.length > 0) {
              <ejs-chart
                [primaryXAxis]="histogramXAxis"
                [primaryYAxis]="histogramYAxis"
                [tooltip]="histogramTooltip"
                [legendSettings]="histogramLegend"
                height="180px">
                <e-series-collection>
                  <e-series
                    type="Column"
                    [dataSource]="dir.durationHistogramData"
                    xName="label"
                    yName="count"
                    name="Count"
                    [animation]="histogramAnimation">
                  </e-series>
                </e-series-collection>
              </ejs-chart>
            } @else {
              <span class="stats-histogram-empty">No data</span>
            }
          </div>
        </section>
      }
    </div>
  }
</div>
`,
  styles: [`
.stats-panel-section { padding: 8px 0; }
.stats-toggle { display: inline-flex; border: 1px solid var(--mat-sys-outline-variant); border-radius: 4px; overflow: hidden; margin-bottom: 12px; }
.stats-toggle-btn { border: none; background: transparent; padding: 4px 14px; font-size: 12px; cursor: pointer; color: var(--mat-sys-on-surface-variant); border-right: 1px solid var(--mat-sys-outline-variant); }
.stats-toggle-btn:last-child { border-right: none; }
.stats-toggle-btn:hover { background: var(--mat-sys-surface-container); }
.stats-toggle-btn.active { background: var(--mat-sys-primary); color: var(--mat-sys-on-primary); }
.stats-panel-loading, .stats-panel-empty {
  display: flex; align-items: center; gap: 8px; padding: 24px; color: #666;
}
.stats-panel-content { display: flex; flex-direction: column; gap: 16px; }
.stats-direction {
  border: 1px solid #e0e0e0; border-radius: 4px; padding: 12px;
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
}
.stats-direction-up { border-left: 3px solid #4caf50; }
.stats-direction-down { border-left: 3px solid #f44336; }
.stats-direction-title { grid-column: 1 / -1; margin: 0 0 4px 0; font-size: 14px; }
.stats-block { font-size: 12px; }
.stats-block h4 { margin: 0 0 4px 0; font-size: 12px; font-weight: 600; }
.stats-fields { display: grid; grid-template-columns: auto auto; gap: 2px 8px; margin: 0; }
.stats-field { display: contents; }
.stats-field-label { color: #666; }
.stats-field-value { margin: 0; font-variant-numeric: tabular-nums; }
.stats-histogram { grid-column: 1 / -1; }
.stats-histogram h5 { margin: 8px 0 4px 0; font-size: 11px; font-weight: 600; color: #666; }
.stats-histogram-empty { font-size: 12px; color: #999; padding: 8px; display: block; }
`],
})
export class StatsPanelComponent implements OnChanges {
  @Input() stats: SwingStats | null = null;
  /** Dual mode: [large, small, all] — null means single-config mode. */
  @Input() statsSets: StatsSets | null = null;
  @Input() loading = false;

  readonly statsSignal = signal<SwingStats | null>(null);
  private readonly statsSetsSignal = signal<StatsSets | null>(null);
  private readonly loadingSignal = signal(false);
  /** Selected stats source — component state only, not persisted. */
  readonly statsMode = signal<StatsMode>('large');

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['stats']) this.statsSignal.set(this.stats);
    if (changes['statsSets']) this.statsSetsSignal.set(this.statsSets);
    if (changes['loading']) this.loadingSignal.set(this.loading);
  }

  readonly isLoading = computed(() => this.loadingSignal());
  readonly isDualMode = computed(() => this.statsSetsSignal() != null);

  /** The stats to display — selected set in dual mode, `stats` otherwise. */
  readonly activeStats = computed<SwingStats | null>(() => {
    const sets = this.statsSetsSignal();
    if (sets != null) {
      return sets[STATS_MODE_INDEX[this.statsMode()]] ?? null;
    }
    return this.statsSignal();
  });

  readonly hasSwings = computed(() => {
    const s = this.activeStats();
    if (!s) return false;
    return s.up.count > 0 || s.down.count > 0;
  });

  readonly directions = computed(() => {
    const s = this.activeStats();
    if (!s) return [];
    return [
      this.toDirectionView('up', 'Up', s.up),
      this.toDirectionView('down', 'Down', s.down),
    ];
  });

  setStatsMode(mode: StatsMode): void {
    this.statsMode.set(mode);
  }

  private toDirectionView(key: 'up' | 'down', label: string, ds: DirectionStats & { magnitudeHistogram: Histogram; durationHistogram: Histogram }) {
    return {
      key,
      label,
      count: ds.count,
      magnitudePercent: ds.magnitudePercent,
      magnitudeAbsolute: ds.magnitudeAbsolute,
      duration: ds.duration,
      magnitudePercentFields: this.summaryFields(ds.magnitudePercent, 'percent'),
      magnitudeAbsoluteFields: this.summaryFields(ds.magnitudeAbsolute, 'currency'),
      durationFields: this.summaryFields(ds.duration, 'duration'),
      magnitudeHistogram: ds.magnitudeHistogram,
      magnitudeHistogramData: this.toHistogramPoints(ds.magnitudeHistogram),
      durationHistogram: ds.durationHistogram,
      durationHistogramData: this.toHistogramPoints(ds.durationHistogram),
    };
  }

  private toHistogramPoints(h: Histogram): HistogramPoint[] {
    return h.bins.map((b) => ({ label: b.label, count: b.count }));
  }

  private summaryFields(s: DistributionSummary, kind: 'percent' | 'currency' | 'duration') {
    const fmt = (v: number) => this.format(v, kind);
    return [
      { label: 'Mean', value: fmt(s.mean) },
      { label: 'Median', value: fmt(s.median) },
      { label: 'Std Dev', value: fmt(s.stdDev) },
      { label: 'Min', value: fmt(s.min) },
      { label: 'Max', value: fmt(s.max) },
      { label: 'P10', value: fmt(s.p10) },
      { label: 'P25', value: fmt(s.p25) },
      { label: 'P50', value: fmt(s.p50) },
      { label: 'P75', value: fmt(s.p75) },
      { label: 'P90', value: fmt(s.p90) },
    ];
  }

  private format(v: number, kind: 'percent' | 'currency' | 'duration'): string {
    if (!Number.isFinite(v)) return '—';
    if (kind === 'duration') return v.toFixed(1);
    // Percent and currency: preserve significant digits for small and large values.
    const abs = Math.abs(v);
    if (abs < 0.01) return v.toFixed(4);
    if (abs < 1) return v.toFixed(3);
    if (abs < 100) return v.toFixed(2);
    return v.toFixed(2);
  }

  // Syncfusion chart config
  readonly histogramXAxis = { valueType: 'Category' as const, labelIntersectAction: 'Rotate45' as const, majorGridLines: { width: 0 } };
  readonly histogramYAxis = { labelFormat: '{value}', minimum: 0, majorGridLines: { width: 0.5, color: '#e0e0e0' } };
  readonly histogramTooltip = { enable: true, format: '${point.x}: ${point.y}' };
  readonly histogramLegend = { visible: false };
  readonly histogramAnimation = { enable: false };
}
