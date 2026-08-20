/**
 * @topic #108 — Options Position Strategy Engine
 *
 * One-time seed script for the options strategy instance registry migration.
 *
 * Writes the legacy hardcoded QQQM-WHEEL instance to Firestore so the nightly
 * passes continue to process it after the registry is removed from code.
 *
 * Usage:
 *   npx tsx functions/scripts/seed-options-strategy-instances.ts
 */

import { db } from '../src/firebase-admin-init';
import { OPTIONS_STRATEGY_INSTANCES_COLLECTION } from '../src/options-strategy-engine/collections';
import { OptionType, PositionSpreadType, StrategyFrequency } from '../../shared/options-common';
import { TradeSide } from '../../shared/common';
import { ExitPolicy, LifecycleState } from '../../shared/options-strategy-engine-contracts';
import { generateInstanceId } from '../../shared/strategy-instance-id';

const createdAt = new Date('2025-08-16T00:00:00Z');
const symbol = 'QQQM';
const phases = [
  {
    spreadType: PositionSpreadType.CASH_SECURED_PUT,
    targetDelta: 0.2,
    dteMin: 21,
    dteMax: 30,
  },
  {
    spreadType: PositionSpreadType.COVERED_CALL,
    targetDelta: 0.3,
    dteMin: 21,
    dteMax: 30,
  },
];

const instanceId = generateInstanceId(
  createdAt,
  symbol,
  phases,
  StrategyFrequency.DAILY,
  '12:00',
);

const instance = {
  id: instanceId,
  symbol,
  optionType: OptionType.PUT,
  side: TradeSide.SHORT,
  targetDelta: 0.2,
  dteMin: 21,
  dteMax: 30,
  phases,
  frequency: StrategyFrequency.DAILY,
  openTimePT: '12:00',
  exitPolicies: [{ policy: ExitPolicy.WHEEL_IF_ASSIGNED }],
  lifecycleState: LifecycleState.ACTIVE,
  userId: 'system',
  createdAt: createdAt.toISOString(),
  updatedAt: createdAt.toISOString(),
};

async function main(): Promise<void> {
  const ref = db.collection(OPTIONS_STRATEGY_INSTANCES_COLLECTION).doc(instanceId);
  const existing = await ref.get();

  if (existing.exists) {
    console.log(`Instance ${instanceId} already exists; skipping.`);
    return;
  }

  await ref.set(instance);
  console.log(`Seeded instance ${instanceId} to ${OPTIONS_STRATEGY_INSTANCES_COLLECTION}.`);
}

main().catch((err) => {
  console.error('Seed failed:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
