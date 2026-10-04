import { SignalTimeframe, SignalDirection, SignalStatus, SIGNAL_FILTER_ALL, ReviewDecision, GroupDimension, NO_MEMBERSHIP } from '../common/constants';
import type { StSignalItem, StSymbolProfile } from '../services/types';
import type { SymbolGroup } from '../stores/group.store';
import {
  matchesSignalFilter,
  filterSignals,
  profileMatchesSignalFilter,
  rowMatchesSignalFilter,
  rowHasDirection,
  buildSymbolGroups,
  BuildSymbolGroupsInput,
  mapSymbolProfile,
  formatTradingViewWatchlist,
  isUntriaged,
  shouldShowInListFilter,
  fillSignalClosePrices,
} from './utils';
import type { OhlcBar } from '../../../core/models/market-data.types';
import { StSymbolSource } from '../services/types';

const mockSignal = (
  overrides: Partial<StSignalItem> = {}
): StSignalItem => ({
  id: '2026-07-10',
  symbol: 'AAPL',
  barDate: '2026-07-10',
  marketDate: '2026-07-10',
  runId: 'run-1',
  timeframe: SignalTimeframe.DAILY,
  direction: SignalDirection.LONG,
  signalType: 'D_ZONE_V1_UPTICK',
  status: SignalStatus.CONFIRMED,
  indicators: {},
  ...overrides,
});

const TEST_CREATED_AT = '2026-01-01T00:00:00.000Z';

const mockProfile = (
  createdAt: string,
  overrides: Partial<Omit<StSymbolProfile, 'createdAt'>> = {}
): StSymbolProfile => ({
  symbol: 'AAPL',
  name: 'Apple Inc.',
  sector: 'Technology',
  industry: 'Consumer Electronics',
  marketCapTier: 'large',
  exchange: 'NASDAQ',
  enabled: true,
  createdAt,
  ...overrides,
});

describe('formatTradingViewWatchlist', () => {
  it('formats selected symbols with exchange prefixes', () => {
    const profiles = [
      mockProfile(TEST_CREATED_AT, { symbol: 'AAPL', exchange: 'NASDAQ' }),
      mockProfile(TEST_CREATED_AT, { symbol: 'T', exchange: 'NYSE' }),
    ];

    expect(formatTradingViewWatchlist(['aapl', 'T'], profiles)).toEqual({
      content: 'NASDAQ:AAPL,NYSE:T',
      unresolved: [],
    });
  });

  it('reports symbols without exchange metadata instead of exporting raw symbols', () => {
    const result = formatTradingViewWatchlist(['AAPL', 'MSFT'], [
      mockProfile(TEST_CREATED_AT, { symbol: 'AAPL', exchange: 'NASDAQ' }),
    ]);

    expect(result).toEqual({
      content: 'NASDAQ:AAPL',
      unresolved: ['MSFT'],
    });
  });
});

describe('matchesSignalFilter', () => {
  it('returns true when filter is ALL', () => {
    const signal = mockSignal();
    expect(matchesSignalFilter(signal, SIGNAL_FILTER_ALL)).toBe(true);
  });

  it('matches timeframe only', () => {
    const signal = mockSignal({ timeframe: SignalTimeframe.WEEKLY });
    expect(matchesSignalFilter(signal, { timeframe: SignalTimeframe.WEEKLY, direction: SignalDirection.ALL })).toBe(true);
    expect(matchesSignalFilter(signal, { timeframe: SignalTimeframe.DAILY, direction: SignalDirection.ALL })).toBe(false);
  });

  it('matches direction only', () => {
    const signal = mockSignal({ direction: SignalDirection.SHORT });
    expect(matchesSignalFilter(signal, { timeframe: SignalTimeframe.ALL, direction: SignalDirection.SHORT })).toBe(true);
    expect(matchesSignalFilter(signal, { timeframe: SignalTimeframe.ALL, direction: SignalDirection.LONG })).toBe(false);
  });

  it('matches both timeframe and direction', () => {
    const signal = mockSignal({ timeframe: SignalTimeframe.DAILY, direction: SignalDirection.LONG });
    expect(matchesSignalFilter(signal, { timeframe: SignalTimeframe.DAILY, direction: SignalDirection.LONG })).toBe(true);
    expect(matchesSignalFilter(signal, { timeframe: SignalTimeframe.WEEKLY, direction: SignalDirection.LONG })).toBe(false);
    expect(matchesSignalFilter(signal, { timeframe: SignalTimeframe.DAILY, direction: SignalDirection.SHORT })).toBe(false);
  });
});

describe('filterSignals', () => {
  it('returns all signals for ALL filter', () => {
    const signals = [mockSignal(), mockSignal({ direction: SignalDirection.SHORT })];
    expect(filterSignals(signals, SIGNAL_FILTER_ALL)).toEqual(signals);
  });

  it('filters by direction', () => {
    const long = mockSignal({ direction: SignalDirection.LONG });
    const short = mockSignal({ direction: SignalDirection.SHORT });
    const result = filterSignals([long, short], { timeframe: SignalTimeframe.ALL, direction: SignalDirection.LONG });
    expect(result).toEqual([long]);
  });
});

describe('profileMatchesSignalFilter', () => {
  it('matches daily direction from profile', () => {
    const profile = mockProfile(TEST_CREATED_AT, { lastDailySignalDirection: SignalDirection.LONG });
    expect(profileMatchesSignalFilter(profile, { timeframe: SignalTimeframe.DAILY, direction: SignalDirection.LONG })).toBe(true);
    expect(profileMatchesSignalFilter(profile, { timeframe: SignalTimeframe.WEEKLY, direction: SignalDirection.LONG })).toBe(false);
  });

  it('matches any direction with ALL timeframe when profile has either signal', () => {
    const profile = mockProfile(TEST_CREATED_AT, { lastWeeklySignalDirection: SignalDirection.SHORT });
    expect(profileMatchesSignalFilter(profile, { timeframe: SignalTimeframe.ALL, direction: SignalDirection.SHORT })).toBe(true);
  });
});

describe('rowHasDirection', () => {
  it('uses loaded signals when available', () => {
    const row = {
      profile: mockProfile(TEST_CREATED_AT),
      hasSignal: true,
      signals: [mockSignal({ direction: SignalDirection.SHORT })],
      reviewStatus: ReviewDecision.PENDING,
      isReviewed: false,
    };
    expect(rowHasDirection(row, SignalDirection.SHORT)).toBe(true);
    expect(rowHasDirection(row, SignalDirection.LONG)).toBe(false);
  });

  it('falls back to profile directions when signals are not loaded', () => {
    const row = {
      profile: mockProfile(TEST_CREATED_AT, { lastDailySignalDirection: SignalDirection.LONG }),
      hasSignal: true,
      signals: undefined,
      reviewStatus: ReviewDecision.PENDING,
      isReviewed: false,
    };
    expect(rowHasDirection(row, SignalDirection.LONG)).toBe(true);
    expect(rowHasDirection(row, SignalDirection.SHORT)).toBe(false);
  });
});

describe('buildSymbolGroups', () => {
  const baseInput = (overrides: Partial<BuildSymbolGroupsInput> = {}): BuildSymbolGroupsInput => ({
    signalSymbols: [],
    allSymbols: [],
    showAll: false,
    dimension: GroupDimension.SECTOR,
    symbolLists: {},
    exclusiveListKeys: [],
    activeListFilter: 'ALL',
    statuses: {},
    reviewFlagSymbols: new Set<string>(),
    historyCache: {},
    historyLoading: {},
    activeRunId: 'run-1',
    signalFilter: SIGNAL_FILTER_ALL,
    ...overrides,
  });

  it('groups symbols by dimension', () => {
    const input = baseInput({
      signalSymbols: [
        mockProfile(TEST_CREATED_AT, { symbol: 'AAPL', sector: 'Technology', marketCap: 1000 }),
        mockProfile(TEST_CREATED_AT, { symbol: 'MSFT', sector: 'Technology', marketCap: 900 }),
        mockProfile(TEST_CREATED_AT, { symbol: 'XOM', sector: 'Energy', marketCap: 500 }),
      ],
    });

    const groups = buildSymbolGroups(input);
    expect(groups.length).toBe(2);

    const technology = groups.find((g: SymbolGroup) => g.key === 'Technology');
    expect(technology?.rows.length).toBe(2);
    expect(technology?.rows[0].profile.symbol).toBe('AAPL');

    const energy = groups.find((g: SymbolGroup) => g.key === 'Energy');
    expect(energy?.rows.length).toBe(1);
  });

  it('applies signal filter at the row level', () => {
    const input = baseInput({
      signalSymbols: [
        mockProfile(TEST_CREATED_AT, { symbol: 'AAPL', sector: 'Technology', lastDailySignalDirection: SignalDirection.LONG }),
        mockProfile(TEST_CREATED_AT, { symbol: 'TSLA', sector: 'Technology', lastDailySignalDirection: SignalDirection.SHORT }),
      ],
      signalFilter: { timeframe: SignalTimeframe.ALL, direction: SignalDirection.LONG },
    });

    const groups = buildSymbolGroups(input);
    expect(groups[0].rows.length).toBe(1);
    expect(groups[0].rows[0].profile.symbol).toBe('AAPL');
  });

  it('filters signals per row when history is loaded', () => {
    const profile = mockProfile(TEST_CREATED_AT, { symbol: 'AAPL' });
    const longSignal = mockSignal({ direction: SignalDirection.LONG });
    const shortSignal = mockSignal({ direction: SignalDirection.SHORT });

    const input = baseInput({
      signalSymbols: [profile],
      historyCache: { 'AAPL::run-1': [longSignal, shortSignal] },
      signalFilter: { timeframe: SignalTimeframe.ALL, direction: SignalDirection.LONG },
    });

    const groups = buildSymbolGroups(input);
    const row = groups[0].rows[0];
    expect(row.signals?.length).toBe(1);
    expect(row.signals?.[0].direction).toBe(SignalDirection.LONG);
  });

  it('excludes non-signal symbols unless showAll is true', () => {
    const input = baseInput({
      signalSymbols: [mockProfile(TEST_CREATED_AT, { symbol: 'AAPL' })],
      allSymbols: [mockProfile(TEST_CREATED_AT, { symbol: 'SPY' })],
      showAll: false,
    });

    expect(buildSymbolGroups(input).length).toBe(1);
    expect(buildSymbolGroups(input)[0].rows[0].profile.symbol).toBe('AAPL');
  });

  it('includes non-signal symbols when showAll is true', () => {
    const input = baseInput({
      signalSymbols: [mockProfile(TEST_CREATED_AT, { symbol: 'AAPL' })],
      allSymbols: [mockProfile(TEST_CREATED_AT, { symbol: 'SPY' })],
      showAll: true,
    });

    const groups = buildSymbolGroups(input);
    // Both symbols lack a sector so they land in the same "Unknown" group —
    // the assertion that matters is that the non-signal symbol is included.
    const symbols = groups.flatMap((g) => g.rows.map((r) => r.profile.symbol));
    expect(symbols).toEqual(expect.arrayContaining(['AAPL', 'SPY']));
  });
});

describe('mapSymbolProfile', () => {
  it('maps string fields and defaults enabled to true', () => {
    const raw: Record<string, unknown> = {
      symbol: 'AAPL',
      createdAt: '2026-07-13T20:00:00Z',
      source: StSymbolSource.PARTNER_UNIVERSE,
      name: 'Apple Inc.',
      sector: 'Technology',
      marketCap: 3000e9,
      marketCapTier: 'mega',
    };
    const profile = mapSymbolProfile(raw);
    expect(profile.symbol).toBe('AAPL');
    expect(profile.enabled).toBe(true);
    expect(profile.createdAt).toBe('2026-07-13T20:00:00Z');
    expect(profile.source).toBe(StSymbolSource.PARTNER_UNIVERSE);
    expect(profile.name).toBe('Apple Inc.');
    expect(profile.marketCap).toBe(3000e9);
    expect(profile.marketCapTier).toBe('mega');
  });

  it('converts a Firestore Timestamp duck-type to an ISO string', () => {
    const raw: Record<string, unknown> = {
      symbol: 'TSLA',
      createdAt: { toDate: () => new Date('2026-07-13T20:00:00Z') },
    };
    const profile = mapSymbolProfile(raw);
    expect(profile.createdAt).toBe(new Date('2026-07-13T20:00:00Z').toISOString());
  });

  it('ignores non-canonical source values', () => {
    const raw: Record<string, unknown> = {
      symbol: 'SPY',
      source: 'partner-universe-260713',
    };
    const profile = mapSymbolProfile(raw);
    expect(profile.source).toBeUndefined();
  });

  it('leaves missing fields undefined', () => {
    const raw: Record<string, unknown> = { symbol: 'META' };
    const profile = mapSymbolProfile(raw);
    expect(profile.name).toBeUndefined();
    expect(profile.marketCap).toBeUndefined();
    expect(profile.createdAt).toBe('');
  });
});

describe('isUntriaged', () => {
  const lists = { PRIMARY: ['AAPL', 'MSFT'], AVOID: ['TSLA'], Monitor: ['NVDA'] };
  const exclusiveKeys = ['PRIMARY', 'AVOID'];

  it('returns true for a symbol outside every exclusive list', () => {
    expect(isUntriaged('NVDA', lists, exclusiveKeys)).toBe(true);
  });

  it('returns false for membership in any exclusive list, case-insensitive on the symbol', () => {
    expect(isUntriaged('aapl', lists, exclusiveKeys)).toBe(false);
    expect(isUntriaged('TSLA', lists, exclusiveKeys)).toBe(false);
  });

  it('ignores nonexclusive memberships regardless of their key', () => {
    expect(isUntriaged('NVDA', lists, exclusiveKeys)).toBe(true);
    expect(isUntriaged('MSFT', lists, exclusiveKeys)).toBe(false);
  });
});

describe('shouldShowInListFilter', () => {
  const lists = { PRIMARY: ['AAPL', 'MSFT'], AVOID: ['TSLA'], 'user-list': ['NVDA'] };
  const exclusiveKeys = ['PRIMARY', 'AVOID'];

  it('ALL shows every symbol', () => {
    expect(shouldShowInListFilter('NVDA', lists, 'ALL', exclusiveKeys)).toBe(true);
    expect(shouldShowInListFilter('AAPL', lists, 'ALL', exclusiveKeys)).toBe(true);
  });

  it('a catalog list key shows only its members', () => {
    expect(shouldShowInListFilter('AAPL', lists, 'PRIMARY', exclusiveKeys)).toBe(true);
    expect(shouldShowInListFilter('NVDA', lists, 'user-list', exclusiveKeys)).toBe(true);
    expect(shouldShowInListFilter('TSLA', lists, 'PRIMARY', exclusiveKeys)).toBe(false);
  });

  it('NO_MEMBERSHIP uses the supplied exclusive-role keys only', () => {
    expect(shouldShowInListFilter('NVDA', lists, NO_MEMBERSHIP, exclusiveKeys)).toBe(true);
    expect(shouldShowInListFilter('AAPL', lists, NO_MEMBERSHIP, exclusiveKeys)).toBe(false);
    expect(shouldShowInListFilter('TSLA', lists, NO_MEMBERSHIP, exclusiveKeys)).toBe(false);
  });
});

describe('fillSignalClosePrices', () => {
  const bar = (d: string, c: number): OhlcBar => ({ d, o: c - 1, h: c + 1, l: c - 2, c });

  it('fills a daily signal closePrice from the firing bar', () => {
    const signals = [mockSignal({ barDate: '2026-10-02' })];
    const result = fillSignalClosePrices(signals, [bar('2026-10-02', 213.44)], []);
    expect(result[0].closePrice).toBe(213.44);
  });

  it('fills a weekly signal closePrice from the weekly bar, not a daily bar on the same date', () => {
    const signals = [mockSignal({ timeframe: SignalTimeframe.WEEKLY, barDate: '2026-09-29' })];
    const result = fillSignalClosePrices(
      signals,
      [bar('2026-09-29', 999)],
      [bar('2026-09-29', 187.5)],
    );
    expect(result[0].closePrice).toBe(187.5);
  });

  it('preserves an already-populated closePrice', () => {
    const signals = [mockSignal({ closePrice: 100 })];
    const result = fillSignalClosePrices(signals, [bar('2026-07-10', 200)], []);
    expect(result[0].closePrice).toBe(100);
  });

  it('leaves closePrice undefined when no bar matches the barDate', () => {
    const signals = [mockSignal({ barDate: '2026-10-02' })];
    const result = fillSignalClosePrices(signals, [bar('2026-10-01', 50)], []);
    expect(result[0].closePrice).toBeUndefined();
  });

  it('returns the same array reference when nothing needs filling', () => {
    const signals = [mockSignal({ closePrice: 1 })];
    expect(fillSignalClosePrices(signals, [bar('2026-07-10', 5)], [])).toBe(signals);
  });
});
