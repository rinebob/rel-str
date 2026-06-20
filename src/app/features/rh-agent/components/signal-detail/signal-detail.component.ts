/**
 * Signal Detail Component
 *
 * Detail panel for the review interface.
 */
import { Component, inject, ChangeDetectionStrategy, output, effect, computed, signal, input } from '@angular/core';
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
import { UiStateService } from '../../../../core/services/ui-state.service';
import type { FlexChartConfig, IndicatorConfig, IndicatorPane, IndicatorOption } from '../../../shared/components/flex-chart/flex-chart.types';
import { INDICATOR_OPTIONS, DEFAULT_ST_INDICATORS } from '../../../shared/components/flex-chart/indicators/indicator-registry';
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
  readonly uiState = inject(UiStateService);

  /** Expose enum to template */
  readonly BarsInterval = BarsInterval;

  signalAccepted = output<string>();
  signalConsidered = output<string>();
  signalRejected = output<string>();

  /** Manual symbol override from parent (when user types a symbol directly) */
  manualSymbol = input<string | null>(null);

  signal = this.uiStore.selectedSignal;
  hasSignal = this.uiStore.hasSelectedSignal;
  /** Show chart when a signal is selected OR a manual symbol is entered */
  showChart = computed(() => this.hasSignal() || !!this.manualSymbol());
  chartData = this.chartStore.chartData;
  chartDataWeekly = this.chartStore.chartDataWeekly;
  chartDataMonthly = this.chartStore.chartDataMonthly;
  chartLoading = this.chartStore.loading;

  /** Shared crosshair date for syncing across triple charts */
  crosshairDate = signal<Date | null>(null);

  /** User-added indicators — pre-loaded with ST indicator suite */
  activeIndicators = signal<IndicatorConfig[]>([...DEFAULT_ST_INDICATORS]);

  /** Selected chart interval */
  selectedInterval = signal<BarsInterval>(BarsInterval.DAILY);

  /** When true, charts show all available data instead of a zoomed-in window */
  showAllData = signal(false);

  /** Available indicators for the dropdown */
  indicatorOptions = INDICATOR_OPTIONS;

  /** Dynamic chart config driven by user-added indicators (single mode) */
  chartConfig = computed<FlexChartConfig>(() => {
    const interval = this.selectedInterval();
    const all = this.showAllData();
    let initialZoomDays = all ? 99999 : 365;
    if (!all && interval === BarsInterval.WEEKLY) initialZoomDays = 104;
    else if (!all && interval === BarsInterval.MONTHLY) initialZoomDays = 9999;

    const intervalHint = interval === BarsInterval.WEEKLY ? 'weekly'
      : interval === BarsInterval.MONTHLY ? 'monthly' : 'daily';

    return {
      indicators: this.activeIndicators(),
      showCrosshair: true,
      showZoomToolbar: true,
      enableScrollbar: true,
      initialZoomDays,
      interval: intervalHint as 'daily' | 'weekly' | 'monthly',
    };
  });

  /** Chart config for daily chart in triple mode */
  chartConfigDaily = computed<FlexChartConfig>(() => ({
    indicators: this.activeIndicators(),
    showCrosshair: true,
    showZoomToolbar: true,
    enableScrollbar: true,
    initialZoomDays: this.showAllData() ? 99999 : 365,
    interval: 'daily' as const,
  }));

  /** Chart config for weekly chart in triple mode */
  chartConfigWeekly = computed<FlexChartConfig>(() => ({
    indicators: this.activeIndicators(),
    showCrosshair: true,
    showZoomToolbar: false,
    enableScrollbar: true,
    initialZoomDays: this.showAllData() ? 99999 : 104,
    interval: 'weekly' as const,
  }));

  /** Chart config for monthly chart in triple mode */
  chartConfigMonthly = computed<FlexChartConfig>(() => ({
    indicators: this.activeIndicators(),
    showCrosshair: true,
    showZoomToolbar: false,
    enableScrollbar: true,
    initialZoomDays: this.showAllData() ? 99999 : 9999,
    interval: 'monthly' as const,
  }));

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
    if (option.defaultPane === 'main' || option.defaultPane === 'overlay') return 'overlay';

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

  /** Change the chart interval (D/W/M) */
  onIntervalChange(interval: BarsInterval): void {
    this.selectedInterval.set(interval);
  }

  /** Update shared crosshair date for triple-chart sync */
  onCrosshairChange(date: Date | null): void {
    this.crosshairDate.set(date);
  }

  constructor() {
    // Load chart data when signal or interval changes
    effect(() => {
      const signal = this.signal();
      const interval = this.selectedInterval();
      if (signal) {
        this.chartStore.loadData({
          baseline: 'SPY',
          symbol: signal.symbol,
          interval,
        });
      }
    });

    // Load triple data when layout switches to triple or signal changes
    effect(() => {
      const signal = this.signal();
      const layout = this.uiState.chartLayout();
      if (signal && layout === 'triple') {
        this.chartStore.loadTripleData();
      }
    });

    // Load chart data when manual symbol is entered
    effect(() => {
      const symbol = this.manualSymbol();
      if (symbol) {
        const interval = this.selectedInterval();
        this.chartStore.loadData({
          baseline: 'SPY',
          symbol,
          interval,
        });
        const layout = this.uiState.chartLayout();
        if (layout === 'triple') {
          this.chartStore.loadTripleData();
        }
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
