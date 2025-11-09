import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { computed } from '@angular/core';
import { DecisionBoardDay, DecisionBoardService, PositionDoc } from './decision-board.service';

export interface DecisionBoardRange {
    fromDay?: string;
    toDay?: string;
    limitDays: number; // when no range provided
}

export interface DecisionBoardStoreState {
    range: DecisionBoardRange;
    days: DecisionBoardDay[]; // unsorted raw order from backend; we sort via selector
    loading: boolean;
    error: string;
    positions: Record<string, PositionDoc>; // keyed by positionId
    latestRs: Record<string, number | undefined>; // keyed by pair
}

const initialState: DecisionBoardStoreState = {
    range: { limitDays: 7 },
    days: [],
    loading: false,
    error: '',
    positions: {},
    latestRs: {},
};

export const DecisionBoardStore = signalStore(
    { providedIn: 'root' },
    withState(initialState),
    withComputed((store) => {
        // Define local computeds and return them, avoiding referencing them via store inside this block
        const daysDesc = computed<DecisionBoardDay[]>(() => [...store.days()].sort((a, b) => b.day.localeCompare(a.day)));
        const latestDay = computed<string | undefined>(() => daysDesc().at(0)?.day);
        const hasAnyItems = computed<boolean>(() => {
            const days = store.days();
            for (const d of days) {
                if ((d.items?.newCloses?.length || 0) + (d.items?.holds?.length || 0) + (d.items?.newOpens?.length || 0) > 0) return true;
            }
            return false;
        });
        const totals = computed<Array<{ day: string; opens: number; holds: number; closes: number }>>(() =>
            daysDesc().map((d: DecisionBoardDay) => ({ day: d.day, opens: d.items.newOpens.length, holds: d.items.holds.length, closes: d.items.newCloses.length }))
        );
        return {
            daysDesc,
            latestDay,
            hasAnyItems,
            totals,
        };
    }),
    withMethods((store) => {
        const svc = inject(DecisionBoardService);

        async function enrichLatestDay(days: DecisionBoardDay[]) {
            const latest = [...days].sort((a, b) => b.day.localeCompare(a.day))[0];
            if (!latest) { patchState(store, { positions: {}, latestRs: {} }); return; }
            const items = [...latest.items.newCloses, ...latest.items.holds, ...latest.items.newOpens];
            const positionIds = items.map((i) => i.positionId).filter(Boolean);
            const pairs = Array.from(new Set(items.map((i) => i.pair)));
            try {
                // Always-visible log: enrichment start
                // eslint-disable-next-line no-console
                console.log('[DecisionBoard] enrichLatestDay:start', { day: latest.day, positionIds: positionIds.length, pairs: pairs.length });
                let [posMap, rsMap] = await Promise.all([
                    svc.fetchPositions(positionIds),
                    svc.fetchLatestRs(pairs),
                ]);

                // Positions SOT = Firestore positions/{id}. No callable fallback.

                patchState(store, { positions: posMap, latestRs: rsMap });

                // Debug: log per-chip enriched data for the latest day
                try {
                    for (const it of latest.items.newCloses) {
                        const pos = posMap[it.positionId];
                        const rs = rsMap[it.pair];
                        const price = pos?.exitPrice;
                        const delta = pos?.netPnL;
                        const pct = pos?.percentReturn;
                        // eslint-disable-next-line no-console
                        console.log('[DecisionBoard][chip]', { kind: 'close', day: latest.day, item: it, pos, rs, price, delta, pct });
                    }
                    for (const it of latest.items.holds) {
                        const pos = posMap[it.positionId];
                        const rs = rsMap[it.pair];
                        const price = pos?.currentPrice;
                        const delta = pos?.currentChange;
                        const pct = pos?.currentPctChange;
                        // eslint-disable-next-line no-console
                        console.log('[DecisionBoard][chip]', { kind: 'hold', day: latest.day, item: it, pos, rs, price, delta, pct });
                    }
                    for (const it of latest.items.newOpens) {
                        const pos = posMap[it.positionId];
                        const rs = rsMap[it.pair];
                        const price = pos?.currentPrice;
                        const delta = pos?.currentChange;
                        const pct = pos?.currentPctChange;
                        // eslint-disable-next-line no-console
                        console.log('[DecisionBoard][chip]', { kind: 'open', day: latest.day, item: it, pos, rs, price, delta, pct });
                    }
                    // eslint-disable-next-line no-console
                    console.log('[DecisionBoard] enrichLatestDay:done', { day: latest.day, chips: items.length, positionsFound: Object.keys(posMap).length });
                } catch {}
            } catch (e: any) {
                patchState(store, { positions: {}, latestRs: {} });
                // eslint-disable-next-line no-console
                console.error('[DecisionBoard] enrichLatestDay:error', { message: e?.message, stack: e?.stack });
            }
        }

        return {
            totals: store.totals,

            async loadLastNDays(n?: number) {
                const limit = typeof n === 'number' ? n : 7;
                patchState(store, { loading: true, error: '', range: { limitDays: limit } });
                try {
                    const days = await svc.getDailySignals({ limitDays: limit });
                    patchState(store, { days });
                    await enrichLatestDay(days);
                } catch (e: any) {
                    patchState(store, { error: String(e?.message || 'load failed') });
                } finally {
                    patchState(store, { loading: false });
                }
            },

            async appendMore(n?: number) {
                const inc = typeof n === 'number' ? n : 7;
                const current = store.range().limitDays || 0;
                const nextLimit = current + inc;
                patchState(store, { loading: true, error: '', range: { limitDays: nextLimit } });
                try {
                    // Replace with full set up to nextLimit (server returns latest N); no need to merge manually
                    const days = await svc.getDailySignals({ limitDays: nextLimit });
                    patchState(store, { days });
                    await enrichLatestDay(days);
                } catch (e: any) {
                    patchState(store, { error: String(e?.message || 'append failed') });
                } finally {
                    patchState(store, { loading: false });
                }
            },

            // Load recent days until at least N non-empty signal days are available (or cap is reached)
            async loadLastNWithSignals(n?: number) {
                const target = Math.max(1, typeof n === 'number' ? n : 7);
                let limit = Math.max(7, target);
                const cap = 120; // safety bound
                patchState(store, { loading: true, error: '' });
                try {
                    while (true) {
                        const days = await svc.getDailySignals({ limitDays: limit });
                        patchState(store, { days, range: { limitDays: limit } });
                        const nonEmpty = days.filter((d) => (d.items?.newCloses?.length || 0) + (d.items?.holds?.length || 0) + (d.items?.newOpens?.length || 0) > 0).length;
                        if (nonEmpty >= target || limit >= cap) {
                            await enrichLatestDay(days);
                            break;
                        }
                        // Ramp up and try again
                        limit = Math.min(cap, Math.ceil(limit * 1.5));
                    }
                } catch (e: any) {
                    patchState(store, { error: String(e?.message || 'load (signals) failed') });
                } finally {
                    patchState(store, { loading: false });
                }
            },
        };
    })
);