import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgStyle } from '@angular/common';

import { ALL_STOCK_DATA } from '../../../data/stocks';
import { BaselineTargetRankDatum, StockData } from '../../../common/interfaces-rs';
import { generateRelStrTableDataSet } from '../../../utils/rs-calc-utils';
import { RelStrBaseComponent } from '../../rel-str-base/rel-str-base.component';
import { AppRoutes } from '../../../../../core/common/interfaces';

type SelectionType = 'chart' | 'history';

const HEADER_CELL_CORNER_TEXT = 'Symbol/Date';

@Component({
  selector: 'rs-heatmap',
  standalone: true,
  imports: [NgStyle],
  templateUrl: './heatmap.component.html',
  styleUrl: './heatmap.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeatmapComponent extends RelStrBaseComponent {
    
    headerCells = signal<string[]>([]);
    ranksDataWithColorsEntries = signal<[string, BaselineTargetRankDatum[]][]>([]);

    constructor() {
        super();
    }

    ngOnInit() {
        this.generateRelStrTableData(ALL_STOCK_DATA, 'QQQ');

        this.selectedStockList$.pipe().subscribe(list => {
            // console.log('h ngOI selected stock list sub: ', list);
            if (!!list.ranksDataWithColors) {
                const entries = Object.entries(list.ranksDataWithColors);
                // console.log('h ngOI O.e(list): ', entries);
                this.ranksDataWithColorsEntries.set(entries);
                const data = entries[0][1];
                // console.log('h ngOI data: ', data);
                const dates: string[] = [HEADER_CELL_CORNER_TEXT];
                for (const datum of data) {
                    dates.push(datum.date);
                }
                // console.log('h ngOI dates: ', dates);
                this.headerCells.set(dates);
            }
        });
	}

    generateRelStrTableData(stockData: StockData[], baseline: string) {
        const {allData, relStrTableData} = generateRelStrTableDataSet(stockData, baseline, this.rsCalcsStore.heatmapColors());
        // console.log('h gRSTDS final allData: ', allData);
        // console.log('h gRSTDS final relStrTableData: ', relStrTableData);
        this.rsCalcsStore.setAllData(allData);
        this.rsCalcsStore.setRelStrTableData(relStrTableData);
    }

    handleCellSelection() {

    }

    handleSymbolSelection(symbol: string, selectionType: SelectionType) {
        // console.log('h hSS symbol/selection type: ', symbol, selectionType);
        const route = selectionType === 'chart' ? AppRoutes.CHART : AppRoutes.HISTORY;
        this.router.navigate([route])
    }


}
