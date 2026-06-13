import { ChangeDetectionStrategy, Component, Signal, signal, computed } from '@angular/core';

import { 
    CandleWithRSColor, 
    MockCandleWithRSColor, 
    OHLCDatum, 
    RsPaneDatum,
    RsChartConfig,
    ChartSignal
} from '../shared/types/rs.interfaces';
import { MSFT_WITH_COLORS } from '../data/MSFT_WITH_COLORS';
import { QQQ_DATA } from '../data/QQQ_DATA';
import { RsChartComponent } from '../shared/comps/rs-chart/rs-chart.component';
import { CHART_CONFIGS, ZOOM_ENABLED_CONFIG, ZOOM_DISABLED_CONFIG } from '../shared/constants/rs.constants';

type TargetSignalMap = { [symbol: string]: Signal<CandleWithRSColor[]> };
type BaselineSignalMap = { [symbol: string]: Signal<OHLCDatum[]> };
type RSSignalMap = { [symbol: string]: Signal<RsPaneDatum[]> };

@Component({
    selector: 'rs-sync-chart-view',
    standalone: true,
    imports: [RsChartComponent],
    templateUrl: './sync-chart-view.component.html',
    styleUrls: ['./sync-chart-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncChartViewComponent {
    // Configuration for all charts
    public readonly chartConfigs: RsChartConfig[] = CHART_CONFIGS;
    
    // Store mock data
    private readonly MOCK_DATA: MockCandleWithRSColor[] = MSFT_WITH_COLORS;
    private readonly MOCK_BASELINE_DATA: OHLCDatum[] = QQQ_DATA;
    
    // Signal maps for data
    private readonly targetSignals: TargetSignalMap = {};
    private readonly baselineSignals: BaselineSignalMap = {};
    private readonly rsSignals: RSSignalMap = {};

    // Computed chart configurations with their signals and zoom settings
    public readonly chartSignals = computed<ChartSignal[]>(() => {
        if (!this.chartConfigs?.length) return [];
        return this.chartConfigs.map((config, index) => this.createChartSignal(config, index === 0));
    });

    // Get main chart (first chart)
    public readonly mainChart = computed<ChartSignal | undefined>(() => this.chartSignals()[0]);
    
    // Get small charts (all except first)
    public readonly smallCharts = computed<ChartSignal[]>(() => this.chartSignals().slice(1));

    constructor() {
        this.initializeDataSignals();
    }

    /**
     * Initialize data signals for charts
     */
    private initializeDataSignals(): void {
        if (!this.chartConfigs?.length) return;
        
        for (const config of this.chartConfigs) {
            this.initializeTargetSignal(config);
            this.initializeBaselineSignal(config);
        }
    }

    /**
     * Initialize target signal for a chart configuration
     */
    private initializeTargetSignal(config: RsChartConfig): void {
        if (this.targetSignals[config.targetSymbol]) return;
        
        const targetData = this.prepareChartData(this.MOCK_DATA);
        this.targetSignals[config.targetSymbol] = signal<CandleWithRSColor[]>(targetData);
        this.rsSignals[config.targetSymbol] = signal<RsPaneDatum[]>(this.prepareRSData(targetData));
    }

    /**
     * Initialize baseline signal for a chart configuration
     */
    private initializeBaselineSignal(config: RsChartConfig): void {
        if (this.baselineSignals[config.baselineSymbol]) return;
        this.baselineSignals[config.baselineSymbol] = signal<OHLCDatum[]>([...this.MOCK_BASELINE_DATA]);
    }

    /**
     * Create a chart signal with the appropriate configuration
     */
    private createChartSignal(config: RsChartConfig, isMainChart: boolean): ChartSignal {
        const chartData = this.targetSignals[config.targetSymbol]?.() || [];
        const baselineData = this.baselineSignals[config.baselineSymbol]?.() || [];
        const rsData = this.rsSignals[config.targetSymbol]?.() || [];
        
        return {
            id: config.id,
            config: {
                ...config,
                chartConfig: {
                    ...config.chartConfig,
                    zoomSettings: isMainChart ? ZOOM_ENABLED_CONFIG : ZOOM_DISABLED_CONFIG
                }
            },
            chartData,
            baselineData,
            rsData
        };
    }

    /**
     * Prepare chart data from the mock data
     */
    private prepareChartData(data: MockCandleWithRSColor[]): CandleWithRSColor[] {
        return data.map(datum => ({
            ...datum,
            x: new Date(datum.x)
        }));
    }

    /**
     * Prepare RS data from target data
     */
    private prepareRSData(targetData: CandleWithRSColor[]): RsPaneDatum[] {
        return targetData.map(d => ({
            date: d.x instanceof Date ? d.x : new Date(d.x),
            rank: d.rank,
            rsColor: d.rsColor || '#ddd',
        }));
    }
}
