import { inject } from '@angular/core';
import { patchState, signalStore, withMethods, withState } from '@ngrx/signals';
import { TradeJournalListItem, TradeDirection, TradeStatus, TRADE_JOURNAL_MOCK_TRADES } from './trade-journal.mocks';
import { NewTradeDialogResult } from './new-trade.dialog';
import { TradeJournalService } from './trade-journal.service';

export interface TradeJournalStoreState {
  trades: TradeJournalListItem[];
  loading: boolean;
  error: string | null;
}

const initialState: TradeJournalStoreState = {
  trades: TRADE_JOURNAL_MOCK_TRADES,
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
  };
}

export const TradeJournalStore = signalStore(
  { providedIn: 'root' },
  withState<TradeJournalStoreState>(initialState),
  withMethods((store, service: TradeJournalService = inject(TradeJournalService)) => ({
    async addTradeFromDialog(result: NewTradeDialogResult): Promise<string> {
      const current = store.trades();
      const rawDate = String(result.entryDate ?? '').slice(0, 10);
      const compactDate = rawDate.replace(/-/g, '');
      const upperSymbol = String(result.symbol ?? '').trim().toUpperCase();
      const upperDirection = String(result.direction ?? '').trim().toUpperCase();
      const action = result.status === TradeStatus.CLOSED ? 'close' : 'open';

      const newId = `${compactDate}-${upperSymbol}-${upperDirection}-${action}`;
      const newTrade = buildTradeFromDialog(
        {
          ...result,
          symbol: upperSymbol,
          direction: upperDirection,
        },
        newId,
      );

      patchState(store, {
        trades: [...current, newTrade],
        loading: true,
        error: null,
      });

      try {
        await service.importTrade(result, newTrade.id);
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('[TradeJournalStore] importTrade failed', e);
        patchState(store, { error: String(e?.message || 'import failed') });
      } finally {
        patchState(store, { loading: false });
      }

      return newTrade.id;
    },
  })),
);
