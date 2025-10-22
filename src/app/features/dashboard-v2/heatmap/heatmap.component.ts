import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { NgStyle } from '@angular/common';

import { ALL_STOCK_DATA } from '../../data/stocks';
import { BaselineTargetRankDatum, StockData } from '../../shared/types/rs.interfaces';
import { generateRelStrTableDataSet } from '../../utils/rs-calc-utils';
import { RelStrBaseComponent } from '../../rel-str-base/rel-str-base.component';
import { AppRoutes } from '../../../core/common/interfaces';

type SelectionType = 'chart' | 'history';

const HEADER_CELL_CORNER_TEXT = 'Symbol/Date';

@Component({
    selector: 'rs-heatmap',
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

        this.selectedStockListV2$.pipe().subscribe(list => {
            // Guard: no list or no ranks data
            const ranks = list?.ranksDataWithColors;
            if (!ranks || Object.keys(ranks).length === 0) {
                this.ranksDataWithColorsEntries.set([]);
                this.headerCells.set([HEADER_CELL_CORNER_TEXT]);
                return;
            }

            const entries = Object.entries(ranks) as [string, BaselineTargetRankDatum[]][];
            this.ranksDataWithColorsEntries.set(entries);

            // Guard: no first entry
            const first = entries[0]?.[1];
            if (!Array.isArray(first) || first.length === 0) {
                this.headerCells.set([HEADER_CELL_CORNER_TEXT]);
                return;
            }

            const dates: string[] = [HEADER_CELL_CORNER_TEXT];
            for (const datum of first) {
                dates.push(datum.date);
            }
            this.headerCells.set(dates);
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
        const route = selectionType === 'chart' ? AppRoutes.SYNC_CHART : AppRoutes.HISTORY;
        this.router.navigate([route])
    }


}
