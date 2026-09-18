/**
 * SwingAnalysisPageComponent — page shell for ZigZag swing analysis.
 *
 * Wires the SwingAnalysisStore, param controls (symbol + ZigZagConfig),
 * an isolated flex-chart with only ST_ZIGZAG enabled, the swing table,
 * the stats panel, and a Save Analysis button.
 *
 * The page owns no calculation or persistence — it delegates to the store.
 */
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { SwingAnalysisStore } from './swing-analysis.store';
import { SwingTableComponent } from './components/swing-table.component';
import { StatsPanelComponent } from './components/stats-panel.component';
import { FlexChartComponent } from '../../shared/components/flex-chart/flex-chart.component';
import { ChartIntervalKey, StIndicator } from '../../shared/components/flex-chart/flex-chart.types';
import type {
  FlexChartConfig,
  FlexChartDataset,
  IndicatorConfig,
} from '../../shared/components/flex-chart/flex-chart.types';
import { BarsInterval } from '../../../core/models/partner.types';
import type { ZigZagConfig } from '../../shared/components/flex-chart/indicators/st-zigzag.types';

/** Numeric ZigZagConfig keys that accept number values. */
type NumericParam = 'devThreshold' | 'leftDepth' | 'rightDepth';

/** Boolean ZigZagConfig keys that accept boolean values. */
type BoolParam = 'allowZigZagOnOneBar' | 'projectionPivots';

/** Per-param validation bounds for numeric inputs. */
const NUMERIC_BOUNDS: Record<NumericParam, { min: number; max: number }> = {
  devThreshold: { min: 0.1, max: 100 },
  leftDepth: { min: 2, max: 100 },
  rightDepth: { min: 2, max: 100 },
};

/**
 * Build the isolated ST_ZIGZAG IndicatorConfig from the store's ZigZagConfig.
 * The chart only renders ST_ZIGZAG — no other indicators are loaded.
 */
function buildZigZagIndicator(config: ZigZagConfig): IndicatorConfig {
  return {
    id: 'st-zigzag-swing-analysis',
    type: StIndicator.ST_ZIGZAG,
    pane: 'overlay',
    seriesType: 'line',
    params: {
      devThreshold: config.devThreshold,
      leftDepth: config.leftDepth,
      rightDepth: config.rightDepth,
      allowZigZagOnOneBar: config.allowZigZagOnOneBar,
      projectionPivots: config.projectionPivots,
      lineColor: config.lineColor,
    },
    options: {
      name: 'ST-ZIGZAG',
    },
  };
}

@Component({
  selector: 'app-swing-analysis-page',
  standalone: true,
  imports: [
    MatButtonModule,
    MatProgressSpinnerModule,
    FlexChartComponent,
    SwingTableComponent,
    StatsPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="swing-analysis-page">
  <header class="swing-analysis-header">
    <h1>Swing Analysis</h1>
    <p class="subtitle">ZigZag pivot indicator — historical swing magnitude & duration</p>
  </header>

  @if (loading()) {
    <div class="swing-analysis-loading" data-testid="loading-indicator" aria-live="polite">
      <mat-progress-spinner diameter="32" mode="indeterminate" />
      <span>Loading bars…</span>
    </div>
  }

  @if (error()) {
    <div class="swing-analysis-error" data-testid="error-message" aria-live="polite">
      {{ error() }}
    </div>
  }

  <section class="swing-analysis-controls">
    <label class="control">
      <span class="control-label">Symbol</span>
      <input
        data-testid="symbol-input"
        type="text"
        [value]="symbol()"
        (input)="onSymbol($event)"
        placeholder="AAPL"
      />
    </label>

    <label class="control">
      <span class="control-label">Dev Threshold</span>
      <input
        data-testid="param-devThreshold"
        type="number"
        min="0.1"
        step="0.1"
        [value]="config().devThreshold"
        (input)="onNumberParam('devThreshold', $event)"
      />
    </label>

    <label class="control">
      <span class="control-label">Left Depth</span>
      <input
        data-testid="param-leftDepth"
        type="number"
        min="2"
        step="1"
        [value]="config().leftDepth"
        (input)="onNumberParam('leftDepth', $event)"
      />
    </label>

    <label class="control">
      <span class="control-label">Right Depth</span>
      <input
        data-testid="param-rightDepth"
        type="number"
        min="2"
        step="1"
        [value]="config().rightDepth"
        (input)="onNumberParam('rightDepth', $event)"
      />
    </label>

    <label class="control control-checkbox">
      <input
        data-testid="param-allowZigZagOnOneBar"
        type="checkbox"
        [checked]="config().allowZigZagOnOneBar"
        (change)="onBoolParam('allowZigZagOnOneBar', $event)"
      />
      <span class="control-label">Allow ZigZag on One Bar</span>
    </label>

    <label class="control control-checkbox">
      <input
        data-testid="param-projectionPivots"
        type="checkbox"
        [checked]="config().projectionPivots"
        (change)="onBoolParam('projectionPivots', $event)"
      />
      <span class="control-label">Projection Pivots</span>
    </label>

    <button
      data-testid="save-analysis-btn"
      mat-raised-button
      color="primary"
      [disabled]="!canSave()"
      (click)="onSave()"
    >
      Save Analysis
    </button>
  </section>

  <section class="swing-analysis-chart">
    <app-flex-chart
      [chartData]="chartData()"
      [config]="chartConfig()"
      height="400px"
    />
  </section>

  <section class="swing-analysis-table">
    <app-swing-table
      [swings]="swings()"
      [loading]="loading()"
      [error]="error()"
    />
  </section>

  <section class="swing-analysis-stats">
    <app-stats-panel
      [stats]="stats()"
      [loading]="loading()"
    />
  </section>
</div>
  `,
  styles: [`
    :host {
      display: block;
      height: calc(100vh - 64px);
      overflow: auto;
    }
    .swing-analysis-page {
      padding: 16px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .swing-analysis-header h1 {
      margin: 0 0 4px;
      font-size: 1.5rem;
    }
    .swing-analysis-header .subtitle {
      margin: 0 0 16px;
      color: #666;
      font-size: 0.9rem;
    }
    .swing-analysis-loading {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 16px;
      color: #555;
    }
    .swing-analysis-error {
      padding: 12px 16px;
      background: #fee;
      color: #c00;
      border-radius: 4px;
      margin-bottom: 12px;
    }
    .swing-analysis-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-end;
      padding: 12px 0;
      border-bottom: 1px solid #eee;
      margin-bottom: 16px;
    }
    .control {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .control-checkbox {
      flex-direction: row;
      align-items: center;
      gap: 6px;
    }
    .control-label {
      font-size: 0.75rem;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .control input[type="text"],
    .control input[type="number"] {
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 100px;
    }
    .swing-analysis-chart {
      margin-bottom: 16px;
    }
    .swing-analysis-table {
      margin-bottom: 16px;
    }
    .swing-analysis-stats {
      margin-bottom: 16px;
    }
  `],
})
export class SwingAnalysisPageComponent {
  readonly store = inject(SwingAnalysisStore);

  // Re-expose store signals for template binding.
  // The page currently uses config 0 only — dual-mode UI is added in a later task.
  readonly symbol = this.store.symbol;
  readonly config = computed(() => this.store.configs()[0]);
  readonly swings = computed(() => this.store.swings()[0] ?? []);
  readonly stats = computed(() => this.store.stats()[0] ?? null);
  readonly loading = this.store.loading;
  readonly error = this.store.error;

  /** Chart dataset built from store bars — null when no symbol entered. */
  readonly chartData = computed<FlexChartDataset | null>(() => {
    const sym = this.symbol();
    const bars = this.store.bars();
    if (!sym || bars.length === 0) return null;
    return {
      symbol: sym,
      interval: BarsInterval.DAILY,
      bars,
    };
  });

  /** Isolated chart config — only ST_ZIGZAG, no other indicators. */
  readonly chartConfig = computed<FlexChartConfig>(() => ({
    indicators: [buildZigZagIndicator(this.config())],
    showCrosshair: true,
    showZoomToolbar: true,
    interval: ChartIntervalKey.DAILY,
  }));

  /** Save is enabled only when a symbol is set and stats exist. */
  readonly canSave = computed(() => {
    return this.symbol().length > 0 && this.stats() !== null && !this.loading();
  });

  /** Reset store state on construction to avoid stale data from prior visits. */
  constructor() {
    this.store.resetState();
  }

  onSymbol(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.store.setSymbol(value);
  }

  onNumberParam(key: NumericParam, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const bounds = NUMERIC_BOUNDS[key];
    const clamped = Math.min(bounds.max, Math.max(bounds.min, value));
    this.store.updateConfig(0, { [key]: clamped });
  }

  onBoolParam(key: BoolParam, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.store.updateConfig(0, { [key]: checked });
  }

  onSave(): void {
    this.store.saveAnalysis(0);
  }
}
