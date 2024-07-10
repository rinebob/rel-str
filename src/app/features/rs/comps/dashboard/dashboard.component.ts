import { ChangeDetectionStrategy, Component, OnInit, signal, ViewChild } from '@angular/core';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';

import { MOCK_STOCK_LISTS } from '../../common/constants-rs';
import { HeatmapComponent } from './heatmap/heatmap.component';
import { SelectStockPanelComponent } from './select-stock-panel/select-stock-panel.component';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';

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

        // this.selectedStockList$.pipe().subscribe(list => {
        //     console.log('d ngOI selected stock list sub: ', list);
        // });
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

