import { inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, withHooks, patchState } from '@ngrx/signals';
import { Collection, BucketDocId, Subcollection } from '../../core/common/constants';
import { Firestore, collection, collectionData } from '@angular/fire/firestore';
import { PositionDoc, PositionDirection, BackendPositionDoc } from '../../core/models/fe-position.types';
import { MOCK_OPEN_POSITIONS } from './positions-mock-data';
import { Observable } from 'rxjs';
import { computed } from '@angular/core';

export interface PositionsStoreState {
  loading: boolean;
  error: string;
  open: Record<string, PositionDoc>;
  closed: Record<string, PositionDoc>;
}

const initialState: PositionsStoreState = {
  loading: false,
  error: '',
  open: {},
  closed: {},
};

function positionsCollection(fs: Firestore, bucketId: string) {
  return collection(fs, `${Collection.POSITIONS}/${bucketId}/${Subcollection.ITEMS}`).withConverter<PositionDoc>({
    toFirestore: (v: PositionDoc) => v as any,
    fromFirestore: (snap) => {
      const raw = snap.data() as any;
      const id = snap.id;

      let pair: string | undefined = raw.pair;
      let baseline: string | undefined = (raw as any).baseline;
      let symbol: string | undefined = (raw as any).symbol;

      if (!pair) {
        const parts = id.split('-');
        if (parts.length >= 5) {
          baseline = baseline ?? parts[2];
          symbol = symbol ?? parts[3];
          pair = `${baseline}/${symbol}`;
        }
      }

      return {
        positionId: id,
        ...raw,
        ...(pair ? { pair } : {}),
        ...(baseline ? { baseline } : {}),
        ...(symbol ? { symbol } : {}),
      } as PositionDoc;
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
    return {
      openList,
      closedList,
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
  withMethods((store) => {
    const fs = inject(Firestore);

    function listenToBucket(bucketId: string): Observable<PositionDoc[]> {
      const col = positionsCollection(fs, bucketId);
      // Read all docs in the bucket; positionId is derived from docId in the converter
      return collectionData(col) as Observable<PositionDoc[]>;
    }

    return {
      listenToBucket,
    };
  }),
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

            for (const mock of MOCK_OPEN_POSITIONS) {
              if (mock.positionId) {
                map[mock.positionId] = mock;
              }
            }

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
