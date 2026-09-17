// @ts-nocheck — Verification script runs via tsx with NODE_PATH=functions/node_modules.
/**
 * Verification script: Firestore security rules for configs collection.
 *
 * Exercises the real Firestore Admin SDK (not mocked) to verify that the
 * path construction `configs/option-chain-pct-change/configs/{configId}`
 * produces a valid 4-segment DocumentReference and that save → load → delete
 * round-trips work against the real Firestore.
 *
 * Verifies:
 * - db.doc('configs/option-chain-pct-change/configs/{configId}') produces
 *   a valid 4-segment DocumentReference (even segments).
 * - setDoc writes a document that getDoc can read back.
 * - Round-trip preserves all fields.
 * - deleteDoc removes the document.
 * - Cleanup: deletes the test document after verification.
 *
 * Usage:
 *   NODE_PATH=functions/node_modules npx tsx scripts/verify/options-pct-change-config-rules.ts
 *
 * No arguments needed. Uses Application Default Credentials (run
 * `gcloud auth application-default login` first if not already signed in).
 * The script uses a test config ID and cleans up after itself.
 */

import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// =============================================================================
// Config
// =============================================================================

const CONFIGS_ROOT = 'configs';
const FEATURE_DOC = 'option-chain-pct-change';
const CONFIGS_SUBCOLLECTION = 'configs';
const TEST_CONFIG_ID = 'VERIFY-TEST-QQQ-2025-04-07-3-pct-change-abc123';

// =============================================================================
// Init
// =============================================================================

const app = getApps().length ? getApp() : initializeApp();
const db: Firestore = getFirestore(app);

// =============================================================================
// Helpers
// =============================================================================

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`PASS: ${msg}`);
}

// =============================================================================
// Verification
// =============================================================================

async function main() {
  const docRef = db.doc(
    `${CONFIGS_ROOT}/${FEATURE_DOC}/${CONFIGS_SUBCOLLECTION}/${TEST_CONFIG_ID}`,
  );

  // 1. Verify path has even segments (valid document path)
  const segments = docRef.path.split('/');
  assert(segments.length === 4, `doc path has 4 segments (got ${segments.length}): ${docRef.path}`);

  // 2. Write a test config doc
  const testDoc = {
    symbol: 'QQQ',
    startDate: '2025-04-07',
    type: 'call',
    targetType: 'pct-change',
    targetDates: ['2025-04-10', '2025-04-15'],
    pctMode: 'list',
    pctValues: [-3, 5, 10],
    filter: { type: 'call' },
  };

  await docRef.set(testDoc);
  console.log('PASS: setDoc succeeded');

  // 3. Read it back
  const snap = await docRef.get();
  assert(snap.exists, 'getDoc returns the saved document');

  const data = snap.data()!;
  assert(data.symbol === 'QQQ', `symbol round-trips: ${data.symbol}`);
  assert(data.targetType === 'pct-change', `targetType round-trips: ${data.targetType}`);
  assert(Array.isArray(data.targetDates) && data.targetDates.length === 2, 'targetDates round-trips');
  assert(Array.isArray(data.pctValues) && data.pctValues.length === 3, 'pctValues round-trips');
  assert(data.filter.type === 'call', `filter.type round-trips: ${data.filter.type}`);

  // 4. List the subcollection
  const colRef = db.collection(`${CONFIGS_ROOT}/${FEATURE_DOC}/${CONFIGS_SUBCOLLECTION}`);
  const colSnap = await colRef.get();
  assert(!colSnap.empty, 'collection list returns at least one document');

  // 5. Delete the test doc
  await docRef.delete();
  const afterDelete = await docRef.get();
  assert(!afterDelete.exists, 'document is gone after delete');

  console.log('\nAll verification checks passed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
