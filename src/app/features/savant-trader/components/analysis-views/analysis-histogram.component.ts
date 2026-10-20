/**
 * Trade-return histogram (Thread #1059, task #1084) — ejs-chart column
 * series over tradeRetPct bins with adjustable width, win/loss coloring,
 * and mean/median striplines. Input-driven like the table.
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
  ColumnSeriesService,
  LegendService,
  StripLineService,
  TooltipService,
} from '@syncfusion/ej2-angular-charts';
import type { TradeAnalysisRow } from '@paper-trading/analysis';
import {
  computeAnalysisStats,
  histogramBins,
} from '../../utils/analysis-stats.util';

const WIDTH_OPTIONS = [1, 2.5, 5, 10];

@Component({
  selector: 'app-analysis-histogram',
  standalone: true,
  imports: [ChartModule, FormsModule, MatCheckboxModule, MatSelectModule],
  providers: [ColumnSeriesService, LegendService, StripLineService, TooltipService],
  templateUrl: './analysis-histogram.component.html',
  styleUrl: './analysis-histogram.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisHistogramComponent {
  rows = input.required<TradeAnalysisRow[]>();
  /** Optional second cohort — overlaid as a faint baseline behind the
   *  filtered bins so the subset is read in context (IMPL §4). */
  baselineRows = input<TradeAnalysisRow[] | null>(null);

  protected readonly widthOptions = WIDTH_OPTIONS;
  protected readonly binWidth = signal(5);
  protected readonly showBaseline = signal(true);

  protected readonly bins = computed(() =>
    histogramBins(this.rows(), 'tradeRetPct', this.binWidth()),
  );

  protected readonly baselineBins = computed(() => {
    const base = this.baselineRows();
    return base === null
      ? []
      : histogramBins(base, 'tradeRetPct', this.binWidth());
  });

  /** One point per bin, centered, carrying its win/loss fill. */
  protected readonly chartData = computed(() =>
    this.bins().map((b) => ({
      cx: (b.x0 + b.x1) / 2,
      count: b.count,
      fill: b.x0 >= 0 ? '#2e7d32' : '#c62828',
    })),
  );

  /** Baseline overlay data — same bin edges, muted fill. */
  protected readonly baselineData = computed(() =>
    this.baselineBins().map((b) => ({
      cx: (b.x0 + b.x1) / 2,
      count: b.count,
    })),
  );

  protected readonly baselineActive = computed(
    () => this.showBaseline() && this.baselineData().length > 0,
  );

  protected readonly stats = computed(() => computeAnalysisStats(this.rows()));

  protected readonly primaryXAxis = computed(() => ({
    valueType: 'Double',
    title: 'tradeRetPct',
    labelFormat: '{value}%',
    stripLines: [
      this.stats().avgRetPct === null
        ? null
        : {
            start: this.stats().avgRetPct,
            size: 1.5,
            sizeType: 'Pixel',
            zIndex: 'Over',
            color: '#2196f3',
            text: 'mean',
            textStyle: { color: '#2196f3' },
          },
      this.stats().medianRetPct === null
        ? null
        : {
            start: this.stats().medianRetPct,
            size: 1.5,
            sizeType: 'Pixel',
            zIndex: 'Over',
            color: '#ff9800',
            text: 'median',
            textStyle: { color: '#ff9800' },
            dashArray: '4,4',
          },
    ].filter((x) => x !== null),
  }));

  protected readonly primaryYAxis = { title: 'trades', minimum: 0 };
  protected readonly tooltip = {
    enable: true,
    format: '${point.x}% : ${point.y} trades',
  };
  protected readonly legendSettings = computed(() => ({
    visible: this.baselineActive(),
    position: 'Bottom',
  }));

  protected setBinWidth(w: number): void {
    this.binWidth.set(w);
  }
  protected setShowBaseline(v: boolean): void {
    this.showBaseline.set(v);
  }
}
