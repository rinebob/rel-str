/**
 * Shared typed test fixtures for swing-compare specs — Pivot/Swing/
 * SwingAnalysisDoc/SwingStats factories. Feature-local: used by the
 * pct-change store spec, swing-compare utils spec, and picker spec.
 * (The swing-analysis specs have their own copies — not consolidated
 * here to avoid cross-thread churn.)
 */
import type { SwingAnalysisDoc } from '../../../swing-analysis/swing-analysis.types';
import type {
  DistributionSummary,
  Histogram,
  Pivot,
  Swing,
  SwingStats,
} from '../../../../shared/components/flex-chart/indicators/st-zigzag.types';
import { OptionType } from '@options-contract/contracts';
import type { HistoricalOptionContract } from '@options-contract/contracts';
import type { StSignalItem } from '../../../services/types';
import {
  SignalDirection,
  SignalStatus,
  SignalTimeframe,
} from '../../../common/constants';

export const fixtureMs = (dateStr: string): number =>
  new Date(dateStr + 'T00:00:00.000Z').getTime();

export function makePivotFixture(overrides: Partial<Pivot> = {}): Pivot {
  return {
    barIndex: 0,
    time: fixtureMs('2025-04-07'),
    price: 100,
    isHigh: false,
    confirmed: true,
    ...overrides,
  };
}

export function makeSwingFixture(
  start: string,
  end: string,
  direction: 'up' | 'down' = 'up',
  startPrice = 100,
  endPrice?: number,
): Swing {
  const ep = endPrice ?? (direction === 'up' ? 120 : 85);
  return {
    direction,
    start: { time: fixtureMs(start), price: startPrice, barIndex: 0 },
    end: { time: fixtureMs(end), price: ep, barIndex: 10 },
    magnitudePercent: ep > startPrice ? 20 : -15,
    magnitudeAbsolute: Math.abs(ep - startPrice),
    duration: 10,
    volume: 0,
    confirmed: true,
  };
}

function emptyDistribution(): DistributionSummary {
  return {
    mean: 0, median: 0, stdDev: 0, min: 0, max: 0,
    p10: 0, p25: 0, p50: 0, p75: 0, p90: 0,
  };
}

export function makeSwingStatsFixture(): SwingStats {
  const dir = () => ({
    count: 0,
    magnitudePercent: emptyDistribution(),
    magnitudeAbsolute: emptyDistribution(),
    duration: emptyDistribution(),
    magnitudeHistogram: { bins: [] },
    durationHistogram: { bins: [] },
  });
  return { up: dir(), down: dir() };
}

export function makeSwingAnalysisDocFixture(
  overrides: Partial<SwingAnalysisDoc> = {},
): SwingAnalysisDoc {
  return {
    id: 'QQQ_dev5_L5_R5_1barY_projY',
    userId: 'user-1',
    symbol: 'QQQ',
    paramsId: 'dev5_L5_R5_1barY_projY',
    config: {
      devThreshold: 5,
      leftDepth: 5,
      rightDepth: 5,
      allowZigZagOnOneBar: true,
      projectionPivots: true,
      lineColor: '#000',
    },
    pivots: [],
    projection: null,
    swings: [],
    stats: makeSwingStatsFixture(),
    savedAt: '2026-09-18T00:00:00Z',
    ...overrides,
  };
}

export function makeSignalFixture(
  overrides: Partial<StSignalItem> = {},
): StSignalItem {
  return {
    id: '2025-04-08',
    symbol: 'QQQ',
    barDate: '2025-04-08',
    marketDate: '2025-04-08',
    runId: 'run-1',
    timeframe: SignalTimeframe.DAILY,
    direction: SignalDirection.LONG,
    signalType: 'D_ZONE_V1_UPTICK',
    status: SignalStatus.INTERIM,
    indicators: {},
    closePrice: 100,
    ...overrides,
  };
}

/** Minimal historical option contract for snapshot caches. */
export function makeContractFixture(
  overrides: Partial<HistoricalOptionContract> = {},
): HistoricalOptionContract {
  return {
    contractID: 'TEST',
    symbol: 'QQQ',
    expiration: '2024-03-15',
    strike: '100',
    type: OptionType.CALL,
    mark: '5.00',
    delta: '0.5',
    ...overrides,
  };
}
