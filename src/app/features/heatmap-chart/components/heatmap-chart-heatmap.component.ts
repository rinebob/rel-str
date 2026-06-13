import { Component, input, computed, ChangeDetectionStrategy } from '@angular/core';


import type { HeatmapDataset, HeatmapRow, HeatmapCell, HeatmapColorScheme, AlignmentMetrics, CellAlignment } from '../heatmap-chart.types';
import { calculateAlignmentMetrics, calculateRowAlignments } from '../heatmap-chart-alignment.util';

@Component({
  selector: 'app-heatmap-chart-heatmap',
  standalone: true,
  imports: [],
  template: `
    <div class="heatmap-wrapper">
      @if (heatmapData(); as data) {
        <div class="heatmap-rows">
          @if (data.daily) {
            <div class="heatmap-row daily-row">
              <div class="row-label">Daily</div>
              <div class="cells-container" [style.width.px]="containerWidth()">
                @for (cell of data.daily.cells; track cell.date) {
                  <div 
                    class="heatmap-cell"
                    [style.background-color]="cell.color"
                    [style.left.px]="getCellLeft(cell, 'daily')"
                    [style.width.px]="getCellWidth(cell, 'daily')"
                    [title]="getCellTooltip(cell)">
                  </div>
                }
              </div>
            </div>
          }
          
          @if (data.weekly) {
            <div class="heatmap-row weekly-row">
              <div class="row-label">Weekly</div>
              <div class="cells-container" [style.width.px]="containerWidth()">
                @for (cell of data.weekly.cells; track cell.date) {
                  <div 
                    class="heatmap-cell"
                    [style.background-color]="cell.color"
                    [style.left.px]="getCellLeft(cell, 'weekly')"
                    [style.width.px]="getCellWidth(cell, 'weekly')"
                    [title]="getCellTooltip(cell)">
                  </div>
                }
              </div>
            </div>
          }
          
          @if (data.monthly) {
            <div class="heatmap-row monthly-row">
              <div class="row-label">Monthly</div>
              <div class="cells-container" [style.width.px]="containerWidth()">
                @for (cell of data.monthly.cells; track cell.date) {
                  <div 
                    class="heatmap-cell"
                    [style.background-color]="cell.color"
                    [style.left.px]="getCellLeft(cell, 'monthly')"
                    [style.width.px]="getCellWidth(cell, 'monthly')"
                    [title]="getCellTooltip(cell)">
                  </div>
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="no-data">No heatmap data available</div>
      }
    </div>
  `,
  styles: [`
    .heatmap-wrapper {
      width: 100%;
      height: 100%;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 0.5rem;
    }
    
    .heatmap-rows {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    
    .heatmap-row {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      height: 40px;
    }
    
    .row-label {
      min-width: 60px;
      font-size: 0.875rem;
      font-weight: 500;
      color: #666;
    }
    
    .cells-container {
      position: relative;
      height: 100%;
      flex: 1;
      border: 1px solid #e0e0e0;
    }
    
    .heatmap-cell {
      position: absolute;
      top: 0;
      height: 100%;
      border-right: 1px solid rgba(255, 255, 255, 0.2);
      cursor: pointer;
      transition: opacity 0.2s;
    }
    
    .heatmap-cell:hover {
      opacity: 0.8;
      border: 1px solid rgba(0, 0, 0, 0.3);
    }
    
    .no-data {
      padding: 2rem;
      text-align: center;
      color: #999;
    }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeatmapChartHeatmapComponent {
  heatmapData = input.required<HeatmapDataset | null>();
  chartBarCount = input.required<number>();
  colorScheme = input<HeatmapColorScheme>({ type: 'dynamic', variation: 'standard' });
  
  private dailyAlignments = computed(() => {
    const data = this.heatmapData();
    if (!data?.daily) return new Map<string, CellAlignment>();
    return this.calculateAlignments(data.daily);
  });
  
  private weeklyAlignments = computed(() => {
    const data = this.heatmapData();
    if (!data?.weekly) return new Map<string, CellAlignment>();
    return this.calculateAlignments(data.weekly);
  });
  
  private monthlyAlignments = computed(() => {
    const data = this.heatmapData();
    if (!data?.monthly) return new Map<string, CellAlignment>();
    return this.calculateAlignments(data.monthly);
  });
  
  containerWidth = computed(() => {
    const barCount = this.chartBarCount();
    const cellWidth = 10;
    return barCount * cellWidth;
  });

  getCellLeft(cell: HeatmapCell, interval: 'daily' | 'weekly' | 'monthly'): number {
    const alignments = interval === 'daily' 
      ? this.dailyAlignments() 
      : interval === 'weekly' 
      ? this.weeklyAlignments() 
      : this.monthlyAlignments();
    
    const alignment = alignments.get(cell.date);
    return alignment?.left ?? 0;
  }

  getCellWidth(cell: HeatmapCell, interval: 'daily' | 'weekly' | 'monthly'): number {
    const alignments = interval === 'daily' 
      ? this.dailyAlignments() 
      : interval === 'weekly' 
      ? this.weeklyAlignments() 
      : this.monthlyAlignments();
    
    const alignment = alignments.get(cell.date);
    return alignment?.width ?? 10;
  }

  getCellTooltip(cell: HeatmapCell): string {
    return `${cell.date}: RS ${cell.rsValue.toFixed(2)} (${cell.phase})`;
  }

  private calculateAlignments(row: HeatmapRow): Map<string, CellAlignment> {
    const data = this.heatmapData();
    if (!data?.daily) return new Map();
    
    const dailyDates = data.daily.cells.map(c => c.date);
    const metrics = this.createMetricsFromDates(dailyDates);
    
    return calculateRowAlignments(row.cells, metrics);
  }

  private createMetricsFromDates(dates: string[]): AlignmentMetrics {
    const dateToIndex = new Map<string, number>();
    const indexToDate = new Map<number, string>();
    
    dates.forEach((date, index) => {
      dateToIndex.set(date, index);
      indexToDate.set(index, date);
    });
    
    const cellWidth = 10;
    
    return {
      barWidth: cellWidth,
      totalBars: dates.length,
      dateToIndex,
      indexToDate,
    };
  }
}
