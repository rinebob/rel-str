/**
 * Chart Toolbar State Service
 *
 * Page-scoped view state for the chart toolbar — hoisted out of
 * SignalDetailComponent (#1232/#1255) so the page-level merged toolbar
 * (chart-view) and the detail component's charts share one source.
 *
 * Scope: provide on the page component (`providers: [...]`) — instances die
 * with the page, so interval/range/indicator prefs reset per visit. Global
 * layout prefs (chart layout, fullscreen) stay in UiStateService.
 *
 * Indicator-selection semantics preserved verbatim from SignalDetailComponent:
 * - per-interval selection sets (`selectedIdsByInterval`)
 * - `indicatorScope` — triple layout: D/W/M; single: the active interval
 * - an id shows checked only when on in ALL in-scope supporting intervals
 * - `applyIndicatorToggle` writes the whole batch in one signal update
 */
import { Injectable, inject, signal, computed } from '@angular/core';

import { BarsInterval } from '../../../core/models/partner.types';
import { UiStateService, ChartLayout } from '../../../core/services/ui-state.service';
import type { IndicatorOption, ChartRange } from '../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey, StIndicator } from '../../shared/components/flex-chart/flex-chart.types';
import { chartIntervalKey } from '../utils/chart-indicators';
import { ST_INDICATOR_OPTIONS } from '../../shared/components/flex-chart/indicators/indicator-registry';
import { ST_SIGNAL_DOTS_INDICATOR } from '../../shared/components/flex-chart/indicators/st-signal-dots.indicator';
import {
  ST_TRIGGER_BANDS_DOTS_INDICATOR,
  ST_TRIGGER_BANDS_INDICATOR,
} from '../../shared/components/flex-chart/indicators/st-trigger-bands.indicator';
import {
  ST_ZONE_V1_UPTICK_DOTS_INDICATOR,
  ST_ZONE_V2_UPTICK_DOTS_INDICATOR,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
} from '../utils/chart-indicators';

/** Savant Trader indicator menu options: shared ST base (includes Trigger Bands
 *  bands since #932) + Savant Trader-specific HTF zone windows + the Trigger
 *  Bands dots — a separate opt-in entry so the pullback warning can be toggled
 *  independently of the bands. */
export const ST_EXTRA_INDICATOR_OPTIONS: IndicatorOption[] = [
  ...ST_INDICATOR_OPTIONS,
  ST_ZONE_WINDOW_WEEKLY_INDICATOR,
  ST_ZONE_WINDOW_MONTHLY_INDICATOR,
  ST_TRIGGER_BANDS_DOTS_INDICATOR,
];

/** Indicator IDs offered in the menu per interval — a superset of
 *  `chart-indicators`' `INDICATORS_BY_INTERVAL` (the default-on base set):
 *  menu offers include opt-in entries the defaults exclude. All IDs reference
 *  the same option objects used in the menu (id === type by convention). */
export const INDICATOR_MENU_BY_INTERVAL: Record<ChartIntervalKey, string[]> = {
  [ChartIntervalKey.DAILY]: [
    StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
    ST_SIGNAL_DOTS_INDICATOR.id, ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id,
    ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id,
    ST_ZONE_WINDOW_WEEKLY_INDICATOR.id,
    StIndicator.ST_STD_DEV_LINES,
    ST_TRIGGER_BANDS_INDICATOR.id, ST_TRIGGER_BANDS_DOTS_INDICATOR.id,
  ],
  [ChartIntervalKey.WEEKLY]: [
    StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
    ST_SIGNAL_DOTS_INDICATOR.id, ST_ZONE_V1_UPTICK_DOTS_INDICATOR.id,
    ST_ZONE_V2_UPTICK_DOTS_INDICATOR.id,
    ST_ZONE_WINDOW_MONTHLY_INDICATOR.id,
    ST_TRIGGER_BANDS_INDICATOR.id, ST_TRIGGER_BANDS_DOTS_INDICATOR.id,
  ],
  [ChartIntervalKey.MONTHLY]: [
    StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
  ],
  // Never selectable here (the interval switch is BarsInterval D/W/M) —
  // present only to keep the Record exhaustive.
  [ChartIntervalKey.TWO_DAY]: [
    StIndicator.TREND_BANDS, StIndicator.TREND_STRENGTH, StIndicator.ZONE, StIndicator.ZONE_V2,
  ],
};

/** Allowlisted ids that start UNCHECKED — enabling them triggers the opt-in
 *  Trigger Bands callable request, so they must not fire on first paint.
 *  Trigger Bands carries no monthly data (lean request is D/W only), which
 *  is also why monthly excludes it above. */
const OPT_IN_INDICATOR_IDS = new Set<string>([
  ST_TRIGGER_BANDS_INDICATOR.id,
  ST_TRIGGER_BANDS_DOTS_INDICATOR.id,
]);

/** Default-on selection for an interval: the allowlist minus opt-in ids. */
function defaultSelection(key: ChartIntervalKey): Set<string> {
  return new Set(INDICATOR_MENU_BY_INTERVAL[key].filter((id) => !OPT_IN_INDICATOR_IDS.has(id)));
}

@Injectable()
export class ChartToolbarStateService {
  private readonly uiStateService = inject(UiStateService);

  /** The interval currently rendered in single-chart mode. */
  readonly selectedInterval = signal<BarsInterval>(BarsInterval.DAILY);
  /** Selected time-range preset controlling `visibleBars` on all charts. */
  readonly selectedRange = signal<ChartRange>('recent');
  /** Whether the Syncfusion zoom/pan toolbar is visible on all charts. */
  readonly showZoomToolbar = signal(false);
  /** The chart interval whose indicator-menu badge reads 'active' — tracks
   *  `selectedInterval` in single mode, last-clicked chart in triple. */
  readonly activeChartInterval = signal<BarsInterval>(BarsInterval.DAILY);
  /** Price-axis scale mode shared across all charts — defaults to log. */
  readonly logScale = signal(true);

  /** Per-interval selected indicator ID sets. Written atomically once per
   *  batch (see `applyIndicatorToggle`) so a single signal write triggers one
   *  reactive propagation through the indicator computed chain. */
  readonly selectedIdsByInterval = signal<Record<ChartIntervalKey, Set<string>>>({
    [ChartIntervalKey.DAILY]:   defaultSelection(ChartIntervalKey.DAILY),
    [ChartIntervalKey.WEEKLY]:  defaultSelection(ChartIntervalKey.WEEKLY),
    [ChartIntervalKey.MONTHLY]: defaultSelection(ChartIntervalKey.MONTHLY),
    [ChartIntervalKey.TWO_DAY]: defaultSelection(ChartIntervalKey.TWO_DAY),
  });

  /** The interval keys currently in scope for indicator menu actions.
   *  Triple layout: all three intervals. Single: the active interval only. */
  readonly indicatorScope = computed<ChartIntervalKey[]>(() => {
    if (this.uiStateService.chartLayout() === ChartLayout.TRIPLE) {
      return [ChartIntervalKey.DAILY, ChartIntervalKey.WEEKLY, ChartIntervalKey.MONTHLY];
    }
    return [chartIntervalKey(this.activeChartInterval())];
  });

  /** Indicator options visible in the menu — union of all in-scope intervals. */
  readonly activeChartIndicatorOptions = computed<IndicatorOption[]>(() => {
    const allowed = new Set(this.indicatorScope().flatMap((k) => INDICATOR_MENU_BY_INTERVAL[k]));
    return ST_EXTRA_INDICATOR_OPTIONS.filter((o) => allowed.has(o.id));
  });

  /** Selected indicator IDs for the menu. An indicator is checked only if it
   *  is on in ALL in-scope intervals that support it. */
  readonly activeSelectedIndicatorIds = computed<Set<string>>(() => {
    const scope = this.indicatorScope();
    const current = this.selectedIdsByInterval();
    return new Set(
      ST_EXTRA_INDICATOR_OPTIONS
        .filter((o) => {
          const supportingKeys = scope.filter((k) => INDICATOR_MENU_BY_INTERVAL[k].includes(o.id));
          return supportingKeys.length > 0 && supportingKeys.every((k) => current[k].has(o.id));
        })
        .map((o) => o.id),
    );
  });

  /** D/W/M pill click — updates both `selectedInterval` (single-mode data)
   *  and `activeChartInterval` (toolbar badge). */
  setInterval(interval: BarsInterval): void {
    this.selectedInterval.set(interval);
    this.activeChartInterval.set(interval);
  }

  /** Triple-mode chart-cell click — moves the badge only. */
  setActiveChart(interval: BarsInterval): void {
    this.activeChartInterval.set(interval);
  }

  setRange(range: ChartRange): void {
    this.selectedRange.set(range);
  }

  toggleZoomToolbar(): void {
    this.showZoomToolbar.update((v) => !v);
  }

  toggleLogScale(): void {
    this.logScale.update((v) => !v);
  }

  /** Apply a batch of toggled indicator IDs atomically — a single
   *  `selectedIdsByInterval` update so Angular emits exactly one change
   *  notification regardless of batch size. Each ID toggles on every
   *  in-scope interval that supports it. */
  applyIndicatorToggle(optionIds: string[]): void {
    const scope = this.indicatorScope();
    this.selectedIdsByInterval.update((current) => {
      const updated = { ...current };
      for (const optionId of optionIds) {
        const keysToUpdate = scope.filter((k) => INDICATOR_MENU_BY_INTERVAL[k].includes(optionId));
        for (const k of keysToUpdate) {
          const next = new Set(updated[k]);
          if (next.has(optionId)) next.delete(optionId); else next.add(optionId);
          updated[k] = next;
        }
      }
      return updated;
    });
  }
}
