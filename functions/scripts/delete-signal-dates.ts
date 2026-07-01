/**
 * Delete Signal-Dates Collections
 *
 * One-time cleanup script: deletes every document in the `signal-dates`
 * subcollection for every rh-agent symbol, then verifies nothing remains.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/delete-signal-dates.ts [--dry-run] [--symbol <ticker>]
 *
 * Options:
 *   --dry-run          Print what would be deleted, no Firestore writes.
 *   --symbol <ticker>  Process a single symbol only.
 */
import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run');

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const SYMBOL_ARG = argValue('--symbol');

// ---------------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------------

function initFirestore(): Firestore {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
  const repoRoot  = path.resolve(scriptDir, '..', '..');

  const keyPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(repoRoot, 'keys', 'rel-str-firebase-adminsdk.json'),
    path.join(repoRoot, 'keys', 'rel-str-partner-caller-prod.json'),
    path.join(repoRoot, 'functions', 'service-account-key.json'),
  ].filter((p): p is string => !!p);

  for (const keyPath of keyPaths) {
    try {
      if (fs.existsSync(keyPath)) {
        const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        const app = initializeApp({ credential: cert(sa), projectId: 'rel-str' });
        console.log(`✓ Firebase initialized with: ${path.basename(keyPath)}`);
        return getFirestore(app);
      }
    } catch (_) {}
  }

  const app = initializeApp({ credential: applicationDefault(), projectId: 'rel-str' });
  console.log('✓ Firebase initialized with Application Default Credentials');
  return getFirestore(app);
}

const db = initFirestore();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYMBOLS_COLLECTION = 'rh-agent-symbols';
const SIGNAL_DATES_SUB   = 'signal-dates';
const BATCH_SIZE         = 400;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== Delete signal-dates Collections ===');
  console.log(`Mode:     ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Symbol:   ${SYMBOL_ARG ?? 'all'}\n`);

  // Fetch symbol list
  let symbolIds: string[];
  if (SYMBOL_ARG) {
    symbolIds = [SYMBOL_ARG.toUpperCase()];
  } else {
    const snap = await db.collection(SYMBOLS_COLLECTION).get();
    symbolIds = snap.docs.map(d => d.id);
  }
  console.log(`Found ${symbolIds.length} symbol(s).\n`);

  let totalDeleted = 0;
  let totalErrors = 0;

  for (const symbol of symbolIds) {
    try {
      const deleted = await deleteSignalDates(symbol);
      totalDeleted += deleted;
      if (deleted > 0) {
        console.log(`  ${symbol}: deleted ${deleted} doc(s)`);
      } else {
        console.log(`  ${symbol}: nothing to delete`);
      }
    } catch (err: any) {
      console.error(`  ${symbol}: ERROR — ${err?.message}`);
      totalErrors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Symbols:  ${symbolIds.length}`);
  console.log(`${DRY_RUN ? 'Would delete' : 'Deleted'}:  ${totalDeleted}`);
  console.log(`Errors:   ${totalErrors}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No documents were actually deleted.');
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

async function deleteSignalDates(symbol: string): Promise<number> {
  const collRef = db
    .collection(SYMBOLS_COLLECTION)
    .doc(symbol)
    .collection(SIGNAL_DATES_SUB);

  console.log(`    querying: ${collRef.path}`);
  const snap = await collRef.get();
  console.log(`    found: ${snap.size} doc(s)`);
  if (snap.empty) return 0;

  if (DRY_RUN) {
    for (const doc of snap.docs) {
      console.log(`    [dry-run] would delete: ${doc.ref.path}`);
    }
    return snap.size;
  }

  // Delete in batches
  let deleted = 0;
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = docs.slice(i, i + BATCH_SIZE);
    for (const doc of chunk) {
      batch.delete(doc.ref);
    }
    await batch.commit();
    deleted += chunk.length;
  }

  return deleted;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
