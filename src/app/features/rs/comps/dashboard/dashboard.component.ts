import { ChangeDetectionStrategy, Component, OnInit, ViewChild } from '@angular/core';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';

import { MOCK_STOCK_LISTS } from '../../common/constants-rs';
import { HeatmapComponent } from './heatmap/heatmap.component';
import { SelectStockPanelComponent } from './select-stock-panel/select-stock-panel.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { generateColorArray } from '../../utils/color-utils';
import { NUM_HEATMAP_MIDPOINTS } from '../../../../core/common/constants';

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

	title = 'rel-str';

    ngOnInit() {
        this.rsCalcsStore.setHeatmapColors(generateColorArray(NUM_HEATMAP_MIDPOINTS));
        this.rsAppStore.getSupportedSymbolsList();
        this.rsAppStore.getSupportedPairsList();
        this.rsAppStore.setAllStockLists(MOCK_STOCK_LISTS);
        this.rsAppStore.initializeList({...MOCK_STOCK_LISTS[0]});
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

