import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { HeatmapColumnMeta, HeatmapDataService, HeatmapQuery, HeatmapRowMeta, HeatmapSlice } from './constants-heatmap-view';


/**
 * Placeholder implementation that will later be wired to Firestore/Functions.
 * For now it returns a small mocked slice so that the store and view can be
 * developed without backend dependencies.
 */
@Injectable({ providedIn: 'root' })
export class HeatmapViewDataService implements HeatmapDataService {
  getHeatmapSlice$(query: HeatmapQuery): Observable<HeatmapSlice> {
    const today = new Date();
    const isoToday = today.toISOString().slice(0, 10);

    const rows: HeatmapRowMeta[] = query.symbols.map((symbol, index) => ({
      pairId: `${query.baseline}-${symbol}`,
      symbol,
      baseline: query.baseline,
    }));

    const columns: HeatmapColumnMeta[] = [
      {
        date: isoToday,
        phase: 'post',
        isToday: true,
        lastUpdateTime: today.getTime(),
      },
    ];

    const rsValues: (number | null)[][] = rows.map((_, rowIndex) => [
      0.5 + (rowIndex * 0.03),
    ]);

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

    return of(slice);
  }
}
