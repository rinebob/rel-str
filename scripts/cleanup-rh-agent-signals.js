#!/usr/bin/env node
/**
 * RH Agent Signal Cleanup Script
 *
 * One-time migration script to clear old Firestore signal data and prepare
 * for the new signal-dates structure (rh-agent-symbols/{symbol}/signal-dates/{barDate}).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AUTHENTICATION
 * ─────────────────────────────────────────────────────────────────────────────
 * This script connects directly to production Firestore. It authenticates via:
 *
 *   1. GOOGLE_APPLICATION_CREDENTIALS env var (if set to a service account key path)
 *   2. A key file at keys/rel-str-firebase-adminsdk.json (if present)
 *   3. Application Default Credentials (ADC) — the standard fallback
 *
 * To use ADC (recommended — no key file needed):
 *   gcloud auth application-default login
 *
 * If gcloud is not installed: https://cloud.google.com/sdk/docs/install
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USAGE
 * ─────────────────────────────────────────────────────────────────────────────
 *   node scripts/cleanup-rh-agent-signals.js [options]
 *
 * Options:
 *   --dry-run            Print counts of what would be deleted without writing
 *   --skip-runs          Skip deleting rh-agent-runs docs (keep run history)
 *   --skip-signal-dates  Skip deleting signal-dates subcollection (keep new data)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 * ─────────────────────────────────────────────────────────────────────────────
 *   Step 1  Delete rh-agent-symbols/{symbol}/signals        (old subcollection)
 *   Step 2  Delete rh-agent-symbols/{symbol}/signal-dates   (new — omit with --skip-signal-dates)
 *   Step 3  Clear lastDailySignalDate + lastWeeklySignalDate on all symbol docs
 *   Step 4  Delete rh-agent-runs                            (omit with --skip-runs)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * RECOMMENDED WORKFLOW
 * ─────────────────────────────────────────────────────────────────────────────
 *   1. Dry run to verify counts:
 *        node scripts/cleanup-rh-agent-signals.js --dry-run
 *
 *   2. Execute cleanup:
 *        node scripts/cleanup-rh-agent-signals.js
 *
 *   3. Deploy Firestore rules (adds signal-dates subcollection rule):
 *        firebase deploy --only firestore:rules
 *
 *   4. Trigger agent manual runs for the desired date range from the dashboard.
 *      New signals will be written to signal-dates/{barDate} with INTERIM/CONFIRMED status.
 */

const path = require('path');
const admin = require(path.join(__dirname, '..', 'functions', 'node_modules', 'firebase-admin'));

const DRY_RUN = process.argv.includes('--dry-run');
const SKIP_RUNS = process.argv.includes('--skip-runs');
const SKIP_SIGNAL_DATES = process.argv.includes('--skip-signal-dates');
const BATCH_SIZE = 400; // Firestore batch limit is 500

// --- Init ---
const fs = require('fs');

const envKey = process.env.GOOGLE_APPLICATION_CREDENTIALS;
const serviceAccountPaths = [
  ...(envKey ? [envKey] : []),
  path.join(__dirname, '..', 'keys', 'rel-str-firebase-adminsdk.json'),
  path.join(__dirname, '..', 'keys', 'rel-str-partner-caller-prod.json'),
  path.join(__dirname, '..', 'functions', 'service-account-key.json'),
];

let serviceAccount;
let usedPath;
for (const keyPath of serviceAccountPaths) {
  try {
    if (fs.existsSync(keyPath)) {
      serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      usedPath = keyPath;
      break;
    }
  } catch (_) {}
}

if (serviceAccount) {
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount), projectId: 'rel-str' });
  console.log(`✓ Firebase initialized with: ${path.basename(usedPath)}`);
} else {
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: 'rel-str' });
  console.log('✓ Firebase initialized with Application Default Credentials');
}

const db = admin.firestore();

// --- Helpers ---

/**
 * Delete all documents in a collection in batched chunks.
 * @param {FirebaseFirestore.CollectionReference} collRef Collection to clear.
 * @param {string} label Progress label for console output.
 */
async function deleteCollection(collRef, label) {
  let total = 0;
  let snap;
  do {
    snap = await collRef.limit(BATCH_SIZE).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach(d => batch.delete(d.ref));

    if (!DRY_RUN) await batch.commit();
    total += snap.docs.length;
    process.stdout.write(`\r  ${label}: ${total} deleted...`);
  } while (snap.docs.length === BATCH_SIZE);

  if (total > 0) console.log(`\r  ${label}: ${total} deleted.      `);
  return total;
}

/**
 * Clear lastDailySignalDate and lastWeeklySignalDate from all symbol docs.
 * @param {FirebaseFirestore.QueryDocumentSnapshot[]} symbolDocs Array of symbol documents.
 */
async function clearSymbolGateDates(symbolDocs) {
  let total = 0;
  for (let i = 0; i < symbolDocs.length; i += BATCH_SIZE) {
    const chunk = symbolDocs.slice(i, i + BATCH_SIZE);
    const batch = db.batch();
    for (const doc of chunk) {
      batch.update(doc.ref, {
        lastDailySignalDate: admin.firestore.FieldValue.delete(),
        lastWeeklySignalDate: admin.firestore.FieldValue.delete(),
      });
    }
    if (!DRY_RUN) await batch.commit();
    total += chunk.length;
    process.stdout.write(`\r  Clearing gate dates: ${total}/${symbolDocs.length}...`);
  }
  console.log(`\r  Clearing gate dates: ${total} symbols updated.      `);
}

// --- Main ---

/** Run the signal cleanup sequence. */
async function main() {
  console.log(`\n=== RH Agent Signal Cleanup${DRY_RUN ? ' [DRY RUN]' : ''} ===\n`);

  // 1. Load all symbol docs
  console.log('Loading rh-agent-symbols...');
  const symbolsSnap = await db.collection('rh-agent-symbols').get();
  const symbolDocs = symbolsSnap.docs;
  console.log(`  Found ${symbolDocs.length} symbol docs.\n`);

  // 2. Delete old signals subcollection per symbol
  console.log('Step 1: Deleting old signals subcollection (rh-agent-symbols/{s}/signals)...');
  let totalOldSignals = 0;
  for (const symbolDoc of symbolDocs) {
    const signalsRef = symbolDoc.ref.collection('signals');
    const count = await deleteCollection(signalsRef, `  ${symbolDoc.id}/signals`);
    totalOldSignals += count;
  }
  console.log(`  → Total old signal docs deleted: ${totalOldSignals}\n`);

  // 3. Optionally delete new signal-dates subcollection per symbol
  if (!SKIP_SIGNAL_DATES) {
    console.log('Step 2: Deleting signal-dates subcollection (rh-agent-symbols/{s}/signal-dates)...');
    let totalSignalDates = 0;
    for (const symbolDoc of symbolDocs) {
      const datesRef = symbolDoc.ref.collection('signal-dates');
      const count = await deleteCollection(datesRef, `  ${symbolDoc.id}/signal-dates`);
      totalSignalDates += count;
    }
    console.log(`  → Total signal-dates docs deleted: ${totalSignalDates}\n`);
  } else {
    console.log('Step 2: Skipping signal-dates deletion (--skip-signal-dates).\n');
  }

  // 4. Clear gate dates on symbol docs
  console.log('Step 3: Clearing lastDailySignalDate + lastWeeklySignalDate on symbol docs...');
  await clearSymbolGateDates(symbolDocs);
  console.log('');

  // 5. Optionally delete run history
  if (!SKIP_RUNS) {
    console.log('Step 4: Deleting rh-agent-runs...');
    const runsRef = db.collection('rh-agent-runs');
    const total = await deleteCollection(runsRef, 'rh-agent-runs');
    console.log(`  → Total run docs deleted: ${total}\n`);
  } else {
    console.log('Step 4: Skipping rh-agent-runs deletion (--skip-runs).\n');
  }

  console.log(`=== Done${DRY_RUN ? ' [DRY RUN — no changes written]' : ''} ===\n`);
}

main().catch(err => {
  console.error('\n✗ Fatal error:', err);
  process.exit(1);
});
