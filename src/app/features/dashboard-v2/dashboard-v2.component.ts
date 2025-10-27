import { ChangeDetectionStrategy, Component, EnvironmentInjector, inject, OnInit, ViewChild, runInInjectionContext } from '@angular/core';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { AsyncPipe, JsonPipe } from '@angular/common';

import { HeatmapComponent } from './heatmap/heatmap.component';
import { SelectStockPanelComponent } from './select-stock-panel/select-stock-panel.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { generateColorArray } from '../utils/color-utils';
import { NUM_HEATMAP_MIDPOINTS } from '../../core/common/constants';
import { RelStrStockList, Timeframe } from '../shared/types/rs.interfaces';
import { RelStrDbV2Service } from '../services/rel-str-db-v2.service';
import { RsDataService } from '../services/rs-data.service';
import { RsDataStore } from '../store/rs-data.store';
import { Auth, authState } from '@angular/fire/auth';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
    selector: 'rs-dashboard-v2',
    imports: [HeatmapComponent, MatSidenavModule, MatButtonModule, SelectStockPanelComponent, AsyncPipe, JsonPipe],
    templateUrl: './dashboard-v2.component.html',
    styleUrl: './dashboard-v2.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardV2Component extends RelStrBaseComponent implements OnInit {

    @ViewChild('selectStock', { static: false }) selectStockPanel!: MatDrawer;

    rSDbSvc = inject(RelStrDbV2Service)
    private readonly rsDataSvc = inject(RsDataService);
    private readonly rsDataStore = inject(RsDataStore);
    private readonly auth = inject(Auth);
    private readonly env = inject(EnvironmentInjector);

    title = 'rel-str';

    // Expose tracked symbols for quick debugging in the UI
    readonly trackedSymbols$ = this.rSDbSvc.getTrackedSymbols$();

    ngOnInit() {
        this.rsCalcsStore.setHeatmapColors(generateColorArray(NUM_HEATMAP_MIDPOINTS));
        this.rsAppStore.getSupportedSymbolsListV2();
        this.rsAppStore.getSupportedPairsListV2();

        // Load lists only after a user is authenticated to satisfy rules
        runInInjectionContext(this.env, () => authState(this.auth))
          .pipe(takeUntilDestroyed(this.destroyRef))
          .subscribe(u => {
            if (u?.uid) {
              this.rsAppStore.getListsForUserV2(u.uid);
            }
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
