/**
 * @topic #553 — Paper Trading Infra (task #565)
 *
 * Read-side callables for the paper-trading dashboard:
 *
 *   listPaperTrades   — trades filtered by AND-combined dims
 *                       (status, source, instance, cohort, signal, symbol,
 *                       expression, variantKey)
 *   getPaperStats     — stats rollup doc(s): one scope or every scope
 *   getPaperAccount   — the caller's acct-{uid} doc (null when unopened)
 *   listExitVariants  — the variant registry's shippable configurations
 *
 * All read-only — no RH MCP needed, no secrets. Auth required; accounts are
 * scoped to the caller's uid (trades/stats are user-agnostic rollups).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type {
  GetPaperAccountResponse,
  GetPaperStatsRequest,
  GetPaperStatsResponse,
  ListExitVariantsResponse,
  ListPaperTradesRequest,
  ListPaperTradesResponse,
  PaperAccount,
  PaperStats,
  PaperTrade,
} from '@paper-trading/contracts';
import { buildAccountId, buildStatsId } from '@paper-trading/ids';
import { db } from '../firebase-admin-init';
import { getAccount, getStats, listStats, listTrades } from './repository';
import { listExitVariantConfigs } from './exits/registry';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from './engine/options-strategy-cors';
import { createLogger } from './engine/logging';

const logger = createLogger('PaperRead');

// ── Dependencies ──────────────────────────────────────────────────────────

export interface PaperReadDeps {
  listTrades: (filters: ListPaperTradesRequest) => Promise<PaperTrade[]>;
  getStats: (statsId: string) => Promise<PaperStats | null>;
  listStats: () => Promise<PaperStats[]>;
  getAccount: (accountId: string) => Promise<PaperAccount | null>;
}

function requireUid(request: CallableRequest<unknown>): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  return uid;
}

const SCOPE_RE = /^[a-zA-Z0-9-]{1,128}$/;

// ── Handlers (deps-injected; the onCall wrappers delegate) ────────────────

export async function handleListPaperTrades(
  request: CallableRequest<ListPaperTradesRequest>,
  deps: PaperReadDeps,
): Promise<ListPaperTradesResponse> {
  requireUid(request);
  const f = request.data ?? {};
  const filters: ListPaperTradesRequest = {
    ...(f.status ? { status: f.status } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.strategyInstanceId ? { strategyInstanceId: f.strategyInstanceId } : {}),
    ...(f.cohortId ? { cohortId: f.cohortId } : {}),
    ...(f.signalId ? { signalId: f.signalId } : {}),
    ...(f.symbol ? { symbol: f.symbol.toUpperCase() } : {}),
    ...(f.expression ? { expression: f.expression } : {}),
    ...(f.variantKey ? { variantKey: f.variantKey } : {}),
  };
  const trades = await deps.listTrades(filters);
  logger.info(`listPaperTrades ${JSON.stringify(filters)} → ${trades.length} trades`);
  return { trades };
}

export async function handleGetPaperStats(
  request: CallableRequest<GetPaperStatsRequest>,
  deps: PaperReadDeps,
): Promise<GetPaperStatsResponse> {
  requireUid(request);
  const scope = request.data?.scope;
  if (scope !== undefined && !SCOPE_RE.test(scope)) {
    throw new HttpsError('invalid-argument', 'malformed scope');
  }
  if (scope === undefined) {
    return { stats: await deps.listStats() };
  }
  const doc = await deps.getStats(buildStatsId(scope));
  return { stats: doc ? [doc] : [] };
}

export async function handleGetPaperAccount(
  request: CallableRequest<Record<string, never>>,
  deps: PaperReadDeps,
): Promise<GetPaperAccountResponse> {
  const userId = requireUid(request);
  const account = await deps.getAccount(buildAccountId(userId));
  return { account };
}

export async function handleListExitVariants(
  request: CallableRequest<Record<string, never>>,
): Promise<ListExitVariantsResponse> {
  requireUid(request);
  return { variants: listExitVariantConfigs() };
}

// ── Production wiring ─────────────────────────────────────────────────────

/** Wrap non-HttpsError failures the same way paperSignalOrder does — raw
 *  backend errors never leak to clients. */
async function internalGuard<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    throw new HttpsError(
      'internal',
      `${label} failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Production deps — exported so the verify script shares one wiring. */
export function paperReadDeps(): PaperReadDeps {
  return {
    listTrades: (filters) => listTrades(db, filters),
    getStats: (statsId) => getStats(db, statsId),
    listStats: () => listStats(db),
    getAccount: (accountId) => getAccount(db, accountId),
  };
}

// ── Callable exports ──────────────────────────────────────────────────────

const CORS = { cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS };

export const listPaperTrades = onCall<ListPaperTradesRequest, Promise<ListPaperTradesResponse>>(
  CORS,
  (request) =>
    internalGuard('listPaperTrades', () =>
      handleListPaperTrades(request, paperReadDeps())),
);

export const getPaperStats = onCall<GetPaperStatsRequest, Promise<GetPaperStatsResponse>>(
  CORS,
  (request) =>
    internalGuard('getPaperStats', () =>
      handleGetPaperStats(request, paperReadDeps())),
);

export const getPaperAccount = onCall<Record<string, never>, Promise<GetPaperAccountResponse>>(
  CORS,
  (request) =>
    internalGuard('getPaperAccount', () =>
      handleGetPaperAccount(request, paperReadDeps())),
);

export const listExitVariants = onCall<Record<string, never>, Promise<ListExitVariantsResponse>>(
  CORS,
  (request) => internalGuard('listExitVariants', () => handleListExitVariants(request)),
);
