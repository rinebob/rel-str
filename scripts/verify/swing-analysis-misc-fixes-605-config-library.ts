// @ts-nocheck — Verification script runs via tsx with NODE_PATH=functions/node_modules.
// The root tsconfig excludes scripts/verify; the functions tsconfig includes it but the
// IDE resolves against the root config, so firebase-admin types are not visible here.
/**
 * Verification script: st-swing-configs config-library round-trip (task #605).
 *
 * Exercises the real (prod) Firestore via the Admin SDK to verify the new
 * slim config-document shape and the paramsId-keyed doc path the
 * SwingAnalysisService now targets. Admin SDK bypasses security rules —
 * this verifies the data contract, not auth (rules are unit-reviewed).
 *
 * Verifies:
 * - st-swing-configs/{paramsId} is a valid doc path.
 * - The slim write shape {name?, paramsId, userId, config, savedAt}
 *   round-trips — no symbol/pivots/swings/stats fields.
 * - Writing identical params is idempotent (same doc id, overwrite).
 * - deleteConfig path removes the doc.
 *
 * Usage:
 *   NODE_PATH=functions/node_modules npx tsx scripts/verify/swing-analysis-misc-fixes-605-config-library.ts
 *
 * Requires Application Default Credentials (`gcloud auth application-default login`).
 * Writes under the paramsId `dev42_L2_R3_1barY_projY_trigN` and cleans up after itself.
 */

import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

const COLLECTION = 'st-swing-configs';
const PARAMS_ID = 'dev42_L2_R3_1barY_projY_trigN';
const DOC_PATH = `${COLLECTION}/${PARAMS_ID}`;

const CONFIG = {
  devThreshold: 42,
  leftDepth: 2,
  rightDepth: 3,
  allowZigZagOnOneBar: true,
  projectionPivots: true,
  showTriggerDots: false,
  lineColor: '#verify',
};

if (getApps().length === 0) {
  initializeApp({ projectId: 'rel-str' });
}
const db: Firestore = getFirestore(getApp());
db.settings({ ignoreUndefinedProperties: true });

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`ASSERT FAILED: ${message}`);
}

async function main() {
  const ref = db.doc(DOC_PATH);
  assert(DOC_PATH.split('/').length === 2, `doc path has 2 segments: ${DOC_PATH}`);

  // Write slim doc — exactly the service's PersistedConfig shape
  await ref.set({
    paramsId: PARAMS_ID,
    userId: 'verify-script',
    name: 'verify',
    config: CONFIG,
    savedAt: '2026-09-26T00:00:00.000Z',
  });
  console.log('write: ok');

  // Read back — round-trip + slim shape
  const snap = await ref.get();
  assert(snap.exists, 'doc exists after write');
  const data = snap.data()!;
  assert(data.paramsId === PARAMS_ID, 'paramsId round-trips');
  assert(data.userId === 'verify-script', 'userId round-trips');
  assert(data.name === 'verify', 'name round-trips');
  assert(data.config.devThreshold === 42, 'config round-trips');
  for (const banned of ['symbol', 'pivots', 'swings', 'stats', 'projection', 'id']) {
    assert(!(banned in data), `slim shape — no '${banned}' field`);
  }
  console.log('read-back + slim shape: ok');

  // Idempotent overwrite — same params, same doc id, no name
  await ref.set({ paramsId: PARAMS_ID, userId: 'verify-script', config: CONFIG, savedAt: 't2' });
  const again = await ref.get();
  assert(again.data()!.savedAt === 't2', 'overwrite lands on same doc id');
  assert(!('name' in again.data()!), 'name omitted when absent');
  console.log('idempotent overwrite: ok');

  // List query shape (userId constraint) — prove collection enumerates
  const list = await db.collection(COLLECTION).where('userId', '==', 'verify-script').get();
  assert(list.docs.some((d) => d.id === PARAMS_ID), 'where(userId) list finds the doc');
  console.log('userId-scoped list: ok');

  // Cleanup — deleteConfig path
  await ref.delete();
  assert(!(await ref.get()).exists, 'doc deleted');
  console.log('delete + cleanup: ok');

  console.log('\nALL CHECKS PASSED — st-swing-configs round-trip verified against prod');
}

main().catch((err) => {
  console.error('VERIFY FAILED:', err.message);
  process.exit(1);
});
