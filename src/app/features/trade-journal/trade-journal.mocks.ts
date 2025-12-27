export enum TradeDirection {
  LONG = 'LONG',
  SHORT = 'SHORT',
}

export enum TradeStatus {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  CANCELED = 'CANCELED',
}

export interface TradeJournalListItem {
  id: string;
  symbol: string;
  direction: TradeDirection;
  status: TradeStatus;
  entryDate: string;
  exitDate?: string | null;
  pnlPct?: number | null;
}

export const TRADE_JOURNAL_MOCK_TRADES: TradeJournalListItem[] = [
  {
    id: 't-pltr-long-campaign-1',
    symbol: 'PLTR',
    direction: TradeDirection.LONG,
    status: TradeStatus.OPEN,
    entryDate: '2025-12-18',
    exitDate: null,
    pnlPct: 5.4,
  },
  {
    id: 't-pltr-long-scalp-1',
    symbol: 'PLTR',
    direction: TradeDirection.LONG,
    status: TradeStatus.CLOSED,
    entryDate: '2025-12-10',
    exitDate: '2025-12-12',
    pnlPct: 2.1,
  },
  {
    id: 't-qqq-short-hedge-1',
    symbol: 'QQQ',
    direction: TradeDirection.SHORT,
    status: TradeStatus.CLOSED,
    entryDate: '2025-11-20',
    exitDate: '2025-12-01',
    pnlPct: -1.3,
  },
  {
    id: 't-spy-long-planned-1',
    symbol: 'SPY',
    direction: TradeDirection.LONG,
    status: TradeStatus.OPEN,
    entryDate: '2025-12-31',
    exitDate: null,
    pnlPct: null,
  },
];
