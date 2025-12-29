import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';
import { TradeDirection, TradeStatus } from '../../core/common/constants';
import { AuthService } from '../../core/auth/auth.service';
import { FirebaseStorageService } from '../../core/storage/firebase-storage.service';
import {
  TRADE_BUCKET_BROKER_CSVS,
  TRADE_BUCKET_INDICATOR_CSVS,
  TRADE_BUCKET_SCREENSHOTS,
  TradeImportPayload,
  TradeJournalListItem,
  TradeUpsertDto,
  TradeUpsertOperation,
  buildTradeBucketPrefix,
} from './trade-journal.types';
import { NewTradeDialogResult } from './new-trade.dialog';
import { TradeJournalService } from './trade-journal.service';

export interface TradeJournalStoreState {
  trades: TradeJournalListItem[];
  loading: boolean;
  error: string | null;
}

function buildImportPayloadFromDialog(
  result: NewTradeDialogResult,
  trade: TradeJournalListItem,
): TradeImportPayload {
  const rawEntryDate = String(result.entryDate ?? '').slice(0, 10);
  const rawEntryTime = String(result.entryTime ?? '');

  return {
    trade,
    entryDate: rawEntryDate,
    entryTime: rawEntryTime,
    brokerCsvFiles: result.brokerCsvFiles ?? [],
    indicatorCsvFiles: result.indicatorCsvFiles ?? [],
    screenshotFiles: result.screenshotFiles ?? [],
    deletedBrokerCsvPaths: result.deletedBrokerCsvPaths,
    deletedIndicatorCsvPaths: result.deletedIndicatorCsvPaths,
    deletedScreenshotPaths: result.deletedScreenshotPaths,
  };
}

const initialState: TradeJournalStoreState = {
  trades: [],
  loading: false,
  error: null,
};

function buildTradeFromDialog(result: NewTradeDialogResult, id: string): TradeJournalListItem {
  const { symbol, direction, status, entryPrice, entryDate, entryTime } = result;

  const parsedPrice = Number(entryPrice);
  const safePrice = Number.isFinite(parsedPrice) ? parsedPrice : 0;

  const entryDateTime = `${entryDate || ''} ${entryTime || ''}`.trim();

  const mappedDirection = direction === TradeDirection.SHORT ? TradeDirection.SHORT : TradeDirection.LONG;

  let mappedStatus: TradeStatus;
  switch (status) {
    case TradeStatus.OPEN:
      mappedStatus = TradeStatus.OPEN;
      break;
    case TradeStatus.CLOSED:
      mappedStatus = TradeStatus.CLOSED;
      break;
    default:
      mappedStatus = TradeStatus.OPEN;
  }

  return {
    id,
    symbol: symbol.trim().toUpperCase(),
    direction: mappedDirection,
    status: mappedStatus,
    entryDate: entryDateTime,
    entryPrice: safePrice,
  };
}

export const TradeJournalStore = signalStore(
  { providedIn: 'root' },
  withState<TradeJournalStoreState>(initialState),
  withMethods((store) => {
    const service = inject(TradeJournalService);
    const authService = inject(AuthService);
    const storageService = inject(FirebaseStorageService);

    const buildUpsertPaths = async (
      uid: string,
      tradeId: string,
      result: NewTradeDialogResult,
      existing: TradeJournalListItem | null,
    ): Promise<Pick<
      TradeUpsertDto,
      | 'brokerCsvPaths'
      | 'indicatorCsvPaths'
      | 'screenshotPaths'
      | 'deletedBrokerCsvPaths'
      | 'deletedIndicatorCsvPaths'
      | 'deletedScreenshotPaths'
    >> => {
      const existingBroker = existing?.brokerCsvPaths ?? [];
      const existingIndicator = existing?.indicatorCsvPaths ?? [];
      const existingScreenshots = existing?.screenshotPaths ?? [];

      const deletedBroker = result.deletedBrokerCsvPaths ?? [];
      const deletedIndicator = result.deletedIndicatorCsvPaths ?? [];
      const deletedScreenshots = result.deletedScreenshotPaths ?? [];

      const keptBroker = existingBroker.filter((p) => !deletedBroker.includes(p));
      const keptIndicator = existingIndicator.filter((p) => !deletedIndicator.includes(p));
      const keptScreenshots = existingScreenshots.filter((p) => !deletedScreenshots.includes(p));

      const newBrokerFiles = result.brokerCsvFiles ?? [];
      const newIndicatorFiles = result.indicatorCsvFiles ?? [];
      const newScreenshotFiles = result.screenshotFiles ?? [];

      const brokerPrefix = buildTradeBucketPrefix(uid, tradeId, TRADE_BUCKET_BROKER_CSVS);
      const indicatorPrefix = buildTradeBucketPrefix(uid, tradeId, TRADE_BUCKET_INDICATOR_CSVS);
      const screenshotPrefix = buildTradeBucketPrefix(uid, tradeId, TRADE_BUCKET_SCREENSHOTS);

      const [newBrokerPaths, newIndicatorPaths, newScreenshotPaths] = await Promise.all([
        storageService.uploadFiles({ uid, pathPrefix: brokerPrefix, files: newBrokerFiles }),
        storageService.uploadFiles({ uid, pathPrefix: indicatorPrefix, files: newIndicatorFiles }),
        storageService.uploadFiles({ uid, pathPrefix: screenshotPrefix, files: newScreenshotFiles }),
      ]);

      return {
        brokerCsvPaths: [...keptBroker, ...newBrokerPaths],
        indicatorCsvPaths: [...keptIndicator, ...newIndicatorPaths],
        screenshotPaths: [...keptScreenshots, ...newScreenshotPaths],
        deletedBrokerCsvPaths: deletedBroker,
        deletedIndicatorCsvPaths: deletedIndicator,
        deletedScreenshotPaths: deletedScreenshots,
      };
    };

    return {
    async loadTrades(): Promise<void> {
        console.log('[TradeJournalService] loadTrades called');
      patchState(store, { loading: true, error: null });

      try {
        const trades = await service.loadTrades();
        console.log('[TradeJournalService] loadTrades: ', trades, trades.length);
        patchState(store, { trades, loading: false });
      } catch (e: any) {
        console.log('[TradeJournalService] loadTrades failed');
        patchState(store, {
          loading: false,
          error: String(e?.message || 'failed to load trades'),
        });
      }
    },

    async addTradeFromDialogDeprecated(result: NewTradeDialogResult): Promise<string> {
      const current = store.trades();
      const rawDate = String(result.entryDate ?? '').slice(0, 10);
      const compactDate = rawDate.replace(/-/g, '');
      const upperSymbol = String(result.symbol ?? '').trim().toUpperCase();
      const upperDirection = String(result.direction ?? '').trim().toUpperCase();
      const action = result.status === TradeStatus.CLOSED ? 'CLOSE' : 'OPEN';

      const newId = `${compactDate}-${upperSymbol}-${upperDirection}-${action}`;
      const newTrade = buildTradeFromDialog(
        {
          ...result,
          symbol: upperSymbol,
          direction: upperDirection,
        },
        newId,
      );

      const importPayload = buildImportPayloadFromDialog(result, newTrade);

      patchState(store, {
        trades: [...current, newTrade],
        loading: true,
        error: null,
      });

      try {
        await service.importTradeDeprecated(importPayload);
        try {
          const screenshotUrl = await service.loadPrimaryScreenshotUrl(newTrade.id);
          if (screenshotUrl) {
            const updated = store.trades().map((t) =>
              t.id === newTrade.id ? { ...t, screenshotUrl } : t,
            );
            patchState(store, { trades: updated });
          }
        } catch (innerErr: any) {
          // eslint-disable-next-line no-console
          console.error('[TradeJournalStore] loadPrimaryScreenshotUrl failed', innerErr);
        }
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[TradeJournalStore] importTrade failed', e);
        patchState(store, { error: String(e?.message || 'import failed') });
      } finally {
        patchState(store, { loading: false });
      }

      return newTrade.id;
    },

    async editTradeFromDialogDeprecated(tradeId: string, result: NewTradeDialogResult): Promise<void> {
      patchState(store, { loading: true, error: null });

      try {
        const existing = store.trades().find((t) => t.id === tradeId);
        if (!existing) {
          throw new Error(`Trade with id ${tradeId} not found in store`);
        }

        const updatedTrade: TradeJournalListItem = {
          ...existing,
          ...buildTradeFromDialog(result, tradeId),
          brokerCsvPaths: existing.brokerCsvPaths ?? null,
          indicatorCsvPaths: existing.indicatorCsvPaths ?? null,
          screenshotPaths: existing.screenshotPaths ?? null,
        };

        const payload = buildImportPayloadFromDialog(result, updatedTrade);

        await service.editTradeDeprecated(payload);

        // Reload trades from Firestore so paths and screenshotUrl stay in sync
        const refreshed = await service.loadTrades();
        patchState(store, { trades: refreshed });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[TradeJournalStore] editTradeFromDialog failed', e);
        patchState(store, { error: String(e?.message || 'edit failed') });
      } finally {
        patchState(store, { loading: false });
      }
    },

    async addTradeFromDialog(result: NewTradeDialogResult): Promise<string> {
      patchState(store, { loading: true, error: null });

      const user = await firstValueFrom(authService.user$);
      if (!user) {
        patchState(store, { loading: false, error: 'Unauthenticated user' });
        throw new Error('[TradeJournalStore] addTradeFromDialog requires authenticated user');
      }

      const rawDate = String(result.entryDate ?? '').slice(0, 10);
      const compactDate = rawDate.replace(/-/g, '');
      const upperSymbol = String(result.symbol ?? '').trim().toUpperCase();
      const upperDirection = String(result.direction ?? '').trim().toUpperCase();
      const action = result.status === TradeStatus.CLOSED ? 'CLOSE' : 'OPEN';

      const newId = `${compactDate}-${upperSymbol}-${upperDirection}-${action}`;
      const trade = buildTradeFromDialog(
        {
          ...result,
          symbol: upperSymbol,
          direction: upperDirection,
        },
        newId,
      );

      try {
        const upsertPaths = await buildUpsertPaths(user.uid, newId, result, null);

        const dto: TradeUpsertDto = {
          operation: TradeUpsertOperation.CREATE,
          tradeId: newId,
          trade,
          ...upsertPaths,
        };

        const tradeId = await service.createTrade(dto);

        const refreshed = await service.loadTrades();
        patchState(store, { trades: refreshed, loading: false });

        return tradeId;
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[TradeJournalStore] addTradeFromDialog (JSON) failed', e);
        patchState(store, { loading: false, error: String(e?.message || 'create failed') });
        throw e;
      }
    },

    async editTradeFromDialog(tradeId: string, result: NewTradeDialogResult): Promise<void> {
      patchState(store, { loading: true, error: null });

      const user = await firstValueFrom(authService.user$);
      if (!user) {
        patchState(store, { loading: false, error: 'Unauthenticated user' });
        throw new Error('[TradeJournalStore] editTradeFromDialog requires authenticated user');
      }

      try {
        const existing = store.trades().find((t) => t.id === tradeId) ?? null;
        if (!existing) {
          throw new Error(`Trade with id ${tradeId} not found in store`);
        }

        const trade: TradeJournalListItem = {
          ...existing,
          ...buildTradeFromDialog(result, tradeId),
        };

        const upsertPaths = await buildUpsertPaths(user.uid, tradeId, result, existing);

        const dto: TradeUpsertDto = {
          operation: TradeUpsertOperation.EDIT,
          tradeId,
          trade,
          ...upsertPaths,
        };

        await service.editTrade(dto);

        const refreshed = await service.loadTrades();
        patchState(store, { trades: refreshed, loading: false });
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[TradeJournalStore] editTradeFromDialog (JSON) failed', e);
        patchState(store, { loading: false, error: String(e?.message || 'edit failed') });
        throw e;
      }
    },
  }; }),
);
