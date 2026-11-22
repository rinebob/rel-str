/**
 * Specs for `appendManageContractListRows` (#1543) + the open pass's
 * `appendContractListRows` seam. Offline — Firestore + RH MCP behind deps.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { appendManageContractListRows } from '../../../functions/src/options-strategy-engine/passes/contract-list-writer';
import type {
  ContractListLegInput,
  ContractListWriterDeps,
} from '../../../functions/src/options-strategy-engine/passes/contract-list-writer';
import type { OptionsContractListDocV1 } from '../../../shared/options-replay-contracts';
import type { RunnableManageInstance } from '../../../functions/src/options-strategy-engine/manage-instance-reader';
import type { ManageVariant } from '../../../shared/manage-variant-contracts';
import { OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';

// ── Fixtures ────────────────────────────────────────────────────────────────

const MARKET_DATE = '2026-02-02';
const NEXT_DATE = '2026-02-03';
const EXPIRY = '2026-03-06';

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

function makeInstance(): RunnableManageInstance {
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
  };
}

function legInputs(
  idA = 'QQQ260306C00450000',
  idB = 'QQQ260306C00455000',
): ContractListLegInput[] {
  const variant = cdsVariant();
  return [
    {
      leg: variant.legs[0] as ContractListLegInput['leg'],
      contract: {
        contractID: idA,
        strike: 450,
        expiration: EXPIRY,
        mark: 5.0,
        delta: 0.5,
        iv: 0.22,
        bid: 4.9,
        ask: 5.1,
        volume: 1200,
        openInterest: 9000,
      },
    },
    {
      leg: variant.legs[1] as ContractListLegInput['leg'],
      contract: {
        contractID: idB,
        strike: 455,
        expiration: EXPIRY,
        mark: 3.0,
        delta: 0.4,
        iv: 0.23,
        bid: 2.9,
        ask: 3.1,
        volume: 800,
        openInterest: 6000,
      },
    },
  ];
}

function storeDeps(existing?: OptionsContractListDocV1) {
  const written: OptionsContractListDocV1[] = [];
  let current = existing;
  const deps: ContractListWriterDeps = {
    upsertDoc: async (_id, fn) => {
      current = fn(current);
      written.push(current);
    },
    fetchUnderlyingPrice: async () => 512.34,
    now: () => new Date('2026-02-02T20:00:00Z'),
  };
  return { deps, written };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('appendManageContractListRows', () => {
  it('creates the doc on first open — runId=instanceId, status success, one pick row per leg', async () => {
    const { deps, written } = storeDeps();
    await appendManageContractListRows(makeInstance(), legInputs(), MARKET_DATE, deps);

    assert.equal(written.length, 1);
    const doc = written[0];
    assert.equal(doc.runId, 'QQQ-CDS-30-50-40-ALL');
    assert.equal(doc.symbol, 'QQQ');
    assert.equal(doc.templateId, 'cds');
    assert.equal(doc.status, 'success');
    assert.equal(doc.schemaVersion, undefined); // v1 — defined by absence
    assert.equal(doc.rows.length, 2);
    assert.equal(doc.generatedAt, '2026-02-02T20:00:00.000Z');

    const [r0, r1] = doc.rows;
    assert.equal(r0.kind, 'pick');
    if (r0.kind !== 'pick' || r1.kind !== 'pick') throw new Error('unreachable');
    assert.equal(r0.contractId, 'QQQ260306C00450000');
    assert.equal(r0.entryDate, MARKET_DATE);
    assert.equal(r0.expiration, EXPIRY);
    assert.equal(r0.dte, 32); // calendar days 2026-02-02 → 2026-03-06
    assert.equal(r0.strike, 450);
    assert.equal(r0.mark, 5.0);
    assert.equal(r0.delta, 0.5);
    assert.equal(r0.iv, 0.22);
    assert.equal(r0.side, TradeSide.LONG);
    assert.equal(r0.underlyingClose, 512.34);
    assert.equal(r0.repeatsPrevious, false); // first row ever
    assert.equal(r1.contractId, 'QQQ260306C00455000');
    assert.equal(r1.side, TradeSide.SHORT);
    assert.equal(r1.repeatsPrevious, false);
  });

  it('appends a second open — same-index repeatsPrevious + meta bookkeeping', async () => {
    const { deps, written } = storeDeps();
    const instance = makeInstance();

    // Day 1: legs A/B open.
    await appendManageContractListRows(instance, legInputs(), MARKET_DATE, deps);
    // Day 2: leg 0 repeats contract A; leg 1 moves to a different contract.
    await appendManageContractListRows(
      instance,
      legInputs('QQQ260306C00450000', 'QQQ260306C00460000'),
      NEXT_DATE,
      deps,
    );

    const doc = written[1];
    assert.equal(doc.rows.length, 4);
    const [, , r2, r3] = doc.rows;
    if (r2.kind !== 'pick' || r3.kind !== 'pick') throw new Error('unreachable');
    // Same-index semantics: leg0's new row compares to the previous group's
    // leg0 (same contract → true); leg1's compares to prev leg1 (different →
    // false). Literal-previous-row semantics would have compared r3 to r2 —
    // leg0 vs leg1, always false — which is NOT what happens here.
    assert.equal(r2.repeatsPrevious, true);
    assert.equal(r3.repeatsPrevious, false);
    assert.equal(doc.pickDocMeta.pickCount, 4);
    assert.equal(doc.pickDocMeta.firstDate, MARKET_DATE);
    assert.equal(doc.pickDocMeta.lastDate, NEXT_DATE);
    assert.equal(doc.pickDocMeta.missCount, 0);
  });

  it('pickDocMeta carries leg-0 coordinate + synthetic gridVersion 0', async () => {
    const { deps, written } = storeDeps();
    await appendManageContractListRows(makeInstance(), legInputs(), MARKET_DATE, deps);
    const meta = written[0].pickDocMeta;
    assert.equal(meta.coordinate.type, OptionType.CALL);
    assert.equal(meta.coordinate.targetDelta, 0.5);
    assert.deepEqual(meta.coordinate.expiry, { mode: 'nearestDte', dte: 30 });
    assert.equal(meta.gridVersion, 0);
  });

  it('missing quote numerics write NaN, absent underlying price writes NaN', async () => {
    const { deps, written } = storeDeps();
    const legs = legInputs();
    legs[0].contract = { contractID: 'QQQ260306C00450000', strike: 450, expiration: EXPIRY, mark: 5.0 };
    const depsNoPrice: ContractListWriterDeps = {
      ...deps,
      fetchUnderlyingPrice: async () => undefined,
    };
    await appendManageContractListRows(makeInstance(), legs, MARKET_DATE, depsNoPrice);

    const r0 = written[0].rows[0];
    if (r0.kind !== 'pick') throw new Error('unreachable');
    for (const f of ['delta', 'iv', 'bid', 'ask', 'volume', 'openInterest', 'underlyingClose'] as const) {
      assert.ok(Number.isNaN(r0[f]), `${f} should be NaN`);
    }
    assert.equal(r0.mark, 5.0);
  });

  it('empty legs list is a no-op — no read, no write', async () => {
    let touched = false;
    const deps: ContractListWriterDeps = {
      upsertDoc: async () => {
        touched = true;
      },
      fetchUnderlyingPrice: async () => 1,
      now: () => new Date(),
    };
    await appendManageContractListRows(makeInstance(), [], MARKET_DATE, deps);
    assert.equal(touched, false);
  });
});

describe('appendManageContractListRows — idempotent dedupe', () => {
  it('re-appending the same (entryDate, contractId) group returns the doc untouched', async () => {
    const { deps, written } = storeDeps();
    const inst = makeInstance();
    await appendManageContractListRows(inst, legInputs(), MARKET_DATE, deps);
    await appendManageContractListRows(inst, legInputs(), MARKET_DATE, deps);

    // Second call's upsert returned the existing doc unchanged.
    assert.equal(written.length, 2);
    assert.equal(written[1].rows.length, 2);
    assert.equal(written[1].pickDocMeta.pickCount, 2);
  });

  it('fills only missing (entryDate, contractId) rows on a partial reconcile', async () => {
    const { deps, written } = storeDeps();
    const inst = makeInstance();
    await appendManageContractListRows(inst, legInputs(), MARKET_DATE, deps);
    // Reconcile carries a leg rebuilt from the persisted position —
    // mark present, greeks absent (NaN rows for the missing half).
    await appendManageContractListRows(
      inst,
      [
        legInputs()[0],
        {
          leg: legInputs()[1].leg,
          contract: {
            contractID: 'QQQ260306C00460000', // persisted pick — different from day-1's leg1
            strike: 460,
            expiration: EXPIRY,
            mark: 2.0,
          },
        },
      ],
      MARKET_DATE,
      deps,
    );
    const doc = written[1];
    assert.equal(doc.rows.length, 3); // leg0 dup skipped, leg1-new added
    const added = doc.rows[2];
    if (added.kind !== 'pick') throw new Error('unreachable');
    assert.equal(added.contractId, 'QQQ260306C00460000');
    assert.ok(Number.isNaN(added.delta));
  });
});
