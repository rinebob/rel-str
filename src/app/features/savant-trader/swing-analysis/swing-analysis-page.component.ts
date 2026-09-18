/**
 * SwingAnalysisPageComponent — page shell for ZigZag swing analysis.
 *
 * Wires the SwingAnalysisStore, param controls (symbol + ZigZagConfig),
 * an isolated flex-chart with only ST_ZIGZAG enabled, the swing table,
 * the stats panel, and per-config Save Analysis buttons.
 *
 * The page owns no calculation or persistence — it delegates to the store.
 *
 * When dual mode is on, the chart renders two ZigZag instances and each
 * config section has its own controls and save button. The swing table
 * and stats panel still show config 0's results only — the nested tree
 * table (B4) and stats toggle (B5) are later tasks.
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
type BoolParam = 'allowZigZagOnOneBar';

/** Per-param validation bounds for numeric inputs. */
const NUMERIC_BOUNDS: Record<NumericParam, { min: number; max: number }> = {
  devThreshold: { min: 0.1, max: 100 },
  leftDepth: { min: 2, max: 100 },
  rightDepth: { min: 2, max: 100 },
};

/** Labels for each config section — index 0 is the large/primary config. */
const CONFIG_LABELS = ['Large Swings', 'Small Swings'] as const;

/**
 * Build the isolated ST_ZIGZAG IndicatorConfig from the store's ZigZagConfig.
 * Each config gets a unique `id` so the chart can render multiple instances.
 */
function buildZigZagIndicator(config: ZigZagConfig, index: number): IndicatorConfig {
  return {
    id: `st-zigzag-${index}`,
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
      name: `ST-ZIGZAG-${index}`,
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

    <label class="control control-checkbox">
      <input
        data-testid="dual-mode-toggle"
        type="checkbox"
        [checked]="dualMode()"
        (change)="onToggleDualMode($event)"
      />
      <span class="control-label">Dual Mode</span>
    </label>
  </section>

  <section class="config-sections">
    @for (cfg of configs(); track $index; let i = $index) {
      <details
        class="config-section"
        [attr.data-testid]="'config-section-' + i"
        open
      >
        <summary class="config-section-header">
          <span class="config-section-label">{{ configLabel(i) }}</span>
          <span
            class="config-section-swatch"
            [style.background-color]="cfg.lineColor"
            aria-hidden="true"
          ></span>
        </summary>

        <div class="config-controls">
          <label class="control">
            <span class="control-label">Dev Threshold</span>
            <input
              [attr.data-testid]="'param-devThreshold-' + i"
              type="number"
              [attr.min]="numericBounds('devThreshold').min"
              [attr.max]="numericBounds('devThreshold').max"
              step="0.1"
              [value]="cfg.devThreshold"
              (change)="onNumberParam(i, 'devThreshold', $event)"
            />
          </label>

          <label class="control">
            <span class="control-label">Left Depth</span>
            <input
              [attr.data-testid]="'param-leftDepth-' + i"
              type="number"
              [attr.min]="numericBounds('leftDepth').min"
              [attr.max]="numericBounds('leftDepth').max"
              step="1"
              [value]="cfg.leftDepth"
              (change)="onNumberParam(i, 'leftDepth', $event)"
            />
          </label>

          <label class="control">
            <span class="control-label">Right Depth</span>
            <input
              [attr.data-testid]="'param-rightDepth-' + i"
              type="number"
              [attr.min]="numericBounds('rightDepth').min"
              [attr.max]="numericBounds('rightDepth').max"
              step="1"
              [value]="cfg.rightDepth"
              (change)="onNumberParam(i, 'rightDepth', $event)"
            />
          </label>

          <label class="control">
            <span class="control-label">Line Color</span>
            <input
              [attr.data-testid]="'param-lineColor-' + i"
              type="color"
              [value]="cfg.lineColor"
              (input)="onColorParam(i, 'lineColor', $event)"
            />
          </label>

          <label class="control control-checkbox">
            <input
              [attr.data-testid]="'param-allowZigZagOnOneBar-' + i"
              type="checkbox"
              [checked]="cfg.allowZigZagOnOneBar"
              (change)="onBoolParam(i, 'allowZigZagOnOneBar', $event)"
            />
            <span class="control-label">Allow ZigZag on One Bar</span>
          </label>

          <button
            [attr.data-testid]="'save-analysis-btn-' + i"
            mat-raised-button
            color="primary"
            [disabled]="!canSave(i)"
            (click)="onSave(i)"
          >
            Save {{ configLabel(i) }}
          </button>
        </div>
      </details>
    }
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
    .config-sections {
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-bottom: 16px;
    }
    .config-section {
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow: hidden;
    }
    .config-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      background: #f5f5f5;
      cursor: pointer;
      user-select: none;
    }
    .config-section-label {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .config-section-swatch {
      width: 16px;
      height: 16px;
      border-radius: 2px;
      border: 1px solid #999;
    }
    .config-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-end;
      padding: 12px;
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
    .control input[type="color"] {
      padding: 0;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 40px;
      height: 28px;
      cursor: pointer;
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
  readonly symbol = this.store.symbol;
  readonly configs = this.store.configs;
  readonly dualMode = this.store.dualMode;
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

  /** Isolated chart config — one or two ST_ZIGZAG indicators, unique id each. */
  readonly chartConfig = computed<FlexChartConfig>(() => ({
    indicators: this.configs().map((c, i) => buildZigZagIndicator(c, i)),
    showCrosshair: true,
    showZoomToolbar: true,
    interval: ChartIntervalKey.DAILY,
  }));

  /** Reset store state on construction to avoid stale data from prior visits. */
  constructor() {
    this.store.resetState();
  }

  /** Label for a config section — "Large Swings" or "Small Swings". */
  configLabel(index: number): string {
    return CONFIG_LABELS[index] ?? `Config ${index}`;
  }

  /** Numeric bounds for a param — single source of truth for template and handler. */
  numericBounds(key: NumericParam): { min: number; max: number } {
    return NUMERIC_BOUNDS[key];
  }

  /** Save is enabled for a config when a symbol is set and stats exist. */
  canSave(index: number): boolean {
    return this.symbol().length > 0 && this.store.stats()[index] != null && !this.loading();
  }

  onSymbol(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.store.setSymbol(value);
  }

  onToggleDualMode(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked !== this.store.dualMode()) {
      this.store.toggleDualMode();
    }
  }

  onNumberParam(index: number, key: NumericParam, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const bounds = NUMERIC_BOUNDS[key];
    const clamped = Math.min(bounds.max, Math.max(bounds.min, value));
    this.store.updateConfig(index, { [key]: clamped });
  }

  onBoolParam(index: number, key: BoolParam, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.store.updateConfig(index, { [key]: checked });
  }

  onColorParam(index: number, key: 'lineColor', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.store.updateConfig(index, { [key]: value });
  }

  onSave(index: number): void {
    this.store.saveAnalysis(index);
  }
}
