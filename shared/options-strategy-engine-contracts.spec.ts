/**
 * @topic #137 — Strategy Builder UI
 *
 * Unit tests for the unified options-strategy-engine shared contracts:
 * OptionQuote, OccRhInstrumentMapEntry, OvernightDeltaSimulation,
 * StrategyInstanceConfig, and OCC contract ID round-trip helpers.
 */

import { OptionType, OptionQuoteSource, PositionSpreadType, StrategyFrequency, parseOccContractId, buildOccContractId } from './options-common';
import { TradeSide } from './common';
import {
  OptionQuote,
  OccRhInstrumentMapEntry,
  OvernightDeltaGridPoint,
  OvernightDeltaSimulation,
  StrategyInstanceConfig,
  LifecycleState,
} from './options-strategy-engine-contracts';

describe('options-strategy-engine-contracts', () => {
  describe('OptionQuote', () => {
    it('accepts a minimal AV_EOD quote', () => {
      const quote: OptionQuote = {
        contractID: 'SPY250817P00770000',
        symbol: 'SPY',
        expiration: '2025-08-17',
        strike: 770,
        type: OptionType.PUT,
        side: TradeSide.LONG,
        mark: 1.23,
        source: OptionQuoteSource.AV_EOD,
        asOf: '2025-08-16T20:00:00Z',
      };
      expect(quote.source).toBe(OptionQuoteSource.AV_EOD);
    });

    it('accepts a full RH_MCP quote with optional Greeks and rho', () => {
      const quote: OptionQuote = {
        contractID: 'SPY250817C00450000',
        symbol: 'SPY',
        expiration: '2025-08-17',
        strike: 450,
        type: OptionType.CALL,
        side: TradeSide.SHORT,
        mark: 0.02,
        bid: 0.01,
        ask: 0.03,
        last: 0.02,
        volume: 100,
        openInterest: 1000,
        impliedVolatility: 0.25,
        delta: 0.55,
        gamma: 0.01,
        theta: -0.02,
        vega: 0.12,
        rho: 0.001,
        source: OptionQuoteSource.RH_MCP,
        asOf: '2025-08-17T20:00:00Z',
      };
      expect(quote.rho).toBe(0.001);
    });

    it('accepts a minimal AV_REALTIME quote', () => {
      const quote: OptionQuote = {
        contractID: 'QQQ250919C00450000',
        symbol: 'QQQ',
        expiration: '2025-09-19',
        strike: 450,
        type: OptionType.CALL,
        side: TradeSide.LONG,
        mark: 2.50,
        source: OptionQuoteSource.AV_REALTIME,
        asOf: '2025-09-15T15:30:00Z',
      };
      expect(quote.source).toBe(OptionQuoteSource.AV_REALTIME);
    });
  });

  describe('OccRhInstrumentMapEntry', () => {
    it('accepts a complete entry with firstTradedDate', () => {
      const entry: OccRhInstrumentMapEntry = {
        occId: 'SPY250817P00770000',
        instrumentId: 'abc-123',
        chainId: 'chain-123',
        chainSymbol: 'SPY',
        expiration: '2025-08-17',
        strike: 770,
        type: OptionType.PUT,
        firstTradedDate: '2025-01-15',
        createdAt: '2025-08-16T20:00:00Z',
        expiresAt: '2025-11-17T20:00:00Z',
      };
      expect(entry.instrumentId).toBe('abc-123');
    });

    it('accepts an entry without firstTradedDate', () => {
      const entry: OccRhInstrumentMapEntry = {
        occId: 'SPY250817P00770000',
        instrumentId: 'abc-123',
        chainId: 'chain-123',
        chainSymbol: 'SPY',
        expiration: '2025-08-17',
        strike: 770,
        type: OptionType.PUT,
        createdAt: '2025-08-16T20:00:00Z',
        expiresAt: '2025-11-17T20:00:00Z',
      };
      expect(entry.firstTradedDate).toBeUndefined();
      expect(entry.expiresAt).toBe('2025-11-17T20:00:00Z');
    });
  });

  describe('OvernightDeltaSimulation', () => {
    it('produces a symmetric grid for default range and step', () => {
      const rangePct = 0.025;
      const stepPct = 0.005;
      const stepCount = Math.round(rangePct / stepPct);
      const grid: OvernightDeltaGridPoint[] = [];
      for (let i = -stepCount; i <= stepCount; i++) {
        const p = Number((i * stepPct).toFixed(4));
        grid.push({
          underlyingMovePct: p,
          underlyingPrice: 100 * (1 + p),
          delta: 0,
          mark: 0,
          theta: 0,
        });
      }
      const simulation: OvernightDeltaSimulation = {
        baseUnderlyingPrice: 100,
        baseContractID: 'SPY250817P00770000',
        rangePct,
        stepPct,
        grid,
        computedAt: '2025-08-16T20:00:00Z',
      };
      expect(simulation.grid.length).toBe(11);
      expect(simulation.grid[0].underlyingMovePct).toBeCloseTo(-0.025, 4);
      expect(simulation.grid[simulation.grid.length - 1].underlyingMovePct).toBeCloseTo(0.025, 4);
    });

    it('stores baseUnderlyingPrice, baseContractID, and computedAt', () => {
      const simulation: OvernightDeltaSimulation = {
        baseUnderlyingPrice: 425.50,
        baseContractID: 'QQQM250919P00400000',
        rangePct: 0.025,
        stepPct: 0.005,
        grid: [],
        computedAt: '2025-08-16T22:00:00Z',
      };
      expect(simulation.baseUnderlyingPrice).toBe(425.50);
      expect(simulation.baseContractID).toBe('QQQM250919P00400000');
      expect(simulation.computedAt).toBe('2025-08-16T22:00:00Z');
    });

    it('verifies grid point field shapes', () => {
      const point: OvernightDeltaGridPoint = {
        underlyingMovePct: -0.01,
        underlyingPrice: 99.0,
        delta: -0.22,
        mark: 1.50,
        theta: -0.05,
      };
      expect(point.underlyingMovePct).toBe(-0.01);
      expect(point.underlyingPrice).toBe(99.0);
      expect(point.delta).toBe(-0.22);
      expect(point.mark).toBe(1.50);
      expect(point.theta).toBe(-0.05);
    });
  });

  describe('StrategyInstanceConfig', () => {
    it('accepts a config with maxOvernightMovePct disabled', () => {
      const config: StrategyInstanceConfig = {
        id: 'TEST-CSP',
        symbol: 'SPY',
        optionType: OptionType.PUT,
        side: TradeSide.SHORT,
        targetDelta: 0.2,
        dteMin: 21,
        dteMax: 30,
        phases: [{ spreadType: PositionSpreadType.CASH_SECURED_PUT, targetDelta: 0.2, dteMin: 21, dteMax: 30 }],
        frequency: StrategyFrequency.DAILY,
        openTimePT: '12:00',
        exitPolicies: [],
        lifecycleState: LifecycleState.ACTIVE,
        userId: 'test-user',
        maxOvernightMovePct: null,
        createdAt: '2025-08-16T00:00:00Z',
        updatedAt: '2025-08-16T00:00:00Z',
      };
      expect(config.maxOvernightMovePct).toBeNull();
    });
  });

  describe('OCC contract ID round-trip', () => {
    it('round-trips a put', () => {
      const original = 'SPY250817P00770000';
      const parsed = parseOccContractId(original)!;
      expect(parsed.optionType).toBe(OptionType.PUT);
      expect(parsed.strike).toBe(770);
      expect(buildOccContractId(parsed.symbol, parsed.expiration, parsed.optionType, parsed.strike)).toBe(original);
    });

    it('round-trips a call', () => {
      const original = 'QQQ240719C00450000';
      const parsed = parseOccContractId(original)!;
      expect(parsed.optionType).toBe(OptionType.CALL);
      expect(parsed.strike).toBe(450);
      expect(buildOccContractId(parsed.symbol, parsed.expiration, parsed.optionType, parsed.strike)).toBe(original);
    });

    it('round-trips a decimal strike', () => {
      const original = 'AAPL250117P00187500';
      const parsed = parseOccContractId(original)!;
      expect(parsed.optionType).toBe(OptionType.PUT);
      expect(parsed.strike).toBe(187.5);
      expect(buildOccContractId(parsed.symbol, parsed.expiration, parsed.optionType, parsed.strike)).toBe(original);
    });

    it('rejects a malformed OCC ID', () => {
      expect(parseOccContractId('not-an-occ-id')).toBeNull();
    });

    it('round-trips a far-future expiration', () => {
      const original = 'SPY301215C00055000';
      const parsed = parseOccContractId(original)!;
      expect(parsed.expiration).toBe('2030-12-15');
      expect(parsed.strike).toBe(55);
      expect(buildOccContractId(parsed.symbol, parsed.expiration, parsed.optionType, parsed.strike)).toBe(original);
    });

    it('round-trips a leap-day expiration', () => {
      const original = 'QQQ240229P00123450';
      const parsed = parseOccContractId(original)!;
      expect(parsed.expiration).toBe('2024-02-29');
      expect(parsed.strike).toBe(123.45);
      expect(buildOccContractId(parsed.symbol, parsed.expiration, parsed.optionType, parsed.strike)).toBe(original);
    });

    it('round-trips a zero strike', () => {
      const original = 'SPY250817C00000000';
      const parsed = parseOccContractId(original)!;
      expect(parsed.strike).toBe(0);
      expect(buildOccContractId(parsed.symbol, parsed.expiration, parsed.optionType, 0)).toBe(original);
    });
  });

  describe('buildOccContractId validation', () => {
    it('throws on empty symbol', () => {
      expect(() => buildOccContractId('', '2025-08-17', OptionType.CALL, 100)).toThrow('symbol must be non-empty');
    });

    it('throws on invalid expiration format', () => {
      expect(() => buildOccContractId('SPY', '08-17-2025', OptionType.CALL, 100)).toThrow('expiration must be YYYY-MM-DD');
    });

    it('throws on negative strike', () => {
      expect(() => buildOccContractId('SPY', '2025-08-17', OptionType.CALL, -1)).toThrow('strike must be non-negative');
    });

    it('throws on an empty symbol with only whitespace', () => {
      expect(() => buildOccContractId('   ', '2025-08-17', OptionType.CALL, 100)).toThrow('symbol must be non-empty');
    });

    it('builds an OCC ID for a long symbol', () => {
      const id = buildOccContractId('SPXW', '2025-12-19', OptionType.PUT, 3875.5);
      expect(id).toBe('SPXW251219P03875500');
      expect(parseOccContractId(id)?.strike).toBe(3875.5);
    });
  });
});
