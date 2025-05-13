import { Component, Input, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import type { CandleWithRSColor } from '../chart-two/chart-two.component';

@Component({
  selector: 'rs-pane',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './rs-pane.component.html',
  styleUrls: ['./rs-pane.component.scss']
})
export class RsPaneComponent implements OnChanges {
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

  ngOnChanges(changes: SimpleChanges) {
    // eslint-disable-next-line no-console
    // console.log('[RS PANE DEBUG] changes:', changes);
    // if (changes['xAxisTicks']) console.log('[RS PANE DEBUG] xAxisTicks received:', changes['xAxisTicks'].currentValue);
    // if (changes['candleData']) console.log('[RS PANE DEBUG] candleData received:', changes['candleData'].currentValue);
    // if (changes['plotAreaLeft']) console.log('[RS PANE DEBUG] plotAreaLeft received:', changes['plotAreaLeft'].currentValue);
    // if (changes['plotAreaWidth']) console.log('[RS PANE DEBUG] plotAreaWidth received:', changes['plotAreaWidth'].currentValue);
  }
}
