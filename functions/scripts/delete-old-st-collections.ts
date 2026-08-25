/**
 * Delete Old RH Agent Firestore Collections
 *
 * One-time cleanup: deletes the deprecated `st-indicators` and `rs-symbol-cache`
 * data. `st-indicators` has orphaned subcollections (`st-zone/series`,
 * `st-trend-strength/series`, `st-trend-bands/series`) under symbol docs, so this
 * script uses collection-group queries to find them and deletes every descendant
 * before deleting the parent doc. `rs-symbol-cache` is a flat top-level collection.
 *
 * These collections are no longer used after the indicator-series refactor and can
 * cause the Firebase Console to become unresponsive.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/delete-old-st-collections.ts [--dry-run] [--collection <name>]
 *
 * Options:
 *   --dry-run                Print what would be deleted, no Firestore writes.
 *   --collection <name>      Delete only one collection (st-indicators or rs-symbol-cache).
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Firestore, QuerySnapshot } from 'firebase-admin/firestore';

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run');

function argValue(flag: string): string | null {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] ?? null : null;
}

const COLLECTION_ARG = argValue('--collection');

// ---------------------------------------------------------------------------
// Firebase init
// ---------------------------------------------------------------------------

function initFirestore(): Firestore {
  const app = initializeApp({ credential: applicationDefault(), projectId: 'rel-str' });
  console.log('✓ Firebase initialized with Application Default Credentials');
  return getFirestore(app);
}

const db = initFirestore();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_OLD_COLLECTIONS = ['st-indicators', 'rs-symbol-cache'];
const BATCH_SIZE = 400;
const QUERY_LIMIT = 400;

const ST_INDICATORS_SUBCOLLECTIONS = ['st-zone', 'st-trend-strength', 'st-trend-bands'];

const COLLECTIONS_TO_DELETE = COLLECTION_ARG
  ? [COLLECTION_ARG]
  : DEFAULT_OLD_COLLECTIONS;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('\n=== Delete Old RH Agent Collections ===');
  console.log(`Mode:        ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log(`Collections: ${COLLECTIONS_TO_DELETE.join(', ')}\n`);

  let totalDeleted = 0;
  let totalErrors = 0;

  for (const collectionName of COLLECTIONS_TO_DELETE) {
    try {
      const deleted = collectionName === 'st-indicators'
        ? await deleteStIndicators()
        : await deleteTopLevelCollection(collectionName);
      totalDeleted += deleted;
      console.log(`  ${collectionName}: ${DRY_RUN ? 'would delete' : 'deleted'} ${deleted} doc(s)`);
    } catch (err: any) {
      console.error(`  ${collectionName}: ERROR — ${err?.message}`);
      totalErrors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`${DRY_RUN ? 'Would delete' : 'Deleted'}: ${totalDeleted}`);
  console.log(`Errors:      ${totalErrors}`);

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No documents were actually deleted.');
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

/**
 * Delete every document in a top-level collection by repeatedly fetching and
 * deleting in batches. This avoids loading the entire collection into memory.
 */
async function deleteTopLevelCollection(collectionName: string): Promise<number> {
  const collRef = db.collection(collectionName);
  let deleted = 0;

  while (true) {
    const snap: QuerySnapshot = await collRef.limit(QUERY_LIMIT).get();
    if (snap.empty) break;

    const docs = snap.docs;

    if (DRY_RUN) {
      for (const doc of docs) {
        console.log(`    [dry-run] would delete: ${doc.ref.path}`);
      }
      deleted += docs.length;
      break; // In dry-run, report the first batch only to avoid infinite loops
    }

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + BATCH_SIZE);
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      deleted += chunk.length;
    }
  }

  return deleted;
}

/**
 * Delete `st-indicators` including its orphaned subcollections.
 *
 * The parent docs may have been deleted already, leaving subcollections behind.
 * We use a collection-group query on the `series` subcollection to discover every
 * symbol that still has data, then delete all known indicator subcollections and
 * the parent doc.
 */
async function deleteStIndicators(): Promise<number> {
  const symbols = await discoverStIndicatorSymbols();
  console.log(`  discovered ${symbols.size} symbol(s) with st-indicators subcollections`);

  let deleted = 0;

  for (const symbol of symbols) {
    const parentRef = db.collection('st-indicators').doc(symbol);

    for (const subName of ST_INDICATORS_SUBCOLLECTIONS) {
      const subDeleted = await deleteSubcollection(parentRef.collection(subName));
      deleted += subDeleted;
    }

    // Delete the parent doc if it exists
    if (DRY_RUN) {
      console.log(`    [dry-run] would delete parent: ${parentRef.path}`);
      deleted += 1;
    } else {
      try {
        await parentRef.delete();
        deleted += 1;
      } catch (err: any) {
        console.warn(`    [warn] could not delete parent ${parentRef.path}: ${err?.message}`);
      }
    }
  }

  return deleted;
}

/**
 * Discover all symbols that still have st-indicators subcollections.
 *
 * The indicator docs live under `st-indicators/{symbol}/{st-zone|st-trend-strength|st-trend-bands}/series`.
 * We use collection-group queries on those subcollection names and keep only the
 * paths rooted at `st-indicators`.
 */
async function discoverStIndicatorSymbols(): Promise<Set<string>> {
  const symbols = new Set<string>();

  for (const subName of ST_INDICATORS_SUBCOLLECTIONS) {
    const snap = await db.collectionGroup(subName).limit(10000).get();
    for (const doc of snap.docs) {
      const parts = doc.ref.path.split('/');
      if (parts.length >= 4 && parts[0] === 'st-indicators') {
        symbols.add(parts[1]);
      }
    }
  }

  return symbols;
}

/**
 * Delete every document in a subcollection in batches.
 */
async function deleteSubcollection(collRef: ReturnType<Firestore['collection']>): Promise<number> {
  let deleted = 0;

  while (true) {
    const snap = await collRef.limit(QUERY_LIMIT).get();
    if (snap.empty) break;

    const docs = snap.docs;

    if (DRY_RUN) {
      for (const doc of docs) {
        console.log(`    [dry-run] would delete: ${doc.ref.path}`);
      }
      deleted += docs.length;
      break; // In dry-run, report the first batch only to avoid infinite loops
    }

    for (let i = 0; i < docs.length; i += BATCH_SIZE) {
      const batch = db.batch();
      const chunk = docs.slice(i, i + BATCH_SIZE);
      for (const doc of chunk) {
        batch.delete(doc.ref);
      }
      await batch.commit();
      deleted += chunk.length;
    }
  }

  return deleted;
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
