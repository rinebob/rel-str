/**
 * @topic #108 — Options Position Strategy Engine
 *
 * Config-driven registry of options position strategy instances.
 *
 * This is intentionally separate from the RH Agent signal strategy registry.
 * Each entry defines a recurring, stateful position-lifecycle strategy (e.g. a
 * cash-secured put ladder). The open pass iterates this registry and opens a
 * position for every instance due on the current market date.
 */

import {
  PositionSpreadType,
  StrategyFrequency,
} from '@options/common';
import type { StrategyInstanceConfig } from './types';

export const STRATEGY_INSTANCES: readonly StrategyInstanceConfig[] = [
  {
    id: 'QQQM-WHEEL',
    symbol: 'QQQM',
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.2,
        dteMin: 21,
        dteMax: 30,
      },
      // Future phase: covered-call leg after share assignment.
      // {
      //   spreadType: PositionSpreadType.COVERED_CALL,
      //   targetDelta: 0.3,
      //   dteMin: 21,
      //   dteMax: 30,
      // },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '12:00',
    exitCriteria: null,
  },
];

/**
 * Look up a strategy instance by its composite id (e.g. "QQQM-WHEEL").
 */
export function getStrategyInstance(id: string): StrategyInstanceConfig | undefined {
  return STRATEGY_INSTANCES.find((instance) => instance.id === id);
}
