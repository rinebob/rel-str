/**
 * Signal History Component
 *
 * Standalone page that generates and displays historical signals
 * for a given symbol across D/W/M timeframes using the ST-Zone
 * and ST-Trend-Strength indicator signal detectors.
 */
import { Component, inject, signal, computed, effect, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { forkJoin } from 'rxjs';

import { BarsInterval } from '../../../../core/models/partner.types';
import { HeatmapChartDataService } from '../../../heatmap-chart/heatmap-chart-data.service';
import type { ChartDataset } from '../../../heatmap-chart/heatmap-chart.types';
import type { PriceBar } from '../../../shared/components/flex-chart/flex-chart.types';
import { calculateStZone } from '../../../shared/components/flex-chart/indicators/st-zone.indicator';
import { calculateStTrendStrength } from '../../../shared/components/flex-chart/indicators/st-trend-strength.indicator';
import { detectZoneSignals } from '../../../shared/components/flex-chart/signals/st-zone.signals';
import { detectTrendStrengthSignals } from '../../../shared/components/flex-chart/signals/st-trend-strength.signals';
import type { SignalMarker } from '../../../shared/components/flex-chart/signals/signal.types';
import { SignalTableComponent, SignalTableRow } from '../../components/signal-table/signal-table.component';

interface TimeframeSignals {
  interval: string;
  zone: SignalMarker[];
  strength: SignalMarker[];
  all: SignalMarker[];
}

@Component({
  selector: 'app-signal-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    SignalTableComponent,
  ],
  templateUrl: './signal-history.component.html',
  styleUrl: './signal-history.component.scss',
})
export class SignalHistoryComponent {
  private readonly dataService = inject(HeatmapChartDataService);
  private readonly router = inject(Router);

  symbolInput = signal('AAPL');
  loading = signal(false);
  currentSymbol = signal<string | null>(null);

  daily = signal<TimeframeSignals | null>(null);
  weekly = signal<TimeframeSignals | null>(null);
  monthly = signal<TimeframeSignals | null>(null);

  /** Active source filter */
  sourceFilter = signal<'all' | 'st-zone' | 'st-trend-strength'>('all');

  /** Active direction filter */
  directionFilter = signal<'all' | 'long' | 'short'>('all');

  /** Active timeframe filter */
  timeframeFilter = signal<'all' | 'daily' | 'weekly' | 'monthly'>('all');

  /** All signals combined and filtered */
  filteredSignals = computed<SignalTableRow[]>(() => {
    const d = this.daily();
    const w = this.weekly();
    const m = this.monthly();
    const source = this.sourceFilter();
    const direction = this.directionFilter();
    const tf = this.timeframeFilter();

    let signals: SignalTableRow[] = [];

    if (d && (tf === 'all' || tf === 'daily')) {
      signals.push(...d.all.map(s => ({ ...s, timeframe: 'Daily' })));
    }
    if (w && (tf === 'all' || tf === 'weekly')) {
      signals.push(...w.all.map(s => ({ ...s, timeframe: 'Weekly' })));
    }
    if (m && (tf === 'all' || tf === 'monthly')) {
      signals.push(...m.all.map(s => ({ ...s, timeframe: 'Monthly' })));
    }

    if (source !== 'all') {
      signals = signals.filter(s => s.source === source);
    }
    if (direction !== 'all') {
      signals = signals.filter(s => s.direction === direction);
    }

    // Sort by date descending (most recent first)
    signals.sort((a, b) => b.x.getTime() - a.x.getTime());
    return signals;
  });

  /** Summary counts */
  summary = computed(() => {
    const signals = this.filteredSignals();
    return {
      total: signals.length,
      long: signals.filter(s => s.direction === 'long').length,
      short: signals.filter(s => s.direction === 'short').length,
      zone: signals.filter(s => s.source === 'st-zone').length,
      strength: signals.filter(s => s.source === 'st-trend-strength').length,
    };
  });

  /** Navigate back to the RH Agent dashboard. */
  goBack(): void {
    this.router.navigate(['/rh-agent']);
  }

  /** Load D/W/M chart data and generate signals for the current symbol input. */
  loadSignals(): void {
    const symbol = this.symbolInput().trim().toUpperCase();
    if (!symbol) return;

    this.loading.set(true);
    this.currentSymbol.set(symbol);

    const baseline = 'SPY';

    forkJoin({
      daily: this.dataService.fetchChartData$(baseline, symbol, BarsInterval.DAILY),
      weekly: this.dataService.fetchChartData$(baseline, symbol, BarsInterval.WEEKLY),
      monthly: this.dataService.fetchChartData$(baseline, symbol, BarsInterval.MONTHLY),
    }).subscribe({
      next: ({ daily, weekly, monthly }) => {
        this.daily.set(this.generateSignals(daily, 'Daily'));
        this.weekly.set(this.generateSignals(weekly, 'Weekly'));
        this.monthly.set(this.generateSignals(monthly, 'Monthly'));
        this.loading.set(false);
      },
      error: (err) => {
        console.error('[SignalHistory] Error loading data:', err);
        this.loading.set(false);
      },
    });
  }

  /** Generate ST-Zone and ST-Trend-Strength signals for a single chart dataset. */
  private generateSignals(dataset: ChartDataset, interval: string): TimeframeSignals {
    const bars = dataset.bars;
    const params = {};

    // Calculate indicator values
    const zoneData = calculateStZone(bars, params);
    const strengthData = calculateStTrendStrength(bars, params);

    // Detect signals
    const zoneSignals = detectZoneSignals(zoneData, bars);
    const strengthSignals = detectTrendStrengthSignals(strengthData, bars);

    const all = [...zoneSignals, ...strengthSignals].sort(
      (a, b) => a.x.getTime() - b.x.getTime()
    );

    return { interval, zone: zoneSignals, strength: strengthSignals, all };
  }

  /** Handle Enter key in the symbol input to trigger signal loading. */
  onSymbolKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      this.loadSignals();
    }
  }
}
