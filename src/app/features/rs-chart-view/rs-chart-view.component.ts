import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { ChartSignal, MaType, Timeframe } from '../shared/types/rs.interfaces';
import { RsChartComponent } from '../shared/comps/rs-chart/rs-chart.component';
import { RsChartStore } from '../store/rs-chart.store';

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
    imports: [CommonModule, MatButtonToggleModule, RsChartComponent],
    templateUrl: './rs-chart-view.component.html',
    styleUrls: ['./rs-chart-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RsChartViewComponent {
    private readonly chartStore = inject(RsChartStore);

    public readonly MaType = MaType;
    public readonly Timeframe = Timeframe;

    // Expose live store signals so the template can react via signal syntax.
    public readonly mainChart = this.chartStore.mainChart;
    public readonly smallCharts = this.chartStore.smallCharts;
    public readonly mainMaConfigs = this.chartStore.mainMaConfigs;
    public readonly timeframe = this.chartStore.timeframe;

    public readonly ma1Config = computed(() => this.mainMaConfigs().find((c) => c.id === 'ma1'));
    public readonly ma2Config = computed(() => this.mainMaConfigs().find((c) => c.id === 'ma2'));
    public readonly ma3Config = computed(() => this.mainMaConfigs().find((c) => c.id === 'ma3'));

    // Derive a shared MA type for the controls (assumes all main MAs share the same type).
    public readonly currentMaType = computed<MaType>(() => {
        const first = this.mainMaConfigs()[0];
        return first?.type ?? MaType.EMA;
    });

    constructor() {
        // Kick off load for the hard-coded dev list; will later be driven by router/list selection.
        this.chartStore.loadListForCurrentUser();
    }

    /** Update selected chart when a filmstrip item is clicked. */
    public selectChart(chartId: string): void {
        if (!chartId) {
            return;
        }
        // TEMP DEBUG: verify carousel click wiring
        // eslint-disable-next-line no-console
        // console.log('[RsChartView] selectChart', { chartId });
        this.chartStore.setSelectedChartId(chartId);
    }

    public onMaTypeChange(type: MaType): void {
        this.chartStore.setMainMaType(type);
    }

    public onMaLengthChange(id: 'ma1' | 'ma2' | 'ma3', value: string | number): void {
        const numeric = typeof value === 'number' ? value : Number(value);
        this.chartStore.setMainMaLength(id, numeric);
    }

    public onTimeframeChange(tf: Timeframe): void {
        this.chartStore.setTimeframe(tf);
    }
}
