/**
 *
 * Callable Cloud Functions for the options strategy dashboard —
 * listStrategyPositions (open/closed position tables). The stats/equity
 * surface moved to `getPaperStats` (paper-trading read-callables, #984).
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from './options-strategy-cors';
import { listAllPositions } from './position-repository';
import {
  buildPositionsResponse,
  type StrategyPositionsResponse,
} from './strategy-query-service';
import type { Position, PositionStatus } from './types';

// ── Request/response types ───────────────────────────────────────────────────

export interface ListStrategyPositionsRequest {
  instanceId?: string;
  status?: PositionStatus;
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
  deps: { listAllPositions: (instanceId?: string) => Promise<Position[]> },
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
