/**
 * Gallery cards util — unit tests (#754).
 *
 * Covers the pure seams: occurrence → symbol+side card aggregation,
 * timeframe/direction/list filtering, and the three gallery sorts.
 */
import {
  buildGalleryCards,
  filterGalleryCards,
  sortGalleryCards,
  GalleryCard,
  GalleryFilter,
  GalleryListContext,
} from './gallery-cards.util';
import { StSignalItem, StSymbolProfile } from '../services/types';
import {
  NO_MEMBERSHIP,
  SignalDirection,
  SignalStatus,
  SignalTimeframe,
} from '../common/constants';

const RUN_ID = 'run-1';

function profile(symbol: string, extra: Partial<StSymbolProfile> = {}): StSymbolProfile {
  return { symbol, enabled: true, createdAt: '2026-01-01', ...extra };
}

function signal(
  symbol: string,
  timeframe: SignalTimeframe,
  direction: SignalDirection,
  extra: Partial<StSignalItem> = {},
): StSignalItem {
  return {
    id: '2026-08-25',
    symbol,
    barDate: '2026-08-25',
    marketDate: '2026-08-25',
    runId: RUN_ID,
    timeframe,
    direction,
    signalType: 'RS_RISE',
    status: SignalStatus.INTERIM,
    indicators: {},
    ...extra,
  };
}

const noLists: GalleryListContext = {
  symbolLists: {},
  exclusiveListKeys: [],
};

const allFilter: GalleryFilter = {
  timeframe: SignalTimeframe.ALL,
  direction: SignalDirection.ALL,
  listFilter: 'ALL',
};

describe('buildGalleryCards', () => {
  it('aggregates same-side D+W occurrences into one card per symbol', () => {
    const cards = buildGalleryCards(
      [profile('AAPL')],
      {
        AAPL: [
          signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
          signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG, { signalType: 'RS_WEEKLY' }),
        ],
      },
    );

    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({ key: 'AAPL:buy', symbol: 'AAPL', side: 'buy' });
    expect(cards[0].occurrences).toHaveLength(2);
  });

  it('emits two cards when a symbol has opposite directions', () => {
    const cards = buildGalleryCards(
      [profile('TSLA')],
      {
        TSLA: [
          signal('TSLA', SignalTimeframe.DAILY, SignalDirection.LONG),
          signal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT),
        ],
      },
    );

    expect(cards).toHaveLength(2);
    expect(cards.map((c) => c.side).sort()).toEqual(['buy', 'sell']);
  });

  it('skips symbols with no occurrences for the run', () => {
    const cards = buildGalleryCards([profile('MSFT'), profile('AAPL')], { AAPL: [signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)] });
    expect(cards.map((c) => c.symbol)).toEqual(['AAPL']);
  });

  it('orders occurrences by barDate descending', () => {
    const cards = buildGalleryCards(
      [profile('AAPL')],
      {
        AAPL: [
          signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { barDate: '2026-08-20', id: '2026-08-20' }),
          signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { barDate: '2026-08-25', id: '2026-08-25' }),
        ],
      },
    );
    expect(cards[0].occurrences.map((o) => o.barDate)).toEqual(['2026-08-25', '2026-08-20']);
  });
});

describe('filterGalleryCards', () => {
  const cards = buildGalleryCards(
    [profile('AAPL'), profile('TSLA'), profile('MSFT')],
    {
      AAPL: [
        signal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
        signal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG),
      ],
      TSLA: [signal('TSLA', SignalTimeframe.WEEKLY, SignalDirection.SHORT)],
      MSFT: [signal('MSFT', SignalTimeframe.DAILY, SignalDirection.SHORT)],
    },
  );

  it('returns all cards under the ALL/ALL/ALL filter', () => {
    expect(filterGalleryCards(cards, allFilter, noLists)).toHaveLength(3);
  });

  it('filters to the matching direction', () => {
    const out = filterGalleryCards(cards, { ...allFilter, direction: SignalDirection.SHORT }, noLists);
    expect(out.map((c) => c.symbol).sort()).toEqual(['MSFT', 'TSLA']);
  });

  it('trims occurrences to the matching timeframe and drops empty cards', () => {
    const out = filterGalleryCards(cards, { ...allFilter, timeframe: SignalTimeframe.WEEKLY }, noLists);
    expect(out.map((c) => c.symbol).sort()).toEqual(['AAPL', 'TSLA']);
    const aapl = out.find((c) => c.symbol === 'AAPL')!;
    expect(aapl.occurrences).toHaveLength(1);
    expect(aapl.occurrences[0].timeframe).toBe(SignalTimeframe.WEEKLY);
  });

  it('filters by named list membership', () => {
    const lists: GalleryListContext = {
      symbolLists: { PRIMARY: ['AAPL'], MONITOR: ['TSLA'] },
      exclusiveListKeys: ['PRIMARY'],
    };
    const out = filterGalleryCards(cards, { ...allFilter, listFilter: 'PRIMARY' }, lists);
    expect(out.map((c) => c.symbol)).toEqual(['AAPL']);
  });

  it('NO_MEMBERSHIP keeps only symbols in zero exclusive lists', () => {
    // Untriaged is derived from exclusive-list membership — no separate
    // tracked-symbols load is required (#754 review finding).
    const lists: GalleryListContext = {
      symbolLists: { PRIMARY: ['AAPL', 'MSFT'], MONITOR: ['TSLA'] },
      exclusiveListKeys: ['PRIMARY'],
    };
    const out = filterGalleryCards(cards, { ...allFilter, listFilter: NO_MEMBERSHIP }, lists);
    expect(out.map((c) => c.symbol)).toEqual(['TSLA']);
  });
});

describe('sortGalleryCards', () => {
  const cards = (syms: { s: string; p?: Partial<StSymbolProfile> }[]): GalleryCard[] =>
    buildGalleryCards(
      syms.map(({ s, p }) => profile(s, p)),
      Object.fromEntries(syms.map(({ s }) => [s, [signal(s, SignalTimeframe.DAILY, SignalDirection.LONG)]])),
    );

  it('sector sort orders by sector → industry → symbol, missing values last', () => {
    const out = sortGalleryCards(
      cards([
        { s: 'ZZZ', p: { sector: 'Tech', industry: 'Software' } },
        { s: 'AAA', p: { sector: 'Energy', industry: 'Oil' } },
        { s: 'BBB', p: { sector: 'Energy', industry: 'Gas' } },
        { s: 'NOSEC' },
      ]),
      'sector',
      noLists,
    );
    expect(out.map((c) => c.symbol)).toEqual(['BBB', 'AAA', 'ZZZ', 'NOSEC']);
  });

  it('marketCap sort orders mega → micro → symbol, missing last', () => {
    const out = sortGalleryCards(
      cards([
        { s: 'SML', p: { marketCapTier: 'small' } },
        { s: 'MEG', p: { marketCapTier: 'mega' } },
        { s: 'MID', p: { marketCapTier: 'mid' } },
        { s: 'NOCAP' },
      ]),
      'marketCap',
      noLists,
    );
    expect(out.map((c) => c.symbol)).toEqual(['MEG', 'MID', 'SML', 'NOCAP']);
  });

  it('list sort orders by exclusive-list bucket order → symbol', () => {
    const lists: GalleryListContext = {
      symbolLists: { PRIMARY: ['B2'], SECONDARY: ['A1', 'C1'] },
      exclusiveListKeys: ['PRIMARY', 'SECONDARY'],
    };
    const out = sortGalleryCards(cards([{ s: 'C1' }, { s: 'B2' }, { s: 'A1' }, { s: 'NONE' }]), 'list', lists);
    expect(out.map((c) => c.symbol)).toEqual(['B2', 'A1', 'C1', 'NONE']);
  });
});
