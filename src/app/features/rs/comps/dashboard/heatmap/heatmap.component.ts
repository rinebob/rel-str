import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RelStrBaseComponent } from '../../rel-str-base/rel-str-base.component';
import { ALL_STOCK_DATA } from '../../../data/stocks';
import { StockData } from '../../../common/interfaces-rs';
import { generateRelStrTableDataSet } from '../../../utils/rs-calc-utils';
import { generateColorArray } from '../../../utils/color-utils';
import { NgStyle } from '@angular/common';
import { NUM_HEATMAP_MIDPOINTS } from '../../../../../core/common/constants';

type SelectionType = 'chart' | 'history';

@Component({
  selector: 'rs-heatmap',
  standalone: true,
  imports: [NgStyle],
  templateUrl: './heatmap.component.html',
  styleUrl: './heatmap.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeatmapComponent extends RelStrBaseComponent {
    
    constructor() {
        super();
    }

    ngOnInit() {
        this.rsCalcsStore.setHeatmapColors(generateColorArray(NUM_HEATMAP_MIDPOINTS));
        // console.log('h ngOI colors array: ', this.rsCalcsStore.heatmapColors());
        this.generateRelStrTableData(ALL_STOCK_DATA, 'QQQ');
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
    }


}
