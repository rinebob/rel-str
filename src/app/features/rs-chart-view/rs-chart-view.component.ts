import { ChangeDetectionStrategy, Component, Signal, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

import { CandleWithRSColor, ChartSignal, MockCandleWithRSColor, OHLCDatum, RsChartConfig, RsPaneDatum } from '../shared/types/rs.interfaces';
import { RsChartComponent } from '../shared/comps/rs-chart/rs-chart.component';
import { CHART_CONFIGS } from '../shared/constants/rs.constants';
import { MSFT_WITH_COLORS } from '../data/MSFT_WITH_COLORS';
import { QQQ_DATA } from '../data/QQQ_DATA';

/**
 * RsChartViewComponent
 *
 * New chart view intended to replace the legacy SyncChartView once
 * feature parity is achieved. Uses SyncFusion under the hood but applies
 * RS threshold filtering for improved clarity.
 */
@Component({
    selector: 'rs-rs-chart-view',
    standalone: true,
    imports: [CommonModule, RsChartComponent],
    templateUrl: './rs-chart-view.component.html',
    styleUrls: ['./rs-chart-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RsChartViewComponent {
    // Configuration for all charts (one main + filmstrip)
    public readonly chartConfigs: RsChartConfig[] = CHART_CONFIGS;

    // Store mock data for now; will be replaced by live data wiring
    private readonly mockData: MockCandleWithRSColor[] = MSFT_WITH_COLORS;
    private readonly mockBaselineData: OHLCDatum[] = QQQ_DATA;

    // RS thresholds mirrored from backend webhooks-config
    private readonly rsOpenLongThreshold = 0.8;
    private readonly rsCloseLongThreshold = 0.8;
    private readonly rsOpenShortThreshold = 0.2;
    private readonly rsCloseShortThreshold = 0.2;

    // Signal maps for data
    private readonly targetSignals: { [symbol: string]: Signal<CandleWithRSColor[]> } = {};
    private readonly baselineSignals: { [symbol: string]: Signal<OHLCDatum[]> } = {};
    private readonly rsSignals: { [symbol: string]: Signal<RsPaneDatum[]> } = {};

    // Computed chart configurations with their signals
    public readonly chartSignals = computed<ChartSignal[]>(() => {
        if (!this.chartConfigs?.length) return [];
        return this.chartConfigs.map((config, index) => this.createChartSignal(config, index === 0));
    });

    // Main chart = first config
    public readonly mainChart = computed<ChartSignal | undefined>(() => this.chartSignals()[0]);

    // Filmstrip charts = remaining configs
    public readonly smallCharts = computed<ChartSignal[]>(() => this.chartSignals().slice(1));

    constructor() {
        this.initializeDataSignals();
    }

    /** Initialize data signals for all configured charts. */
    private initializeDataSignals(): void {
        if (!this.chartConfigs?.length) return;
        for (const config of this.chartConfigs) {
            this.initializeTargetSignal(config);
            this.initializeBaselineSignal(config);
        }
    }

    /** Initialize target (price) and RS signals for a single chart configuration. */
    private initializeTargetSignal(config: RsChartConfig): void {
        if (this.targetSignals[config.targetSymbol]) return;

        const targetData = this.prepareChartData(this.mockData);
        this.targetSignals[config.targetSymbol] = signal<CandleWithRSColor[]>(targetData);
        this.rsSignals[config.targetSymbol] = signal<RsPaneDatum[]>(
            this.prepareThresholdFilteredRsData(targetData),
        );
    }

    /** Initialize baseline series for a single chart configuration. */
    private initializeBaselineSignal(config: RsChartConfig): void {
        if (this.baselineSignals[config.baselineSymbol]) return;
        this.baselineSignals[config.baselineSymbol] = signal<OHLCDatum[]>([...this.mockBaselineData]);
    }

    /** Build a ChartSignal object for RsChartComponent consumption. */
    private createChartSignal(config: RsChartConfig, isMainChart: boolean): ChartSignal {
        const chartData = this.targetSignals[config.targetSymbol]?.() ?? [];
        const baselineData = this.baselineSignals[config.baselineSymbol]?.() ?? [];
        const rsData = this.rsSignals[config.targetSymbol]?.() ?? [];

        return {
            id: config.id,
            config,
            chartData,
            baselineData,
            rsData,
        };
    }

    /** Convert mock candle data into typed CandleWithRSColor series. */
    private prepareChartData(data: MockCandleWithRSColor[]): CandleWithRSColor[] {
        return data.map((datum) => ({
            ...datum,
            x: new Date(datum.x),
        }));
    }

    /**
     * Map target candle data into RS pane data, filtering out values that
     * fall between open/close thresholds to improve clarity.
     */
    private prepareThresholdFilteredRsData(targetData: CandleWithRSColor[]): RsPaneDatum[] {
        return targetData
            .filter((d) => {
                const rank = d.rank ?? 0;
                const isLongZone = rank >= this.rsOpenLongThreshold;
                const isShortZone = rank <= this.rsOpenShortThreshold;
                // For now we treat open/close thresholds the same visually.
                return isLongZone || isShortZone;
            })
            .map((d) => ({
                date: d.x instanceof Date ? d.x : new Date(d.x),
                rank: d.rank,
                rsColor: d.rsColor ?? '#dddddd',
            }));
    }
}
