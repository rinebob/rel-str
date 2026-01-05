import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, of } from 'rxjs';
import { HeatmapColumnMeta, HeatmapDataService, HeatmapQuery, HeatmapRowMeta, HeatmapSlice } from './constants-heatmap-view';
import { RelStrDbV2Service } from '../services/rel-str-db-v2.service';
import { Timeframe, RsSeriesPoint, RsPhase } from '../shared/types/rs.interfaces';


/**
 * Data access layer for the heatmap view.
 *
 * Maps a `HeatmapQuery` onto windowed archive reads from `pairs-data` and
 * normalizes the result into a `HeatmapSlice` contract expected by the store.
 */
@Injectable({ providedIn: 'root' })
export class HeatmapViewDataService implements HeatmapDataService {
  private readonly relStrDb = inject(RelStrDbV2Service);

  getHeatmapSlice$(query: HeatmapQuery): Observable<HeatmapSlice> {
    const symbols = Array.isArray(query.symbols) ? query.symbols : [];
    if (symbols.length === 0) {
      const empty: HeatmapSlice = {
        query,
        rows: [],
        columns: [],
        rsValues: [],
        meta: {
          isComplete: true,
          missingDates: [],
        },
      };
      return of(empty);
    }

    const today = new Date();
    const todayYMD = this.fmtYMD(today);
    const timeframe = this.mapIntervalToTimeframe(query.interval);
    const daysBack = Number.isFinite(query.rangeDays as number)
      ? Math.max(1, Number(query.rangeDays))
      : 60;

    const pairIds = symbols.map(symbol => `${query.baseline}-${symbol}`.toUpperCase());

    const seriesPerPair$ = pairIds.map(pairId =>
      this.relStrDb.getPairSeriesFromArchiveWindowByInterval$(pairId, daysBack, timeframe),
    );

    return combineLatest(seriesPerPair$).pipe(
      map((seriesRows: RsSeriesPoint[][]): HeatmapSlice => {
        const allDates = new Set<string>();

        seriesRows.forEach(series => {
          series.forEach(point => {
            const d = String(point.date || '').slice(0, 10);
            if (d) {
              allDates.add(d);
            }
          });
        });

        const sortedDates = Array.from(allDates.values()).sort((a, b) => a.localeCompare(b));

        const columns: HeatmapColumnMeta[] = sortedDates.map((date, index) => {
          // Pick phase based on the last non-null point for this date across all rows.
          let phase: RsPhase | undefined;
          for (const series of seriesRows) {
            const match = series.find(p => String(p.date).slice(0, 10) === date);
            if (match && match.phase) {
              phase = match.phase;
              break;
            }
          }

          const col: HeatmapColumnMeta = {
            date,
            phase: (phase ?? RsPhase.POST) as 'pre' | 'post',
            isToday: date === todayYMD,
            isPreCloseStream: false,
            lastUpdateTime: index === sortedDates.length - 1 ? today.getTime() : undefined,
          };
          return col;
        });

        const rows: HeatmapRowMeta[] = symbols.map(symbol => ({
          pairId: `${query.baseline}-${symbol}`.toUpperCase(),
          symbol,
          baseline: query.baseline,
        }));

        const rsValues: (number | null)[][] = seriesRows.map(series => {
          const byDate = new Map<string, RsSeriesPoint>();
          series.forEach(point => {
            const d = String(point.date || '').slice(0, 10);
            if (d) {
              byDate.set(d, point);
            }
          });

          return sortedDates.map(date => {
            const point = byDate.get(date);
            if (!point) return null;
            const v = Number.isFinite(point.norm as number)
              ? (point.norm as number)
              : point.value;
            return Number.isFinite(v) ? v : null;
          });
        });

        const slice: HeatmapSlice = {
          query,
          rows,
          columns,
          rsValues,
          meta: {
            isComplete: true,
            missingDates: [],
          },
        };

        return slice;
      }),
    );
  }

  private mapIntervalToTimeframe(interval: HeatmapQuery['interval']): Timeframe {
    switch (interval) {
      case 'WEEKLY':
        return Timeframe.WEEKLY;
      case 'MONTHLY':
        return Timeframe.MONTHLY;
      case 'DAILY':
      default:
        return Timeframe.DAILY;
    }
  }

  private fmtYMD(d: Date): string {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
