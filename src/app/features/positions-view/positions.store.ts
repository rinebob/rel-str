import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, withHooks, patchState } from '@ngrx/signals';
import { Collection, BucketDocId, Subcollection } from '../../core/common/constants';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { PositionDoc, PositionDirection, BackendPositionDoc, PositionStatus } from '../../core/models/fe-position.types';
import { MOCK_OPEN_POSITIONS } from './positions-mock-data';
import { Observable } from 'rxjs';
import { computed } from '@angular/core';

export enum PositionsSideFilter {
  ALL = 'all',
  LONG = 'long',
  SHORT = 'short',
}

export enum PositionsResultFilter {
  ALL = 'all',
  WINNERS = 'winners',
  LOSERS = 'losers',
}

export interface PositionsStoreState {
  loading: boolean;
  error: string;
  open: Record<string, PositionDoc>;
  closed: Record<string, PositionDoc>;
  sideFilter: PositionsSideFilter;
  resultFilter: PositionsResultFilter;
  closedFromTimestamp: number | null;
  closedToTimestamp: number | null;
  closedPageIndex: number;
  closedPageSize: number;
}

const initialState: PositionsStoreState = {
  loading: false,
  error: '',
  open: {},
  closed: {},
  sideFilter: PositionsSideFilter.ALL,
  resultFilter: PositionsResultFilter.ALL,
  closedFromTimestamp: null,
  closedToTimestamp: null,
  closedPageIndex: 0,
  closedPageSize: 50,
};

function projectBackendPosition(raw: BackendPositionDoc, id: string): PositionDoc {
  const positionId = String(id || raw.positionId || '').trim();

  const entry = raw.entry;
  const updates = Array.isArray(raw.updates) ? raw.updates : [];
  const latestSample = raw.exit ?? (updates.length > 0 ? updates[updates.length - 1] : entry);

  const isOpen = raw.status === PositionStatus.OPEN;

  const rawDir = String((raw as unknown as { direction?: string }).direction ?? '').toUpperCase();
  const direction = rawDir === PositionDirection.SHORT ? PositionDirection.SHORT : PositionDirection.LONG;

  const projected: PositionDoc = {
    ...raw,
    positionId,
    direction,
    entryPrice: entry?.price,
    entryDay: entry?.day,
    entryTimestamp: entry?.timestamp,
  };

  if (latestSample) {
    if (isOpen) {
      projected.currentPrice = latestSample.price;
      projected.currentChange = latestSample.pnl;
      projected.currentPctChange = latestSample.pct;
      projected.lastUpdateDay = latestSample.day;
      projected.currentRs = latestSample.rs;

      projected.netPnL = latestSample.pnl;
      projected.percentReturn = latestSample.pct;
    } else {
      if (raw.exit) {
        projected.exitPrice = raw.exit.price;
        projected.exitDay = raw.exit.day;
        projected.exitTimestamp = raw.exit.timestamp;
        projected.exitRs = raw.exit.rs;
      }

      projected.netPnL = raw.netPnL ?? raw.exit?.pnl;
      projected.percentReturn = raw.netPercentReturn ?? raw.exit?.pct;
    }
  }

  return projected;
}

function positionsCollection(fs: Firestore, bucketId: string) {
  return collection(fs, `${Collection.POSITIONS}/${bucketId}/${Subcollection.ITEMS}`).withConverter<PositionDoc>({
    toFirestore: (v: PositionDoc) => ({ ...v }),
    fromFirestore: (snap) => {
      const raw = snap.data() as BackendPositionDoc;
      const id = String(snap.id || raw.positionId || '').trim();
      return projectBackendPosition(raw, id);
    },
  });
}

export const PositionsStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => {
    const openList = computed<PositionDoc[]>(() =>
      Object.values(store.open()).sort((a, b) => {
        const ta = a.entryTimestamp ?? 0;
        const tb = b.entryTimestamp ?? 0;
        // Oldest first = longest time opened
        return ta - tb;
      }),
    );
    const closedList = computed<PositionDoc[]>(() =>
      Object.values(store.closed()).sort((a, b) => {
        const ta = a.exitTimestamp ?? 0;
        const tb = b.exitTimestamp ?? 0;
        return tb - ta;
      }),
    );
    const openLongs = computed<PositionDoc[]>(() =>
      openList().filter((p) => (p.direction ?? PositionDirection.LONG) === PositionDirection.LONG),
    );
    const openShorts = computed<PositionDoc[]>(() =>
      openList().filter((p) => (p.direction ?? PositionDirection.SHORT) === PositionDirection.SHORT),
    );
    const closedLongs = computed<PositionDoc[]>(() =>
      closedList().filter((p) => (p.direction ?? PositionDirection.LONG) === PositionDirection.LONG),
    );
    const closedShorts = computed<PositionDoc[]>(() =>
      closedList().filter((p) => (p.direction ?? PositionDirection.SHORT) === PositionDirection.SHORT),
    );

    const totalOpenPnl = computed<number>(() =>
      openList().reduce((sum, p) => sum + (p.netPnL ?? 0), 0),
    );

    const openCount = computed<number>(() => openList().length);

    const longOpenPnl = computed<number>(() =>
      openLongs().reduce((sum, p) => sum + (p.netPnL ?? 0), 0),
    );

    const shortOpenPnl = computed<number>(() =>
      openShorts().reduce((sum, p) => sum + (p.netPnL ?? 0), 0),
    );

    const longOpenCount = computed<number>(() => openLongs().length);
    const shortOpenCount = computed<number>(() => openShorts().length);

    const openFiltered = computed<PositionDoc[]>(() => {
      const side = store.sideFilter();
      const res = store.resultFilter();

      return openList().filter((p) => {
        const isLong = (p.direction ?? PositionDirection.LONG) === PositionDirection.LONG;

        const entry = p.entryPrice ?? 0;
        const inferredChange =
          p.currentPrice != null && entry != null
            ? (p.currentPrice ?? 0) - entry
            : 0;
        const change = p.currentChange ?? inferredChange;

        if (side === PositionsSideFilter.LONG && !isLong) return false;
        if (side === PositionsSideFilter.SHORT && isLong) return false;

        if (res === PositionsResultFilter.WINNERS && change <= 0) return false;
        if (res === PositionsResultFilter.LOSERS && change >= 0) return false;

        return true;
      });
    });

    const closedFilteredAll = computed<PositionDoc[]>(() => {
      const side = store.sideFilter();
      const res = store.resultFilter();
      const from = store.closedFromTimestamp();
      const to = store.closedToTimestamp();

      return closedList().filter((p) => {
        const isLong = (p.direction ?? PositionDirection.LONG) === PositionDirection.LONG;

        const closedAt = p.exitTimestamp ?? 0;
        if (from != null && closedAt < from) return false;
        if (to != null && closedAt > to) return false;

        const entry = p.entryPrice ?? 0;
        const exit = p.exitPrice ?? 0;
        const inferredChange = exit && entry ? exit - entry : 0;
        const change = p.netPnL ?? inferredChange;

        if (side === PositionsSideFilter.LONG && !isLong) return false;
        if (side === PositionsSideFilter.SHORT && isLong) return false;

        if (res === PositionsResultFilter.WINNERS && change <= 0) return false;
        if (res === PositionsResultFilter.LOSERS && change >= 0) return false;

        return true;
      });
    });

    const closedFiltered = computed<PositionDoc[]>(() => {
      const pageIndex = store.closedPageIndex();
      const pageSize = store.closedPageSize();
      const all = closedFilteredAll();
      const start = pageIndex * pageSize;
      return all.slice(start, start + pageSize);
    });

    const closedFilteredCount = computed<number>(() => closedFilteredAll().length);
    return {
      openList,
      closedList,
      openFiltered,
      closedFiltered,
      closedFilteredCount,
      openLongs,
      openShorts,
      closedLongs,
      closedShorts,
      totalOpenPnl,
      openCount,
      longOpenPnl,
      shortOpenPnl,
      longOpenCount,
      shortOpenCount,
    };
  }),
  withMethods((store) => ({
    listenToBucket(bucketId: string): Observable<PositionDoc[]> {
      const fs = inject(Firestore);
      const col = positionsCollection(fs, bucketId);
      // Read all docs in the bucket; positionId is derived from docId in the converter
      return collectionData(col) as Observable<PositionDoc[]>;
    },

    setSideFilter(value: PositionsSideFilter): void {
      patchState(store, { sideFilter: value });
    },

    setResultFilter(value: PositionsResultFilter): void {
      patchState(store, { resultFilter: value });
    },

    setClosedDateRange(from: number | null, to: number | null): void {
      patchState(store, {
        closedFromTimestamp: from,
        closedToTimestamp: to,
        closedPageIndex: 0,
      });
    },

    setClosedPage(index: number): void {
      const safeIndex = index < 0 ? 0 : index;
      patchState(store, { closedPageIndex: safeIndex });
    },

    setClosedPagination(index: number, size: number): void {
      const safeIndex = index < 0 ? 0 : index;
      const safeSize = size > 0 ? size : store.closedPageSize();
      patchState(store, {
        closedPageIndex: safeIndex,
        closedPageSize: safeSize,
      });
    },
  })),
  withHooks({
    onInit(store) {
      patchState(store, { loading: true, error: '' });
      try {
        const fs = inject(Firestore);
        const year = new Date().getFullYear();
        const closedBucketId = `${year}-closed`;

        // Always-visible debug of Firestore environment and target buckets
        try {
          const fsAny = fs as any;
          const proj = fsAny?.app?.options?.projectId;
          // eslint-disable-next-line no-console
          console.log('[PositionsStore] Firestore env', {
            projectId: proj,
            openBucketId: BucketDocId.OPEN,
            closedBucketId,
          });
        } catch {}

        const listenToBucket = (bucketId: string): Observable<PositionDoc[]> => {
          const col = positionsCollection(fs, bucketId);
          return collectionData(col) as Observable<PositionDoc[]>;
        };

        listenToBucket(BucketDocId.OPEN).subscribe({
          next: (items) => {
            // Start with mock open positions so we can see a richer UI during development.
            // Backend data for a given positionId will always win over the mock entry.
            const map: Record<string, PositionDoc> = {};

            // for (const mock of MOCK_OPEN_POSITIONS) {
            //   if (mock.positionId) {
            //     map[mock.positionId] = mock;
            //   }
            // }

            for (const p of items) {
              if (p.positionId) {
                map[p.positionId] = p;
              }
            }
            // Always-visible debug log for open positions
            // eslint-disable-next-line no-console
            console.log('[PositionsStore] OPEN bucket snapshot', {
              bucketId: BucketDocId.OPEN,
              count: Object.keys(map).length,
              items,
              ids: Object.keys(map),
            });
            patchState(store, { open: map });
          },
          error: (err) => {
            // eslint-disable-next-line no-console
            console.error('[PositionsStore] OPEN bucket subscribe error', err);
          },
        });

        listenToBucket(closedBucketId).subscribe({
          next: (items) => {
            const map: Record<string, PositionDoc> = {};
            for (const p of items) {
              if (p.positionId) {
                map[p.positionId] = p;
              }
            }
            // Always-visible debug log for closed positions
            // eslint-disable-next-line no-console
            console.log('[PositionsStore] CLOSED bucket snapshot', {
              bucketId: closedBucketId,
              count: items.length,
              items,
              ids: Object.keys(map),
            });
            patchState(store, { closed: map });
          },
          error: (err) => {
            // eslint-disable-next-line no-console
            console.error('[PositionsStore] CLOSED bucket subscribe error', err);
          },
        });
      } catch (e: any) {
        patchState(store, { error: String(e?.message || 'positions load failed') });
      } finally {
        patchState(store, { loading: false });
      }
    },
  }),
);
