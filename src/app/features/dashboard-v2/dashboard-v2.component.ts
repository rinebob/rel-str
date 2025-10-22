import { ChangeDetectionStrategy, Component, inject, OnInit, ViewChild } from '@angular/core';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatButtonModule } from '@angular/material/button';
import { AsyncPipe, JsonPipe } from '@angular/common';

import { MOCK_STOCK_LISTS } from '../shared/constants/rs.constants';
import { HeatmapComponent } from './heatmap/heatmap.component';
import { SelectStockPanelComponent } from './select-stock-panel/select-stock-panel.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { generateColorArray } from '../utils/color-utils';
import { NUM_HEATMAP_MIDPOINTS } from '../../core/common/constants';
import { BaselineTargetRankDatum, ListAction, RelStrStockList, Timeframe } from '../shared/types/rs.interfaces';
import { RAW_STOCK_DATA_BY_SYMBOL } from '../data/stocks';
import { RelStrDbV2Service } from '../services/rel-str-db-v2.service';
// import { SymbolInputComponent } from '../symbol-input/symbol-input.component';
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

    title = 'rel-str';

    // Expose tracked symbols for quick debugging in the UI
    readonly trackedSymbols$ = this.rSDbSvc.getTrackedSymbols$();

    ngOnInit() {
        this.rsCalcsStore.setHeatmapColors(generateColorArray(NUM_HEATMAP_MIDPOINTS));
        this.rsAppStore.getSupportedSymbolsListV2();
        this.rsAppStore.getSupportedPairsListV2();

        // Initial load with effective UID (auth if available, else stable local dev UID)
        // TODO(auth): Replace getEffectiveUid() fallback with the real authenticated UID once auth is implemented
        const initialUid = this.getEffectiveUid();
        if (initialUid) {
            this.rsAppStore.getListsForUserV2(initialUid);
        }

        // Also react to auth changes using AngularFire's authState (runs inside injection context)
        authState(this.auth).pipe(takeUntilDestroyed(this.destroyRef)).subscribe(user => {
            const uid = user?.uid || this.getEffectiveUid();
            if (uid) this.rsAppStore.getListsForUserV2(uid);
        });
    }

    private getEffectiveUid(): string | null {
        const liveUid = this.auth?.currentUser?.uid;
        if (liveUid) return liveUid;
        // Fallback: stable dev UID stored in localStorage
        // TODO(auth): Remove this dev fallback and rely solely on Firebase Auth UID in production
        const key = 'relstr-dev-uid';
        try {
            let val = localStorage.getItem(key);
            if (!val) {
                val = `dev-${Math.random().toString(36).slice(2)}-${Date.now()}`;
                localStorage.setItem(key, val);
            }
            return val;
        } catch {
            // If localStorage unavailable, return a process-stable constant
            return 'dev-user';
        }
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

    initializeData() {
        // save symbols
        for (const symbol of Object.keys(RAW_STOCK_DATA_BY_SYMBOL)) {
            this.updateSymbol(symbol, ListAction.ADD);
        }

        // save symbol pairs
        // for (const symbol of Object.keys(RANKS_WITH_COLORS_BY_SYMBOL)) {
        //     this.updateSymbolPair(symbol, ListAction.ADD);
        // }

        // save stock lists

        // save pairs data

        
    }

    updateSymbol(symbol: string, action: ListAction) {

        this.rsAppStore.updateSupportedSymbolsListV2(symbol, action);
    }

    updateSymbolPair(pair: string, action: ListAction) {
        this.rsAppStore.updateSupportedPairsListV2(pair, action);
    }

    updateStockList(userId: string, list: RelStrStockList) {
        this.rsAppStore.saveStockListForUserV2(userId, list);

    }

    updatePairsData(pair: string, data: BaselineTargetRankDatum[]) {
        this.rsAppStore.savePairDataV2(pair, data);
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
