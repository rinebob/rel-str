import { ChangeDetectionStrategy, Component, inject, OnInit, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';

import { HeatmapV3Component } from './heatmap-v3/heatmap-v3.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { Timeframe } from '../shared/types/rs.interfaces';
import { RsDataStore } from '../store/rs-data.store';
import { DashboardV3Store } from './store/dashboard-v3.store';
import { HeatmapPaletteStore } from '../store/heatmap-palette.store';
import type { HeatmapPaletteId } from '../utils/heatmap-color-registry';
import { ThresholdsStore } from '../store/thresholds.store';
import type { ThresholdConfig } from '../store/thresholds.store';
import { HeatmapV4Component } from './heatmap-v4/heatmap-v4.component';

@Component({
    selector: 'rs-dashboard-v3',
    standalone: true,
    imports: [
        MatButtonToggleModule,
        HeatmapV4Component,
        MatButtonModule,
        MatChipsModule,
    ],
    templateUrl: './dashboard-v3.component.html',
    styleUrl: './dashboard-v3.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardV3Component extends RelStrBaseComponent implements OnInit {

    // Expose Timeframe enum to template
    readonly timeframe = Timeframe;

    private readonly rsDataStore = inject(RsDataStore);
    readonly dashboardV3Store = inject(DashboardV3Store);
    readonly heatmapPaletteStore = inject(HeatmapPaletteStore);
    readonly thresholdsStore = inject(ThresholdsStore);

    title = 'rel-str';

    // Computed signal for selected interval
    selectedInterval = computed(() => this.rsDataStore.selectedTimeframe());

    // Baseline selection (v3-specific)
    selectedBaseline = computed(() => this.dashboardV3Store.selectedBaseline());

    // Baseline-driven universe (pairs) for the selected baseline
    currentUniversePairs = computed(() => this.dashboardV3Store.currentUniversePairs());

    // Available heatmap palettes (for selector UI)
    palettes = computed(() => this.heatmapPaletteStore.getPalettes());
    selectedPaletteId = computed(() => this.heatmapPaletteStore.selectedPaletteId());

    // Current L/N/S threshold configuration
    thresholdConfig = computed(() => this.thresholdsStore.getConfig());

    // Current heatmap mode (gradient vs 3-zone L/N/S)
    heatmapMode = computed(() => this.dashboardV3Store.getHeatmapMode());

    // RSMA window (5/10/30) used for RS-based sorting
    rsmaWindow = computed(() => this.dashboardV3Store.rsmaWindow());

    async ngOnInit(): Promise<void> {
    await this.dashboardV3Store.initFromBaselineRegistry();
    await this.dashboardV3Store.loadHeatmapForCurrentBaseline();
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

    onPaletteChange(paletteId: HeatmapPaletteId) {
        this.heatmapPaletteStore.setPalette(paletteId);
        // Recompute heatmap rows using the new palette.
        // For now we simply reload the snapshot for the current baseline/timeframe
        // so DashboardV3Store rebuilds ranks with the updated colors.
        void this.dashboardV3Store.loadHeatmapForCurrentBaseline(true);
    }

    onBaselineChipClick(baselineId: string) {
        this.dashboardV3Store.selectBaseline(baselineId);
        void this.dashboardV3Store.loadHeatmapForCurrentBaseline(true);
    }

    onThresholdChange(key: keyof ThresholdConfig, raw: string) {
        const value = Number(raw);
        if (!Number.isFinite(value)) {
            return;
        }
        this.thresholdsStore.patchConfig({ [key]: value });
        void this.dashboardV3Store.loadHeatmapForCurrentBaseline(true);
    }

    onModeChange(mode: 'gradient' | 'lns3') {
        this.dashboardV3Store.setHeatmapMode(mode);
        void this.dashboardV3Store.loadHeatmapForCurrentBaseline(true);
    }

    onRsmaWindowChange(window: 5 | 10 | 30) {
        this.dashboardV3Store.setRsmaWindow(window);
    }
}
