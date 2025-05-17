import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal, ViewChild } from '@angular/core';
import { CandleWithRSColor, MockCandleWithRSColor, OHLCDatum, RsPaneDatum } from '../../common/interfaces-rs';
import { SyncChartOneComponent } from './sync-chart-one/sync-chart-one.component';
import { SyncChartTwoComponent } from './sync-chart-two/sync-chart-two.component';
import { MSFT_WITH_COLORS } from '../../data/MSFT_WITH_COLORS';
import {QQQ_DATA } from '../../data/QQQ_DATA';
import { AxisModel, IZoomCompleteEventArgs, VisibleRangeModel } from '@syncfusion/ej2-charts';
import { ChartComponent } from '@syncfusion/ej2-angular-charts';

@Component({
  selector: 'rs-sync-chart-view',
  imports: [SyncChartOneComponent, SyncChartTwoComponent],
  templateUrl: './sync-chart-view.component.html',
  styleUrl: './sync-chart-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SyncChartViewComponent implements OnInit {

    @ViewChild('chartOne', { static: false }) chartOne?: SyncChartOneComponent;
    @ViewChild('chartTwo', { static: false }) chartTwo?: SyncChartTwoComponent;

    private readonly http = inject(HttpClient);

    MOCK_DATA: MockCandleWithRSColor[] = MSFT_WITH_COLORS;
    // QQQ_DATA: OHLCDatum[] = QQQ_DATA;

    public candleData = signal<CandleWithRSColor[]>([]);
    public msftData = signal<CandleWithRSColor[]>([]);
    public compareData = signal<OHLCDatum[]>(QQQ_DATA);
    public rsPaneData = signal<RsPaneDatum[]>([]);

    // public primaryXAxis?: Partial<AxisModel>;

    // public crosshair: Object = { enable: true };

    ngOnInit(): void {
        this.setData();
        // console.log('sCVC ngOI candleData: ', this.candleData());
        // console.log('sCVC ngOI rsData: ', this.rsPaneData());
    }

    setData() {
        const candleData = this.MOCK_DATA.map(datum => {
            return {
                ...datum,
                x: new Date(datum.x)
            }
        });

        this.candleData.set(candleData);

        const rsData = candleData.map((d: CandleWithRSColor) => ({
            date: d.x instanceof Date ? d.x : new Date(d.x),
            rank: d.rank,
            rsColor: d.rsColor || '#ddd',
        }));
        
        this.rsPaneData.set(rsData);
    }


}
