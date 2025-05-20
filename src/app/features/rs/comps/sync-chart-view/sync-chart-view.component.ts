import { ChangeDetectionStrategy, Component, Signal, signal, computed, OnInit } from '@angular/core';
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

    // Computed chart configurations with their signals
    public readonly chartSignals = computed(() => {
        if (!this.chartConfigs?.length) return [];
        
        return this.chartConfigs.map(config => {
            const chartData = this.targetSignals[config.targetSymbol]?.() || [];
            const baselineData = this.baselineSignals[config.baselineSymbol]?.() || [];
            const rsData = this.rsSignals[config.targetSymbol]?.() || [];
            
            return {
                id: config.id,
                config,
                chartData,
                baselineData,
                rsData
            };
        });
    });

    constructor() {
        this.initializeDataSignals();
    }

    private initializeDataSignals(): void {
        console.log('sCVI initializeDataSignals called');
        if (!this.chartConfigs?.length) return;
        
        for (const config of this.chartConfigs) {
            // Skip if already initialized
            if (this.targetSignals[config.targetSymbol]) continue;
            
            // Initialize target signal with mock data
            const targetData = this.prepareChartData(this.MOCK_DATA);
            this.targetSignals[config.targetSymbol] = signal<CandleWithRSColor[]>(targetData);
            
            // Initialize baseline signal if not already done for this symbol
            if (!this.baselineSignals[config.baselineSymbol]) {
                this.baselineSignals[config.baselineSymbol] = signal<OHLCDatum[]>([...this.MOCK_BASELINE_DATA]);
            }
            
            // Initialize RS signal
            this.rsSignals[config.targetSymbol] = signal<RsPaneDatum[]>(this.prepareRSData(targetData));
        }
    }

    // Get signals by symbol - simplified since we're handling null checks in chartSignals
    private getTargetSignal(symbol: string): Signal<CandleWithRSColor[]> {
        return this.targetSignals[symbol] || signal([]);
    }

    // For backward compatibility
    getDataForSymbol(symbol: string): CandleWithRSColor[] {
        return this.targetSignals[symbol]?.() || [];
    }

    /**
     * TrackBy function for ngFor to optimize change detection
     */
    trackChart(_index: number, chart: { id: string }): string {
        return chart.id;
    }

    ngOnInit(): void {
        // Data is initialized in the constructor
        // This method is kept for interface implementation
    }

    /**
     * Prepare chart data from the mock data
     */
    private prepareChartData(data: MockCandleWithRSColor[]): CandleWithRSColor[] {
        console.log('sCVI prepareChartData called');
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
