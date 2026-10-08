/**
 * Production `/api/rh/**` surface — `rhApi` onRequest function.
 *
 * AuthZ runs before any route: `Authorization: Bearer <Firebase idToken>` →
 * `verifyIdToken` → `uid === RH_OWNER_UID` (401 no/bad token, 403 non-owner).
 * Tool calls dispatch through the shared route table against the KMS+Firestore
 * credential repository; every call is audit-logged as
 * `rh_api_call { tool, category, outcome }` — never args or payloads.
 *
 * The reauth route returns a structured REAUTHORIZATION_REQUIRED state —
 * interactive OAuth only exists locally; production recovery is the local
 * bootstrap + upload-rh-credential flow (task #806, runbook task #811).
 */
import { onRequest } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { logger } from 'firebase-functions/v2';
import cors from 'cors';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ST_ALLOWED_ORIGINS } from '../../st-cloud-function/cors';
import {
  dispatchRhApiRequest,
  sendJson,
  type RhApiAuditEntry,
} from '../api-shared/rh-api-routes';
import type { RobinhoodCredentialRepository } from '../auth/credential-repository';
import type { RobinhoodMcpTransportFactory } from '../client/robinhood-mcp-session';
import {
  FirestoreDocStore,
  KmsFirestoreCredentialRepository,
  TransactionalCredentialDocumentBackend,
} from '../auth/kms-firestore-credential-repository';
import { createKmsCipherFromEnv } from '../auth/kms-cipher';
import { db } from '../../firebase-admin-init';

/** Auth-rejection audit record — structural only, never token material. */
export interface RhApiAuthRejectEntry {
  reason: 'missing_token' | 'invalid_token' | 'non_owner';
  uid?: string;
}

export interface RhApiDeps {
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  ownerUid: string;
  repository: RobinhoodCredentialRepository;
  transportFactory?: RobinhoodMcpTransportFactory;
  onAudit?: (entry: RhApiAuditEntry) => void;
  /** Auth rejections (401/403) — visible in logs without token material. */
  onAuditReject?: (entry: RhApiAuthRejectEntry) => void;
  /** Test seams forwarded to the executor — prod leaves both unset. */
  callTimeoutMs?: number;
  batchBudgetMs?: number;
}

type RequestHandler = (
  request: IncomingMessage,
  response: ServerResponse,
) => Promise<void>;

function bearerToken(request: IncomingMessage): string | null {
  const header = request.headers.authorization;
  const match =
    typeof header === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(header) : null;
  return match?.[1] ?? null;
}

/** Auth-checked request handler — injectable deps keep tests in-process. */
export function createRhApiHandler(deps: RhApiDeps): RequestHandler {
  return async (request, response) => {
    const token = bearerToken(request);
    if (!token) {
      sendJson(response, 401, {
        success: false,
        error: 'Missing Authorization bearer token',
      });
      deps.onAuditReject?.({ reason: 'missing_token' });
      return;
    }

    let uid: string;
    try {
      uid = (await deps.verifyIdToken(token)).uid;
    } catch {
      sendJson(response, 401, {
        success: false,
        error: 'Invalid or expired token',
      });
      deps.onAuditReject?.({ reason: 'invalid_token' });
      return;
    }

    if (uid !== deps.ownerUid) {
      sendJson(response, 403, { success: false, error: 'Forbidden' });
      deps.onAuditReject?.({ reason: 'non_owner', uid });
      return;
    }

    await dispatchRhApiRequest(request, response, {
      executorOptions: {
        repository: deps.repository,
        transportFactory: deps.transportFactory,
        callTimeoutMs: deps.callTimeoutMs,
        batchBudgetMs: deps.batchBudgetMs,
      },
      reauthHandler: async (_request, res) =>
        sendJson(res, 200, {
          success: false,
          state: 'REAUTHORIZATION_REQUIRED',
          message:
            'Run the local OAuth bootstrap, then upload-rh-credential to reseed the production repository.',
        }),
      onAudit: deps.onAudit,
    });
  };
}

function createProductionRepository(): RobinhoodCredentialRepository {
  return new KmsFirestoreCredentialRepository(
    new TransactionalCredentialDocumentBackend(new FirestoreDocStore(db)),
    createKmsCipherFromEnv(),
  );
}

/**
 * Shared CORS allowlist (savanttrader.com + web.app + hosted.app + localhost
 * debug) with a 24h preflight cache — the onRequest `cors` shorthand can't
 * set maxAge, so without this every authed call would pay an OPTIONS
 * roundtrip plus a function invocation. Runs inside the handler; the
 * middleware answers preflights (204) itself, real requests fall through.
 */
const rhApiCors = cors({ origin: ST_ALLOWED_ORIGINS, maxAge: 86400 });

/** cors() is typed for express req/res; onRequest hands us the same objects
 *  (functions-framework is express under the hood) minus the type tag. */
type CorsRequest = Parameters<typeof rhApiCors>[0];
type CorsResponse = Parameters<typeof rhApiCors>[1];

/** Applies the CORS layer synchronously. Preflights end inside the cors
 *  middleware (204, next() never runs) — callers must check
 *  `response.writableEnded` before dispatching to the real handler. */
export function applyRhApiCors(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  rhApiCors(request as CorsRequest, response as CorsResponse, (err?: unknown) => {
    if (err) throw err;
  });
}

let cachedHandler: RequestHandler | undefined;

/** Lazy cold-start build — env vars + admin SDK resolve on first request.
 *  CORS runs first: preflights answer (204) without touching auth/KMS/env. */
async function productionHandler(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  applyRhApiCors(request, response);
  if (response.writableEnded) return;

  cachedHandler ??= createRhApiHandler({
    verifyIdToken: async (token) => {
      const decoded = await getAuth().verifyIdToken(token);
      return { uid: decoded.uid };
    },
    ownerUid: process.env.RH_OWNER_UID ?? '',
    repository: createProductionRepository(),
    onAudit: (entry) => logger.info('rh_api_call', entry),
    onAuditReject: (entry) => logger.warn('rh_api_auth_reject', entry),
  });
  await cachedHandler(request, response);
}

export const rhApi = onRequest(
  {
    region: 'us-central1',
    timeoutSeconds: 120,
    memory: '512MiB',
    // Bounds concurrent-refresh amplification per instance.
    // minInstances lands with the session cache in task #808.
    concurrency: 8,
  },
  productionHandler,
);
