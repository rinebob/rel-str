import { Component, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { BarsInterval } from '../../core/models/partner.types';
import { HeatmapChartStore } from './heatmap-chart.store';
import type { HeatmapChartQuery } from './heatmap-chart.types';
import { HeatmapChartChartComponent } from './components/heatmap-chart-chart.component';
import { HeatmapChartHeatmapComponent } from './components/heatmap-chart-heatmap.component';

@Component({
  selector: 'app-heatmap-chart-view',
  standalone: true,
  imports: [CommonModule, HeatmapChartChartComponent, HeatmapChartHeatmapComponent],
  template: `
    <div class="heatmap-chart-view">
      @if (store.loading()) {
        <div class="loading-indicator">
          <p>Loading chart data...</p>
        </div>
      }
      
      @if (store.error()) {
        <div class="error-message">
          <p>Error: {{ store.error() }}</p>
        </div>
      }
      
      @if (store.viewModel(); as vm) {
        <div class="view-header">
          <div class="pair-info">
            <h2>{{ vm.query.symbol }} / {{ vm.query.baseline }}</h2>
            <span class="interval-badge">{{ vm.query.interval }}</span>
          </div>
          
          <div class="controls">
            <!-- Timeframe selector will go here -->
            <div class="timeframe-selector">
              <button 
                [class.active]="vm.query.interval === 'DAILY'"
                (click)="onIntervalChange('DAILY')">
                Daily
              </button>
              <button 
                [class.active]="vm.query.interval === 'WEEKLY'"
                (click)="onIntervalChange('WEEKLY')">
                Weekly
              </button>
              <button 
                [class.active]="vm.query.interval === 'MONTHLY'"
                (click)="onIntervalChange('MONTHLY')">
                Monthly
              </button>
            </div>
            
            <!-- List navigation will go here -->
            @if (vm.query.listContext) {
              <div class="list-navigator">
                <button 
                  [disabled]="!store.canNavigatePrevious()"
                  (click)="onNavigatePrevious()">
                  ← Previous
                </button>
                <span class="position">
                  {{ vm.query.listContext.currentIndex + 1 }} / {{ vm.query.listContext.pairIds.length }}
                </span>
                <button 
                  [disabled]="!store.canNavigateNext()"
                  (click)="onNavigateNext()">
                  Next →
                </button>
              </div>
            }
          </div>
        </div>
        
        <div class="chart-container">
          <app-heatmap-chart-chart
            [chartData]="vm.chartData"
            [height]="'100%'">
          </app-heatmap-chart-chart>
        </div>
        
        <div class="heatmap-container">
          <app-heatmap-chart-heatmap
            [heatmapData]="vm.heatmapData"
            [chartBarCount]="vm.chartData?.bars?.length || 0"
            [colorScheme]="vm.colorScheme">
          </app-heatmap-chart-heatmap>
        </div>
      }
    </div>
  `,
  styles: [`
    .heatmap-chart-view {
      display: flex;
      flex-direction: column;
      height: 100vh;
      padding: 1rem;
      box-sizing: border-box;
    }
    
    .loading-indicator,
    .error-message {
      padding: 2rem;
      text-align: center;
    }
    
    .error-message {
      color: #ff0000;
    }
    
    .view-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px solid #ccc;
      flex-shrink: 0;
    }
    
    .pair-info {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    
    .pair-info h2 {
      margin: 0;
      font-size: 1.5rem;
    }
    
    .interval-badge {
      padding: 0.25rem 0.5rem;
      background: #007bff;
      color: white;
      border-radius: 0.25rem;
      font-size: 0.875rem;
    }
    
    .controls {
      display: flex;
      gap: 1rem;
      align-items: center;
    }
    
    .timeframe-selector {
      display: flex;
      gap: 0.5rem;
    }
    
    .timeframe-selector button {
      padding: 0.5rem 1rem;
      border: 1px solid #ccc;
      background: white;
      cursor: pointer;
    }
    
    .timeframe-selector button.active {
      background: #007bff;
      color: white;
      border-color: #007bff;
    }
    
    .list-navigator {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    
    .list-navigator button {
      padding: 0.5rem 1rem;
      border: 1px solid #ccc;
      background: white;
      cursor: pointer;
    }
    
    .list-navigator button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    
    .position {
      padding: 0 0.5rem;
      font-size: 0.875rem;
    }
    
    .chart-container {
      flex: 1 1 auto;
      min-height: 300px;
      margin-bottom: 1rem;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow: hidden;
    }
    
    .heatmap-container {
      flex: 0 0 200px;
      border: 1px solid #e0e0e0;
      border-radius: 4px;
      overflow-y: auto;
      overflow-x: hidden;
    }
  `]
})
export class HeatmapChartViewComponent implements OnInit, OnDestroy {
  readonly store = inject(HeatmapChartStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly destroy$ = new Subject<void>();

  ngOnInit(): void {
    this.route.params.pipe(takeUntil(this.destroy$)).subscribe((params) => {
      const baseline = params['baseline'];
      const symbol = params['symbol'];
      
      if (!baseline || !symbol) {
        console.error('Missing baseline or symbol in route params');
        return;
      }

      const query: HeatmapChartQuery = {
        baseline,
        symbol,
        interval: BarsInterval.DAILY,
      };

      this.store.loadData(query);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
    this.store.reset();
  }

  onIntervalChange(interval: string): void {
    const barsInterval = interval as BarsInterval;
    this.store.setInterval(barsInterval);
  }

  onNavigateNext(): void {
    this.store.navigateNext();
  }

  onNavigatePrevious(): void {
    this.store.navigatePrevious();
  }
}
