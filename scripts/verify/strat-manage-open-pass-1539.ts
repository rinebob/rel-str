/**
 * Verification: manage instance reader + open-pass rework (task #1539).
 *
 * Exercises the real functions-side modules through the functions
 * tsconfig aliases — `normalizeManageInstance` (validation/normalize,
 * legacy + deleted skip, invariant rejects, malformed cap handling) and
 * `runManageOpenPass` end-to-end with injected MCP + persistence fakes:
 * daily open via two-leg chain resolution (Δ/DTE per leg, deterministic
 * position id, premium math), cadence + cap dedup, signal-trigger gate,
 * no_contracts skip, stock-leg throw, and lastFiredAt stamping.
 *
 * Importing the modules runs `firebase-admin-init` (parameterless
 * `initializeApp()` — no credentials needed; no Firestore call is made).
 *
 * Usage: npx tsx scripts/verify/strat-manage-open-pass-1539.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { normalizeManageInstance } from '../../functions/src/paper-trading/engine/manage-instance-reader';
import type { RunnableManageInstance } from '../../functions/src/paper-trading/engine/manage-instance-reader';
import {
  runManageOpenPass,
  type ManageOpenPassResult,
} from '../../functions/src/paper-trading/engine/passes/manage-open-pass';
import type {
  Position,
  PositionLeg,
} from '../../functions/src/paper-trading/engine/types';
import { PositionStatus } from '../../functions/src/paper-trading/engine/types';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import type { ManageVariant } from '@manage/variant-contracts';

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${JSON.stringify(actual)}`);
  if (!ok) {
    console.log(`     expected: ${JSON.stringify(expected)}`);
    failures++;
  }
}

const MARKET_DATE = '2026-02-02'; // Monday
const EXPIRY = '2026-03-06'; // ~32 DTE — inside a 30-DTE leg's ±15d band

function cdsVariant(): ManageVariant {
  return {
    id: 'cds-30-50-40',
    name: 'call debit spread 50-40 30',
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

const mcpCallTool = async (name: string) => {
  if (name.endsWith('get_option_chains')) {
    return { chains: [{ symbol: 'QQQ', expiration_dates: [EXPIRY] }] };
  }
  if (name.endsWith('get_option_instruments')) {
    return {
      data: {
        instruments: [
          { id: 'inst-450', expiration_date: EXPIRY, strike_price: '450', type: 'call' },
          { id: 'inst-455', expiration_date: EXPIRY, strike_price: '455', type: 'call' },
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

function fakeCreate() {
  const created: { legs: PositionLeg[]; premium: number; capital: number }[] = [];
  const create = async (
    position: Omit<Position, 'id'>,
    legs: PositionLeg[],
    _raw: unknown,
    _inst: unknown,
    positionId?: string,
  ): Promise<Position> => {
    created.push({
      legs,
      premium: position.premiumCollected,
      capital: position.capitalRequired,
    });
    return { ...position, id: positionId ?? 'pos-x' };
  };
  return { created, create };
}

const openPosition = (openDate: string): Position => ({
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

// ── Reader: normalize/validate ──────────────────────────────────────
const validDoc = {
  variantRef: 'cds-30-50-40',
  variant: cdsVariant(),
  symbol: '  qqq ',
  mode: 'paper',
  trigger: 'daily',
  stopType: 'ALL',
  runState: 'ACTIVE',
  userId: 'u1',
  createdAt: '2026-01-15T00:00:00Z',
  updatedAt: '2026-01-15T00:00:00Z',
};

check(
  'reader: valid doc normalizes symbol',
  normalizeManageInstance('QQQ-CDS-30-50-40-ALL', validDoc)?.symbol,
  'QQQ',
);
check(
  'reader: legacy doc skips (no runState)',
  normalizeManageInstance('legacy-1', {
    symbol: 'SPY',
    lifecycleState: 'ACTIVE',
    phases: [{}],
    userId: 'u1',
    createdAt: 'x',
    updatedAt: 'x',
  }),
  null,
);
check(
  'reader: deleted doc skips silently',
  normalizeManageInstance('x', { ...validDoc, deletedAt: 't' }),
  null,
);
check(
  'reader: paper+non-ALL stop rejected',
  normalizeManageInstance('x', { ...validDoc, stopType: 'TRAIL8' }),
  null,
);
check(
  'reader: unknown trigger rejected',
  normalizeManageInstance('x', { ...validDoc, trigger: 'hourly' }),
  null,
);
check(
  'reader: malformed maxOpenPositions dropped, doc survives',
  normalizeManageInstance('x', { ...validDoc, maxOpenPositions: 'three' })?.maxOpenPositions,
  undefined,
);
check(
  'reader: explicit 0 cap honored',
  normalizeManageInstance('x', { ...validDoc, maxOpenPositions: 0 })?.maxOpenPositions,
  0,
);
check(
  'reader: variant:null rejected without crash',
  normalizeManageInstance('x', { ...validDoc, variant: null }),
  null,
);
check(
  'reader: NaN leg delta rejected',
  normalizeManageInstance('x', {
    ...validDoc,
    variant: { ...cdsVariant(), legs: [{ ...cdsVariant().legs[0], targetDelta: NaN }] },
  }),
  null,
);
check(
  'reader: stopType normalized before validation',
  normalizeManageInstance('x', { ...validDoc, stopType: ' all ' })?.stopType,
  'ALL',
);

async function main(): Promise<void> {
// ── Pass: daily open ────────────────────────────────────────────────
{
    const { created, create } = fakeCreate();
    const writes: ManageOpenPassResult[] = [];
    const updates: Record<string, unknown>[] = [];
    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: mcpCallTool,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: create as never,
      writeResult: async (_id, r) => {
        writes.push(r);
      },
      // capture the instance doc patch by wrapping Firestore-less writeResult
      // — lastFiredAt is asserted below via the returned result shape
      now: () => new Date('2026-02-02T20:00:00Z'),
    });
    void updates;
    check('daily: opens', result.skipped, false);
    check('daily: deterministic position id', result.positionId, 'QQQ-CDS-30-50-40-ALL-2026-02-02');
    check(
      'daily: per-leg OCC ids',
      result.legsResolved,
      ['QQQ260306C00450000', 'QQQ260306C00455000'],
    );
    check('daily: leg sides', created[0]?.legs.map((l) => l.side), [TradeSide.LONG, TradeSide.SHORT]);
    check('daily: leg strikes', created[0]?.legs.map((l) => l.strike), [450, 455]);
    check('daily: debit premium math', created[0]?.capital, 200);
    check('daily: result written back', writes.length, 1);
}

// ── Pass: dedup + cap ───────────────────────────────────────────────
{
    const result = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: mcpCallTool,
      listInstancePositions: async () => [openPosition(MARKET_DATE)],
      getPosition: async () => null,
      writeResult: async () => {},
    });
    check('dedup: same-day open skipped', [result.skipped, result.skipReason], [true, 'already_opened_today']);

    const stale = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: mcpCallTool,
      listInstancePositions: async () => [],
      getPosition: async () => openPosition(MARKET_DATE),
      writeResult: async () => {},
    });
    check('dedup: deterministic-id pre-check', [stale.skipped, stale.skipReason], [true, 'already_opened_today']);

    const capped = await runManageOpenPass(makeInstance({ maxOpenPositions: 2 }), MARKET_DATE, {
      callTool: mcpCallTool,
      listInstancePositions: async () => [openPosition('2026-01-30'), openPosition('2026-01-29')],
      getPosition: async () => null,
      writeResult: async () => {},
    });
    check('cap: maxOpenPositions blocks', [capped.skipped, capped.skipReason], [true, 'max_open_positions']);
}

// ── Pass: signal trigger ────────────────────────────────────────────
{
    const noSignal = await runManageOpenPass(makeInstance({ trigger: 'signal' }), MARKET_DATE, {
      callTool: mcpCallTool,
      hasFreshSignal: async () => false,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      writeResult: async () => {},
    });
    check('signal: flat without fresh signal', [noSignal.skipped, noSignal.skipReason], [true, 'no_fresh_signal']);

    const { created, create } = fakeCreate();
    const withSignal = await runManageOpenPass(makeInstance({ trigger: 'signal' }), MARKET_DATE, {
      callTool: mcpCallTool,
      hasFreshSignal: async () => true,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: create as never,
      writeResult: async () => {},
    });
    check('signal: opens on fresh signal', [withSignal.skipped, created.length], [false, 1]);
}

// ── Pass: failure modes ─────────────────────────────────────────────
{
    const noChain = await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: async (name: string) =>
        name.endsWith('get_option_chains')
          ? { chains: [{ symbol: 'QQQ', expiration_dates: [] }] }
          : {},
      listInstancePositions: async () => [],
      getPosition: async () => null,
      writeResult: async () => {},
    });
    check('failure: no_contracts skip', [noChain.skipped, noChain.skipReason], [true, 'no_contracts']);

    let threw = false;
    try {
      await runManageOpenPass(
        makeInstance({
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
        }),
        MARKET_DATE,
        {
          callTool: mcpCallTool,
          listInstancePositions: async () => [],
          getPosition: async () => null,
          writeResult: async () => {},
        },
      );
    } catch (err) {
      threw = /stock leg/.test(err instanceof Error ? err.message : String(err));
    }
    check('failure: stock leg throws (share plumbing deferred)', threw, true);

    // Error path — a create failure writes an errored result before rethrow.
    const errWrites: ManageOpenPassResult[] = [];
    let rethrew = false;
    try {
      await runManageOpenPass(makeInstance(), MARKET_DATE, {
        callTool: mcpCallTool,
        listInstancePositions: async () => [],
        getPosition: async () => null,
        createPosition: async () => {
          throw new Error('paper trade already exists');
        },
        writeResult: async (_id, r) => {
          errWrites.push(r);
        },
      });
    } catch {
      rethrew = true;
    }
    check('failure: error rethrows', rethrew, true);
    check(
      'failure: errored result written',
      [errWrites.length, errWrites[0]?.skipReason],
      [1, 'error'],
    );

    // Exclusion — legs targeting the same Δ must not pick one contract twice.
    const sameDelta = makeInstance({
      variant: {
        ...cdsVariant(),
        legs: [
          { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.LONG },
          { kind: 'option', type: OptionType.CALL, targetDelta: 0.5, dte: 30, side: TradeSide.SHORT },
        ],
      },
    });
    const excl = await runManageOpenPass(sameDelta, MARKET_DATE, {
      callTool: mcpCallTool,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: fakeCreate().create as never,
      writeResult: async () => {},
    });
    check(
      'exclusion: same-Δ legs pick distinct contracts',
      excl.legsResolved,
      ['QQQ260306C00450000', 'QQQ260306C00455000'],
    );

    // lastFiredAt — stamped through the dep after a successful open.
    const stamps: string[] = [];
    await runManageOpenPass(makeInstance(), MARKET_DATE, {
      callTool: mcpCallTool,
      listInstancePositions: async () => [],
      getPosition: async () => null,
      createPosition: fakeCreate().create as never,
      stampLastFiredAt: async (id, at) => {
        stamps.push(`${id}@${at}`);
      },
      writeResult: async () => {},
      now: () => new Date('2026-02-02T20:00:00Z'),
    });
    check('bookkeeping: lastFiredAt stamped via dep', stamps, [
      'QQQ-CDS-30-50-40-ALL@2026-02-02T20:00:00.000Z',
    ]);
}

    console.log(failures === 0 ? '\nAll checks passed' : `\n${failures} check(s) FAILED`);
    process.exit(failures === 0 ? 0 : 1);
}

main();
