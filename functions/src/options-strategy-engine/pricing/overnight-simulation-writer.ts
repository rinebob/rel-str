/**
 * @topic #114 — Options Strategy Engine — Hybrid Quote Provider
 *
 * Persistence for the overnight delta simulation on a strategy instance's
 * daily-analysis document.
 */

import { db } from '../../firebase-admin-init';
import { OPTIONS_STRATEGY_INSTANCES_COLLECTION } from '../collections';
import type { OvernightDeltaSimulation } from '@options-strategy-engine/contracts';

export type OvernightSimulationWriter = (
  instanceId: string,
  date: string,
  simulation: OvernightDeltaSimulation,
) => Promise<void>;

export function createDefaultOvernightSimulationWriter(): OvernightSimulationWriter {
  return async (instanceId, date, simulation) => {
    await db
      .collection(OPTIONS_STRATEGY_INSTANCES_COLLECTION)
      .doc(instanceId)
      .collection('daily-analysis')
      .doc(date)
      .set({ overnightDeltaSimulation: simulation }, { merge: true });
  };
}

export async function persistOvernightDeltaSimulation(
  instanceId: string,
  date: string,
  simulation: OvernightDeltaSimulation,
  write: OvernightSimulationWriter = createDefaultOvernightSimulationWriter(),
): Promise<void> {
  await write(instanceId, date, simulation);
}
