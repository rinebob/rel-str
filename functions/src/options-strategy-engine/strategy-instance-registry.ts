/**
 * @topic #108 — Options Position Strategy Engine
 * @topic #137 — Strategy Builder UI
 *
 * Config-driven registry of options position strategy instances.
 *
 * This is intentionally separate from the RH Agent signal strategy registry.
 * Each entry defines a recurring, stateful position-lifecycle strategy (e.g. a
 * cash-secured put ladder). The open pass iterates this registry and opens a
 * position for every instance due on the current market date.
 */

import {
  OptionType,
  PositionSpreadType,
  StrategyFrequency,
} from '@options/common';
import { TradeSide } from '@common';
import { ExitPolicy, LifecycleState } from '../../../shared/options-strategy-engine-contracts';
import type { StrategyInstanceConfig } from './types';

export const STRATEGY_INSTANCES: readonly StrategyInstanceConfig[] = [
  {
    id: 'QQQM-WHEEL',
    symbol: 'QQQM',
    // Flat fields (single-phase config consumed by passes)
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    targetDelta: 0.2,
    dteMin: 21,
    dteMax: 30,
    // Multi-phase config (phases[0] mirrors flat fields; future phases describe wheel legs)
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.2,
        dteMin: 21,
        dteMax: 30,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '12:00',
    exitPolicies: [
      { policy: ExitPolicy.WHEEL_IF_ASSIGNED },
    ],
    lifecycleState: LifecycleState.ACTIVE,
    userId: 'system',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

/**
 * Look up a strategy instance by its composite id (e.g. "QQQM-WHEEL").
 */
export function getStrategyInstance(id: string): StrategyInstanceConfig | undefined {
  return STRATEGY_INSTANCES.find((instance) => instance.id === id);
}
