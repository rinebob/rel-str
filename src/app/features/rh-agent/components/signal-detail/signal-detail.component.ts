/**
 * Signal Detail Component
 *
 * Detail panel for the review interface.
 */
import { Component, inject, ChangeDetectionStrategy, output, effect, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { RhAgentDashboardStore } from '../../rh-agent-dashboard.store';
import { HeatmapChartStore } from '../../../heatmap-chart/heatmap-chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import type { FlexChartConfig, IndicatorConfig } from '../../../shared/components/flex-chart/flex-chart.types';

@Component({
  selector: 'app-signal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule, FlexChartComponent],
  templateUrl: './signal-detail.component.html',
  styleUrl: './signal-detail.component.scss',
})
export class SignalDetailComponent {
  readonly uiStore = inject(RhAgentDashboardStore);
  readonly chartStore = inject(HeatmapChartStore);

  signalAccepted = output<string>();
  signalConsidered = output<string>();
  signalRejected = output<string>();

  signal = this.uiStore.selectedSignal;
  hasSignal = this.uiStore.hasSelectedSignal;
  chartData = this.chartStore.chartData;
  chartLoading = this.chartStore.loading;

  /** Dynamic chart config based on signal indicators */
  chartConfig = computed<FlexChartConfig>(() => {
    const signal = this.signal();
    if (!signal) {
      return { indicators: [] };
    }

    const indicators: IndicatorConfig[] = [];
    const signalIndicators = signal['indicators'] as Record<string, number> | undefined;
    const signalType = signal['signalType'] as string | undefined;

    // Add RSI to lower pane if relevant
    if (signalType?.includes('RSI') || signalIndicators?.['rsi'] !== undefined) {
      indicators.push({
        id: 'rsi',
        type: 'rsi',
        pane: 'lower-1',
        seriesType: 'line',
        params: { period: 14 },
        options: {
          name: 'RSI(14)',
          color: '#2196f3',
          lineWidth: 2,
        },
      });
    }

    // Add MACD to lower pane if relevant
    if (signalType?.includes('MACD') || signalIndicators?.['macd'] !== undefined) {
      indicators.push({
        id: 'macd',
        type: 'macd',
        pane: 'lower-1',
        seriesType: 'line',
        params: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 },
        options: {
          name: 'MACD',
          color: '#ff9800',
          lineWidth: 2,
        },
      });
    }

    // If signal has custom indicators, add them as display-only markers
    // (pane assignment will be configurable in future)
    if (signalIndicators) {
      for (const [key, value] of Object.entries(signalIndicators)) {
        // Skip standard indicators we already added
        if (['rsi', 'macd'].includes(key)) continue;

        // Add as custom indicator (pane assignment TBD via config system)
        indicators.push({
          id: `custom-${key}`,
          type: 'custom',
          pane: 'lower-2', // Default placement for now - will be configurable
          seriesType: 'line',
          params: {
            note: `Value: ${value.toFixed(2)}`,
          },
          options: {
            name: `${key.toUpperCase()}: ${value.toFixed(2)}`,
            color: '#607d8b',
            lineWidth: 2,
          },
        });
      }
    }

    return {
      indicators,
      showCrosshair: true,
      showZoomToolbar: true,
      enableScrollbar: true,
      initialZoomDays: 60,
    };
  });

  constructor() {
    // Load chart data when signal changes
    effect(() => {
      const signal = this.signal();
      if (signal) {
        this.chartStore.loadData({
          baseline: 'SPY',
          symbol: signal.symbol,
          interval: BarsInterval.DAILY,
        });
      }
    });
  }

  getStatus(): string {
    const s = this.signal();
    if (!s) return 'PENDING';
    return this.uiStore.getSignalStatus(s.id);
  }

  onAccept(signalId: string): void {
    this.uiStore.acceptSignal(signalId);
    this.signalAccepted.emit(signalId);
  }

  onConsider(signalId: string): void {
    this.uiStore.considerSignal(signalId);
    this.signalConsidered.emit(signalId);
  }

  onReject(signalId: string): void {
    this.uiStore.rejectSignal(signalId);
    this.signalRejected.emit(signalId);
  }
}
