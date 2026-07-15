import { SignalTimeframe, SignalDirection, SIGNAL_FILTER_ALL, RhAgentReviewDecision, GroupDimension } from '../common/rh-agent.constants';
import type { RhAgentSignalItem, RhAgentSymbolProfile } from '../services/rh-agent.types';
import type { RhSymbolGroup } from '../stores/rh-agent-group.store';
import {
  matchesSignalFilter,
  filterSignals,
  profileMatchesSignalFilter,
  rowMatchesSignalFilter,
  rowHasDirection,
  buildSymbolGroups,
  BuildSymbolGroupsInput,
  mapSymbolProfile,
} from './rh-agent.utils';
import { RhAgentSymbolSource } from '../services/rh-agent.types';

const mockSignal = (
  overrides: Partial<RhAgentSignalItem> = {}
): RhAgentSignalItem => ({
  id: '2026-07-10',
  symbol: 'AAPL',
  barDate: '2026-07-10',
  marketDate: '2026-07-10',
  runId: 'run-1',
  timeframe: SignalTimeframe.DAILY,
  direction: SignalDirection.LONG,
  signalType: 'D_ZONE_V1_UPTICK',
  status: 'CONFIRMED',
  indicators: {},
  ...overrides,
});

const TEST_CREATED_AT = '2026-01-01T00:00:00.000Z';

const mockProfile = (
  createdAt: string,
  overrides: Partial<Omit<RhAgentSymbolProfile, 'createdAt'>> = {}
): RhAgentSymbolProfile => ({
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
      reviewStatus: RhAgentReviewDecision.PENDING,
    };
    expect(rowHasDirection(row, SignalDirection.SHORT)).toBe(true);
    expect(rowHasDirection(row, SignalDirection.LONG)).toBe(false);
  });

  it('falls back to profile directions when signals are not loaded', () => {
    const row = {
      profile: mockProfile(TEST_CREATED_AT, { lastDailySignalDirection: SignalDirection.LONG }),
      hasSignal: true,
      signals: undefined,
      reviewStatus: RhAgentReviewDecision.PENDING,
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
    activeListFilter: 'ALL',
    statuses: {},
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

    const technology = groups.find((g: RhSymbolGroup) => g.key === 'Technology');
    expect(technology?.rows.length).toBe(2);
    expect(technology?.rows[0].profile.symbol).toBe('AAPL');

    const energy = groups.find((g: RhSymbolGroup) => g.key === 'Energy');
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
    expect(groups.length).toBe(2);
  });
});

describe('mapSymbolProfile', () => {
  it('maps string fields and defaults enabled to true', () => {
    const raw: Record<string, unknown> = {
      symbol: 'AAPL',
      createdAt: '2026-07-13T20:00:00Z',
      source: RhAgentSymbolSource.PARTNER_UNIVERSE,
      name: 'Apple Inc.',
      sector: 'Technology',
      marketCap: 3000e9,
      marketCapTier: 'mega',
    };
    const profile = mapSymbolProfile(raw);
    expect(profile.symbol).toBe('AAPL');
    expect(profile.enabled).toBe(true);
    expect(profile.createdAt).toBe('2026-07-13T20:00:00Z');
    expect(profile.source).toBe(RhAgentSymbolSource.PARTNER_UNIVERSE);
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
