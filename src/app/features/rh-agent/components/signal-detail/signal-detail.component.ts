/**
 * Signal Detail Component
 *
 * Detail panel for the review interface.
 */
import { Component, inject, ChangeDetectionStrategy, output, effect, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';

import { RhAgentDashboardStore } from '../../rh-agent-dashboard.store';
import { HeatmapChartStore } from '../../../heatmap-chart/heatmap-chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import type { FlexChartConfig, IndicatorConfig, IndicatorPane, IndicatorOption } from '../../../shared/components/flex-chart/flex-chart.types';
import { INDICATOR_OPTIONS } from '../../../shared/components/flex-chart/indicators/indicator-registry';
import { IndicatorConfigDialogComponent } from '../indicator-config-dialog/indicator-config-dialog.component';

@Component({
  selector: 'app-signal-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatCardModule, MatButtonModule, MatIconModule, MatTooltipModule, MatMenuModule, MatProgressSpinnerModule, FlexChartComponent],
  templateUrl: './signal-detail.component.html',
  styleUrl: './signal-detail.component.scss',
})
export class SignalDetailComponent {
  readonly uiStore = inject(RhAgentDashboardStore);
  readonly chartStore = inject(HeatmapChartStore);
  private readonly dialog = inject(MatDialog);

  signalAccepted = output<string>();
  signalConsidered = output<string>();
  signalRejected = output<string>();

  signal = this.uiStore.selectedSignal;
  hasSignal = this.uiStore.hasSelectedSignal;
  chartData = this.chartStore.chartData;
  chartLoading = this.chartStore.loading;

  /** User-added indicators */
  activeIndicators = signal<IndicatorConfig[]>([]);

  /** Available indicators for the dropdown */
  indicatorOptions = INDICATOR_OPTIONS;

  /** Dynamic chart config driven by user-added indicators */
  chartConfig = computed<FlexChartConfig>(() => {
    return {
      indicators: this.activeIndicators(),
      showCrosshair: true,
      showZoomToolbar: true,
      enableScrollbar: true,
      initialZoomDays: 60,
    };
  });

  /** Open config dialog for the selected indicator type */
  onAddIndicator(option: IndicatorOption): void {
    const pane = this.getNextAvailablePane(option);

    const dialogRef = this.dialog.open(IndicatorConfigDialogComponent, {
      data: { indicator: option, pane },
      width: '360px',
    });

    dialogRef.afterClosed().subscribe((result: IndicatorConfig | undefined) => {
      if (result) {
        this.activeIndicators.update(current => [...current, result]);
      }
    });
  }

  /** Remove an indicator from the chart */
  onRemoveIndicator(id: string): void {
    this.activeIndicators.update(current => current.filter(i => i.id !== id));
  }

  /** Determine which pane to assign based on indicator type and what's already active */
  private getNextAvailablePane(option: IndicatorOption): IndicatorPane {
    if (option.defaultPane === 'main') return 'main';

    const active = this.activeIndicators();
    const usedLowerPanes = new Set(
      active.filter(i => i.pane.startsWith('lower-')).map(i => i.pane)
    );

    const allLower: IndicatorPane[] = ['lower-1', 'lower-2', 'lower-3', 'lower-4'];
    for (const pane of allLower) {
      if (!usedLowerPanes.has(pane)) return pane;
    }
    return 'lower-4'; // Max reached, stack on last
  }

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
