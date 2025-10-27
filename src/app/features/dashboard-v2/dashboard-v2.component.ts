import { ChangeDetectionStrategy, Component, inject, OnInit, ViewChild } from '@angular/core';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';

import { HeatmapComponent } from './heatmap/heatmap.component';
import { SelectStockPanelComponent } from './select-stock-panel/select-stock-panel.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { generateColorArray } from '../utils/color-utils';
import { NUM_HEATMAP_MIDPOINTS } from '../../core/common/constants';
import { RelStrStockList, Timeframe } from '../shared/types/rs.interfaces';
import { RelStrDbV2Service } from '../services/rel-str-db-v2.service';
import { RsDataService } from '../services/rs-data.service';
import { RsDataStore } from '../store/rs-data.store';
import { AuthStore } from '../../core/auth/auth.store';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
    selector: 'rs-dashboard-v2',
    imports: [HeatmapComponent, MatSidenavModule, MatButtonModule, SelectStockPanelComponent],
    templateUrl: './dashboard-v2.component.html',
    styleUrl: './dashboard-v2.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardV2Component extends RelStrBaseComponent implements OnInit {

    @ViewChild('selectStock', { static: false }) selectStockPanel!: MatDrawer;

    rSDbSvc = inject(RelStrDbV2Service)
    private readonly rsDataSvc = inject(RsDataService);
    private readonly rsDataStore = inject(RsDataStore);
    private readonly authStore = inject(AuthStore);

    title = 'rel-str';

    ngOnInit() {
        this.rsCalcsStore.setHeatmapColors(generateColorArray(NUM_HEATMAP_MIDPOINTS));
        this.rsAppStore.getSupportedSymbolsListV2();

        // Load data only after authenticated user is emitted
        this.authStore.isAuthenticated$
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(u => {
            // Now that we're authenticated, load pairs list and user lists
            this.rsAppStore.getSupportedPairsListV2();
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

        // Fetch daily OHLC for submitted symbols
        this.rsDataSvc.fetchOhlcForSymbols(symbols, Timeframe.DAILY).subscribe({
            next: (result) => {
                for (const s of symbols) {
                    const data = result[s] ?? [];
                    this.rsDataStore.setData(s, data);
                }
            },
            error: (err: unknown) => {
                const message = (err as Error)?.message ?? 'Failed to fetch data';
                for (const s of symbols) {
                    this.rsDataStore.setError(s, message);
                }
            }
        });
    }

    // initializeData removed: V2 uses dynamic sources only (no hard-coded seed data)

    updateStockList(userId: string, list: RelStrStockList) {
        this.rsAppStore.saveStockListForUserV2(userId, list);
    }

    handleSelectStock() {
        // console.log('d hSS open select stock panel: ', this.selectStockPanel);
        this.selectStockPanel.open();
    }
    
    handleChangeTimeframe() {
        
    }
    
    handleSortFilter() {
        
    }
    
    handleCloseSelectStockPanel() {
        // console.log('d hCSSP close select stock panel');
        this.selectStockPanel.close();
    }
}
