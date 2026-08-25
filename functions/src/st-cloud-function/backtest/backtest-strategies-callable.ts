/**
 * Backtest strategy discovery callable.
 *
 * Returns the metadata for every strategy registered in the strategy registry,
 * including config schemas so the UI can render a dynamic config form.
 */

import { onCall } from 'firebase-functions/v2/https';
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

export const stBacktestStrategies = onCall<void, Promise<BacktestStrategyResponse>>(
  { cors: true, memory: '256MiB', invoker: 'public' },
  async () => {
    const strategies = strategyRegistry.list().map((metadata) => ({
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
);
