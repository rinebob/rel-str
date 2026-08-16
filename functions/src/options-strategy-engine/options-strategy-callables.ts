/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Callable Cloud Functions for the options strategy dashboard —
 * listStrategyPositions (open/closed position tables) and
 * getStrategyEquityCurve (per-symbol + combined equity curve with stats).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from './options-strategy-cors';
import { listAllPositions } from './position-repository';
import {
  defaultReadStatsDoc,
  defaultStatsDeps,
  getEquityCurve,
  getStats,
} from './stats-repository';
import {
  buildPositionsResponse,
  type StrategyPositionsResponse,
} from './strategy-query-service';
import type {
  EquityCurvePoint,
  Position,
  PositionStatus,
  StrategyStats,
} from './types';

// ── Request/response types ───────────────────────────────────────────────────

export interface ListStrategyPositionsRequest {
  instanceId?: string;
  status?: PositionStatus;
}

export interface GetStrategyEquityCurveRequest {
  /** Instance ID for per-symbol view, or omit for the combined ALL scope. */
  instanceId?: string;
}

export interface StrategyEquityCurveResponse {
  points: EquityCurvePoint[];
  stats: StrategyStats | null;
}

// ── Consolidated deps (for testability) ──────────────────────────────────────

export interface OptionsStrategyCallableDeps {
  listAllPositions: (instanceId?: string) => Promise<Position[]>;
  readEquityCurve: (scope: string) => Promise<EquityCurvePoint[]>;
  readStatsDoc: (scope: string) => Promise<StrategyStats | null>;
}

// ── listStrategyPositions ────────────────────────────────────────────────────

/**
 * Handler for listStrategyPositions — testable pure function.
 * Throws HttpsError('unauthenticated') if no auth context.
 * Accepts optional instanceId (per-symbol filter) and status (single-status filter).
 */
export async function handleListStrategyPositions(
  request: {
    data?: ListStrategyPositionsRequest;
    auth?: { uid: string };
  },
  deps: Pick<OptionsStrategyCallableDeps, 'listAllPositions'>,
): Promise<StrategyPositionsResponse> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to view positions');
  }
  const { instanceId, status } = request.data ?? {};
  let positions = await deps.listAllPositions(instanceId);
  if (status) {
    positions = positions.filter((p) => p.status === status);
  }
  return buildPositionsResponse(positions);
}

export const listStrategyPositions = onCall<
  ListStrategyPositionsRequest,
  Promise<StrategyPositionsResponse>
>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    return handleListStrategyPositions(request, { listAllPositions });
  },
);

// ── getStrategyEquityCurve ───────────────────────────────────────────────────

/**
 * Handler for getStrategyEquityCurve — testable pure function.
 * Throws HttpsError('unauthenticated') if no auth context.
 * Accepts optional instanceId — omit for the combined ALL scope.
 */
export async function handleGetStrategyEquityCurve(
  request: {
    data?: GetStrategyEquityCurveRequest;
    auth?: { uid: string };
  },
  deps: Pick<OptionsStrategyCallableDeps, 'readEquityCurve' | 'readStatsDoc'>,
): Promise<StrategyEquityCurveResponse> {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in to view equity curve');
  }
  const scope = request.data?.instanceId ?? 'ALL';
  const [points, stats] = await Promise.all([
    getEquityCurve(scope, { readEquityCurve: deps.readEquityCurve }),
    getStats(scope, { readStatsDoc: deps.readStatsDoc }),
  ]);
  return { points, stats };
}

export const getStrategyEquityCurve = onCall<
  GetStrategyEquityCurveRequest,
  Promise<StrategyEquityCurveResponse>
>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    memory: '256MiB',
    timeoutSeconds: 30,
  },
  async (request) => {
    return handleGetStrategyEquityCurve(request, {
      readEquityCurve: defaultStatsDeps.getExistingEquityCurve,
      readStatsDoc: defaultReadStatsDoc,
    });
  },
);
