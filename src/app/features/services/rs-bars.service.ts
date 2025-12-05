import { Injectable, EnvironmentInjector, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { defer, from, map, catchError, of, Observable } from 'rxjs';

import { CallableName } from '../../core/common/constants';
import type { GetPairDailyBarsRequest, GetPairDailyBarsResponse, PartnerDailyBarDTO } from '../../core/models/partner.types';
import { BarsInterval } from '../../core/models/partner.types';
import type { OHLCDatum } from '../shared/types/rs.interfaces';

/**
 * RsBarsService
 *
 * Thin Angular wrapper around the getPairDailyBars callable. Responsible for
 * mapping backend PartnerDailyBarDTO objects into OHLCDatum points suitable
 * for SyncFusion charts. Bars with issues are excluded from the plotted series
 * but can be surfaced separately for diagnostics if needed.
 */
@Injectable({ providedIn: 'root' })
export class RsBarsService {
  private readonly env = inject(EnvironmentInjector);
  private readonly functions = inject(Functions);

  private inCtx<T>(fn: () => T): T {
    return runInInjectionContext(this.env, fn);
  }

  /** Fetch daily OHLCV bars for a symbol from the backend callable. */
  getDailyBars$(symbol: string, params: Partial<GetPairDailyBarsRequest> = {}): Observable<OHLCDatum[]> {
    const sym = String(symbol || '').trim().toUpperCase();
    if (!sym) {
      return of([] as OHLCDatum[]);
    }

    // We always ask the backend for up to this many years, but Savant may
    // still return full history. We clamp to this window client-side so the
    // chart only works with a bounded range.
    const yearsBack = params.yearsBack ?? 7;

    return defer(() => from(this.inCtx(() => {
      const callable = httpsCallable<GetPairDailyBarsRequest, GetPairDailyBarsResponse>(
        this.functions,
        CallableName.GET_PAIR_DAILY_BARS,
      );
      const req: GetPairDailyBarsRequest = {
        symbol: sym,
        interval: params.interval ?? BarsInterval.DAILY,
        yearsBack,
        days: params.days,
        limit: params.limit,
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
      map((bars) => {
        if (!(Number.isFinite(yearsBack) && yearsBack > 0)) {
          return bars;
        }
        const cutoff = new Date();
        cutoff.setUTCDate(cutoff.getUTCDate() - yearsBack * 365);
        return bars.filter((b) => {
          const d = new Date(`${b.date}T00:00:00.000Z`);
          return d >= cutoff;
        });
      }),
      catchError((err) => {
        // eslint-disable-next-line no-console
        console.error('[RsBarsService] getDailyBars$ error', { symbol: sym, err });
        return of([] as OHLCDatum[]);
      }),
    );
  }
}
