import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, catchError, of, Observable } from 'rxjs';

import { CallableName } from '../../core/common/constants';
import { BarsInterval } from '../../core/models/partner.types';
import type { GetPairDailyBarsRequest, GetPairDailyBarsResponse, PartnerDailyBarDTO } from '../../core/models/partner.types';
// Local params type is strictly from/to-based. Any duration presets must be
// converted into explicit calendar windows before calling this service.
type GetDailyBarsParams = {
  interval?: BarsInterval;
  from?: string; // YYYY-MM-DD
  to?: string;   // YYYY-MM-DD
};
import type { OHLCDatum } from '../shared/types/rs.interfaces';
import { environment } from '../../../environments/environment';

/**
 * RsBarsService
 *
 * Thin Angular wrapper around the getPairDailyBars callable. Responsible for
 * mapping backend PartnerDailyBarDTO objects into OHLCDatum points suitable
 * for SyncFusion charts. Bars with issues are excluded from the plotted series
 * but can be surfaced separately for diagnostics if needed.
 */
const EMULATOR_YEARS_BACK = 2;
const PROD_YEARS_BACK = 7;

@Injectable({ providedIn: 'root' })
export class RsBarsService {
  private readonly env = inject(EnvironmentInjector);
  private readonly functions = inject(Functions);

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.env, fn);
  }

  /** Fetch daily OHLCV bars for a symbol from the backend callable. */
  getDailyBars$(symbol: string, params: GetDailyBarsParams = {}): Observable<OHLCDatum[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) {
      return of([] as OHLCDatum[]);
    }

    // Default history window depends on environment: emulators use a
    // smaller 2-year window to match seeded data; prod uses 7 years to
    // support longer backtests and visual context. This is converted into
    // an explicit [from,to] calendar window; callers may override either
    // bound by passing from/to directly in params.
    const defaultYearsWindow = (environment as any)?.useEmulators
      ? EMULATOR_YEARS_BACK
      : PROD_YEARS_BACK;
    const now = new Date();
    const defaultToIso = now.toISOString().slice(0, 10);
    const defaultFromDate = new Date(now.getTime() - defaultYearsWindow * 365 * 24 * 60 * 60 * 1000);
    const defaultFromIso = defaultFromDate.toISOString().slice(0, 10);

    const fromIso = params.from ?? defaultFromIso;
    const toIso = params.to ?? defaultToIso;

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<GetPairDailyBarsRequest, GetPairDailyBarsResponse>(
        this.functions,
        CallableName.GET_PAIR_DAILY_BARS,
      );
      const req: GetPairDailyBarsRequest = {
        symbol: sym,
        interval: params.interval ?? BarsInterval.DAILY,
        from: fromIso,
        to: toIso,
      };
      return callable(req);
    }))).pipe(
      map((res) => Array.isArray(res?.data?.bars) ? res.data.bars : []),
      map((bars: PartnerDailyBarDTO[]) =>
        bars
          // Keep bars where we have a usable close; upstream "issues" are for
          // diagnostics, not hard filtering here.
          .filter((b) => Number.isFinite(b.close as number) && Number(b.close) > 0)
          .map<OHLCDatum>((b) => {
            const close = Number(b.close);
            const open = Number.isFinite(b.open as number) ? Number(b.open) : close;
            const high = Number.isFinite(b.high as number) ? Number(b.high) : close;
            const low = Number.isFinite(b.low as number) ? Number(b.low) : close;

            return {
              x: new Date(`${b.date}T00:00:00.000Z`),
              date: b.date,
              open,
              high,
              low,
              close,
              volume: typeof b.volume === 'number' ? b.volume : undefined,
            };
          }),
      ),
      catchError((err) => {
        // eslint-disable-next-line no-console
        console.error('[RsBarsService] getDailyBars$ error', { symbol: sym, err });
        return of([] as OHLCDatum[]);
      }),
    );
  }
}
