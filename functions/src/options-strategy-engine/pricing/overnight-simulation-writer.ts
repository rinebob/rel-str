/**
 *
 * Persistence for the overnight delta simulation on a strategy instance's
 * daily-analysis document.
 *
 * Writes to two docs:
 * - `daily-analysis/latest` — the operational doc the open pass reads each
 *   morning. Overwritten nightly so the open pass never needs to resolve a
 *   prior trading date.
 * - `daily-analysis/{date}` — dated archive for historical queries.
 */

import { db } from '../../firebase-admin-init';
import { OPTIONS_STRATEGY_INSTANCES_COLLECTION } from '../collections';
import type { OvernightDeltaSimulation } from '@options-strategy-engine/contracts';

export const LATEST_DAILY_ANALYSIS_DOC_ID = 'latest';

export type OvernightSimulationWriter = (
  instanceId: string,
  date: string,
  simulation: OvernightDeltaSimulation,
) => Promise<void>;

export function createDefaultOvernightSimulationWriter(): OvernightSimulationWriter {
  return async (instanceId, date, simulation) => {
    const dailyAnalysisCol = db
      .collection(OPTIONS_STRATEGY_INSTANCES_COLLECTION)
      .doc(instanceId)
      .collection('daily-analysis');

    const payload = { overnightDeltaSimulation: simulation };

    // Operational doc (overwritten nightly) + dated archive.
    await Promise.all([
      dailyAnalysisCol.doc(LATEST_DAILY_ANALYSIS_DOC_ID).set(payload, { merge: true }),
      dailyAnalysisCol.doc(date).set(payload, { merge: true }),
    ]);
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
