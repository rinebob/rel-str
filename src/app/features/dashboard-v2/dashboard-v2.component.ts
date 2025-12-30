import { ChangeDetectionStrategy, Component, inject, OnInit, computed } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';

import { HeatmapComponent } from './heatmap/heatmap.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { generateColorArray } from '../utils/color-utils';
import { NUM_HEATMAP_MIDPOINTS } from '../../core/common/constants';
import { RelStrStockList, Timeframe } from '../shared/types/rs.interfaces';
import { RelStrDbV2Service } from '../services/rel-str-db-v2.service';
import { RsDataService } from '../services/rs-data.service';
import { RsDataStore } from '../store/rs-data.store';
import { AuthStore } from '../../core/auth/auth.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonToggleChange } from '@angular/material/button-toggle';

@Component({
    selector: 'rs-dashboard-v2',
    imports: [HeatmapComponent, MatButtonModule, MatButtonToggleModule],
    templateUrl: './dashboard-v2.component.html',
    styleUrl: './dashboard-v2.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardV2Component extends RelStrBaseComponent implements OnInit {

    // Expose Timeframe enum to template
    readonly timeframe = Timeframe;

    rSDbSvc = inject(RelStrDbV2Service)
    private readonly rsDataSvc = inject(RsDataService);
    private readonly rsDataStore = inject(RsDataStore);
    private readonly authStore = inject(AuthStore);

    title = 'rel-str';

    // Computed signal for selected interval
    selectedInterval = computed(() => this.rsDataStore.selectedTimeframe());

    ngOnInit() {
        this.rsCalcsStore.setHeatmapColors(generateColorArray(NUM_HEATMAP_MIDPOINTS));
        this.rsAppStore.getSupportedSymbolsListV2();

        // Load data only after authenticated user is emitted
        this.authStore.isAuthenticated$
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(u => {
             const user = this.authStore.user();
             if (user?.uid) this.rsAppStore.getListsForUserV2(user.uid);
          });

        // After lists load, auto-select and initialize the first list if none is selected yet
        this.allStockListsV2$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(lists => {
            if (!Array.isArray(lists) || lists.length === 0) return;
            const selected = this.rsAppStore.selectedStockListV2();
            if (!selected?.name) {
                this.rsAppStore.initializeListV2(lists[0]);
            }
        });
    }

    onSymbolsSubmit = (symbols: string[]) => {
        // Mark loading in store
        this.rsDataStore.setLoading(symbols);

        // Get the selected list to process RS calculations
        const selectedList = this.rsAppStore.selectedStockListV2();
        if (!selectedList?.baseline) {
            console.error('No baseline selected for RS calculations');
            return;
        }

        const baseline = selectedList.baseline;
        const selectedTimeframe = this.selectedInterval();
        
        // Fetch OHLC for baseline and all symbols using selected timeframe
        const allSymbols = [baseline, ...symbols];
        this.rsDataSvc.fetchOhlcForSymbols(allSymbols, selectedTimeframe).subscribe({
            next: (result) => {
                // Store raw OHLC data
                for (const s of allSymbols) {
                    const data = result[s] ?? [];
                    this.rsDataStore.setData(s, data);
                }
                
                // Process RS calculations and update the list with ranksDataWithColors
                this.processRsCalculations(baseline, symbols, result, selectedTimeframe);
            },
            error: (err: unknown) => {
                const message = (err as Error)?.message ?? 'Failed to fetch data';
                for (const s of symbols) {
                    this.rsDataStore.setError(s, message);
                }
            }
        });
    }

    private processRsCalculations(baseline: string, symbols: string[], ohlcData: Record<string, any[]>, timeframe: Timeframe) {
        // This would integrate with the existing RS calculation pipeline
        // For now, we'll trigger a reload of the list data which should include RS calculations
        const user = this.authStore.user();
        if (user?.uid) {
            // Reload the list which should trigger RS calculations with the new timeframe
            this.rsAppStore.getListsForUserV2(user.uid);
        }
    }

    // initializeData removed: V2 uses dynamic sources only (no hard-coded seed data)

    updateStockList(userId: string, list: RelStrStockList) {
        this.rsAppStore.saveStockListForUserV2(userId, list);
    }

    setInterval(timeframe: Timeframe) {
        const newTimeframe = timeframe as Timeframe;
        this.rsDataStore.setTimeframe(newTimeframe);
        
        // Clear existing data when switching intervals
        this.rsDataStore.clearAllData();
        
        // Force refresh the selected list to get new interval data
        const selectedList = this.rsAppStore.selectedStockListV2();
        if (selectedList?.symbols?.length) {
            // Trigger a full refresh of the list data with new timeframe
            this.refreshListData(selectedList);
        }
    }
    
    handleIntervalChange(event: MatButtonToggleChange) {
        // Keep this for backward compatibility, but use setInterval instead
        this.setInterval(event.value as Timeframe);
    }
    
    private refreshListData(list: RelStrStockList) {
        const user = this.authStore.user();
        if (user?.uid) {
            // This will trigger the RS calculation pipeline with the new timeframe
            this.rsAppStore.resolveExistingRanksDataV2(list, true);
        }
    }
    
    handleSortFilter() {
        
    }
    
}
