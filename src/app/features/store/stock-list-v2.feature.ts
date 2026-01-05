import { patchState, signalStoreFeature, withComputed, withMethods, withState } from "@ngrx/signals"
import { BaselineTargetRankDatum, FormMode, RanksByDate, RanksDataWithColors, RelStrStockList, StockDatum, StockListFormMode, Timeframe } from "../shared/types/rs.interfaces"
import { StockDataService } from "../services/stock-data.service"
import { inject, EnvironmentInjector, NgZone, runInInjectionContext } from "@angular/core"
import { RelStrDbV2Service } from "../services/rel-str-db-v2.service"
import { generatePairData, getPairsForList } from "../utils/rs-calc-utils-v2"
import { RsCalcsStore } from "./rs-calcs.store"
import { RsDataStore } from "./rs-data.store"
import { firstValueFrom, Subscription } from 'rxjs'

/**
 * Archive Read Toggle (DEV-only)
 * ---------------------------------
 * Data source selection for the V2 heatmap read pipeline.
 * This is a development toggle to compare legacy `pairs-data/{PAIR}.data` vs
 * archive-based reads under `pairs-data/{PAIR}/archive-YYYY/*`.
 *
 * Default: Legacy. When Archive is fully implemented and validated,
 * we will flip the default to Archive and later remove Legacy.
 */
/**
 * Data source selector for Dashboard V2 heatmap.
 * @deprecated LEGACY is deprecated. Archive is the authoritative path. TODO[deprecate]: Remove LEGACY and related branches after archive stabilization in prod.
 */
export enum DataSourceMode {
    /** @deprecated Scheduled for removal with archive-first rollout. */
    LEGACY = 'legacy',
    ARCHIVE = 'archive',
}

export type StockListV2State = {
    allStockListsV2: RelStrStockList[],
    selectedStockListV2: RelStrStockList,
    editingStockListV2: RelStrStockList | null,
    supportedSymbolsListV2: string[],
    supportedPairsListV2: string[],
    formModeV2: StockListFormMode,
    showFormV2: boolean,
    formDataV2: RelStrStockList,
    /** DEV-only: heatmap data source mode (see DataSourceMode). Default = legacy */
    dataSourceMode: DataSourceMode,
    heatmapLoadingV2: boolean,
    heatmapRenderedTimeframeV2: Timeframe | null,
}

export const initialV2State: StockListV2State = {
    allStockListsV2: [],
    selectedStockListV2: {name: '', baseline: '', symbols: []},
    editingStockListV2: null,
    supportedSymbolsListV2: [],
    supportedPairsListV2: [],
    formModeV2: FormMode.CREATE,
    showFormV2: false,
    formDataV2: {name: '', baseline: '', symbols: []},
    dataSourceMode: DataSourceMode.ARCHIVE,
    heatmapLoadingV2: false,
    heatmapRenderedTimeframeV2: null,
}

export function withStockListV2Feature() {
    return signalStoreFeature(
        withState<StockListV2State>(initialV2State),
        withMethods((
            store,
            relStrDbV2Service = inject(RelStrDbV2Service),
            stockDataService = inject(StockDataService),
        ) => ({

            // STOCK DATA
            async getHistoricalDataForSymbolV2(symbol: string): Promise<StockDatum[]> {
                try { return await stockDataService.getStockDataBySymbol(symbol); } catch { return []; }
            },

            async getSupportedSymbolsListV2() {
                const companies = await firstValueFrom(relStrDbV2Service.getTrackedSymbols$());
                const supportedSymbolsListV2 = companies.map(c => c.symbol);
                // console.log('[StockListV2] supportedSymbolsListV2', supportedSymbolsListV2);
                patchState(store, {supportedSymbolsListV2});
            },

            // BASELINE/TARGET RANKS DATA (PAIRS DATA)
            async getSupportedPairsListV2(baseline?: string) {
                // Helper for validations/heatmap hints only. Panel UI renders from users/{uid}/lists.
                const base = String(baseline || store.selectedStockListV2().baseline || '').toUpperCase();
                if (!base) { patchState(store, { supportedPairsListV2: [] }); return; }
                const supportedPairsListV2 = await firstValueFrom(relStrDbV2Service.getPairsForBaseline$(base));
                patchState(store, { supportedPairsListV2 });
            },

        })),

        // ================================================================
        // DEV-only methods block for Archive Read Toggle
        // Keep separate from other methods to avoid same-block references
        // ================================================================
        withMethods((store) => ({
            /**
             * DEV-only UI toggle setter: select which pipeline to use for heatmap reads.
             * - LEGACY: reads from pairs-data/{PAIR}.data (unchanged behavior)
             * - ARCHIVE: reads from archive shards pairs-data/{PAIR}/archive-YYYY/{YYMMDD}
             */
            setDataSourceModeV2(mode: DataSourceMode) {
                patchState(store, { dataSourceMode: mode ?? DataSourceMode.LEGACY });
            },
            /** Getter for current data source mode (DEV-only). */
            getDataSourceModeV2(): DataSourceMode { return store.dataSourceMode(); },
        })),

        // STOCK LISTS
        withMethods((
            store,
            rsCalcsStore = inject(RsCalcsStore),
            relStrDbV2Service = inject(RelStrDbV2Service),
            rsDataStore = inject(RsDataStore),
            env = inject(EnvironmentInjector),
        ) => {
            const liveSubs = new Map<string, Subscription>();
            const zone = inject(NgZone);

            const sortListsV2 = (targetList: RelStrStockList, allStockListsV2: RelStrStockList[]) => {
                // Replace any existing instance of targetList by name, then sort alphabetically by name
                const replaced = allStockListsV2.map(list => list.name === targetList.name ? targetList : list);
                return [...replaced].sort((a, b) => a.name.localeCompare(b.name));
            };

            const buildHeatmapCacheKey = (list: RelStrStockList, timeframe: Timeframe): string => {
                const name = String(list?.name ?? '').trim();
                const baseline = String(list?.baseline ?? '').trim().toUpperCase();
                return `${name}::${baseline}::${timeframe}`;
            };

            const generateHeatmapDataV2 = async (pair: string, timeframe: Timeframe = Timeframe.DAILY): Promise<BaselineTargetRankDatum[]> => {
                let series: Array<{ date: string; value: number; norm?: number; phase?: any }> = [];
                // For DAILY/TWO_DAY, use the full archive reader so background phase loads
                // the complete history instead of another 60-day window. For WEEKLY/MONTHLY
                // keep using the interval-specific reader.
                if (timeframe === Timeframe.DAILY || timeframe === Timeframe.TWO_DAY) {
                    series = await firstValueFrom(relStrDbV2Service.getPairSeriesFromArchive$(pair));
                } else {
                    series = await firstValueFrom(relStrDbV2Service.getPairSeriesFromArchiveWindowByInterval$(pair, 60, timeframe));
                }
                // DEBUG: surface what we received from Firestore
                // eslint-disable-next-line no-console
                console.log('[V2] pair series', pair, 'timeframe=', timeframe, 'len=', series?.length ?? 0, 'first=', series?.[0]);
                if (!Array.isArray(series) || series.length === 0) {
                    // eslint-disable-next-line no-console
                    console.log('[V2] no series data for pair; check doc path pairs-data/', pair, 'timeframe=', timeframe);
                    return [];
                }
                const colors = rsCalcsStore.heatmapColors();
                return series.map(d => {
                    const metric = (d as any).norm ?? d.value;
                    const idx = Math.floor(metric * (colors.length - 1));
                    const color = colors[Math.max(0, Math.min(colors.length - 1, idx))];
                    return { date: d.date, value: d.value, index: idx, color, phase: d.phase, placeholder: false } as BaselineTargetRankDatum;
                });
            };

            const generateHeatmapDataWindowV2 = async (pair: string, daysBack = 60): Promise<BaselineTargetRankDatum[]> => {
                let series: Array<{ date: string; value: number; norm?: number; phase?: any }> = [];
                series = await firstValueFrom(relStrDbV2Service.getPairSeriesFromArchiveWindow$(pair, daysBack));
                // eslint-disable-next-line no-console
                console.log('[V2][window] pair series', pair, 'len=', series?.length ?? 0, 'first=', series?.[0]);
                if (!Array.isArray(series) || series.length === 0) return [];
                const colors = rsCalcsStore.heatmapColors();
                return series.map(d => {
                    const metric = (d as any).norm ?? d.value;
                    const idx = Math.floor(metric * (colors.length - 1));
                    const color = colors[Math.max(0, Math.min(colors.length - 1, idx))];
                    return { date: d.date, value: d.value, index: idx, color, phase: d.phase, placeholder: false } as BaselineTargetRankDatum;
                });
            };

            const getHeatmapDataV2 = async (pairs: string[], timeframe: Timeframe = Timeframe.DAILY): Promise<RanksDataWithColors> => {
                const out: RanksDataWithColors = {};
                // First pass: fetch per-pair arrays and build union of dates
                const perPair: Record<string, BaselineTargetRankDatum[]> = {};
                const bucketSet = new Set<string>();

                const bucketKey = (date: string): string => {
                    const ymd = String(date || '').slice(0, 10);
                    if (!ymd) return '';
                    if (timeframe === Timeframe.MONTHLY) {
                        // Bucket by calendar month: YYYY-MM
                        return ymd.slice(0, 7);
                    }
                    if (timeframe === Timeframe.WEEKLY) {
                        // Bucket by ISO week so weeks crossing months stay grouped.
                        const [yy, mm, dd] = ymd.split('-').map(Number);
                        if (!yy || !mm || !dd) return ymd;
                        const d = new Date(Date.UTC(yy, mm - 1, dd));
                        const tmp = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
                        const dayNum = tmp.getUTCDay() || 7; // Sun=0 -> 7
                        tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum); // nearest Thursday
                        const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
                        const diffDays = Math.floor((tmp.getTime() - yearStart.getTime()) / 86400000) + 1;
                        const week = Math.ceil(diffDays / 7);
                        const wk = String(week).padStart(2, '0');
                        return `${tmp.getUTCFullYear()}-W${wk}`;
                    }
                    // DAILY / TWO_DAY: bucket by exact day
                    return ymd;
                };

                const canonicalDateFromBucket = (bucket: string): string => {
                    if (!bucket) return '';
                    if (timeframe === Timeframe.MONTHLY) {
                        // Represent month buckets as first of month; header uses only month/year.
                        const [y, m] = bucket.split('-');
                        if (!y || !m) return '';
                        return `${y}-${m.padStart(2, '0')}-01`;
                    }
                    if (timeframe === Timeframe.WEEKLY && bucket.includes('-W')) {
                        const [yStr, wStr] = bucket.split('-W');
                        const year = Number(yStr);
                        const week = Number(wStr);
                        if (!year || !week) return '';
                        // ISO week -> Monday of that week
                        const simple = new Date(Date.UTC(year, 0, 4));
                        const dayNum = simple.getUTCDay() || 7; // Sun=0 -> 7
                        simple.setUTCDate(simple.getUTCDate() - (dayNum - 1) + (week - 1) * 7);
                        const mm = String(simple.getUTCMonth() + 1).padStart(2, '0');
                        const dd = String(simple.getUTCDate()).padStart(2, '0');
                        return `${year}-${mm}-${dd}`;
                    }
                    return bucket;
                };
                for (const pair of pairs) {
                    const arr = await generateHeatmapDataV2(pair, timeframe);
                    perPair[pair] = arr;
                    for (const d of arr) {
                        const key = bucketKey(d.date);
                        if (key) bucketSet.add(key);
                    }
                }
                const allBuckets = Array.from(bucketSet.values()).sort((a, b) => {
                    const sa = String(a ?? '');
                    const sb = String(b ?? '');
                    return sa.localeCompare(sb);
                });

                // Second pass: align each pair to the union-of-dates, inserting placeholders where missing
                const colors = rsCalcsStore.heatmapColors();
                const placeholderColor = '#cccccc';
                for (const pair of pairs) {
                    const byBucket = new Map<string, BaselineTargetRankDatum>();
                    for (const d of perPair[pair] || []) {
                        const key = bucketKey(d.date);
                        if (!key) continue;
                        // Overwrite so the latest datum for the bucket wins.
                        byBucket.set(key, d);
                    }
                    const aligned: BaselineTargetRankDatum[] = allBuckets.map(bucket => {
                        const hit = byBucket.get(bucket);
                        if (hit) return hit;
                        const date = canonicalDateFromBucket(bucket);
                        // Placeholder datum for missing cell
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

            const getHeatmapDataWindowV2 = async (pairs: string[], daysBack = 60): Promise<RanksDataWithColors> => {
                const out: RanksDataWithColors = {};
                const perPair: Record<string, BaselineTargetRankDatum[]> = {};
                const dateSet = new Set<string>();

                const concurrency = 10;
                for (let i = 0; i < pairs.length; i += concurrency) {
                    const batch = pairs.slice(i, i + concurrency);
                    const results = await Promise.allSettled(batch.map(p => generateHeatmapDataWindowV2(p, daysBack)));
                    results.forEach((res, idx) => {
                        const pair = batch[idx];
                        if (res.status === 'fulfilled') {
                            const arr = res.value || [];
                            perPair[pair] = arr;
                            for (const d of arr) dateSet.add(d.date);
                        } else {
                            perPair[pair] = [];
                        }
                    });
                }

                const allDates = Array.from(dateSet.values()).sort((a, b) => {
                    const sa = a !== undefined ? String(a) : '';
                    const sb = b !== undefined ? String(b) : '';
                    return sa.localeCompare(sb);
                });
                const placeholderColor = '#cccccc';
                for (const pair of pairs) {
                    const byDate = new Map<string, BaselineTargetRankDatum>();
                    (perPair[pair] || []).forEach(d => byDate.set(d.date, d));
                    const aligned: BaselineTargetRankDatum[] = allDates.map(date => {
                        const hit = byDate.get(date);
                        if (hit) return hit;
                        return { date, value: 0, index: 0, color: placeholderColor, placeholder: true } as BaselineTargetRankDatum;
                    });
                    out[pair] = aligned;
                }
                return out;
            };

            const resolveExistingRanksDataV2 = async (list: RelStrStockList, force = false): Promise<RelStrStockList> => {
                const timeframe = rsDataStore.selectedTimeframe();
                const cacheKey = buildHeatmapCacheKey(list, timeframe);
                const cached = rsCalcsStore.getHeatmapCacheEntry(cacheKey);

                if (cached && !force) {
                    // Use cached full-history data for this list/timeframe
                    const hydrated = { ...list, ranksDataWithColors: { ...cached } } as RelStrStockList;
                    const selected = store.selectedStockListV2();
                    const isSameList = selected?.name === hydrated.name;
                    const others = store.allStockListsV2().filter(l => l.name !== hydrated.name);
                    const allStockListsV2 = sortListsV2(hydrated, [...others, hydrated]);
                    if (isSameList) {
                        patchState(store, { selectedStockListV2: hydrated, allStockListsV2, heatmapRenderedTimeframeV2: timeframe, heatmapLoadingV2: false });
                    } else {
                        patchState(store, { allStockListsV2, heatmapRenderedTimeframeV2: timeframe, heatmapLoadingV2: false });
                    }
                    return hydrated;
                }

                const pairs = getPairsForList(list);
                // For timeframe-specific heatmap data, rely on the cache for reuse.
                // If there is no cache entry (or force is true), always refetch all pairs
                // for the current timeframe so we don't accidentally reuse data from a
                // different interval (e.g., monthly data when switching back to daily).
                const pairsToFetch: string[] = [...pairs];

                if (list.ranksDataWithColors === undefined || pairsToFetch.length) {
                    // eslint-disable-next-line no-console
                    console.log('[StockListFeatureV2] resolveExistingRanksDataV2(): list/num pairsToFetch', list.name, pairsToFetch.length, 'force=', force, 'timeframe=', timeframe);
                    const tLabel = `[heatmap initial ${list.name || 'list'}]`;
                    console.time(tLabel);
                    patchState(store, { heatmapLoadingV2: true });
                    // Phase 1: windowed initial fetch for faster first paint.
                    // Only used for DAILY/TWO_DAY. For WEEKLY/MONTHLY we skip the
                    // intermediate snapshot to avoid flashing a daily window while
                    // interval data is still loading.
                    if (timeframe === Timeframe.DAILY || timeframe === Timeframe.TWO_DAY) {
                        const initial = await getHeatmapDataWindowV2(pairsToFetch, 60);
                        const phase1 = list.ranksDataWithColors !== undefined
                            ? { ...list.ranksDataWithColors, ...initial }
                            : { ...initial };
                        list.ranksDataWithColors = { ...phase1 };

                        // Patch immediately for visual feedback if this list is selected
                        const current = store.selectedStockListV2();
                        const isSameList = current?.name === list.name;
                        if (isSameList) {
                            const baseList = { ...current, ranksDataWithColors: { ...phase1 } } as RelStrStockList;
                            const others = store.allStockListsV2().filter(l => l.name !== baseList.name);
                            const allStockListsV2 = sortListsV2(baseList, [...others, baseList]);
                            patchState(store, { selectedStockListV2: baseList, allStockListsV2, heatmapRenderedTimeframeV2: timeframe, heatmapLoadingV2: false });
                        }
                        console.log('sLV2 rERDV2. end');
                        console.timeEnd(tLabel);
                    }

                    // Phase 2 (background): full history, then merge, patch, and cache
                    zone.run(() => {
                        runInInjectionContext(env, () => {
                            void (async () => {
                                try {
                                    const full = await getHeatmapDataV2(pairsToFetch, timeframe);

                                    const existing = (list.ranksDataWithColors || {}) as RanksDataWithColors;
                                    const merged: RanksDataWithColors = { ...existing };

                                    for (const pairId of Object.keys(full || {})) {
                                        const nextSeries = full[pairId];
                                        if (!Array.isArray(nextSeries) || nextSeries.length === 0) {
                                            continue;
                                        }
                                        // Always replace with the newly fetched series for the
                                        // current timeframe. Length comparison is not valid once
                                        // different timeframes (daily/weekly/monthly) share the
                                        // same ranksDataWithColors field.
                                        merged[pairId] = nextSeries;
                                    }

                                    const selected = store.selectedStockListV2();
                                    const baseList = (selected?.name === list.name ? { ...selected } : { ...list }) as RelStrStockList;
                                    baseList.ranksDataWithColors = merged;
                                    const others = store.allStockListsV2().filter(l => l.name !== baseList.name);
                                    const allStockListsV2 = sortListsV2(baseList, [...others, baseList]);
                                    patchState(store, { selectedStockListV2: baseList, allStockListsV2, heatmapRenderedTimeframeV2: timeframe, heatmapLoadingV2: false });

                                    // Write merged full-history result into cache for this list/timeframe
                                    rsCalcsStore.setHeatmapCacheEntry(cacheKey, merged);
                                } catch (e) {
                                    console.error('[StockListFeatureV2] background full history load failed', e);
                                }
                            })();
                        });
                    });
                }
                return list;
            };

            const stopLivePairSubscriptions = () => {
                for (const sub of liveSubs.values()) { try { sub.unsubscribe(); } catch {} }
                liveSubs.clear();
            };

            const startLivePairSubscriptionsForList = (_list: RelStrStockList) => {
                // TODO[realtime]: Reintroduce realtime archive listeners when we have a docData-based
                // archive reader. For now, archive reads are snapshot-only and live subscriptions
                // are intentionally disabled.
                stopLivePairSubscriptions();
            };

            const parsePair = (pairId: string): { baseline: string; target: string } | undefined => {
                const parts = String(pairId || '').split('-');
                if (parts.length < 2) return undefined;
                const baseline = String(parts[0]).toUpperCase();
                const target = String(parts.slice(1).join('-')).toUpperCase();
                if (!baseline || !target) return undefined;
                return { baseline, target };
            };

            const refreshPairs = async (pairs: string[], list: RelStrStockList) => {
                const timeframe = rsDataStore.selectedTimeframe();
                const ranksData = await getHeatmapDataV2(pairs, timeframe);
                const updated = { ...(list.ranksDataWithColors || {}), ...ranksData } as RanksDataWithColors;
                list.ranksDataWithColors = updated;
            };

            const autoFixMissingCellsInternalV2 = async (list: RelStrStockList, fixes: Array<{ pair: string; dates: string[] }>) => {
                const baseline = String(list?.baseline || '').toUpperCase();
                const targetsByPair = new Map<string, { pair: string; dates: string[] }>();
                for (const f of fixes) {
                    const id = String(f.pair || '').toUpperCase();
                    if (!id) continue;
                    const existing = targetsByPair.get(id);
                    if (existing) {
                        existing.dates.push(...f.dates.map(d => String(d).slice(0,10)));
                    } else {
                        targetsByPair.set(id, { pair: id, dates: f.dates.map(d => String(d).slice(0,10)) });
                    }
                }
                const symbols: string[] = [];
                const bySymbolDates = new Map<string, Set<string>>();
                for (const [pairId, f] of targetsByPair) {
                    const parsed = parsePair(pairId);
                    if (!parsed) continue;
                    symbols.push(parsed.target);
                    const set = bySymbolDates.get(parsed.target) ?? new Set<string>();
                    for (const d of f.dates) set.add(String(d).slice(0,10));
                    bySymbolDates.set(parsed.target, set);
                }
                if (!baseline || symbols.length === 0) return;
                const dates = Array.from(new Set(Array.from(bySymbolDates.values()).flatMap(s => Array.from(s.values()))));
                try { await relStrDbV2Service.diagnosePairDaysAutoFix(baseline, symbols, { phase: 'post' as any, dates, forceWrite: false }); } catch {}
                await refreshPairs(Array.from(targetsByPair.keys()), list);
            };

            return {
                // LISTS
                async getListsForUserV2(userId: string) {
                    const lists = await relStrDbV2Service.getListsForUser(userId);
                    const allStockListsV2 = [...lists].sort((a, b) => a.name.localeCompare(b.name));
                    patchState(store, { allStockListsV2 });
                },

                /** Begin creating a new list in a dialog: initialize an empty editing draft without touching the active heatmap list. */
                beginCreateListV2() {
                    const draft: RelStrStockList = { name: '', baseline: '', symbols: [] };
                    patchState(store, { editingStockListV2: draft, formModeV2: FormMode.CREATE, showFormV2: true });
                },

                /** Begin editing an existing list in a dialog: clone the target into editingStockListV2 while leaving the active list unchanged. */
                beginEditListV2(list: RelStrStockList) {
                    const draft = { ...list } as RelStrStockList;
                    patchState(store, { editingStockListV2: draft, formModeV2: FormMode.EDIT, showFormV2: true });
                },

                /** Cancel the current dialog edit/create session without modifying the active list or heatmap. */
                cancelEditListV2() {
                    patchState(store, { editingStockListV2: null, showFormV2: false });
                },

                async saveStockListForUserV2(userId: string, list: RelStrStockList) {
                    await relStrDbV2Service.saveStockList(userId, list);
                    const existing = store.allStockListsV2().some(l => l.name === list.name);
                    const base = existing ? [...store.allStockListsV2()] : [...store.allStockListsV2(), list];
                    const allStockListsV2 = sortListsV2(list, base);
                    patchState(store, { allStockListsV2, selectedStockListV2: list });
                    try { await relStrDbV2Service.registerPairs(list); } catch (e) { console.error('[StockListFeatureV2] registerPairs failed', e); }
                },

                async deleteStockListForUserV2(userId: string, listName: string) {
                    const listObj = store.allStockListsV2().find(l => l.name === listName);
                    if (listObj) { try { await relStrDbV2Service.unregisterPairs(listObj); } catch {} }
                    await relStrDbV2Service.deleteStockList(userId, listName);
                    const stockLists = store.allStockListsV2().filter(l => l.name !== listName);
                    patchState(store, { allStockListsV2: stockLists });
                },

                async renameStockListForUserV2(userId: string, oldName: string, newList: RelStrStockList) {
                    await relStrDbV2Service.renameStockList(userId, oldName, newList);
                    const others = store.allStockListsV2().filter(l => l.name !== oldName);
                    const allStockListsV2 = sortListsV2(newList, [...others, newList]);
                    patchState(store, { allStockListsV2, selectedStockListV2: newList });
                    try { await relStrDbV2Service.registerPairs(newList); } catch (e) { console.error('[StockListFeatureV2] registerPairs (rename) failed', e); }
                },

                /**
                 * Backfill: Ensure all pairs in existing users/{uid}/lists are registered in pair-registry.
                 * This calls the validateAndRegisterPairs callable for each list so the backend can
                 * attach membership (uid/listId) and upsert the pair entries.
                 */
                async backfillUserListsToRegistryV2(userId: string) {
                    const uid = String(userId || '').trim();
                    if (!uid) return;
                    // Use in-memory lists when available; otherwise fetch
                    let lists = store.allStockListsV2();
                    if (!Array.isArray(lists) || lists.length === 0) {
                        try { lists = await relStrDbV2Service.getListsForUser(uid); } catch { lists = []; }
                        if (lists.length) patchState(store, { allStockListsV2: lists });
                    }
                    for (const list of lists) {
                        try { await relStrDbV2Service.registerPairs(list); } catch (e) {
                            console.error('[StockListFeatureV2] backfill registerPairs failed', { list: list?.name, e });
                        }
                    }
                },

                setAllStockListsV2(allStockListsV2: RelStrStockList[]) { patchState(store, { allStockListsV2 }); },
                setSelectedStockListV2(selectedStockListV2: RelStrStockList){ patchState(store, { selectedStockListV2 }) },
                updateStockListV2(list: RelStrStockList) {
                    const allStockListsV2 = store.allStockListsV2().filter(l => l.name !== list.name);
                    allStockListsV2.push({ ...list });
                    patchState(store, { allStockListsV2, selectedStockListV2: { ...list } })
                },

                async generateHeatmapDataV2(pair: string): Promise<BaselineTargetRankDatum[]> { 
                    const timeframe = rsDataStore.selectedTimeframe();
                    return generateHeatmapDataV2(pair, timeframe); 
                },
                async getHeatmapDataV2(pairs: string[]): Promise<RanksDataWithColors> { 
                    const timeframe = rsDataStore.selectedTimeframe();
                    return getHeatmapDataV2(pairs, timeframe); 
                },
                async resolveExistingRanksDataV2(list: RelStrStockList, force = false): Promise<RelStrStockList> { return resolveExistingRanksDataV2(list, force); },
                sortListsV2(targetList: RelStrStockList, allStockListsV2: RelStrStockList[]) { return sortListsV2(targetList, allStockListsV2); },
                async autoFixMissingCellsV2(fixes: Array<{ pair: string; dates: string[] }>) {
                    const current = store.selectedStockListV2();
                    if (!current?.name) return;
                    const updated = { ...current } as RelStrStockList;
                    await autoFixMissingCellsInternalV2(updated, fixes);
                    const allStockListsV2 = sortListsV2(updated, [...store.allStockListsV2()]);
                    patchState(store, { allStockListsV2, selectedStockListV2: updated });
                },

                async initializeListV2(list: RelStrStockList) {
                    // eslint-disable-next-line no-console
                    console.log('[StockListFeatureV2] initializeListV2(): incoming list', list?.name);
                    patchState(store, { selectedStockListV2: { ...list } });
                    try {
                        const resolved = await resolveExistingRanksDataV2({ ...list });
                        // eslint-disable-next-line no-console
                        console.log('[StockListFeatureV2] initializeListV2(): resolved ranks keys', Object.keys(resolved?.ranksDataWithColors ?? {}));
                        const allStockListsV2 = sortListsV2(resolved, [...store.allStockListsV2()]);
                        patchState(store, { allStockListsV2, selectedStockListV2: resolved });
                        // Live subscriptions temporarily disabled during stabilization
                        // TODO[realtime]: Re-enable realtime updates by invoking startLivePairSubscriptionsForList(resolved)
                        // after initial data is resolved. Also ensure to call stopLivePairSubscriptions() when
                        // selected list changes or on component teardown to prevent memory leaks.
                    } catch (e) {
                        console.error('[StockListFeatureV2] initializeListV2 resolution failed', e);
                    }
                },

                async saveListV2(list: RelStrStockList) {
                    console.log('[StockListFeatureV2] saveList called', { mode: store.formModeV2(), list });
                    let allStockListsV2 = [...store.allStockListsV2()];
                    list = await resolveExistingRanksDataV2(list);
                    if (store.formModeV2() === FormMode.EDIT) {
                        allStockListsV2 = sortListsV2(list, allStockListsV2);
                    } else {
                        allStockListsV2 = [...store.allStockListsV2(), list];
                    }
                    console.log('[StockListFeatureV2] patching state with new list count', { count: allStockListsV2.length });
                    patchState(store, { allStockListsV2, selectedStockListV2: list });
                },

                async deleteStockListV2(listOrName: string | RelStrStockList) {
                    const name = typeof listOrName === 'string' ? listOrName : listOrName.name;
                    const stockLists = store.allStockListsV2().filter(l => l.name !== name);
                    patchState(store, { allStockListsV2: stockLists });
                    const listObj = typeof listOrName === 'string' ? store.allStockListsV2().find(l => l.name === name) : listOrName;
                    if (listObj) { try { await relStrDbV2Service.unregisterPairs(listObj); } catch {} }
                },

                // RANKS DATA
                getRanksDataForPairV2(pair: string) { return relStrDbV2Service.getRanksData(pair); },
                saveRanksDataV2(pair: string, data: RanksByDate) { relStrDbV2Service.setRanksData(pair, data); },

                /** Force-refresh the current list heatmap under the current data source mode (DEV-only). */
                async refreshHeatmapForSelectedListV2() {
                    const current = store.selectedStockListV2();
                    if (!current?.name) return;
                    const updated = await resolveExistingRanksDataV2({ ...current }, true /* force */);
                    const allStockListsV2 = sortListsV2(updated, [...store.allStockListsV2()]);
                    patchState(store, { allStockListsV2, selectedStockListV2: updated });
                },
            };
        }),

        // STOCK LIST FORM STATE
        withMethods((store) => ({
            setFormModeV2(formModeV2: FormMode) {patchState(store, {formModeV2})},

            setShowFormV2(showFormV2: boolean) {patchState(store, {showFormV2})},

            setFormDataV2(formDataV2: RelStrStockList) {
                // console.log('wSLFeatV2 sFD input form data: ', formDataV2);
                patchState(store, {formDataV2})
            },
        })),
    )
}