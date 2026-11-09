/**
 * Backtest strategy discovery callable.
 *
 * Returns the metadata for every strategy registered in the strategy registry,
 * including config schemas so the UI can render a dynamic config form.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { strategyRegistry } from '../strategies/strategy-registry';
import type { ConfigSchemaField } from '../strategies/base-strategy';

export interface BacktestStrategyResponse {
  strategies: Array<{
    id: string;
    name: string;
    description: string;
    category: string;
    defaultConfig: Record<string, unknown>;
    configSchema?: Record<string, ConfigSchemaField>;
    minBarsRequired: number;
    supportedTimeframes: string[];
  }>;
}

export interface BacktestStrategiesDeps {
  listStrategies: () => ReturnType<typeof strategyRegistry.list>;
}

const prodDeps: BacktestStrategiesDeps = {
  listStrategies: () => strategyRegistry.list(),
};

/** Testable core (#1444) — auth guard inside, before any work. */
export async function handleStBacktestStrategies(
  request: CallableRequest<void>,
  deps: BacktestStrategiesDeps = prodDeps,
): Promise<BacktestStrategyResponse> {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'unauthenticated');
  const strategies = deps.listStrategies().map((metadata) => ({
    id: metadata.id,
    name: metadata.name,
    description: metadata.description,
    category: metadata.category,
    defaultConfig: metadata.defaultConfig,
    configSchema: metadata.configSchema,
    minBarsRequired: metadata.minBarsRequired,
    supportedTimeframes: metadata.supportedTimeframes,
  }));

  return { strategies };
}

export const stBacktestStrategies = onCall<void, Promise<BacktestStrategyResponse>>(
  { cors: true, memory: '256MiB', invoker: 'public' },
  (request) => handleStBacktestStrategies(request),
);
