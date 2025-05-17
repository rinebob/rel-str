import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';

import { CandleWithRSColor, MockCandleWithRSColor, OHLCDatum, RsPaneDatum } from '../../common/interfaces-rs';
import { SyncChartOneComponent } from './sync-chart-one/sync-chart-one.component';
import { MSFT_WITH_COLORS } from '../../data/MSFT_WITH_COLORS';
import { QQQ_DATA } from '../../data/QQQ_DATA';
import { RsChartComponent } from '../../shared/rs-chart/rs-chart.component';

@Component({
  selector: 'rs-sync-chart-view',
  imports: [
    SyncChartOneComponent,
    RsChartComponent,
   
  ],
  templateUrl: './sync-chart-view.component.html',
  styleUrls: ['./sync-chart-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncChartViewComponent implements OnInit {

    MOCK_DATA: MockCandleWithRSColor[] = MSFT_WITH_COLORS;

    public chartData = signal<CandleWithRSColor[]>([]);
    public baselineData = signal<OHLCDatum[]>(QQQ_DATA);
    public rsData = signal<RsPaneDatum[]>([]);

    constructor() { 
        // effect(() => {
        //     console.log('rSC ctor eff chartData: ', this.chartData());
        //     console.log('rSC ctor eff compareData: ', this.compareData());
        //     console.log('rSC ctor eff rsData: ', this.rsData());
        // })
    }

    ngOnInit(): void {
        this.setData();
    }

    setData() {
        const chartData = this.MOCK_DATA.map(datum => {
            return {
                ...datum,
                x: new Date(datum.x)
            }
        });

        this.chartData.set(chartData);

        const rsData = chartData.map((d: CandleWithRSColor) => ({
            date: d.x instanceof Date ? d.x : new Date(d.x),
            rank: d.rank,
            rsColor: d.rsColor || '#ddd',
        }));
        
        this.rsData.set(rsData);
    }



}
