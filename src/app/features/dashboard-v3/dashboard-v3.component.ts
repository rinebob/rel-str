import { ChangeDetectionStrategy, Component, inject, OnInit, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';

import { HeatmapV3Component } from './heatmap-v3/heatmap-v3.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { generateColorArray, generateWarmColdColorArray, generateHalfWarmHalfCoolColorArray, generateTwoColorWarmCoolArray } from '../utils/color-utils';
import { NUM_HEATMAP_MIDPOINTS } from '../../core/common/constants';
import { Timeframe } from '../shared/types/rs.interfaces';
import { RsDataStore } from '../store/rs-data.store';
import { DashboardV3Store } from './store/dashboard-v3.store';

@Component({
    selector: 'rs-dashboard-v3',
    standalone: true,
    imports: [HeatmapV3Component, MatButtonModule, MatButtonToggleModule, MatChipsModule],
    templateUrl: './dashboard-v3.component.html',
    styleUrl: './dashboard-v3.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardV3Component extends RelStrBaseComponent implements OnInit {

    // Expose Timeframe enum to template
    readonly timeframe = Timeframe;

    private readonly rsDataStore = inject(RsDataStore);
    readonly dashboardV3Store = inject(DashboardV3Store);

    title = 'rel-str';

    // Computed signal for selected interval
    selectedInterval = computed(() => this.rsDataStore.selectedTimeframe());

    // Baseline selection (v3-specific)
    selectedBaseline = computed(() => this.dashboardV3Store.selectedBaseline());

    // Baseline-driven universe (pairs) for the selected baseline
    currentUniversePairs = computed(() => this.dashboardV3Store.currentUniversePairs());

    ngOnInit() {
        // Use strict two-color warm/cool palette for dashboard v3 heatmap.
        // Other generators remain available (generateColorArray, generateWarmColdColorArray,
        // generateHalfWarmHalfCoolColorArray) for future toggles.
        this.rsCalcsStore.setHeatmapColors(generateTwoColorWarmCoolArray());
        void this.dashboardV3Store.loadHeatmapForCurrentBaseline();
    }

    setInterval(timeframe: Timeframe) {
        const newTimeframe = timeframe as Timeframe;
        this.rsDataStore.setTimeframe(newTimeframe);
        this.rsDataStore.clearAllData();
        void this.dashboardV3Store.loadHeatmapForCurrentBaseline(true);
    }

    handleSortFilter() {
        // v3-specific sort/filter UI will be implemented here later
    }

    onBaselineChipClick(baselineId: string) {
        this.dashboardV3Store.selectBaseline(baselineId);
        void this.dashboardV3Store.loadHeatmapForCurrentBaseline(true);
    }
}
