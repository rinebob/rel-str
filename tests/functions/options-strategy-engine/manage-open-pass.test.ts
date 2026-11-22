import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runManageOpenPass } from '../../../functions/src/options-strategy-engine/passes/manage-open-pass';
import type { ManageOpenPassResult } from '../../../functions/src/options-strategy-engine/passes/manage-open-pass';
import { normalizeManageInstance } from '../../../functions/src/options-strategy-engine/manage-instance-reader';
import type { RunnableManageInstance } from '../../../functions/src/options-strategy-engine/manage-instance-reader';
import { OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type { Position, PositionLeg, RawQuote } from '../../../functions/src/options-strategy-engine/types';
import { PositionStatus } from '../../../functions/src/options-strategy-engine/types';
import type { ManageVariant } from '../../../shared/manage-variant-contracts';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MARKET_DATE = '2026-02-02'; // Monday
const EXPIRY_NEAR = '2026-02-27'; // ~25 DTE
const EXPIRY_TARGET = '2026-03-06'; // ~32 DTE
const EXPIRY_FAR = '2026-04-17';

function cdsVariant(): ManageVariant {
  return {
    id: 'cds-30-50-40',
    name: 'call debit spread 30 50-40',
    templateId: 'cds',
    dte: 30,
    legs: [
      { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.LONG },
      { kind: 'option', type: OptionType.CALL, targetDelta: 0.4, dte: 30, side: TradeSide.SHORT },
    ],
  };
}

function makeInstance(
  overrides: Partial<RunnableManageInstance> = {},
): RunnableManageInstance {
  return {
    id: 'QQQ-CDS-30-50-40-ALL',
    variantRef: 'cds-30-50-40',
    variant: cdsVariant(),
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'ACTIVE',
    userId: 'test-user',
    paperAccountId: 'acct-1',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

/**
 * RH MCP fixture: one expiry (EXPIRY_TARGET, 32d — inside the ±15d window
 * of a 30-DTE leg) with two call strikes whose deltas match the CDS legs.
 */
function mcpCallTool() {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const handler = async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args });
    if (name.endsWith('get_option_chains')) {
      return { chains: [{ symbol: 'QQQ', expiration_dates: [EXPIRY_TARGET] }] };
    }
    if (name.endsWith('get_option_instruments')) {
      return {
        data: {
          instruments: [
            { id: 'inst-450', expiration_date: EXPIRY_TARGET, strike_price: '450', type: 'call' },
            { id: 'inst-455', expiration_date: EXPIRY_TARGET, strike_price: '455', type: 'call' },
          ],
        },
      };
    }
    if (name.endsWith('get_option_quotes')) {
      return {
        results: [
          { instrument_id: 'inst-450', quote: { mark_price: '5.00', delta: '0.50' } },
          { instrument_id: 'inst-455', quote: { mark_price: '3.00', delta: '0.40' } },
        ],
      };
    }
    throw new Error(`unexpected call ${name}`);
  };
  return { calls, handler };
}

function capturedWrites() {
  const results: ManageOpenPassResult[] = [];
  return {
    results,
    writeResult: async (_id: string, r: ManageOpenPassResult) => {
      results.push(r);
    },
  };
}

function fakeCreate() {
  const created: { position: Omit<Position, 'id'>; legs: PositionLeg[]; id?: string }[] = [];
  const create = async (
    position: Omit<Position, 'id'>,
    legs: PositionLeg[],
    _rawQuote: RawQuote,
    _instance: unknown,
    positionId?: string,
  ): Promise<Position> => {
    created.push({ position, legs, id: positionId });
    return { ...position, id: positionId ?? 'pos-x' };
  };
  return { created, create };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('runManageOpenPass — daily trigger', () => {
  it('opens a two-leg position via chain selection (Δ/DTE per leg)', async () => {
    const { calls, handler } = mcpCallTool();
    const { created, create } = fakeCreate();
    const { results, writeResult } = capturedWrites();

    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: handler,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: create as never,
      writeResult,
      now: () => new Date('2026-02-02T20:00:00Z'),
    });

    assert.equal(result.skipped, false);
    assert.equal(result.positionId, 'QQQ-CDS-30-50-40-ALL-2026-02-02');
    assert.deepEqual(result.legsResolved, [
      'QQQ260306C00450000',
      'QQQ260306C00455000',
    ]);
    assert.equal(calls.filter((c) => c.name.endsWith('get_option_chains')).length, 1);
    assert.equal(created.length, 1);
    assert.equal(created[0].legs.length, 2);
    assert.equal(created[0].legs[0].side, TradeSide.LONG);
    assert.equal(created[0].legs[0].strike, 450);
    assert.equal(created[0].legs[0].contractID, 'QQQ260306C00450000');
    assert.equal(created[0].legs[1].side, TradeSide.SHORT);
    assert.equal(created[0].legs[1].strike, 455);
    // debit spread: premium 5.00 long - 3.00 short = 2.00 net debit
    assert.equal(created[0].position.premiumCollected, 0);
    assert.equal(created[0].position.capitalRequired, 200);
    assert.equal(results.length, 1);
    assert.equal(results[0].skipped, false);
  });

  it('dedupes a second open on the same day (cadence gate)', async () => {
    const { handler } = mcpCallTool();
    const open: Position[] = [
      {
        id: 'QQQ-CDS-30-50-40-ALL-2026-02-02',
        instanceId: 'QQQ-CDS-30-50-40-ALL',
        symbol: 'QQQ',
        status: PositionStatus.OPEN,
        premiumCollected: 0,
        capitalRequired: 200,
        openDate: MARKET_DATE,
        currentValue: 200,
        currentValueAsOf: '2026-02-02T20:00:00Z',
        unrealizedPnl: 0,
      },
    ];
    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: handler,
      listInstancePositions: async () => open,
      getPosition: async () => null,
      writeResult: async () => {},
    });
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'already_opened_today');
  });

  it('dedupes via the deterministic-id pre-check when the list read went stale', async () => {
    const { handler } = mcpCallTool();
    const existing: Position = {
      id: 'QQQ-CDS-30-50-40-ALL-2026-02-02',
      instanceId: 'QQQ-CDS-30-50-40-ALL',
      symbol: 'QQQ',
      status: PositionStatus.OPEN,
      premiumCollected: 0,
      capitalRequired: 200,
      openDate: MARKET_DATE,
      currentValue: 200,
      currentValueAsOf: 'x',
      unrealizedPnl: 0,
    };
    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: handler,
      listInstancePositions: async () => [],
      getPosition: async () => existing,
      writeResult: async () => {},
    });
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'already_opened_today');
  });

  it('ladders next-day opens but honors maxOpenPositions', async () => {
    const { handler } = mcpCallTool();
    const { created, create } = fakeCreate();
    const pos = (openDate: string): Position => ({
      id: `pos-${openDate}`,
      instanceId: 'QQQ-CDS-30-50-40-ALL',
      symbol: 'QQQ',
      status: PositionStatus.OPEN,
      premiumCollected: 0,
      capitalRequired: 200,
      openDate,
      currentValue: 200,
      currentValueAsOf: 'x',
      unrealizedPnl: 0,
    });

    // prior-day open does not block today's ladder step
    const r1 = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: handler,
      listInstancePositions: async () => [pos('2026-01-30')],
      getPosition: async () => null,
      createPosition: create as never,
      writeResult: async () => {},
    });
    assert.equal(r1.skipped, false);

    // but at cap it does
    const r2 = await runManageOpenPass(
      makeInstance({ maxOpenPositions: 2 }),
      MARKET_DATE,
      {
        callTool: handler,
        listInstancePositions: async () => [pos('2026-01-30'), pos('2026-01-29')],
        getPosition: async () => null,
        writeResult: async () => {},
      },
    );
    assert.equal(r2.skipped, true);
    assert.equal(r2.skipReason, 'max_open_positions');
    assert.equal(created.length, 1);
  });

  it('skips when the chain has no selectable contract', async () => {
    const noInstruments = async (name: string) => {
      if (name.endsWith('get_option_chains')) {
        return { chains: [{ symbol: 'QQQ', expiration_dates: [] }] };
      }
      throw new Error(`unexpected ${name}`);
    };
    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: noInstruments,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      writeResult: async () => {},
    });
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'no_contracts');
  });

  it('never resolves two legs to the same contract', async () => {
    // Both legs target 0.50Δ — without exclusion both pick inst-450.
    const inst = makeInstance({
      variant: {
        ...cdsVariant(),
        legs: [
          { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.LONG },
          { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.SHORT },
        ],
      },
    });
    const { created, create } = fakeCreate();
    const result = await runManageOpenPass(inst, MARKET_DATE, {
      callTool: mcpCallTool().handler,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: create as never,
      writeResult: async () => {},
    });
    assert.equal(result.skipped, false);
    assert.deepEqual(result.legsResolved, [
      'QQQ260306C00450000',
      'QQQ260306C00455000',
    ]);
    assert.equal(new Set(result.legsResolved).size, 2);
  });

  it('writes an errored result then rethrows on create failure', async () => {
    const writes: ManageOpenPassResult[] = [];
    await assert.rejects(
      runManageOpenPass(makeInstance(), MARKET_DATE, {
        callTool: mcpCallTool().handler,
        listInstancePositions: async () => [],
        getPosition: async () => null,
        createPosition: async () => {
          throw new Error('paper trade already exists');
        },
        writeResult: async (_id, r) => {
          writes.push(r);
        },
      }),
      /already exists/,
    );
    assert.equal(writes.length, 1);
    assert.equal(writes[0].skipReason, 'error');
    assert.match(writes[0].error ?? '', /already exists/);
  });

  it('stamps lastFiredAt through the dep after a successful open', async () => {
    const stamps: { id: string; at: string }[] = [];
    await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: mcpCallTool().handler,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: fakeCreate().create as never,
      stampLastFiredAt: async (id, at) => {
        stamps.push({ id, at });
      },
      writeResult: async () => {},
      now: () => new Date('2026-02-02T20:00:00Z'),
    });
    assert.deepEqual(stamps, [
      { id: 'QQQ-CDS-30-50-40-ALL', at: '2026-02-02T20:00:00.000Z' },
    ]);
  });

  it('survives a stamp failure — position minted, pass still returns', async () => {
    const { created, create } = fakeCreate();
    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: mcpCallTool().handler,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: create as never,
      stampLastFiredAt: async () => {
        throw new Error('firestore down');
      },
      writeResult: async () => {},
    });
    assert.equal(result.skipped, false);
    assert.equal(created.length, 1);
  });

  it('throws on stock legs — share plumbing is a later task', async () => {
    const inst = makeInstance({
      variant: {
        id: 'cc-1',
        name: 'covered call',
        templateId: 'custom',
        dte: 30,
        legs: [
          { kind: 'stock', side: TradeSide.LONG },
          { kind: 'option', type: OptionType.CALL, targetDelta: 0.3, dte: 30, side: TradeSide.SHORT },
        ],
      },
    });
    await assert.rejects(
      runManageOpenPass(inst, MARKET_DATE, {
        callTool: async () => ({}),
        listInstancePositions: async () => [],
        getPosition: async () => null,
        writeResult: async () => {},
      }),
      /stock leg/,
    );
  });
});

describe('runManageOpenPass — signal trigger', () => {
  it('stays flat when no fresh signal exists', async () => {
    const { handler } = mcpCallTool();
    const { created, create } = fakeCreate();
    const result = await runManageOpenPass(
      makeInstance({ trigger: 'signal' }),
      MARKET_DATE,
      {
        callTool: handler,
        hasFreshSignal: async () => false,
        listInstancePositions: async () => [],
        getPosition: async () => null,
        createPosition: create as never,
        writeResult: async () => {},
      },
    );
    assert.equal(result.skipped, true);
    assert.equal(result.skipReason, 'no_fresh_signal');
    assert.equal(created.length, 0);
  });

  it('opens when a fresh signal exists for the symbol', async () => {
    const { handler } = mcpCallTool();
    const { created, create } = fakeCreate();
    const result = await runManageOpenPass(
      makeInstance({ trigger: 'signal' }),
      MARKET_DATE,
      {
        callTool: handler,
        hasFreshSignal: async (symbol, date) => {
          assert.equal(symbol, 'QQQ');
          assert.equal(date, MARKET_DATE);
          return true;
        },
        listInstancePositions: async () => [],
        getPosition: async () => null,
        createPosition: create as never,
        writeResult: async () => {},
      },
    );
    assert.equal(result.skipped, false);
    assert.equal(created.length, 1);
  });
});

describe('normalizeManageInstance — reader adapter', () => {
  const validDoc = {
    variantRef: 'cds-30-50-40',
    variant: cdsVariant(),
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'ACTIVE',
    userId: 'u1',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
  };

  it('accepts a valid doc and normalizes the symbol', () => {
    const inst = normalizeManageInstance('QQQ-CDS-30-50-40-ALL', {
      ...validDoc,
      symbol: '  qqq ',
    });
    assert.ok(inst);
    assert.equal(inst.symbol, 'QQQ');
    assert.equal(inst.id, 'QQQ-CDS-30-50-40-ALL');
  });

  it('skips legacy-shaped docs (no runState/mode/trigger fields)', () => {
    const inst = normalizeManageInstance('legacy-1', {
      symbol: 'SPY',
      optionType: 'put',
      side: 'short',
      lifecycleState: 'ACTIVE',
      phases: [{}],
      userId: 'u1',
      createdAt: 'x',
      updatedAt: 'x',
    });
    assert.equal(inst, null);
  });

  it('skips deleted docs silently', () => {
    assert.equal(
      normalizeManageInstance('x', { ...validDoc, deletedAt: '2026-02-01T00:00:00Z' }),
      null,
    );
  });

  it('rejects mode/stopType invariant violations', () => {
    assert.equal(
      normalizeManageInstance('x', { ...validDoc, stopType: 'TRAIL8' }),
      null,
      'paper with non-ALL stop',
    );
    assert.equal(
      normalizeManageInstance('x', { ...validDoc, mode: 'real' }),
      null,
      'real with ALL stop',
    );
  });

  it('rejects empty legs, unknown enums, missing userId', () => {
    assert.equal(
      normalizeManageInstance('x', { ...validDoc, variant: { legs: [] } }),
      null,
    );
    assert.equal(
      normalizeManageInstance('x', { ...validDoc, runState: 'PAUSED' }),
      null,
    );
    assert.equal(
      normalizeManageInstance('x', { ...validDoc, trigger: 'hourly' }),
      null,
    );
    assert.equal(
      normalizeManageInstance('x', { ...validDoc, userId: '' }),
      null,
    );
  });

  it('rejects variant:null without crashing', () => {
    assert.equal(
      normalizeManageInstance('x', { ...validDoc, variant: null }),
      null,
    );
  });

  it('rejects malformed legs (NaN delta, bad type, unknown kind)', () => {
    const leg = cdsVariant().legs[0];
    assert.equal(
      normalizeManageInstance('x', {
        ...validDoc,
        variant: { ...cdsVariant(), legs: [{ ...leg, targetDelta: NaN }] },
      }),
      null,
    );
    assert.equal(
      normalizeManageInstance('x', {
        ...validDoc,
        variant: { ...cdsVariant(), legs: [{ ...leg, type: 'strangle' }] },
      }),
      null,
    );
    assert.equal(
      normalizeManageInstance('x', {
        ...validDoc,
        variant: { ...cdsVariant(), legs: [{ kind: 'future' }] },
      }),
      null,
    );
  });

  it('normalizes stopType before validation and output', () => {
    const inst = normalizeManageInstance('x', { ...validDoc, stopType: ' all ' });
    assert.equal(inst?.stopType, 'ALL');
  });

  it('honors a valid maxOpenPositions cap; warns + drops malformed', () => {
    const capped = normalizeManageInstance('x', { ...validDoc, maxOpenPositions: 3 });
    assert.equal(capped?.maxOpenPositions, 3);
    const uncapped = normalizeManageInstance('x', { ...validDoc, maxOpenPositions: 'three' });
    assert.equal(uncapped?.maxOpenPositions, undefined);
    assert.equal(normalizeManageInstance('x', { ...validDoc, maxOpenPositions: 0 })?.maxOpenPositions, 0);
  });
});

// ── Contract-list seam (#1543) ──────────────────────────────────────────────

describe('runManageOpenPass — contract-list seam', () => {
  it('invokes appendContractListRows with leg+contract pairs on a successful open', async () => {
    const { handler } = mcpCallTool();
    const { create } = fakeCreate();
    const { writeResult } = capturedWrites();
    const appended: { legs: { leg: unknown; contract: { contractID: string } }[]; md: string }[] = [];

    await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: handler,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: create as never,
      writeResult,
      appendContractListRows: async (_inst, legs, md) => {
        appended.push({ legs: legs as never, md });
      },
    });

    assert.equal(appended.length, 1);
    assert.equal(appended[0].md, MARKET_DATE);
    assert.equal(appended[0].legs.length, 2);
    assert.equal(appended[0].legs[0].contract.contractID, 'QQQ260306C00450000');
    assert.equal(appended[0].legs[1].contract.contractID, 'QQQ260306C00455000');
  });

  it('does not invoke appendContractListRows on a gated skip', async () => {
    const { handler } = mcpCallTool();
    const { writeResult } = capturedWrites();
    let appended = 0;
    await runManageOpenPass(
      makeInstance({ trigger: 'signal' }),
      MARKET_DATE,
      {
        callTool: handler,
        hasFreshSignal: async () => false,
        listInstancePositions: async () => [],
        getPosition: async () => null,
        writeResult,
        appendContractListRows: async () => {
          appended++;
        },
      },
    );
    assert.equal(appended, 0);
  });

  it('an append failure warns but the open still succeeds', async () => {
    const { handler } = mcpCallTool();
    const { create, created } = fakeCreate();
    const { results, writeResult } = capturedWrites();

    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: handler,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: create as never,
      writeResult,
      appendContractListRows: async () => {
        throw new Error('firestore write failed');
      },
    });

    assert.equal(result.skipped, false);
    assert.equal(result.positionId, 'QQQ-CDS-30-50-40-ALL-2026-02-02');
    assert.equal(created.length, 1);
    assert.equal(results.at(-1)?.skipReason, null);
  });
});

describe('runManageOpenPass — contract-list reconcile', () => {
  it('re-appends from persisted legs when the position exists but rows may be missing', async () => {
    const { handler } = mcpCallTool();
    const { writeResult } = capturedWrites();
    const appended: { contractID: string; mark: number }[][] = [];
    const persistedLegs = [
      { id: 'l1', type: OptionType.CALL, side: TradeSide.LONG, strike: 450, expiration: EXPIRY_TARGET, openDate: MARKET_DATE, contractID: 'QQQ260306C00450000', premium: 5.0 },
      { id: 'l2', type: OptionType.CALL, side: TradeSide.SHORT, strike: 455, expiration: EXPIRY_TARGET, openDate: MARKET_DATE, contractID: 'QQQ260306C00455000', premium: 3.0 },
    ];

    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: handler,
      listInstancePositions: async () => [],
      getPosition: async (id) =>
        ({ id, instanceId: 'QQQ-CDS-30-50-40-ALL', symbol: 'QQQ', status: PositionStatus.OPEN, premiumCollected: 0, capitalRequired: 0, openDate: MARKET_DATE, currentValue: 0, currentValueAsOf: '', unrealizedPnl: 0 }),
      createPosition: fakeCreate().create as never,
      getLegs: async () => persistedLegs as never,
      writeResult,
      appendContractListRows: async (_inst, legs, _md) => {
        appended.push(legs.map((l) => ({ contractID: l.contract.contractID, mark: l.contract.mark })));
      },
    });

    assert.equal(result.skipReason, 'already_opened_today');
    assert.equal(appended.length, 1);
    assert.deepEqual(appended[0], [
      { contractID: 'QQQ260306C00450000', mark: 5.0 },
      { contractID: 'QQQ260306C00455000', mark: 3.0 },
    ]);
  });

  it('skips reconcile when persisted leg count mismatches the variant', async () => {
    const { handler } = mcpCallTool();
    const { writeResult } = capturedWrites();
    let appended = 0;
    await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: handler,
      listInstancePositions: async () => [],
      getPosition: async (id) =>
        ({ id, instanceId: 'x', symbol: 'QQQ', status: PositionStatus.OPEN, premiumCollected: 0, capitalRequired: 0, openDate: MARKET_DATE, currentValue: 0, currentValueAsOf: '', unrealizedPnl: 0 }),
      createPosition: fakeCreate().create as never,
      getLegs: async () => [{ contractID: 'x' }] as never, // 1 leg vs variant's 2
      writeResult,
      appendContractListRows: async () => {
        appended++;
      },
    });
    assert.equal(appended, 0);
  });
});
