/**
 * RH Agent Company Overview Sync Worker
 *
 * Cloud Task worker that fetches SA company overview data for a single symbol
 * and writes it back to the rh-agent-symbols document.
 */
import { onTaskDispatched } from 'firebase-functions/v2/tasks';

import { fetchAndWriteSymbolOverview } from '../common/rh-agent-overview-helper';

// ============================================================================
// Task worker — fetches and writes overview for a single symbol
// ============================================================================

/**
 * Cloud Task worker that fetches and writes company overview data for one symbol.
 * Skips fresh data unless forceRefresh is true; treats 404s as non-equities.
 */
export const rhAgentOverviewSyncSymbol = onTaskDispatched<{ symbol: string; forceRefresh?: boolean }>(
  {
    retryConfig: { maxAttempts: 3, minBackoffSeconds: 10, maxBackoffSeconds: 120 },
    rateLimits: { maxConcurrentDispatches: 10, maxDispatchesPerSecond: 5 },
    memory: '256MiB',
    timeoutSeconds: 60,
  },
  async (req) => {
    const { symbol, forceRefresh = false } = req.data;
    await fetchAndWriteSymbolOverview(symbol, { forceRefresh });
  }
);
