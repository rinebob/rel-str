import { computed, EnvironmentInjector, inject, NgZone, runInInjectionContext } from '@angular/core';
import { patchState, signalStore, withComputed, withMethods, withState } from '@ngrx/signals';
import type { RanksDataWithColors, BaselineTargetRankDatum } from '../../shared/types/rs.interfaces';
import { Timeframe } from '../../shared/types/rs.interfaces';
import { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import { RsCalcsStore } from '../../store/rs-calcs.store';
import { RsDataStore } from '../../store/rs-data.store';
import { firstValueFrom } from 'rxjs';
import { HeatmapV3DataService } from '../services/heatmap-v3-data.service';

export type UniverseSliceOption =
  | 'ALL'
  | 'TOP_10' | 'TOP_25' | 'TOP_50'
  | 'BOTTOM_10' | 'BOTTOM_25' | 'BOTTOM_50'
  | 'MIDDLE_25' | 'MIDDLE_50';

export type TimeRangeOption = '6M' | '1Y' | '2Y' | '5Y' | 'ALL';

export interface BaselineMeta {
  id: string;
  label: string;
  type: 'index' | 'sector';
}

export interface DashboardV3State {
  baselines: BaselineMeta[];
  selectedBaselineId: string | null;
  selectedSlice: UniverseSliceOption;
  selectedTimeRange: TimeRangeOption;
  baselineUniverses: Record<string, string[]>;
  universeLoading: boolean;
  universeError: string | null;
  heatmapRanksData: RanksDataWithColors | null;
  heatmapLoading: boolean;
  heatmapError: string | null;
}

const initialState: DashboardV3State = {
  baselines: [
    { id: 'SPY', label: 'SPY – S&P 500', type: 'index' },
    { id: 'QQQ', label: 'QQQ – Nasdaq 100', type: 'index' },
    { id: 'XLF', label: 'XLF – Financials', type: 'sector' },
    { id: 'XLK', label: 'XLK – Technology', type: 'sector' },
  ],
  selectedBaselineId: 'SPY',
  selectedSlice: 'ALL',
  selectedTimeRange: '6M',
  baselineUniverses: {
    SPY: [
      'SPY-AAPL',
      'SPY-GOOGL',
      'SPY-ISRG',
      'SPY-NVDA',
      'SPY-PFE',
      'SPY-PLTR',
      'SPY-QQQ',
      'SPY-TSLA',
      'SPY-WDC',
      'SPY-WMT',
      'SPY-XOM',
      'SPY-XPH',
    ],
    QQQ: [
      'QQQ-AAPL',
      'QQQ-GOOGL',
      'QQQ-LRCX',
      'QQQ-NFLX',
      'QQQ-NVDA',
      'QQQ-PLTR',
      'QQQ-SOXL',
      'QQQ-STX',
      'QQQ-TSLA',
    ],
    XPH: [
        'XPH-ISRG',
        'XPH-PFE',
    ],
  },
  universeLoading: false,
  universeError: null,
  heatmapRanksData: null,
  heatmapLoading: false,
  heatmapError: null,
};

export const DashboardV3Store = signalStore(
  { providedIn: 'root' },
  withState<DashboardV3State>(initialState),
  withComputed((store) => ({
    selectedBaseline: computed(() =>
      store.baselines().find(b => b.id === store.selectedBaselineId()) ?? null,
    ),
    currentUniversePairs: computed(() => {
      const baselines = store.baselines();
      const universes = store.baselineUniverses();
      const selectedId = store.selectedBaselineId();

      if (!selectedId) {
        return [];
      }

      const exists = baselines.some(b => b.id === selectedId);
      if (!exists) {
        return [];
      }

      return universes[selectedId] ?? [];
    }),
  })),
  withMethods((store,
    relStrDbV2Service = inject(RelStrDbV2Service),
    rsCalcsStore = inject(RsCalcsStore),
    rsDataStore = inject(RsDataStore),
    env = inject(EnvironmentInjector),
    zone = inject(NgZone),
    heatmapV3DataService = inject(HeatmapV3DataService),
  ) => {

    const generateHeatmapDataV3 = async (pair: string, timeframe: Timeframe): Promise<BaselineTargetRankDatum[]> => {
      let series: Array<{ date: string; value: number; norm?: number; phase?: any }> = [];
      if (timeframe === Timeframe.DAILY || timeframe === Timeframe.TWO_DAY) {
        series = await firstValueFrom(relStrDbV2Service.getPairSeriesFromArchive$(pair));
      } else {
        series = await firstValueFrom(
          relStrDbV2Service.getPairSeriesFromArchiveWindowByInterval$(pair, 60, timeframe),
        );
      }
      if (!Array.isArray(series) || series.length === 0) {
        return [];
      }
      const colors = rsCalcsStore.heatmapColors();
      return series.map(d => {
        const metric = (d as any).norm ?? d.value;
        const idx = Math.floor(metric * (colors.length - 1));
        const color = colors[Math.max(0, Math.min(colors.length - 1, idx))];
        return {
          date: d.date,
          value: d.value,
          index: idx,
          color,
          phase: (d as any).phase,
          placeholder: false,
        } as BaselineTargetRankDatum;
      });
    };

    /**
     * DEPRECATED for dashboard v3: archive-based FE loader kept for backward compatibility
     * and potential reuse in v2 paths. Dashboard v3 now prefers backend viewport snapshots
     * via HeatmapV3DataService instead of per-pair archive reads.
     */
    const getHeatmapDataV3 = async (pairs: string[], timeframe: Timeframe): Promise<RanksDataWithColors> => {
      const out: RanksDataWithColors = {};
      const perPair: Record<string, BaselineTargetRankDatum[]> = {};
      const bucketSet = new Set<string>();

      const bucketKey = (date: string): string => {
        const ymd = String(date || '').slice(0, 10);
        if (!ymd) return '';
        if (timeframe === Timeframe.MONTHLY) {
          return ymd.slice(0, 7);
        }
        if (timeframe === Timeframe.WEEKLY) {
          const [yy, mm, dd] = ymd.split('-').map(Number);
          if (!yy || !mm || !dd) return ymd;
          const d = new Date(Date.UTC(yy, mm - 1, dd));
          const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
          const dayNum = tmp.getUTCDay() || 7;
          tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
          const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
          const diffDays = Math.floor((tmp.getTime() - yearStart.getTime()) / 86400000) + 1;
          const week = Math.ceil(diffDays / 7);
          const wk = String(week).padStart(2, '0');
          return `${tmp.getUTCFullYear()}-W${wk}`;
        }
        return ymd;
      };

      const canonicalDateFromBucket = (bucket: string): string => {
        if (!bucket) return '';
        if (timeframe === Timeframe.MONTHLY) {
          const [y, m] = bucket.split('-');
          if (!y || !m) return '';
          return `${y}-${m.padStart(2, '0')}-01`;
        }
        if (timeframe === Timeframe.WEEKLY && bucket.includes('-W')) {
          const [yStr, wStr] = bucket.split('-W');
          const year = Number(yStr);
          const week = Number(wStr);
          if (!year || !week) return '';
          const simple = new Date(Date.UTC(year, 0, 4));
          const dayNum = simple.getUTCDay() || 7;
          simple.setUTCDate(simple.getUTCDate() - (dayNum - 1) + (week - 1) * 7);
          const mm = String(simple.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(simple.getUTCDate()).padStart(2, '0');
          return `${year}-${mm}-${dd}`;
        }
        return bucket;
      };

      const concurrency = 10;
      for (let i = 0; i < pairs.length; i += concurrency) {
        const batch = pairs.slice(i, i + concurrency);
        const results = await Promise.allSettled(batch.map(p => generateHeatmapDataV3(p, timeframe)));

        results.forEach((res, idx) => {
          const pair = batch[idx];
          if (res.status === 'fulfilled') {
            const arr = res.value || [];
            perPair[pair] = arr;
            for (const d of arr) {
              const key = bucketKey(d.date);
              if (key) bucketSet.add(key);
            }
          } else {
            perPair[pair] = [];
          }
        });
      }

      const allBuckets = Array.from(bucketSet.values()).sort((a, b) => String(a ?? '').localeCompare(String(b ?? '')));
      const colors = rsCalcsStore.heatmapColors();
      const placeholderColor = '#cccccc';

      for (const pair of pairs) {
        const byBucket = new Map<string, BaselineTargetRankDatum>();
        for (const d of perPair[pair] || []) {
          const key = bucketKey(d.date);
          if (!key) continue;
          byBucket.set(key, d);
        }
        const aligned: BaselineTargetRankDatum[] = allBuckets.map(bucket => {
          const hit = byBucket.get(bucket);
          if (hit) return hit;
          const date = canonicalDateFromBucket(bucket);
          return {
            date,
            value: 0,
            index: 0,
            color: placeholderColor,
            placeholder: true,
          } as BaselineTargetRankDatum;
        });
        out[pair] = aligned;
      }

      return out;
    };

    return {
      selectBaseline(baselineId: string): void {
        patchState(store, {
          selectedBaselineId: baselineId,
          universeError: null,
        });
      },

      async loadHeatmapForCurrentBaseline(force = false): Promise<void> {
        const baselineId = store.selectedBaselineId();
        if (!baselineId) {
          patchState(store, { heatmapRanksData: {}, heatmapLoading: false });
          return;
        }

        const timeframe = rsDataStore.selectedTimeframe() as Timeframe;

        if (!force && store.heatmapRanksData()) {
          return;
        }

        patchState(store, { heatmapLoading: true, heatmapError: null });

        zone.run(() => {
          runInInjectionContext(env, () => {
            void (async () => {
              try {
                // DEBUG: log snapshot request context
                // eslint-disable-next-line no-console
                console.log('[DashboardV3Store] loadHeatmapForCurrentBaseline snapshot request', {
                  baselineId,
                  timeframe,
                });

                const matrix = await heatmapV3DataService.getViewportSnapshotOnce(baselineId, timeframe);

                if (!matrix || !Array.isArray(matrix.pairs) || !Array.isArray(matrix.dates)) {
                  // eslint-disable-next-line no-console
                  console.log('[DashboardV3Store] snapshot load failed or invalid', { matrix });
                  patchState(store, {
                    heatmapRanksData: {},
                    heatmapError: 'Missing or invalid heatmap snapshot',
                    heatmapLoading: false,
                  });
                  return;
                }

                // eslint-disable-next-line no-console
                console.log('[DashboardV3Store] snapshot loaded', {
                  pairs: matrix.pairs.length,
                  dates: matrix.dates.length,
                });

                const colors = rsCalcsStore.heatmapColors();
                const ranks: RanksDataWithColors = {};
                const fallbackColor = '#000000';

                matrix.pairs.forEach((pairId, rowIndex) => {
                  const rowValues = matrix.values[rowIndex] ?? [];
                  const row: BaselineTargetRankDatum[] = matrix.dates.map((date, colIndex) => {
                    const rawValue = Number(rowValues[colIndex] ?? 0);
                    const value = Number.isFinite(rawValue) ? rawValue : 0;
                    const metric = value;

                    let index = 0;
                    let color = fallbackColor;
                    const palette = colors || [];
                    if (palette.length === 2) {
                      // Strict two-color warm/cool palette: values < 0.5 use index 0 (cool),
                      // values >= 0.5 use index 1 (warm).
                      index = metric >= 0.5 ? 1 : 0;
                      color = palette[index] ?? fallbackColor;
                    } else if (palette.length > 0) {
                      const scaled = Math.floor(metric * (palette.length - 1));
                      const clamped = Math.max(0, Math.min(palette.length - 1, scaled));
                      index = clamped;
                      color = palette[clamped] ?? fallbackColor;
                    }

                    return {
                      date,
                      value,
                      index,
                      color,
                      placeholder: false,
                    } as BaselineTargetRankDatum;
                  });

                  ranks[pairId] = row;
                });

                patchState(store, { heatmapRanksData: ranks, heatmapLoading: false });
              } catch (e: unknown) {
                patchState(store, {
                  heatmapError: (e as Error)?.message ?? 'Failed to load v3 heatmap snapshot',
                  heatmapLoading: false,
                });
              }
            })();
          });
        });
      },
    };
  }),
);
