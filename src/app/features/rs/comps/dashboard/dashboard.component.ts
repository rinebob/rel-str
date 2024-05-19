import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';

import { StockData } from '../../common/interfaces-rs';
import { ALL_STOCK_DATA } from '../../data/stocks';
import { generateRelStrTableDataSet } from '../../utils/rs-calc-utils';
import { RelStrBaseComponent } from '../rel-str-base/rel-str-base.component';

@Component({
	selector: 'rs-dashboard',
	standalone: true,
	imports: [],
	templateUrl: './dashboard.component.html',
	styleUrl: './dashboard.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent extends RelStrBaseComponent implements OnInit {
	title = 'rel-str';

	ngOnInit() {
        this.generateRelStrTableData(ALL_STOCK_DATA, 'QQQ');
	}

    generateRelStrTableData(stockData: StockData[], baseline: string) {
        const {allData, relStrTableData} = generateRelStrTableDataSet(stockData, baseline);
        // console.log('d gRSTDS final allData: ', allData);
        // console.log('d gRSTDS final relStrTableData: ', relStrTableData);
        this.rsCalcsStore.setAllData(allData);
        this.rsCalcsStore.setRelStrTableData(relStrTableData);
    }

	
}

