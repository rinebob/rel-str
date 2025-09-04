import { ChangeDetectionStrategy, Component, input, OnInit } from '@angular/core';

import { CandleWithRSColor, OHLCDatum, RsPaneDatum } from '../../common/interfaces-rs';

@Component({
  selector: 'rs-sync-chart-one',
//   imports: [RsChartComponent],
  templateUrl: './sync-chart-one.component.html',
  styleUrls: ['./sync-chart-one.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncChartOneComponent implements OnInit {
    // Pass a unique ID to the chart
    chartId = 'chart-one';

    // Candlestick chart
    chartData = input.required<CandleWithRSColor[]>();
    baselineData = input.required<OHLCDatum[]>();
    rsData = input.required<RsPaneDatum[]>();
    // baselineData = input<OHLCDatum[]>();
    // rsData = input<RsPaneDatum[]>();
    
    // Allow ID override
    id = input.required<string>();

    
    constructor() {
        // effect(() => {
        //     console.log('sCO ctor eff chartData: ', this.chartData());
        // });
    }
    
    ngOnInit() {
        if (this.id) {
            this.chartId = this.id();
        }
    }

}
