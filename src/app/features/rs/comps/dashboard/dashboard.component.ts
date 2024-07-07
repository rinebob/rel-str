import { ChangeDetectionStrategy, Component, OnInit, signal, ViewChild } from '@angular/core';

import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';
import { HeatmapComponent } from './heatmap/heatmap.component';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { SelectStockPanelComponent } from './select-stock-panel/select-stock-panel.component';
import { MOCK_STOCK_LISTS } from '../../common/constants-rs';

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
        this.rsAppStore.setAllStockLists(MOCK_STOCK_LISTS);
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

