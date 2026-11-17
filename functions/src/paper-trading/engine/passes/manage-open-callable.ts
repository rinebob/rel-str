/**
 * @topic #137 — Strategy Builder UI
 * @task #1545 — BE: Manual open pass callable (absorbs #157)
 *
 * Auth-guarded callable that runs the manage open pass for ONE instance
 * on demand — powers the manage table's immediate first-open semantics
 * (start an instance and open today's position now rather than waiting
 * for the noon `manageOpenPassTimer`).
 *
 * Idempotent by construction: the pass's own gates are the "due" check —
 * daily cadence dedup yields `already_opened_today`, a signal instance
 * with no fresh signal yields `no_fresh_signal`, and the deterministic
 * `{instanceId}-{marketDate}` position id prevents a duplicate open even
 * under a double-click. Non-ACTIVE and non-paper instances no-op with a
 * skip reason rather than erroring — the UI drives state transitions
 * through the same surface. A missing instance doc errors `not-found`.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';

import { getMarketDatePT } from '../../../common/pt-date-utils';
import { getManageInstance } from '../manage-instance-reader';
import type { RunnableManageInstance } from '../manage-instance-reader';
import { runManageOpenPass } from './manage-open-pass';
import type {
  ManageOpenPassDependencies,
  ManageOpenPassResult,
  ManageOpenSkipReason,
} from './manage-open-pass';
import { createLogger } from '../logging';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from '../options-strategy-cors';
import { StOrderTicketWriter } from '../../../order-tickets/st-order-ticket-writer';
import {
  createRobinhoodMcpSessionManagerFromEnv,
  type RobinhoodMcpSessionManager,
} from '../../../options-strategy-engine/mcp/robinhood-mcp-session-manager';

const logger = createLogger('ManageOpenCallable');

// ── Result ──────────────────────────────────────────────────────────────────

/** Callable-only skip reasons — the instance itself gates the open before
 *  the pass runs (the pass's own reasons cover "not due"). */
export type ManageManualSkipReason =
  | ManageOpenSkipReason
  | 'not_active'
  | 'non_paper';

export interface ManageManualOpenResult
  extends Omit<ManageOpenPassResult, 'skipReason'> {
  skipReason: ManageManualSkipReason | null;
}

export interface ManageOpenPassManualRequest {
  instanceId?: unknown;
}

// ── Dependencies ────────────────────────────────────────────────────────────

export interface ManageManualOpenDeps {
  getInstance?: (id: string) => Promise<RunnableManageInstance | null>;
  /** RH MCP session for the chain-resolution callTool — the prod factory
   *  mints one per invocation. */
  openSession?: () => Promise<
    Pick<RobinhoodMcpSessionManager, 'callTool' | 'close'>
  >;
  runPass?: (
    instance: RunnableManageInstance,
    marketDate: string,
    deps: ManageOpenPassDependencies,
  ) => Promise<ManageOpenPassResult>;
  ticketsFactory?: () => Pick<StOrderTicketWriter, 'emit' | 'markFilled' | 'markFailed'>;
  marketDate?: () => string;
}

function skipResult(
  instanceId: string,
  symbol: string,
  skipReason: ManageManualSkipReason,
): ManageManualOpenResult {
  return {
    instanceId,
    symbol,
    positionId: null,
    skipped: true,
    skipReason,
    legsResolved: [],
    recordedAt: new Date().toISOString(),
  };
}

/** Handler core — auth + arg validation + instance gating + pass
 *  invocation, all effects behind injectable deps (TEST-BE). */
export async function runManageOpenPassManual(
  request: CallableRequest<ManageOpenPassManualRequest>,
  deps: ManageManualOpenDeps = {},
): Promise<ManageManualOpenResult> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be signed in to trigger a manual open pass');
  }

  const instanceId =
    typeof request.data?.instanceId === 'string' ? request.data.instanceId.trim() : '';
  if (!instanceId) {
    throw new HttpsError('invalid-argument', 'instanceId is required');
  }

  const getInstance = deps.getInstance ?? ((id: string) => getManageInstance(id));
  const openSession = deps.openSession ?? createRobinhoodMcpSessionManagerFromEnv;
  const runPass = deps.runPass ?? runManageOpenPass;
  const tickets = (deps.ticketsFactory ?? (() => new StOrderTicketWriter()))();
  const marketDate = (deps.marketDate ?? getMarketDatePT)();

  const instance = await getInstance(instanceId);
  if (!instance) {
    throw new HttpsError('not-found', `Manage instance '${instanceId}' not found or malformed`);
  }
  if (instance.runState !== 'ACTIVE') {
    return skipResult(instanceId, instance.symbol, 'not_active');
  }
  if (instance.mode !== 'paper') {
    return skipResult(instanceId, instance.symbol, 'non_paper');
  }

  logger.info(`Manual open pass ${instanceId} triggered by ${request.auth.uid}`);

  const fail = (err: unknown): HttpsError => {
    if (err instanceof HttpsError) return err;
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Manual open pass ${instanceId} failed: ${message}`);
    return new HttpsError('internal', `Manual open pass failed: ${message}`);
  };

  let session: Pick<RobinhoodMcpSessionManager, 'callTool' | 'close'>;
  try {
    session = await openSession();
  } catch (err) {
    throw fail(err);
  }
  try {
    return await runPass(instance, marketDate, {
      callTool: (name, args) => session.callTool(name, args),
      tickets,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/already[-_ ]exists/i.test(message)) {
      // Lost a same-instance race (double-click / noon-timer overlap) —
      // the deterministic {instanceId}-{marketDate} position id already
      // minted, so report the no-op rather than a spurious internal.
      return skipResult(instanceId, instance.symbol, 'already_opened_today');
    }
    throw fail(err);
  } finally {
    await session.close();
  }
}

// ── Callable ────────────────────────────────────────────────────────────────

export const manageOpenPassManual = onCall(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    memory: '512MiB',
    timeoutSeconds: 120,
    region: 'us-central1',
    secrets: ['RH_CREDENTIAL_BUNDLE'],
  },
  async (request) => runManageOpenPassManual(request),
);
