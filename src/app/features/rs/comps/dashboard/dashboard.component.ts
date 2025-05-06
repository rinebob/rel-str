import { ChangeDetectionStrategy, Component, inject, OnInit, ViewChild } from '@angular/core';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';

import { MOCK_STOCK_LISTS } from '../../common/constants-rs';
import { HeatmapComponent } from './heatmap/heatmap.component';
import { SelectStockPanelComponent } from './select-stock-panel/select-stock-panel.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { generateColorArray } from '../../utils/color-utils';
import { NUM_HEATMAP_MIDPOINTS } from '../../../../core/common/constants';
import { BaselineTargetRankDatum, ListAction, RelStrStockList } from '../../common/interfaces-rs';
import { RANKS_WITH_COLORS_BY_SYMBOL, RAW_STOCK_DATA_BY_SYMBOL } from '../../data/stocks';
import { RelStrDbService } from '../../services/rel-str-db.service';

@Component({
	selector: 'rs-dashboard',
	standalone: true,
	imports: [HeatmapComponent, MatSidenavModule, SelectStockPanelComponent],
	templateUrl: './dashboard.component.html',
	styleUrl: './dashboard.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent extends RelStrBaseComponent implements OnInit {

    @ViewChild('selectStock', { static: false }) selectStockPanel!: MatDrawer;

    rSDbSvc = inject(RelStrDbService)

	title = 'rel-str';

    ngOnInit() {
        this.rsCalcsStore.setHeatmapColors(generateColorArray(NUM_HEATMAP_MIDPOINTS));
        this.rsAppStore.getSupportedSymbolsList();
        this.rsAppStore.getSupportedPairsList();
        this.rsAppStore.setAllStockLists(MOCK_STOCK_LISTS);
        this.rsAppStore.initializeList({...MOCK_STOCK_LISTS[0]});

        // this.rsAppStore.addSupportedSymbolsList();

        this.rSDbSvc.getSupportedSymbolsList()
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

        this.rsAppStore.updateSupportedSymbolsList(symbol, action);
    }

    updateSymbolPair(pair: string, action: ListAction) {
        this.rsAppStore.updateSupportedPairsList(pair, action);
    }

    updateStockList(userId: string, list: RelStrStockList) {
        this.rsAppStore.saveStockListForUser(userId, list);

    }

    updatePairsData(pair: string, data: BaselineTargetRankDatum[]) {
        this.rsAppStore.savePairData(pair, data);
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

