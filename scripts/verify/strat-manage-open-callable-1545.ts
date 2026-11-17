/**
 * Verification: manage manual open-pass callable (task #1545).
 *
 * Exercises `runManageOpenPassManual` — the `manageOpenPassManual`
 * callable core — through the functions tsconfig aliases with injected
 * fakes: auth guard, arg validation, instance gates (not-found /
 * not_active / non_paper), session-bound pass invocation, session close
 * on success and failure, and error mapping.
 *
 * Importing the module runs `firebase-admin-init` (parameterless
 * `initializeApp()` — no credentials needed; no Firestore call is made).
 *
 * Usage: npx tsx scripts/verify/strat-manage-open-callable-1545.ts
 *
 * Pass: every check prints OK and the script exits 0.
 * Fail: the offending check prints FAIL with detail; exit 1.
 */

import { runManageOpenPassManual } from '../../functions/src/paper-trading/engine/passes/manage-open-callable';
import type { ManageManualOpenDeps } from '../../functions/src/paper-trading/engine/passes/manage-open-callable';
import type { RunnableManageInstance } from '../../functions/src/paper-trading/engine/manage-instance-reader';
import type { ManageOpenPassResult } from '../../functions/src/paper-trading/engine/passes/manage-open-pass';
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

const INSTANCE_ID = 'QQQ-PCS-28-30-15-ALL';
const MARKET_DATE = '2026-02-06';

function makeInstance(overrides: Partial<RunnableManageInstance> = {}): RunnableManageInstance {
  const variant: ManageVariant = {
    id: 'pcs-28-30-15',
    name: 'put credit spread 30-15 28',
    templateId: 'pcs',
    dte: 28,
    legs: [
      { kind: 'option', type: OptionType.PUT, targetDelta: 0.3, dte: 28, side: TradeSide.SHORT },
      { kind: 'option', type: OptionType.PUT, targetDelta: 0.15, dte: 28, side: TradeSide.LONG },
    ],
  };
  return {
    id: INSTANCE_ID,
    variantRef: variant.id,
    variant,
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
    legsResolved: ['QQQ260227P00480000'],
    recordedAt: '2026-02-06T20:00:00Z',
    ...overrides,
  };
}

function makeDeps(overrides: Partial<ManageManualOpenDeps> = {}) {
  const session = { opened: 0, closed: 0, tools: [] as string[] };
  const deps: ManageManualOpenDeps = {
    getInstance: async () => makeInstance(),
    openSession: async () => {
      session.opened++;
      return {
        callTool: async (name: string) => {
          session.tools.push(name);
          return {};
        },
        close: async () => {
          session.closed++;
        },
      };
    },
    runPass: async (_i, _d, passDeps) => {
      await passDeps.callTool('get_option_chains', {});
      return passResult();
    },
    ticketsFactory: () =>
      ({ emit: async () => ({}), markFilled: async () => {}, markFailed: async () => {} }) as never,
    marketDate: () => MARKET_DATE,
    ...overrides,
  };
  return { deps, session };
}

async function rejects(
  fn: () => Promise<unknown>,
): Promise<string> {
  try {
    await fn();
    return 'resolved';
  } catch (e) {
    return `rejected:${(e as { code?: string }).code}`;
  }
}

async function main(): Promise<void> {
  console.log('── auth + validation ──');
  {
    const { deps } = makeDeps();
    check('unauthenticated → unauthenticated',
      await rejects(() => runManageOpenPassManual(request({ instanceId: INSTANCE_ID }, false), deps)),
      'rejected:unauthenticated');
    check('missing instanceId → invalid-argument',
      await rejects(() => runManageOpenPassManual(request({}), deps)),
      'rejected:invalid-argument');
    check('blank instanceId → invalid-argument',
      await rejects(() => runManageOpenPassManual(request({ instanceId: '  ' }), deps)),
      'rejected:invalid-argument');
  }

  console.log('── instance gates ──');
  {
    const { deps } = makeDeps({ getInstance: async () => null });
    check('missing instance → not-found',
      await rejects(() => runManageOpenPassManual(request({ instanceId: 'nope' }), deps)),
      'rejected:not-found');
  }
  {
    const { deps, session } = makeDeps({
      getInstance: async () => makeInstance({ runState: 'PAUSED' }),
    });
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    check('paused instance → skipped not_active', res.skipReason, 'not_active');
    check('paused instance → session never opened', session.opened, 0);
  }
  {
    const { deps } = makeDeps({ getInstance: async () => makeInstance({ mode: 'real' }) });
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    check('real-mode instance → skipped non_paper', res.skipReason, 'non_paper');
  }

  console.log('── invocation + lifecycle ──');
  {
    const { deps, session } = makeDeps();
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    check('ACTIVE paper → position id returned', res.positionId, `${INSTANCE_ID}-${MARKET_DATE}`);
    check('callTool routed through session', session.tools, ['get_option_chains']);
    check('session closed after success', session.closed, 1);
  }
  {
    const { deps } = makeDeps({
      runPass: async () =>
        passResult({ positionId: null, skipped: true, skipReason: 'already_opened_today' }),
    });
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    check('idempotent re-run → already_opened_today passes through',
      res.skipReason, 'already_opened_today');
  }
  {
    const { deps, session } = makeDeps({
      runPass: async () => {
        throw new Error('chain fetch exploded');
      },
    });
    check('pass throw → internal',
      await rejects(() => runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps)),
      'rejected:internal');
    check('session closed after failure', session.closed, 1);
  }
  {
    const { deps } = makeDeps({
      openSession: async () => {
        throw new Error('no RH credentials');
      },
    });
    check('session-open failure → internal',
      await rejects(() => runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps)),
      'rejected:internal');
  }
  {
    const { deps } = makeDeps({
      runPass: async () => {
        throw new Error('6 ALREADY_EXISTS: Document already exists');
      },
    });
    const res = await runManageOpenPassManual(request({ instanceId: INSTANCE_ID }), deps);
    check('lost same-instance race → already_opened_today (not internal)',
      res.skipReason, 'already_opened_today');
  }

  console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('verify crashed:', e);
  process.exit(1);
});
