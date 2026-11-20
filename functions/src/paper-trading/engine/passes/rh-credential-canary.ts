/**
 * @topic #657 — RH-MCP, Task #1628: RH credential canary
 *
 * Daily 7 AM PT weekday probe of the exact credential path the noon
 * manage open pass uses (rh-agent-credentials/bundle via the KMS repo
 * → token refresh → MCP tool call — #1639). A dead refresh token
 * surfaces here as `reauth_required`
 * ~5 hours before the open pass discovers it — enough time to re-run
 * the local OAuth bootstrap + upload-rh-credential the same day.
 *
 * Surfaces:
 * - `st-config/rhCredentialCanary` doc — {state, checkedAt, latencyMs,
 *   error?, userId} overwritten each run. Lives on st-config (client-
 *   readable per-owner) because rh-agent-credentials denies all client
 *   reads; `userId` is stamped from an existing manage instance so the
 *   st-config per-user read rule admits it.
 * - Log markers — `rh_credential_canary` on every run;
 *   `rh_credential_canary_fail` only on alarm states (reauth/misconfig),
 *   so a GCP log-based alert on the fail marker won't fire on transients.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';
import { db } from '../../../firebase-admin-init';
import { createRobinhoodMcpSessionManagerFromKms } from '../../../options-strategy-engine/mcp/robinhood-mcp-session-manager';
import { NO_STORED_CREDENTIAL_MESSAGE } from '../../../rh-agent-mcp/auth/robinhood-mcp-connection';
import { withTimeout } from '../../../rh-agent-mcp/tools/session-acquisition';
import { MCP_CALL_TIMEOUT_MS } from '../../../rh-agent-mcp/tools/robinhood-tool-executor';
import { INSTANCE_RUN_STATES } from '@manage/instance-contracts';
import {
  ST_CONFIG_RH_CREDENTIAL_CANARY_DOC,
  ST_STRATEGY_INSTANCES_ROOT,
  stConfigDocPath,
} from '../../../common/st-collections';

export type CanaryState = 'ok' | 'reauth_required' | 'transient';

export interface CanaryStatusDoc {
  state: CanaryState;
  checkedAt: string;
  latencyMs: number;
  error?: string;
  /** Owner uid — required by the st-config per-user read rule. */
  userId: string;
}

export const CANARY_STATUS_PATH = stConfigDocPath(
  ST_CONFIG_RH_CREDENTIAL_CANARY_DOC,
);

/** Alarm classification — the refresh path's failure throws a
 *  RobinhoodMcpConnectionError whose wrapped OAuth error has lost its
 *  code; the state name is embedded in the message instead
 *  (robinhood-mcp-connection.ts). User-action failures carry either a
 *  classifier state name (REAUTHORIZATION_REQUIRED/MISCONFIGURED) or a
 *  verbatim bootstrap/remedy message (no stored credential) — all require
 *  the OAuth bootstrap + re-upload, so all alarm. Note the remedy phrase
 *  alone is NOT a discriminator: a TEMPORARILY_UNAVAILABLE refresh failure
 *  embeds it too. */
const PERSISTENT_FAILURE_ERROR_NAMES = new Set([
  // KMS-path misconfig (#1639): missing key name, corrupted/undecryptable
  // doc — deterministic failures that need a human, not a retry.
  'KmsUnavailableError',
  'MalformedCredentialDocError',
  'InvalidCredentialBundleError',
]);
function classifyProbeError(error: unknown): CanaryState {
  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  return /REAUTHORIZATION_REQUIRED|MISCONFIGURED|PERMISSION_DENIED|FAILED_PRECONDITION/.test(msg) ||
    PERSISTENT_FAILURE_ERROR_NAMES.has(name) ||
    msg === NO_STORED_CREDENTIAL_MESSAGE
    ? 'reauth_required'
    : 'transient';
}

export async function runCredentialCanary(deps: {
  probe: () => Promise<void>;
  writeDoc: (d: CanaryStatusDoc) => Promise<void>;
  /** Owner uid stamped for the st-config per-user read rule. */
  uid: string;
  now?: () => number;
}): Promise<CanaryStatusDoc> {
  const now = deps.now ?? Date.now;
  const start = now();
  let doc: CanaryStatusDoc;
  try {
    await deps.probe();
    doc = {
      state: 'ok',
      checkedAt: new Date(start).toISOString(),
      latencyMs: now() - start,
      userId: deps.uid,
    };
  } catch (error) {
    doc = {
      state: classifyProbeError(error),
      checkedAt: new Date(start).toISOString(),
      latencyMs: now() - start,
      error: error instanceof Error ? error.message : String(error),
      userId: deps.uid,
    };
  }
  await deps.writeDoc(doc);
  if (doc.state === 'reauth_required') {
    logger.error('rh_credential_canary_fail', {
      state: doc.state,
      error: doc.error,
    });
  } else {
    logger.info('rh_credential_canary', {
      state: doc.state,
      latencyMs: doc.latencyMs,
      ...(doc.error ? { error: doc.error } : {}),
    });
  }
  return doc;
}

/** Production probe — identical to the noon open pass's credential path:
 *  KMS+Firestore repository → connect (which triggers the refresh) → one
 *  cheap read-only call (the same tool+args the pass uses first). The
 *  withTimeout race keeps a hung MCP call from burning the whole
 *  function window without a status write — a timeout lands as
 *  'transient'. */
async function prodProbe(): Promise<void> {
  const manager = await createRobinhoodMcpSessionManagerFromKms();
  try {
    await withTimeout(
      manager.callTool('get_option_chains', {
        underlying_symbol: 'SPY',
      }),
      MCP_CALL_TIMEOUT_MS,
      'rh_credential_canary probe',
    );
  } finally {
    await manager.close().catch(() => undefined);
  }
}

/** The owner uid — sourced from any existing manage instance (scheduled
 *  functions have no auth context). Single-owner app: the first match's
 *  userId is THE owner. */
async function lookupOwnerUid(): Promise<string> {
  const snap = await db
    .collection(ST_STRATEGY_INSTANCES_ROOT)
    .where('runState', 'in', [...INSTANCE_RUN_STATES])
    .limit(1)
    .get();
  const uid = snap.docs[0]?.data().userId;
  if (typeof uid !== 'string' || !uid) {
    throw new Error('no st-strategy-instances doc to source userId from');
  }
  return uid;
}

export const rhCredentialCanary = onSchedule(
  {
    schedule: '0 7 * * 1-5', // 7 AM PT, Mon–Fri — ~5h before the noon open pass
    timeZone: 'America/Los_Angeles',
    memory: '256MiB',
    timeoutSeconds: 60,
    region: 'us-central1',
  },
  async () => {
    await runCredentialCanary({
      probe: prodProbe,
      uid: await lookupOwnerUid(),
      writeDoc: async (d) => {
        await db.doc(CANARY_STATUS_PATH).set(d);
      },
    });
  },
);
