/**
 * Scatter view (Thread #1059, task #1084) — ejs-chart scatter over any two
 * numeric manifest columns, optional enum/string color split (one series
 * per value), deterministic jitter for discrete x, tooltip → tradeId.
 * Input-driven like the table.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import {
  ChartModule,
  LegendService,
  ScatterSeriesService,
  TooltipService,
} from '@syncfusion/ej2-angular-charts';
import {
  ANALYSIS_COLUMNS,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import {
  scatterPoints,
  type ScatterPoint,
} from '../../utils/analysis-stats.util';

/** Distinct-value count at/below which jitter is offered. */
const DISCRETE_X_MAX = 20;
/** Cap on color-split series — beyond that the split is skipped. */
const MAX_COLOR_GROUPS = 12;

@Component({
  selector: 'app-analysis-scatter',
  standalone: true,
  imports: [ChartModule, FormsModule, MatCheckboxModule, MatSelectModule],
  providers: [ScatterSeriesService, LegendService, TooltipService],
  templateUrl: './analysis-scatter.component.html',
  styleUrl: './analysis-scatter.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisScatterComponent {
  rows = input.required<TradeAnalysisRow[]>();
  /** CSV header names actually present — intersected with the manifest. */
  columns = input.required<string[]>();

  protected readonly numericCols = computed(() => {
    const present = new Set(this.columns());
    return ANALYSIS_COLUMNS.filter(
      (c) => c.kind === 'number' && present.has(c.key),
    );
  });

  protected readonly colorCols = computed(() => {
    const present = new Set(this.columns());
    return ANALYSIS_COLUMNS.filter(
      (c) => (c.kind === 'enum' || c.kind === 'string') && present.has(c.key),
    );
  });

  protected readonly xKey = signal<string>('daysHeld');
  protected readonly yKey = signal<string>('tradeRetPct');
  protected readonly colorKey = signal<string>('');
  protected readonly jitter = signal(false);

  private readonly resolvedX = computed(() =>
    this.numericCols().some((c) => c.key === this.xKey())
      ? this.xKey()
      : (this.numericCols()[0]?.key ?? this.xKey()),
  );

  private readonly resolvedY = computed(() =>
    this.numericCols().some((c) => c.key === this.yKey())
      ? this.yKey()
      : (this.numericCols()[1]?.key ?? this.yKey()),
  );

  private readonly resolvedColor = computed(() =>
    this.colorCols().some((c) => c.key === this.colorKey())
      ? this.colorKey()
      : undefined,
  );

  protected readonly points = computed(() => {
    const raw = scatterPoints(
      this.rows(),
      this.resolvedX() as keyof TradeAnalysisRow & string,
      this.resolvedY() as keyof TradeAnalysisRow & string,
      this.resolvedColor() as keyof TradeAnalysisRow & string | undefined,
    );
    return this.jitter() ? this.applyJitter(raw) : raw;
  });

  /** Series split — one e-series per color value when a color column is
   *  chosen and stays under the group cap; otherwise a single series. */
  protected readonly series = computed(() => {
    const pts = this.points();
    if (!this.resolvedColor()) return [{ name: 'trades', data: pts }];
    const groups = new Map<string, ScatterPoint[]>();
    for (const p of pts) {
      const g = p.color === undefined ? '—' : String(p.color);
      (groups.get(g) ?? groups.set(g, []).get(g)!).push(p);
    }
    if (groups.size > MAX_COLOR_GROUPS) return [{ name: 'trades', data: pts }];
    return [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, data]) => ({ name, data }));
  });

  private applyJitter(pts: ScatterPoint[]): ScatterPoint[] {
    const xs = [...new Set(pts.map((p) => p.x))].sort((a, b) => a - b);
    if (xs.length < 2 || xs.length > DISCRETE_X_MAX) return pts;
    const minGap = Math.min(...xs.slice(1).map((v, i) => v - xs[i]));
    return pts.map((p, i) => ({
      ...p,
      // Deterministic by position — stable across CD passes.
      x: p.x + (((i * 7919) % 1000) / 1000 - 0.5) * minGap * 0.6,
    }));
  }

  /** Jitter is only offered when the x column looks discrete. */
  protected readonly discreteX = computed(() => {
    const xs = new Set(
      this.rows().map((r) => r[this.resolvedX() as keyof TradeAnalysisRow]),
    );
    return xs.size > 1 && xs.size <= DISCRETE_X_MAX;
  });

  protected readonly primaryXAxis = computed(() => ({
    valueType: 'Double',
    title: this.resolvedX(),
  }));
  protected readonly primaryYAxis = computed(() => ({
    valueType: 'Double',
    title: this.resolvedY(),
  }));
  protected readonly tooltip = {
    enable: true,
    format: '<b>${point.tooltip}</b><br/>x: ${point.x} · y: ${point.y}',
  };
  protected readonly legendSettings = { visible: true, position: 'Bottom' };
  protected readonly marker = { visible: true, width: 7, height: 7 };

  protected setX(k: string): void {
    this.xKey.set(k);
  }
  protected setY(k: string): void {
    this.yKey.set(k);
  }
  protected setColor(k: string): void {
    this.colorKey.set(k);
  }
  protected setJitter(v: boolean): void {
    this.jitter.set(v);
  }
}
