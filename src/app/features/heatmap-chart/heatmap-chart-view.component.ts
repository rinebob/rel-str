import { Component, OnInit, OnDestroy, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';

import { BarsInterval } from '../../core/models/partner.types';
import { HeatmapChartStore } from './heatmap-chart.store';
import type { HeatmapChartQuery } from './heatmap-chart.types';

@Component({
  selector: 'app-heatmap-chart-view',
  standalone: true,
  imports: [CommonModule],
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
          <!-- Chart component will go here -->
          <div class="chart-placeholder">
            <p>Chart: {{ vm.chartData?.bars?.length || 0 }} bars</p>
          </div>
        </div>
        
        <div class="heatmap-container">
          <!-- Heatmap component will go here -->
          <div class="heatmap-placeholder">
            <p>Heatmap rows:</p>
            <p>Daily: {{ vm.heatmapData?.daily?.cells?.length || 0 }} cells</p>
            <p>Weekly: {{ vm.heatmapData?.weekly?.cells?.length || 0 }} cells</p>
            <p>Monthly: {{ vm.heatmapData?.monthly?.cells?.length || 0 }} cells</p>
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .heatmap-chart-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding: 1rem;
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
      flex: 2;
      min-height: 400px;
      border: 1px solid #ccc;
      margin-bottom: 1rem;
    }
    
    .heatmap-container {
      flex: 1;
      min-height: 200px;
      border: 1px solid #ccc;
    }
    
    .chart-placeholder,
    .heatmap-placeholder {
      padding: 2rem;
      text-align: center;
      color: #666;
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
