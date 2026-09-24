/**
 * SwingAnalysisPageComponent — page shell for ZigZag swing analysis.
 *
 * Wires the SwingAnalysisStore, param controls (symbol + ZigZagConfig),
 * an isolated flex-chart with only ST_ZIGZAG enabled, the swing table,
 * the stats panel, and per-config Save Analysis buttons.
 *
 * The page owns no calculation or persistence — it delegates to the store.
 *
 * When dual mode is on, the chart renders two ZigZag instances, each
 * config section has its own controls and save button, the swing
 * table renders a nested tree (large-swing parents, small-swing
 * children), and the stats panel shows a Large / Small / All toggle
 * driven by `statsSets` ([large, small, all]).
 */
import { ChangeDetectionStrategy, Component, computed, HostBinding, inject, OnDestroy, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';

import { SwingAnalysisStore } from './swing-analysis.store';
import { SwingTableComponent } from './components/swing-table.component';
import { StatsPanelComponent, StatsSets } from './components/stats-panel.component';
import { SavedSetsComponent } from './components/saved-sets.component';
import { SymbolNavComponent } from './components/symbol-nav.component';
import { SwingSettingsDialogComponent } from './components/swing-settings-dialog.component';
import { FlexChartComponent } from '../../shared/components/flex-chart/flex-chart.component';
import { ChartIntervalKey, StIndicator } from '../../shared/components/flex-chart/flex-chart.types';
import type {
  FlexChartConfig,
  FlexChartDataset,
  IndicatorConfig,
} from '../../shared/components/flex-chart/flex-chart.types';
import { BarsInterval } from '../../../core/models/partner.types';
import { UiStateService } from '../../../core/services/ui-state.service';
import type { ZigZagConfig } from '../../shared/components/flex-chart/indicators/st-zigzag.types';

/** Default symbol loaded when the page opens. */
const DEFAULT_SYMBOL = 'QQQ';

/** Sentinel for initialZoomDays — show all available bars on load
 *  (zoomFactor clamps at 1 when days exceed bar count). */
const ALL_BARS_MAX = 99999;

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
      showTriggerDots: config.showTriggerDots !== false,
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
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatDialogModule,
    FlexChartComponent,
    SwingTableComponent,
    StatsPanelComponent,
    SavedSetsComponent,
    SymbolNavComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="swing-analysis-page">
  <header class="swing-analysis-header">
    <div class="header-text">
      <h1>Swing Analysis</h1>
      <p class="subtitle">ZigZag pivot indicator — historical swing magnitude & duration</p>
    </div>
    <div class="header-actions">
      <button
        type="button"
        class="log-pill"
        data-testid="log-pill"
        [class.active]="logScale()"
        [matTooltip]="logScale() ? 'Log Y-axis on' : 'Log Y-axis off'"
        (click)="toggleLogScale()"
      >
        Log Y-axis {{ logScale() ? 'Yes' : 'No' }}
      </button>
      <button
        mat-icon-button
        data-testid="settings-btn"
        matTooltip="Swing settings"
        (click)="openSettings()"
      >
        <mat-icon>settings</mat-icon>
      </button>
      <button
        mat-icon-button
        (click)="ui.toggleFullscreen()"
        [matTooltip]="ui.fullscreen() ? 'Exit fullscreen' : 'Fullscreen'"
      >
        <mat-icon>{{ ui.fullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
      </button>
    </div>
  </header>

  <!-- Symbol nav — prev/next through the tracked universe or a watchlist. -->
  <app-symbol-nav />

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

  <!-- Saved-sets browser — symbol-first picker, N-slot load. -->
  <app-saved-sets />

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
      [smallSwings]="smallSwings()"
      [loading]="loading()"
      [error]="error()"
    />
  </section>

  <section class="swing-analysis-stats">
    <app-stats-panel
      [stats]="stats()"
      [statsSets]="statsSets()"
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
    /* App header hidden in fullscreen — claim the full viewport. */
    :host.fullscreen {
      height: 100vh;
    }
    .swing-analysis-page {
      padding: 16px;
      max-width: 1400px;
      margin: 0 auto;
    }
    .swing-analysis-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
    }
    .swing-analysis-header h1 {
      margin: 0 0 4px;
      font-size: 1.5rem;
    }
    .header-actions {
      display: flex;
      gap: 4px;
      align-items: center;
    }
    .log-pill {
      font-size: 10px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 8px;
      border: none;
      background: var(--mat-sys-surface-container-high);
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
      transition: background 0.1s, color 0.1s;
      white-space: nowrap;
    }
    .log-pill:hover { background: var(--mat-sys-surface-container-highest); }
    .log-pill.active {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
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
export class SwingAnalysisPageComponent implements OnDestroy {
  readonly store = inject(SwingAnalysisStore);
  readonly ui = inject(UiStateService);
  private readonly dialog = inject(MatDialog);

  /** Reflects global fullscreen state on the host so CSS can claim the
   *  full viewport height when the app header is hidden. */
  @HostBinding('class.fullscreen')
  get hostFullscreen(): boolean {
    return this.ui.fullscreen();
  }

  // Re-expose store signals for template binding.
  readonly symbol = this.store.symbol;
  readonly configs = this.store.configs;
  readonly dualMode = this.store.dualMode;
  readonly swings = computed(() => this.store.swings()[0] ?? []);
  /** Small swings for the nested tree table — only meaningful for the
   *  exact-2 (dual) layout; N>2 loaded sets show the flat slot-0 view. */
  readonly smallSwings = computed(() =>
    this.store.configs().length === 2 ? this.store.swings()[1] ?? [] : null,
  );
  readonly stats = computed(() => this.store.stats()[0] ?? null);
  /** [large, small, all] stats for the panel toggle — null in single mode.
   *  For N>2 loaded sets: slot 0 stats + merged allStats; the "small"
   *  seat is null (there's no canonical second). */
  readonly statsSets = computed<StatsSets | null>(() => {
    const n = this.store.configs().length;
    if (n < 2) return null;
    return [
      this.store.stats()[0] ?? null,
      n === 2 ? this.store.stats()[1] ?? null : null,
      this.store.allStats(),
    ];
  });
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

  /** Page-level log-scale state — single chart on this page. */
  readonly logScale = signal(true);

  toggleLogScale(): void {
    this.logScale.update(v => !v);
  }

  /** Isolated chart config — one or two ST_ZIGZAG indicators, unique id each. */
  readonly chartConfig = computed<FlexChartConfig>(() => ({
    indicators: this.configs().map((c, i) => buildZigZagIndicator(c, i)),
    showCrosshair: true,
    showZoomToolbar: true,
    interval: ChartIntervalKey.DAILY,
    initialZoomDays: ALL_BARS_MAX,
    logScale: this.logScale(),
  }));

  /** Reset store state on construction to avoid stale data from prior
   *  visits, load the default symbol so the page opens populated, and
   *  enter fullscreen (app header hidden) like the options pages. */
  constructor() {
    this.store.resetState();
    this.store.setSymbol(DEFAULT_SYMBOL);
    this.ui.setFullscreen(true);
    // Tracked-symbols universe — feeds the nav sequence and the saved-sets
    // symbol picker. Guarded no-op once loaded.
    this.store.loadTrackedSymbols();
  }

  /** Open the settings dialog — symbol, dual-mode, N config sections,
   *  and the batch sweep live there now (seeded sets made them secondary). */
  openSettings(): void {
    this.dialog.open(SwingSettingsDialogComponent, { width: '720px' });
  }

  /** Restore the app header when leaving the page. */
  ngOnDestroy(): void {
    this.ui.setFullscreen(false);
  }
}