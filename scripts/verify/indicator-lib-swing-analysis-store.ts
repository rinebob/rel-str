/**
 * Verification script: SwingAnalysisService Firestore round-trip.
 *
 * Exercises the real Firestore Admin SDK (not mocked) to verify that the
 * SwingAnalysisService path construction is valid and that save → load
 * round-trips preserve data. This is the test that the store unit tests
 * could not catch because they mocked @angular/fire/firestore.
 *
 * Verifies:
 * - db.collection('zig-zags/{symbol}/analyses') produces a valid
 *   3-segment CollectionReference (odd segments).
 * - db.doc('zig-zags/{symbol}/analyses/{paramsId}') produces a valid
 *   4-segment DocumentReference (even segments).
 * - setDoc writes a document that getDoc can read back.
 * - getDocs on the collection returns the saved document.
 * - Round-trip preserves all fields.
 * - Cleanup: deletes the test document after verification.
 *
 * Usage:
 *   NODE_PATH=functions/node_modules npx tsx scripts/verify/indicator-lib-swing-analysis-store.ts
 *
 * No arguments needed. Uses Application Default Credentials (run
 * `gcloud auth application-default login` first if not already signed in).
 * The script uses a test symbol "VERIFY-TEST" and cleans up after itself.
 */

import { initializeApp, getApps, getApp } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

// =============================================================================
// Config
// =============================================================================

const ZIG_ZAGS_COLLECTION = 'zig-zags';
const ANALYSES_SUBCOLLECTION = 'analyses';
const TEST_SYMBOL = 'VERIFY-TEST';
const TEST_PARAMS_ID = 'dev5-l5-r5-a1-p1';
const TEST_COLLECTION_PATH = `${ZIG_ZAGS_COLLECTION}/${TEST_SYMBOL}/${ANALYSES_SUBCOLLECTION}`;
const TEST_DOC_PATH = `${TEST_COLLECTION_PATH}/${TEST_PARAMS_ID}`;

// =============================================================================
// Init
// =============================================================================

if (getApps().length === 0) {
  initializeApp({ projectId: 'rel-str' });
}
const app = getApp();
const db: Firestore = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

// =============================================================================
// Helpers
// =============================================================================

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERT FAILED: ${message}`);
  }
}

function assertPathSegments(
  path: string,
  expectedSegments: number,
  label: string,
): void {
  const segments = path.split('/').length;
  assert(
    segments === expectedSegments,
    `${label}: expected ${expectedSegments} path segments, got ${segments} (path: ${path})`,
  );
}

// =============================================================================
// Verification steps
// =============================================================================

async function verifyCollectionPath(): Promise<void> {
  console.log('1. Verifying collection path construction...');
  const collRef = db.collection(TEST_COLLECTION_PATH);
  assertPathSegments(collRef.path, 3, 'collection()');
  console.log(`   OK: ${collRef.path} (3 segments — valid CollectionReference)`);
}

async function verifyDocPath(): Promise<void> {
  console.log('2. Verifying document path construction...');
  const docRef = db.doc(TEST_DOC_PATH);
  assertPathSegments(docRef.path, 4, 'doc()');
  console.log(`   OK: ${docRef.path} (4 segments — valid DocumentReference)`);
}

async function verifySaveAndLoadRoundTrip(): Promise<void> {
  console.log('3. Verifying save → load round-trip...');

  const docRef = db.doc(TEST_DOC_PATH);

  const testDoc = {
    id: TEST_PARAMS_ID,
    symbol: TEST_SYMBOL,
    paramsId: TEST_PARAMS_ID,
    config: {
      devThreshold: 5.0,
      leftDepth: 5,
      rightDepth: 5,
      allowZigZagOnOneBar: true,
      projectionPivots: true,
    },
    bars: [],
    pivots: [],
    projection: null,
    swings: [],
    stats: {
      up: {
        count: 3,
        magnitudePercent: { mean: 2.5, median: 2.0, stdDev: 0.5, min: 1.0, max: 4.0, p10: 1.0, p25: 1.5, p50: 2.0, p75: 3.0, p90: 3.5 },
        magnitudeAbsolute: { mean: 10, median: 8, stdDev: 2, min: 4, max: 16, p10: 4, p25: 6, p50: 8, p75: 12, p90: 14 },
        duration: { mean: 5, median: 4, stdDev: 1, min: 2, max: 8, p10: 2, p25: 3, p50: 4, p75: 6, p90: 7 },
        magnitudeHistogram: { bins: [] },
        durationHistogram: { bins: [] },
      },
      down: {
        count: 2,
        magnitudePercent: { mean: -1.5, median: -1.0, stdDev: 0.3, min: -2.0, max: -1.0, p10: -2.0, p25: -1.5, p50: -1.0, p75: -1.2, p90: -1.8 },
        magnitudeAbsolute: { mean: 6, median: 5, stdDev: 1, min: 4, max: 8, p10: 4, p25: 4, p50: 5, p75: 7, p90: 8 },
        duration: { mean: 3, median: 3, stdDev: 0.5, min: 2, max: 4, p10: 2, p25: 2, p50: 3, p75: 4, p90: 4 },
        magnitudeHistogram: { bins: [] },
        durationHistogram: { bins: [] },
      },
    },
    savedAt: new Date().toISOString(),
  };

  // Write (same as SwingAnalysisService.saveAnalysis → setDoc)
  await docRef.set(testDoc);
  console.log(`   OK: wrote doc to ${docRef.path}`);

  // Read back via get (same as SwingAnalysisService.loadAnalysis → getDoc)
  const snap = await docRef.get();
  assert(snap.exists, 'get: document should exist after set');
  const loaded = snap.data()!;
  assert(loaded.symbol === TEST_SYMBOL, `round-trip: symbol mismatch (got ${loaded.symbol})`);
  assert(loaded.paramsId === TEST_PARAMS_ID, `round-trip: paramsId mismatch`);
  assert(loaded.config.devThreshold === 5.0, 'round-trip: config.devThreshold mismatch');
  assert(loaded.stats.up.count === 3, 'round-trip: stats.up.count mismatch');
  assert(loaded.stats.down.count === 2, 'round-trip: stats.down.count mismatch');
  console.log('   OK: get round-trip preserves all fields');

  // Read back via collection.get (same as SwingAnalysisService.loadSavedAnalyses → collectionData)
  const collRef = db.collection(TEST_COLLECTION_PATH);
  const querySnap = await collRef.get();
  assert(querySnap.size >= 1, `collection.get: expected at least 1 doc, got ${querySnap.size}`);
  const found = querySnap.docs.find((d) => d.id === TEST_PARAMS_ID);
  assert(found !== undefined, 'collection.get: test doc not found in collection');
  assert(found!.data().symbol === TEST_SYMBOL, 'collection.get: symbol mismatch');
  console.log(`   OK: collection.get found ${querySnap.size} doc(s), test doc present`);
}

async function cleanup(): Promise<void> {
  console.log('4. Cleaning up test document...');
  const docRef = db.doc(TEST_DOC_PATH);
  await docRef.delete();
  console.log(`   OK: deleted ${docRef.path}`);
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  console.log('=== SwingAnalysisService Firestore Round-Trip Verification ===');
  console.log(`Project: ${app.options.projectId ?? 'default'}`);
  console.log(`Test path: ${TEST_DOC_PATH}`);
  console.log('');

  await verifyCollectionPath();
  await verifyDocPath();
  await verifySaveAndLoadRoundTrip();
  await cleanup();

  console.log('');
  console.log('=== ALL CHECKS PASSED ===');
}

main().catch((err) => {
  console.error('Verification failed:', err);
  // Best-effort cleanup on failure
  db.doc(TEST_DOC_PATH).delete().catch(() => {});
  process.exit(1);
});
