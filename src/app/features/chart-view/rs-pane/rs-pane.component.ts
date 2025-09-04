import { Component, computed, input, Input, OnChanges, OnInit, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ChartModule, CategoryService, DateTimeService, ScrollBarService, ColumnSeriesService, LineSeriesService, 
    ChartAnnotationService, RangeColumnSeriesService, StackingColumnSeriesService,LegendService, TooltipService,
    CrosshairService,
    AxisModel
 } from '@syncfusion/ej2-angular-charts'
import type { RsPaneDatum } from '../../common/interfaces-rs';

/**
 * RS Pane Component: renders a Syncfusion vertical bar chart to visualize RS values.
 * The X axis is DateTime and matches the main chart; Y axis is hidden.
 */
@Component({
  selector: 'rs-pane',
  standalone: true,
  imports: [CommonModule, ChartModule],
  providers: [ CategoryService, DateTimeService, ScrollBarService, LineSeriesService, ColumnSeriesService, 
    ChartAnnotationService, RangeColumnSeriesService, StackingColumnSeriesService, LegendService, TooltipService, CrosshairService],
  templateUrl: './rs-pane.component.html',
  styleUrls: ['./rs-pane.component.scss']
})
export class RsPaneComponent implements OnInit {
  /**
   * `Data array, with x (Date) y = 1 and rsColor for each candle.
   */
  paneData = input.required<RsPaneDatum[]>();
  /**
   * X axis config for perfect alignment with the main chart.
   */
  primaryXAxis = input<Partial<AxisModel>>();
  /**
   * Left offset (px) for absolute alignment with chart plot area.
   */
  plotAreaLeft = input<number>(0);
  /**
   * Width (px) for absolute alignment with chart plot area.
   */
  plotAreaWidth = input<number>(0);

  public crosshair?: Object;

    ngOnInit(): void {
        this.crosshair = { enable: true };
    }
}
