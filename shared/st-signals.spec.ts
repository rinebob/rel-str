/**
 * @topic #984 — ST Firestore Reorg (task #998)
 *
 * Pins the canonical StSignal shape (st-signals/{SYM}_{barDate}_{signalType})
 * both BE and FE consume via `@st/signals`.
 */
import {
  ST_SIGNAL_STATUSES,
  ST_SIGNAL_TIMEFRAMES,
  normalizeStSignalDirection,
  StSignal,
} from './st-signals';
import { TradeSide } from './common';

const SIGNAL: StSignal = {
  symbol: 'ADPT',
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  barDate: '2026-10-14',
  marketDate: '2026-10-14',
  direction: TradeSide.LONG,
  timeframe: 'D',
  indicators: { close: 17.42, sma50: 16.9 },
  status: 'INTERIM',
  sourceRunId: 'run-abc',
  runIds: ['run-abc'],
  ticketIds: [],
  positionGroupIds: [],
  createdAt: '2026-10-14T21:00:00Z',
  updatedAt: '2026-10-14T21:00:00Z',
};

describe('StSignal', () => {
  it('carries the canonical identity + lineage fields', () => {
    for (const key of [
      'symbol', 'signalType', 'barDate', 'marketDate', 'direction', 'timeframe',
      'indicators', 'status', 'sourceRunId', 'runIds', 'ticketIds',
      'positionGroupIds', 'createdAt', 'updatedAt',
    ]) {
      expect(SIGNAL).toHaveProperty(key);
    }
  });

  it('pins the status + timeframe value sets', () => {
    expect(ST_SIGNAL_STATUSES).toEqual(['INTERIM', 'CONFIRMED']);
    expect(ST_SIGNAL_TIMEFRAMES).toEqual(['D', 'W', 'M']);
  });

  it('serializes to JSON and round-trips intact', () => {
    expect(JSON.parse(JSON.stringify(SIGNAL))).toEqual(SIGNAL);
  });

  it('direction reuses the shared TradeSide values', () => {
    const short: StSignal = { ...SIGNAL, direction: TradeSide.SHORT };
    expect(short.direction).toBe('short');
  });
});

describe('normalizeStSignalDirection', () => {
  it('maps legacy uppercase entries to TradeSide', () => {
    expect(normalizeStSignalDirection('LONG')).toBe(TradeSide.LONG);
    expect(normalizeStSignalDirection('SHORT')).toBe(TradeSide.SHORT);
    expect(normalizeStSignalDirection('long')).toBe(TradeSide.LONG);
  });

  it('rejects unknown directions', () => {
    expect(normalizeStSignalDirection('sideways')).toBeNull();
    expect(normalizeStSignalDirection(null)).toBeNull();
    expect(normalizeStSignalDirection(undefined)).toBeNull();
  });
});
