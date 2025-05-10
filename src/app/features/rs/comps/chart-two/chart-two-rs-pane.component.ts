import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import type { CandleWithRSColor } from './chart-two.component';

@Component({
  selector: 'rs-chart-two-rs-pane',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chart-two-rs-pane.component.html',
  styleUrl: './chart-two-rs-pane.component.scss'
})
export class ChartTwoRsPaneComponent implements OnChanges {
  ngOnChanges(changes: SimpleChanges) {
    // eslint-disable-next-line no-console
    console.log('[RS PANE DEBUG] xAxisTicks received:', changes['xAxisTicks'].currentValue);
    // Debug: log the received candleData array
    // eslint-disable-next-line no-console
    console.log('[RS PANE DEBUG] candleData received:', changes['candleData'].currentValue);
  }
  /**
   * The main candle data array, including rsColor for each candle.
   */
  @Input() candleData: CandleWithRSColor[] = [];
  /**
   * Indices of candles where x-axis ticks/gridlines should be rendered (from chart).
   */
  @Input() xAxisTicks: number[] = [];
  /**
   * Left offset (px) for absolute alignment with chart plot area
   */
  @Input() plotAreaLeft: number = 0;
  /**
   * Width (px) for absolute alignment with chart plot area
   */
  @Input() plotAreaWidth: number = 0;

}
