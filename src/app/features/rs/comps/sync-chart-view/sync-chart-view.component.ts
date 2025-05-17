import { ChangeDetectionStrategy, Component, OnInit, Signal, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { 
    CandleWithRSColor, 
    MockCandleWithRSColor, 
    OHLCDatum, 
    RsPaneDatum,
    RsChartConfig
} from '../../common/interfaces-rs';
import { MSFT_WITH_COLORS } from '../../data/MSFT_WITH_COLORS';
import { QQQ_DATA } from '../../data/QQQ_DATA';
import { RsChartComponent } from '../../shared/rs-chart/rs-chart.component';
import { CHART_CONFIGS } from '../../common/constants-rs';

type TargetSignalMap = { [symbol: string]: Signal<CandleWithRSColor[]> };
type BaselineSignalMap = { [symbol: string]: Signal<OHLCDatum[]> };
type RSSignalMap = { [symbol: string]: Signal<RsPaneDatum[]> };

@Component({
  selector: 'rs-sync-chart-view',
  standalone: true,
  imports: [CommonModule, RsChartComponent],
  templateUrl: './sync-chart-view.component.html',
  styleUrls: ['./sync-chart-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncChartViewComponent implements OnInit {
    // Configuration for all charts
    public chartConfigs: RsChartConfig[] = CHART_CONFIGS;
    
    // Store mock data
    private MOCK_DATA: MockCandleWithRSColor[] = MSFT_WITH_COLORS;
    private MOCK_BASELINE_DATA: OHLCDatum[] = QQQ_DATA;
    
    // Signal maps for data
    private targetSignals: TargetSignalMap = {};
    private baselineSignals: BaselineSignalMap = {};
    private rsSignals: RSSignalMap = {};

    // Computed chart configurations with their signals
    public chartSignals = computed(() => 
        this.chartConfigs.map(config => ({
            id: config.id,
            config,
            chartData: this.getTargetSignal(config.targetSymbol),
            baselineData: this.getBaselineSignal(config.baselineSymbol),
            rsData: this.getRSSignal(config.targetSymbol)
        }))
    );

    constructor() {
        this.initializeDataSignals();
    }

    private initializeDataSignals(): void {
        this.chartConfigs.forEach(config => {
            // Initialize target signal if it doesn't exist
            if (!this.targetSignals[config.targetSymbol]) {
                this.targetSignals[config.targetSymbol] = 
                    signal(this.prepareChartData(this.MOCK_DATA));
            }

            // Initialize baseline signal if it doesn't exist
            if (!this.baselineSignals[config.baselineSymbol]) {
                this.baselineSignals[config.baselineSymbol] = 
                    signal([...this.MOCK_BASELINE_DATA]);
            }

            // Initialize RS signal if it doesn't exist
            if (!this.rsSignals[config.targetSymbol]) {
                const targetData = this.targetSignals[config.targetSymbol]();
                this.rsSignals[config.targetSymbol] = 
                    signal(this.prepareRSData(targetData));
            }
        });
    }

    // Private getters that are only called during initialization
    private getTargetSignal(symbol: string): Signal<CandleWithRSColor[]> {
        return this.targetSignals[symbol] ?? signal([]);
    }

    private getBaselineSignal(symbol: string): Signal<OHLCDatum[]> {
        return this.baselineSignals[symbol] ?? signal([]);
    }

    private getRSSignal(symbol: string): Signal<RsPaneDatum[]> {
        return this.rsSignals[symbol] ?? signal([]);
    }

    // For backward compatibility
    getDataForSymbol(symbol: string): CandleWithRSColor[] {
        return this.getTargetSignal(symbol)();
    }

    /**
     * TrackBy function for ngFor to optimize change detection
     */
    trackChart(_index: number, chart: { id: string }): string {
        return chart.id;
    }

    ngOnInit(): void {
        // Data is initialized in the constructor
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
        return targetData.map((d: CandleWithRSColor) => ({
            date: d.x instanceof Date ? d.x : new Date(d.x),
            rank: d.rank,
            rsColor: d.rsColor || '#ddd',
        }));
    }



}
