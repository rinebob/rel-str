/**
 * ChartToolbarStateService specs (#1232/#1255).
 *
 * The service owns the chart-toolbar view state hoisted out of
 * SignalDetailComponent so the page-level merged toolbar (chart-view) and the
 * detail component share one source. These specs pin the semantics the
 * refactor must preserve: defaults, interval coupling, indicator-selection
 * scope rules, and atomic selection writes.
 */
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

import { ChartToolbarStateService } from './chart-toolbar-state.service';
import { UiStateService, ChartLayout } from '../../../core/services/ui-state.service';
import { BarsInterval } from '../../../core/models/partner.types';
import { ChartIntervalKey, StIndicator } from '../../shared/components/flex-chart/flex-chart.types';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import { ST_TRIGGER_BANDS_INDICATOR } from '../../shared/components/flex-chart/indicators/st-trigger-bands.indicator';

describe('ChartToolbarStateService', () => {
  let service: ChartToolbarStateService;
  const mockUiState = {
    chartLayout: signal(ChartLayout.TRIPLE),
  };

  beforeEach(() => {
    mockUiState.chartLayout.set(ChartLayout.TRIPLE);
    TestBed.configureTestingModule({
      providers: [
        ChartToolbarStateService,
        { provide: UiStateService, useValue: mockUiState },
      ],
    });
    service = TestBed.inject(ChartToolbarStateService);
  });

  describe('defaults', () => {
    it('starts on daily interval, recent range, log scale, zoom hidden', () => {
      expect(service.selectedInterval()).toBe(BarsInterval.DAILY);
      expect(service.selectedRange()).toBe('recent');
      expect(service.activeChartInterval()).toBe(BarsInterval.DAILY);
      expect(service.showZoomToolbar()).toBe(false);
      expect(service.logScale()).toBe(true);
    });

    it('seeds every interval with its default selection minus opt-in indicators', () => {
      const sel = service.selectedIdsByInterval();
      // Trigger Bands are opt-in — never on by default.
      expect(sel[ChartIntervalKey.DAILY].has(ST_TRIGGER_BANDS_INDICATOR.id)).toBe(false);
      expect(sel[ChartIntervalKey.WEEKLY].has(ST_TRIGGER_BANDS_INDICATOR.id)).toBe(false);
      // A standard indicator IS on by default.
      expect(sel[ChartIntervalKey.DAILY].has(StIndicator.TREND_BANDS)).toBe(true);
      expect(sel[ChartIntervalKey.MONTHLY].has(StIndicator.ZONE)).toBe(true);
    });
  });

  describe('page scope', () => {
    it('a fresh page-scoped instance resets prefs — nothing leaks across visits', () => {
      service.setInterval(BarsInterval.WEEKLY);
      service.setRange('5y');
      service.toggleLogScale();
      service.applyIndicatorToggle([ST_SIGNAL_DOTS_INDICATOR.id]);

      const fresh = TestBed.inject(ChartToolbarStateService, null, { optional: true });
      expect(fresh).toBe(service); // same injector → same instance
      // Simulate a new page visit: a new injector produces default state.
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          ChartToolbarStateService,
          { provide: UiStateService, useValue: mockUiState },
        ],
      });
      const revisit = TestBed.inject(ChartToolbarStateService);
      expect(revisit.selectedInterval()).toBe(BarsInterval.DAILY);
      expect(revisit.selectedRange()).toBe('recent');
      expect(revisit.logScale()).toBe(true);
      expect(revisit.selectedIdsByInterval()[ChartIntervalKey.DAILY].has(ST_SIGNAL_DOTS_INDICATOR.id)).toBe(true);
    });
  });

  describe('setInterval', () => {
    it('updates both selectedInterval (single-mode data) and activeChartInterval (badge)', () => {
      service.setInterval(BarsInterval.WEEKLY);
      expect(service.selectedInterval()).toBe(BarsInterval.WEEKLY);
      expect(service.activeChartInterval()).toBe(BarsInterval.WEEKLY);
    });
  });

  describe('setActiveChart', () => {
    it('moves the badge without touching selectedInterval', () => {
      service.setActiveChart(BarsInterval.MONTHLY);
      expect(service.activeChartInterval()).toBe(BarsInterval.MONTHLY);
      expect(service.selectedInterval()).toBe(BarsInterval.DAILY);
    });
  });

  describe('toggles', () => {
    it('toggleLogScale flips the price-axis mode', () => {
      service.toggleLogScale();
      expect(service.logScale()).toBe(false);
      service.toggleLogScale();
      expect(service.logScale()).toBe(true);
    });

    it('toggleZoomToolbar flips zoom visibility', () => {
      service.toggleZoomToolbar();
      expect(service.showZoomToolbar()).toBe(true);
    });

    it('setRange updates the range preset', () => {
      service.setRange('5y');
      expect(service.selectedRange()).toBe('5y');
    });
  });

  describe('indicatorScope', () => {
    it('is all three intervals in triple layout', () => {
      expect(service.indicatorScope()).toEqual([
        ChartIntervalKey.DAILY,
        ChartIntervalKey.WEEKLY,
        ChartIntervalKey.MONTHLY,
      ]);
    });

    it('is only the active interval in single layout', () => {
      mockUiState.chartLayout.set(ChartLayout.SINGLE);
      service.setActiveChart(BarsInterval.WEEKLY);
      expect(service.indicatorScope()).toEqual([ChartIntervalKey.WEEKLY]);
    });
  });

  describe('applyIndicatorToggle', () => {
    it('toggles an id on every in-scope interval that supports it (triple)', () => {
      // Signal dots are supported on D+W, not monthly — triple scope covers all.
      service.applyIndicatorToggle([ST_SIGNAL_DOTS_INDICATOR.id]);
      const sel = service.selectedIdsByInterval();
      expect(sel[ChartIntervalKey.DAILY].has(ST_SIGNAL_DOTS_INDICATOR.id)).toBe(false);
      expect(sel[ChartIntervalKey.WEEKLY].has(ST_SIGNAL_DOTS_INDICATOR.id)).toBe(false);
      expect(sel[ChartIntervalKey.MONTHLY].has(ST_SIGNAL_DOTS_INDICATOR.id)).toBe(false);
    });

    it('does not touch intervals outside the scope (single layout)', () => {
      mockUiState.chartLayout.set(ChartLayout.SINGLE);
      service.setActiveChart(BarsInterval.DAILY);
      service.applyIndicatorToggle([StIndicator.ZONE]);
      const sel = service.selectedIdsByInterval();
      expect(sel[ChartIntervalKey.DAILY].has(StIndicator.ZONE)).toBe(false);
      // Weekly/monthly untouched — still on (default selection).
      expect(sel[ChartIntervalKey.WEEKLY].has(StIndicator.ZONE)).toBe(true);
      expect(sel[ChartIntervalKey.MONTHLY].has(StIndicator.ZONE)).toBe(true);
    });

    it('ignores ids no in-scope interval supports — a no-op write', () => {
      const before = service.selectedIdsByInterval();
      service.applyIndicatorToggle(['not-a-real-indicator']);
      const after = service.selectedIdsByInterval();
      // Every interval's Set is untouched — the unknown id matched nothing.
      for (const key of Object.values(ChartIntervalKey)) {
        expect(after[key]).toBe(before[key]);
      }
    });

    it('applies a multi-id batch in one update', () => {
      service.applyIndicatorToggle([StIndicator.ZONE, StIndicator.TREND_BANDS]);
      const sel = service.selectedIdsByInterval();
      expect(sel[ChartIntervalKey.DAILY].has(StIndicator.ZONE)).toBe(false);
      expect(sel[ChartIntervalKey.WEEKLY].has(StIndicator.ZONE)).toBe(false);
      expect(sel[ChartIntervalKey.MONTHLY].has(StIndicator.ZONE)).toBe(false);
      expect(sel[ChartIntervalKey.DAILY].has(StIndicator.TREND_BANDS)).toBe(false);
    });

    it('toggles back on with a second call', () => {
      service.applyIndicatorToggle([StIndicator.ZONE]);
      service.applyIndicatorToggle([StIndicator.ZONE]);
      expect(service.selectedIdsByInterval()[ChartIntervalKey.DAILY].has(StIndicator.ZONE)).toBe(true);
    });
  });

  describe('activeSelectedIndicatorIds', () => {
    it('reports an id checked only when on in ALL in-scope intervals that support it', () => {
      // Turn ZONE off on daily only by narrowing scope first.
      mockUiState.chartLayout.set(ChartLayout.SINGLE);
      service.setActiveChart(BarsInterval.DAILY);
      service.applyIndicatorToggle([StIndicator.ZONE]);
      mockUiState.chartLayout.set(ChartLayout.TRIPLE);

      // ZONE is off on daily → not checked in the triple-scope menu.
      expect(service.activeSelectedIndicatorIds().has(StIndicator.ZONE)).toBe(false);
    });

    it('excludes ids unsupported by every in-scope interval', () => {
      // Monthly-only scope can't surface signal dots (not in monthly's list).
      mockUiState.chartLayout.set(ChartLayout.SINGLE);
      service.setActiveChart(BarsInterval.MONTHLY);
      expect(service.activeSelectedIndicatorIds().has(ST_SIGNAL_DOTS_INDICATOR.id)).toBe(false);
    });
  });
});
