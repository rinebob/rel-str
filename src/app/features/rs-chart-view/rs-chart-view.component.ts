import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';

import { ChartSignal } from '../shared/types/rs.interfaces';
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
    imports: [CommonModule, RsChartComponent],
    templateUrl: './rs-chart-view.component.html',
    styleUrls: ['./rs-chart-view.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RsChartViewComponent {
    private readonly chartStore = inject(RsChartStore);

    // Expose live store signals so the template can react via signal syntax.
    public readonly mainChart = this.chartStore.mainChart;
    public readonly smallCharts = this.chartStore.smallCharts;

    constructor() {
        // Kick off load for the hard-coded dev list; will later be driven by router/list selection.
        this.chartStore.loadListForCurrentUser();
    }

    /** Update selected chart when a filmstrip item is clicked. */
    public selectChart(chartId: string): void {
        if (!chartId) {
            return;
        }
        this.chartStore.setSelectedChartId(chartId);
    }
}
