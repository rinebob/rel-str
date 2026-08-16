/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Integration tests covering the full selection → open → mark flow with
 * mocked AV EOD and RH MCP external calls.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runEodNightlySelection } from '../../../functions/src/options-strategy-engine/eod-orchestrator';
import { runOpenPass } from '../../../functions/src/options-strategy-engine/passes/open-pass';
import { runMarkPass } from '../../../functions/src/options-strategy-engine/passes/mark-pass';
import type { BatchQuoteProvider } from '../../../functions/src/options-strategy-engine/passes/mark-pass';
import { OptionType, OptionQuoteSource } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type {
  StrategyInstanceConfig,
  OptionQuote,
  OvernightDeltaSimulation,
} from '../../../shared/options-strategy-engine-contracts';
import type { HistoricalOptionContract } from '../../../functions/src/types/partner';
import type { Position, PositionLeg, RawQuote } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';
import { OccRhInstrumentMapService } from '../../../functions/src/options-strategy-engine/instrument-map/occ-rh-instrument-map-service';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MARKET_DATE = '2025-08-14';
const NEXT_DAY = '2025-08-15';
const INSTANCE_ID = 'SPY-WHEEL-INT';
const SYMBOL = 'SPY';
const UNDERLYING_CLOSE = 100;
const CURRENT_PRICE = 100.5; // +0.5% overnight move

function makeConfig(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
  return {
    symbol: SYMBOL,
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    dteMin: 2,
    dteMax: 5,
    targetDelta: 0.3,
    overnightGridRangePct: 0.025,
    overnightGridStepPct: 0.005,
    ...overrides,
  };
}

function makeAvContract(
  overrides: Record<string, string | undefined> = {},
): HistoricalOptionContract {
  return {
    contractID: 'SPY250817P00100000',
    symbol: SYMBOL,
    expiration: '2025-08-17',
    strike: '100',
    type: OptionType.PUT,
    last: '0.50',
    mark: '0.55',
    bid: '0.54',
    ask: '0.56',
    volume: '100',
    open_interest: '500',
    implied_volatility: '0.25',
    date: MARKET_DATE,
    delta: '-0.30',
    ...overrides,
  };
}

// ── Integration: selection → open → mark ────────────────────────────────────

describe('hybrid quote provider integration — selection → open → mark', () => {
  it('runs the full selection → open → mark flow end-to-end', async () => {
    // ── Step 1: Selection pass (mocked AV EOD) ──────────────────────────────
    const avContracts: HistoricalOptionContract[] = [
      makeAvContract({ contractID: 'SPY250817P00105000', strike: '105', delta: '-0.15' }),
      makeAvContract({ contractID: 'SPY250817P00100000', strike: '100', delta: '-0.30' }),
      makeAvContract({ contractID: 'SPY250817P00095000', strike: '95', delta: '-0.50' }),
    ];

    const mapEntries = new Map<string, unknown>();
    const mapService = new OccRhInstrumentMapService(
      { resolve: async () => ({ instrumentId: 'rh-inst-100', chainId: 'rh-chain-1' }) },
      async (entry) => { mapEntries.set(entry.occId, entry); },
      async () => null,
    );

    const writtenSimulations: { instanceId: string; date: string; simulation: OvernightDeltaSimulation }[] = [];
    const writeSimulation = async (instanceId: string, date: string, simulation: OvernightDeltaSimulation) => {
      writtenSimulations.push({ instanceId, date, simulation });
    };

    const provider = { getEodChain: async () => avContracts };

    const selectionResult = await runEodNightlySelection(
      MARKET_DATE,
      makeConfig(),
      UNDERLYING_CLOSE,
      INSTANCE_ID,
      { provider, mapService, writeSimulation },
    );

    // Selection should pick the contract with delta closest to 0.3
    assert.ok(selectionResult, 'Selection pass should return a result');
    assert.equal(selectionResult!.quote.contractID, 'SPY250817P00100000');
    assert.equal(selectionResult!.quote.delta, -0.3);
    assert.equal(selectionResult!.mapEntry.instrumentId, 'rh-inst-100');
    assert.equal(selectionResult!.simulation.baseUnderlyingPrice, UNDERLYING_CLOSE);
    assert.equal(selectionResult!.simulation.grid.length, 11);
    assert.equal(writtenSimulations.length, 1);
    assert.equal(writtenSimulations[0].instanceId, INSTANCE_ID);
    assert.equal(writtenSimulations[0].date, MARKET_DATE);

    // Verify instrument map persistence side effect
    assert.equal(mapEntries.size, 1);
    assert.ok(mapEntries.has('SPY250817P00100000'));

    // ── Step 2: Open pass (uses simulation from step 1) ─────────────────────
    const simulation = selectionResult!.simulation;
    const openResults: { instanceId: string; date: string; result: unknown }[] = [];
    const createdPositions: Position[] = [];

    const openResult = await runOpenPass(
      INSTANCE_ID,
      NEXT_DAY,
      makeConfig(),
      CURRENT_PRICE,
      {
        readDailyAnalysis: async () => simulation,
        listOpenPositions: async () => [],
        createPosition: async (position, legs, rawQuote) => {
          const created: Position = {
            ...position,
            id: `${INSTANCE_ID}-${NEXT_DAY}`,
          };
          createdPositions.push(created);
          return created;
        },
        writeOpenPassResult: async (instanceId, date, result) => {
          openResults.push({ instanceId, date, result });
        },
      },
    );

    assert.ok(openResult, 'Open pass should return a result');
    assert.equal(openResult!.skipped, false);
    assert.equal(openResult!.positionId, `${INSTANCE_ID}-${NEXT_DAY}`);
    assert.equal(openResult!.contractID, 'SPY250817P00100000');
    assert.equal(openResult!.baseUnderlyingPrice, UNDERLYING_CLOSE);
    assert.equal(openResult!.currentUnderlyingPrice, CURRENT_PRICE);
    assert.equal(createdPositions.length, 1);
    assert.equal(createdPositions[0].status, PositionStatus.OPEN);
    assert.equal(openResults.length, 1);

    // ── Step 3: Mark pass (mocked RH MCP quotes) ────────────────────────────
    const mockQuote: OptionQuote = {
      contractID: 'SPY250817P00100000',
      symbol: SYMBOL,
      expiration: '2025-08-17',
      strike: 100,
      type: OptionType.PUT,
      side: TradeSide.SHORT,
      mark: 0.45,
      bid: 0.44,
      ask: 0.46,
      source: OptionQuoteSource.RH_MCP,
      asOf: '2025-08-15T15:00:00.000Z',
    };

    const mockQuoteProvider: BatchQuoteProvider = {
      getQuotes: async (_contractIDs: string[], _side: TradeSide) => [mockQuote],
    };

    const markResults: { positionId: string; update: Partial<Position>; rawQuote: RawQuote }[] = [];
    const positionLegs: PositionLeg[] = [
      {
        id: 'PUT-100.00-2025-08-17',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        strike: 100,
        expiration: '2025-08-17',
        openDate: NEXT_DAY,
        contractID: 'SPY250817P00100000',
        premium: 0.55,
      },
    ];

    const markResult = await runMarkPass(
      INSTANCE_ID,
      makeConfig(),
      {
        listOpenPositions: async () => createdPositions,
        getLegs: async () => positionLegs,
        quoteProvider: mockQuoteProvider,
        markPosition: async (positionId, update, rawQuote) => {
          markResults.push({ positionId, update, rawQuote });
        },
      },
    );

    assert.equal(markResult.instanceId, INSTANCE_ID);
    assert.equal(markResult.positions.length, 1);
    assert.equal(markResult.errors.length, 0);
    assert.equal(markResult.positions[0].positionId, `${INSTANCE_ID}-${NEXT_DAY}`);
    assert.equal(markResult.positions[0].contractID, 'SPY250817P00100000');
    assert.equal(markResult.positions[0].mark, 0.45);
    assert.equal(markResult.positions[0].currentValue, 45);
    // SHORT P&L = premiumCollected - currentValue
    // premiumCollected comes from the BS simulation's nearest grid point mark
    const expectedPnl = createdPositions[0].premiumCollected - 45;
    assert.equal(markResult.positions[0].unrealizedPnl, expectedPnl);
    assert.equal(markResults.length, 1);
    assert.equal(markResults[0].update.unrealizedPnl, expectedPnl);
  });

  it('skips open pass when an existing position is found', async () => {
    const simulation: OvernightDeltaSimulation = {
      baseUnderlyingPrice: 100,
      baseContractID: 'SPY250817P00100000',
      rangePct: 0.025,
      stepPct: 0.005,
      grid: [
        { underlyingMovePct: 0, underlyingPrice: 100, delta: -0.25, mark: 0.70, theta: -0.03 },
      ],
      computedAt: '2025-08-14T22:00:00Z',
    };

    const existingPosition: Position = {
      id: 'SPY-WHEEL-INT-2025-08-14',
      instanceId: INSTANCE_ID,
      symbol: SYMBOL,
      status: PositionStatus.OPEN,
      premiumCollected: 70,
      capitalRequired: 10000,
      openDate: '2025-08-14',
      currentValue: 65,
      currentValueAsOf: '2025-08-14T22:00:00Z',
      unrealizedPnl: 5,
    };

    const result = await runOpenPass(
      INSTANCE_ID,
      NEXT_DAY,
      makeConfig(),
      CURRENT_PRICE,
      {
        readDailyAnalysis: async () => simulation,
        listOpenPositions: async () => [existingPosition],
        createPosition: async () => { throw new Error('Should not create position'); },
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result!.skipped, true);
    assert.equal(result!.skipReason, 'existing_position');
    assert.equal(result!.positionId, null);
  });

  it('records data-quality error when quote provider throws for missing close.price', async () => {
    const position: Position = {
      id: 'SPY-WHEEL-INT-ERR',
      instanceId: INSTANCE_ID,
      symbol: SYMBOL,
      status: PositionStatus.OPEN,
      premiumCollected: 55,
      capitalRequired: 10000,
      openDate: NEXT_DAY,
      currentValue: 55,
      currentValueAsOf: '2025-08-15T14:00:00Z',
      unrealizedPnl: 0,
    };

    const legs: PositionLeg[] = [
      {
        id: 'PUT-100.00-2025-08-17',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        strike: 100,
        expiration: '2025-08-17',
        openDate: NEXT_DAY,
        contractID: 'SPY250817P00100000',
        premium: 0.55,
      },
    ];

    const failingProvider: BatchQuoteProvider = {
      getQuotes: async () => {
        throw new Error('missing close.price for instrument rh-inst-100');
      },
    };

    const result = await runMarkPass(
      INSTANCE_ID,
      makeConfig(),
      {
        listOpenPositions: async () => [position],
        getLegs: async () => legs,
        quoteProvider: failingProvider,
        markPosition: async () => { throw new Error('Should not mark'); },
      },
    );

    assert.equal(result.positions.length, 0);
    assert.equal(result.errors.length, 1);
    assert.equal(result.errors[0].positionId, 'SPY-WHEEL-INT-ERR');
    assert.equal(result.errors[0].contractID, 'SPY250817P00100000');
    assert.match(result.errors[0].error, /missing close\.price/);
  });

  it('passes all contract IDs to quote provider in a single batch call', async () => {
    const positions: Position[] = [];
    const legsMap = new Map<string, PositionLeg[]>();
    for (let i = 0; i < 5; i++) {
      const strike = 95 + i;
      const strikeStr = strike.toString().padStart(3, '0');
      const occId = `SPY250817P00${strikeStr}000`;
      const posId = `SPY-WHEEL-INT-pos-${i}`;
      positions.push({
        id: posId,
        instanceId: INSTANCE_ID,
        symbol: SYMBOL,
        status: PositionStatus.OPEN,
        premiumCollected: 50,
        capitalRequired: 10000,
        openDate: NEXT_DAY,
        currentValue: 50,
        currentValueAsOf: '2025-08-15T14:00:00Z',
        unrealizedPnl: 0,
      });
      legsMap.set(posId, [
        {
          id: `PUT-${strike}.00-2025-08-17`,
          type: OptionType.PUT,
          side: TradeSide.SHORT,
          strike,
          expiration: '2025-08-17',
          openDate: NEXT_DAY,
          contractID: occId,
          premium: 0.50,
        },
      ]);
    }

    let batchCallCount = 0;
    let lastBatchSize = 0;
    const batchProvider: BatchQuoteProvider = {
      getQuotes: async (contractIDs: string[], _side: TradeSide) => {
        batchCallCount++;
        lastBatchSize = contractIDs.length;
        return contractIDs.map((contractID) => ({
          contractID,
          symbol: SYMBOL,
          expiration: '2025-08-17',
          strike: 100,
          type: OptionType.PUT,
          side: TradeSide.SHORT,
          mark: 0.45,
          source: OptionQuoteSource.RH_MCP,
          asOf: '2025-08-15T15:00:00.000Z',
        }));
      },
    };

    const result = await runMarkPass(
      INSTANCE_ID,
      makeConfig(),
      {
        listOpenPositions: async () => positions,
        getLegs: async (posId) => legsMap.get(posId) ?? [],
        quoteProvider: batchProvider,
        markPosition: async () => {},
      },
    );

    // All 5 contract IDs should be sent in a single getQuotes call
    assert.equal(batchCallCount, 1);
    assert.equal(lastBatchSize, 5);
    assert.equal(result.positions.length, 5);
    assert.equal(result.errors.length, 0);
  });

  it('stores interpolated close flag and computes P&L from mark, not close', async () => {
    const position: Position = {
      id: 'SPY-WHEEL-INT-INTERP',
      instanceId: INSTANCE_ID,
      symbol: SYMBOL,
      status: PositionStatus.OPEN,
      premiumCollected: 55,
      capitalRequired: 10000,
      openDate: NEXT_DAY,
      currentValue: 55,
      currentValueAsOf: '2025-08-15T14:00:00Z',
      unrealizedPnl: 0,
    };

    const legs: PositionLeg[] = [
      {
        id: 'PUT-100.00-2025-08-17',
        type: OptionType.PUT,
        side: TradeSide.SHORT,
        strike: 100,
        expiration: '2025-08-17',
        openDate: NEXT_DAY,
        contractID: 'SPY250817P00100000',
        premium: 0.55,
      },
    ];

    const interpolatedQuote: OptionQuote = {
      contractID: 'SPY250817P00100000',
      symbol: SYMBOL,
      expiration: '2025-08-17',
      strike: 100,
      type: OptionType.PUT,
      side: TradeSide.SHORT,
      mark: 0.42,
      source: OptionQuoteSource.RH_MCP,
      asOf: '2025-08-15T15:00:00.000Z',
      interpolatedClose: true,
    };

    const provider: BatchQuoteProvider = {
      getQuotes: async () => [interpolatedQuote],
    };

    const result = await runMarkPass(
      INSTANCE_ID,
      makeConfig(),
      {
        listOpenPositions: async () => [position],
        getLegs: async () => legs,
        quoteProvider: provider,
        markPosition: async () => {},
      },
    );

    assert.equal(result.positions.length, 1);
    assert.equal(result.positions[0].interpolatedClose, true);
    // P&L = premiumCollected - (mark * 100) = 55 - 42 = 13
    assert.equal(result.positions[0].unrealizedPnl, 13);
    assert.equal(result.positions[0].mark, 0.42);
  });

  it('handles null selection result gracefully in the full flow', async () => {
    // AV EOD returns no contracts — selection will return null
    const mapService = new OccRhInstrumentMapService(
      { resolve: async () => ({ instrumentId: 'rh-inst', chainId: 'rh-chain' }) },
      async () => {},
      async () => null,
    );

    const provider = { getEodChain: async () => [] as HistoricalOptionContract[] };

    const selectionResult = await runEodNightlySelection(
      MARKET_DATE,
      makeConfig(),
      UNDERLYING_CLOSE,
      INSTANCE_ID,
      { provider, mapService, writeSimulation: async () => {} },
    );

    // Selection returns null — no contract matched
    assert.equal(selectionResult, null);

    // Open pass should also return null when no simulation exists
    const openResult = await runOpenPass(
      INSTANCE_ID,
      NEXT_DAY,
      makeConfig(),
      CURRENT_PRICE,
      {
        readDailyAnalysis: async () => null,
        listOpenPositions: async () => [],
        createPosition: async () => { throw new Error('Should not create position'); },
        writeOpenPassResult: async () => {},
      },
    );

    assert.equal(openResult, null);
  });

  it('skips open pass when maxOvernightMovePct is exceeded', async () => {
    const simulation: OvernightDeltaSimulation = {
      baseUnderlyingPrice: 100,
      baseContractID: 'SPY250817P00100000',
      rangePct: 0.025,
      stepPct: 0.005,
      grid: [
        { underlyingMovePct: 0, underlyingPrice: 100, delta: -0.25, mark: 0.70, theta: -0.03 },
      ],
      computedAt: '2025-08-14T22:00:00Z',
    };

    // 5% overnight move, but max is 1%
    const result = await runOpenPass(
      INSTANCE_ID,
      NEXT_DAY,
      makeConfig({ maxOvernightMovePct: 0.01 }),
      105, // +5% move
      {
        readDailyAnalysis: async () => simulation,
        listOpenPositions: async () => [],
        createPosition: async () => { throw new Error('Should not create position'); },
        writeOpenPassResult: async () => {},
      },
    );

    assert.ok(result);
    assert.equal(result!.skipped, true);
    assert.equal(result!.skipReason, 'max_overnight_move_exceeded');
    assert.equal(result!.positionId, null);
  });
});
