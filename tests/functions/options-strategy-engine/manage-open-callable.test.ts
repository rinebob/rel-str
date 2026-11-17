/**
 * Specs for `runManageOpenPassManual` — the `manageOpenPassManual`
 * callable core (task #1545, absorbs #157). All effects through the
 * injectable `ManageManualOpenDeps` seam — no Firestore, no MCP session.
 *
 * Covers: auth guard, arg validation, instance gates (missing →
 * not-found, non-ACTIVE/non-paper → no-op skip), pass invocation with a
 * session-bound callTool + tickets, session close on success AND on
 * throw, error mapping to `internal`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { runManageOpenPassManual } from '../../../functions/src/options-strategy-engine/passes/manage-open-callable';
import type {
  ManageManualOpenDeps,
  ManageManualOpenResult,
} from '../../../functions/src/options-strategy-engine/passes/manage-open-callable';
import type { RunnableManageInstance } from '../../../functions/src/options-strategy-engine/manage-instance-reader';
import type { ManageOpenPassResult } from '../../../functions/src/options-strategy-engine/passes/manage-open-pass';
import { OptionType } from '../../../shared/options-common';
import { TradeSide } from '../../../shared/common';
import type { ManageVariant } from '../../../shared/manage-variant-contracts';

function code(e: unknown): string | undefined {
  return (e as { code?: string }).code;
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const INSTANCE_ID = 'QQQ-PCS-28-30-15-ALL';
const MARKET_DATE = '2026-02-06';

function pcsVariant(): ManageVariant {
  return {
    id: 'pcs-28-30-15',
    name: 'put credit spread 30-15 28',
    templateId: 'pcs',
    dte: 28,
    legs: [
      { kind: 'option', type: OptionType.PUT, targetDelta: 0.3, dte: 28, side: TradeSide.SHORT },
      { kind: 'option', type: OptionType.PUT, targetDelta: 0.15, dte: 28, side: TradeSide.LONG },
    ],
  };
}

function makeInstance(overrides: Partial<RunnableManageInstance> = {}): RunnableManageInstance {
  return {
    id: INSTANCE_ID,
    variantRef: 'pcs-28-30-15',
    variant: pcsVariant(),
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'ACTIVE',
    userId: 'u1',
    paperAccountId: 'acct-1',
    createdAt: '2026-01-15T00:00:00Z',
    updatedAt: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

function request(data: unknown, authed = true) {
  return { data, auth: authed ? { uid: 'u1' } : undefined } as Parameters<
    typeof runManageOpenPassManual
  >[0];
}

function passResult(overrides: Partial<ManageOpenPassResult> = {}): ManageOpenPassResult {
  return {
    instanceId: INSTANCE_ID,
    symbol: 'QQQ',
    positionId: `${INSTANCE_ID}-${MARKET_DATE}`,
    skipped: false,
    skipReason: null,
    legsResolved: ['QQQ260227P00480000', 'QQQ260227P00470000'],
    recordedAt: '2026-02-06T20:00:00Z',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ManageManualOpenDeps> = {}) {
  const sessionCalls = { opened: 0, closed: 0, tools: [] as string[] };
  const passCalls: { instance: RunnableManageInstance; marketDate: string }[] = [];
  const instanceReads: string[] = [];
  const deps: ManageManualOpenDeps = {
    getInstance: async (id) => {
      instanceReads.push(id);
      return makeInstance();
    },
    openSession: async () => {
      sessionCalls.opened++;
      return {
        callTool: async (name: string) => {
          sessionCalls.tools.push(name);
          return {};
        },
        close: async () => {
          sessionCalls.closed++;
        },
      };
    },
    runPass: async (instance, marketDate, passDeps) => {
      passCalls.push({ instance, marketDate });
      // exercise the session-bound callTool
      await passDeps.callTool('get_option_chains', {});
      return passResult();
    },
    ticketsFactory: () => ({ emit: async () => ({}), markFilled: async () => {}, markFailed: async () => {} }) as never,
    marketDate: () => MARKET_DATE,
    ...overrides,
  };
  return { deps, sessionCalls, passCalls, instanceReads };
}

// ── Specs ───────────────────────────────────────────────────────────────────

describe('runManageOpenPassManual — auth + validation', () => {
  it('unauthenticated → unauthenticated before any dep runs', async () => {
    const { deps, instanceReads, sessionCalls } = makeDeps();
    await assert.rejects(
      runManageOpenPassManual(request({ instanceId: INSTANCE_ID }, false), deps),
      (e) => code(e) === 'unauthenticated',
    );
    assert.equal(instanceReads.length, 0);
    assert.equal(sessionCalls.opened, 0);
  });

  for (const [label, data] of [
    ['missing instanceId', {}],
    ['empty string', { instanceId: '' }],
    ['whitespace', { instanceId: '   ' }],
    ['non-string', { instanceId: 7 }],
  ] as const) {
    it(`${label} → invalid-argument`, async () => {
      const { deps } = makeDeps();
      await assert.rejects(
        runManageOpenPassManual(request(data), deps),
        (e) => code(e) === 'invalid-argument',
      );
    });
  }
});

describe('runManageOpenPassManual — instance gates', () => {
  it('missing instance → not-found', async () => {
    const { deps } = makeDeps({ getInstance: async () => null });
    await assert.rejects(
      runManageOpenPassManual(request({ instanceId: 'nope' }), deps),
      (e) => code(e) === 'not-found',
    );
  });

  it('non-ACTIVE instance → no-op skip, pass never invoked', async () => {
    const { deps, passCalls } = makeDeps({
      getInstance: async () => makeInstance({ runState: 'PAUSED' }),
    });
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    assert.equal(res.skipped, true);
    assert.equal(res.skipReason, 'not_active');
    assert.equal(passCalls.length, 0);
  });

  it('non-paper instance → no-op skip (v1 boundary)', async () => {
    const { deps, passCalls } = makeDeps({
      getInstance: async () => makeInstance({ mode: 'real' }),
    });
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    assert.equal(res.skipped, true);
    assert.equal(res.skipReason, 'non_paper');
    assert.equal(passCalls.length, 0);
  });
});

describe('runManageOpenPassManual — pass invocation', () => {
  it('ACTIVE paper instance → pass runs with session callTool + tickets; session closes', async () => {
    const { deps, sessionCalls, passCalls } = makeDeps();
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    assert.equal(passCalls.length, 1);
    assert.equal(passCalls[0].instance.id, INSTANCE_ID);
    assert.equal(passCalls[0].marketDate, MARKET_DATE);
    assert.deepEqual(sessionCalls.tools, ['get_option_chains']);
    assert.equal(sessionCalls.closed, 1);
    assert.equal(res.positionId, `${INSTANCE_ID}-${MARKET_DATE}`);
    assert.equal(res.skipped, false);
  });

  it('pass skip result passes through unchanged (idempotent no-op)', async () => {
    const { deps } = makeDeps({
      runPass: async () =>
        passResult({ positionId: null, skipped: true, skipReason: 'already_opened_today' }),
    });
    const res: ManageManualOpenResult = await runManageOpenPassManual(
      request({ instanceId: INSTANCE_ID }),
      deps,
    );
    assert.equal(res.skipped, true);
    assert.equal(res.skipReason, 'already_opened_today');
  });

  it('pass throw → internal error AND session still closes', async () => {
    const { deps, sessionCalls } = makeDeps({
      runPass: async () => {
        throw new Error('chain fetch exploded');
      },
    });
    await assert.rejects(
      runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps),
      (e) => code(e) === 'internal' && (e as Error).message.includes('chain fetch exploded'),
    );
    assert.equal(sessionCalls.closed, 1);
  });

  it('lost same-instance race → already_opened_today no-op, not internal', async () => {
    const { deps } = makeDeps({
      runPass: async () => {
        throw new Error('6 ALREADY_EXISTS: Document already exists');
      },
    });
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    assert.equal(res.skipped, true);
    assert.equal(res.skipReason, 'already_opened_today');
  });

  it('session-open failure → internal', async () => {
    const { deps } = makeDeps({
      openSession: async () => {
        throw new Error('no RH credentials');
      },
    });
    await assert.rejects(
      runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps),
      (e) => code(e) === 'internal',
    );
  });
});
