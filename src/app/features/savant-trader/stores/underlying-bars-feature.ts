import { withMethods, patchState } from '@ngrx/signals';
import { inject, Signal } from '@angular/core';

import { LocalBarReadService } from '../../../core/services/local-bar-read.service';
import { getMarketDatePT, daysAgoPT } from '../../../core/common/pt-date-utils';
import type { PartnerHistoricalOptionsContractV2Response } from '../../../core/models/partner.types';
import type { OHLCDatum } from '../../shared/types/rs.interfaces';
import { paddedDateRange } from '../utils/contract-observation.utils';
import { toOHLCDatum } from '../utils/ohlc-datum.utils';
import { contextAnchor, contextCoverage, pickPrefixFrom, type FetchRange } from './plotted-window.utils';
import type { PlottedContract } from './plotted-contracts-feature';

/** The underlying-price slice: loaded bars, the range they were requested
 *  for, and the chart pad the fetch paths widen by. */
export interface UnderlyingBarsState {
  underlyingBars: OHLCDatum[];
  /** What the last fetch ASKED for — coverage is judged on this, not bar
   *  dates, so a weekend/holiday tail doesn't read as uncovered (see
   *  FetchRange in plotted-window.utils). Null until the first fetch lands. */
  underlyingBarsRange: FetchRange | null;
  underlyingLoading: boolean;
  chartPadDays: number;
}

export const initialUnderlyingBarsState: UnderlyingBarsState = {
  underlyingBars: [],
  underlyingBarsRange: null,
  underlyingLoading: false,
  chartPadDays: 0,
};

/** State this feature reads, cast off the loosely-typed `store` param. */
interface UnderlyingSignals {
  underlyingBarsRange: Signal<FetchRange | null>;
  contractData: Signal<PartnerHistoricalOptionsContractV2Response | null>;
  chartPadDays: Signal<number>;
  plottedContracts: Signal<Record<string, PlottedContract>>;
}

const asUnderlying = (s: unknown): UnderlyingSignals => s as UnderlyingSignals;

export function withUnderlyingBars() {
  return withMethods((store, localBarReadService = inject(LocalBarReadService)) => {
    const s = asUnderlying(store);

    /** Latest-request token — every fetch stamps a new identity, so a
     *  slow response from a superseded request (e.g. the old symbol's
     *  fetch resolving after a swap issued the new symbol's) is dropped:
     *  foreign bars can never overwrite the current window, and a stale
     *  error can't kill a newer request's spinner. */
    let lastBarsRequest: { symbol: string; from: string; to: string } | null = null;

    /** Fetch underlying bars and record the requested range alongside them.
     *  Failed fetches keep the previous bars — stale context beats an
     *  empty chart, and a transient error must not destroy a plotted set's
     *  underlying window. */
    function fetchUnderlyingBars(symbol: string, from: string, to: string): void {
      const req = { symbol, from, to };
      lastBarsRequest = req;
      patchState(store, { underlyingLoading: true });
      localBarReadService.getDailyBarsForRange$(symbol, from, to).subscribe({
        next: (bars) => {
          if (lastBarsRequest !== req) return;
          patchState(store, {
            underlyingBars: toOHLCDatum(bars),
            underlyingBarsRange: req,
            underlyingLoading: false,
          });
        },
        error: (err: Error) => {
          if (lastBarsRequest !== req) return;
          console.error('[fetchUnderlyingBars] error:', err);
          patchState(store, { underlyingLoading: false });
        },
      });
    }

    /** The dated plotted set's context bounds — the anchor's symbol, the
     *  ~70d prefix, and the current market day. Null when nothing is dated. */
    function context(): { symbol: string; from: string; to: string } | null {
      const anchor = contextAnchor(s.plottedContracts());
      return anchor == null
        ? null
        : { symbol: anchor.symbol, from: pickPrefixFrom(anchor.earliest), to: getMarketDatePT() };
    }

    /** Widen a contract-derived range to the set's context when a dated set
     *  is loaded — clamp-only on both edges, never narrow. */
    function contextClamped(from: string, to: string): { from: string; to: string } {
      const ctx = context();
      return {
        from: ctx != null && ctx.from < from ? ctx.from : from,
        to: ctx != null && ctx.to > to ? ctx.to : to,
      };
    }

    return {
      /** Fetch ~2 years of daily underlying bars (page/symbol init). */
      loadUnderlyingBars(symbol: string): void {
        const sym = String(symbol || '').trim().toUpperCase();
        if (!sym) return;
        // PT matches backend bar dates (UTC causes off-by-one at boundaries)
        fetchUnderlyingBars(sym, daysAgoPT(730), getMarketDatePT());
      },

      /** Fetch full underlying history for a symbol (10 years). */
      loadUnderlyingBarsFullHistory(symbol: string): void {
        const sym = String(symbol || '').trim().toUpperCase();
        if (!sym) return;
        fetchUnderlyingBars(sym, daysAgoPT(3650), getMarketDatePT());
      },

      /** Fetch underlying bars from an explicit start date through today. */
      loadUnderlyingBarsFrom(symbol: string, from: string): void {
        const sym = String(symbol || '').trim().toUpperCase();
        if (!sym || !from) return;
        fetchUnderlyingBars(sym, from, getMarketDatePT());
      },

      /** Fetch bars for a contract-derived range — widened to the dated
       *  set's context on both edges when one is loaded, so a single-
       *  contract path (load, drill-down, pad) can never silently narrow
       *  the underlying away from the set's window. */
      loadUnderlyingBarsForRange(symbol: string, from: string, to: string): void {
        const r = contextClamped(from, to);
        fetchUnderlyingBars(symbol, r.from, r.to);
      },

      /** Refetch the set's context window when the last requested range no
       *  longer covers it — restores both edges in one fetch. No-op when
       *  coverage holds or nothing is dated. Called by set mutations and by
       *  contract-load error paths. */
      ensureContextCoverage(): void {
        const anchor = contextAnchor(s.plottedContracts());
        if (anchor == null) return;
        const today = getMarketDatePT();
        const coverage = contextCoverage(s.underlyingBarsRange(), anchor, today);
        if (!coverage.covered) fetchUnderlyingBars(anchor.symbol, coverage.from, today);
      },

      addPadDays(days: number): void {
        const newPad = s.chartPadDays() + days;
        patchState(store, { chartPadDays: newPad });

        const data = s.contractData();
        if (!data) return;
        const range = paddedDateRange(data.startDate, data.endDate, newPad);
        const ctx = context();
        // Pad widens the axis — with a dated set loaded it widens the SET's
        // underlying (single-underlying, so the anchor's symbol), clamped
        // to context on both edges; stale contractData must not pull the
        // tail back to its own endDate or fetch a foreign symbol.
        const r = ctx ? contextClamped(range.from, range.to) : range;
        fetchUnderlyingBars(ctx?.symbol ?? data.symbol, r.from, r.to);
      },

      resetPadDays(): void {
        patchState(store, { chartPadDays: 0 });

        const data = s.contractData();
        if (!data) return;
        const ctx = context();
        const r = ctx ? contextClamped(data.startDate, data.endDate) : { from: data.startDate, to: data.endDate };
        fetchUnderlyingBars(ctx?.symbol ?? data.symbol, r.from, r.to);
      },
    };
  });
}
