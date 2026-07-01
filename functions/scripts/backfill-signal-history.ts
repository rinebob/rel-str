/**
 * Backfill Signal History from Signal Dates
 *
 * One-time migration script: copies existing signal-dates docs into signal-history
 * for all rh-agent-symbols. This seeds historical chart markers so the chart rendering
 * step (step 4) can switch over without leaving historical bars blank.
 *
 * Source:  rh-agent-symbols/{symbol}/signal-dates/{barDate}
 * Target:  rh-agent-symbols/{symbol}/signal-history/{barDate}
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/backfill-signal-history.ts [--dry-run] [--symbol AAPL]
 *
 * Flags:
 *   --dry-run          Print what would be written without writing anything.
 *   --symbol <ticker>  Backfill a single symbol only (useful for testing).
 */
import { initializeApp, cert, applicationDefault, App } from 'firebase-admin/app';
import { getFirestore, Firestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes('--dry-run');
const SYMBOL_ARG_IDX = process.argv.indexOf('--symbol');
const SINGLE_SYMBOL = SYMBOL_ARG_IDX !== -1 ? process.argv[SYMBOL_ARG_IDX + 1] : null;

const SYMBOLS_COLLECTION = 'rh-agent-symbols';
const SIGNAL_DATES_SUB = 'signal-dates';
const SIGNAL_HISTORY_SUB = 'signal-history';

// Firestore batch limit
const BATCH_SIZE = 400;

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

function initFirestore(): Firestore {
  const scriptDir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
  const repoRoot = path.resolve(scriptDir, '..', '..');

  const keyPaths = [
    process.env.GOOGLE_APPLICATION_CREDENTIALS,
    path.join(repoRoot, 'keys', 'rel-str-firebase-adminsdk.json'),
    path.join(repoRoot, 'keys', 'rel-str-partner-caller-prod.json'),
    path.join(repoRoot, 'functions', 'service-account-key.json'),
  ].filter(Boolean) as string[];

  let app: App;
  for (const keyPath of keyPaths) {
    try {
      if (fs.existsSync(keyPath)) {
        const sa = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
        app = initializeApp({ credential: cert(sa), projectId: 'rel-str' });
        console.log(`✓ Firebase initialized with: ${path.basename(keyPath)}`);
        return getFirestore(app);
      }
    } catch (_) {}
  }

  // Fall back to Application Default Credentials (gcloud auth application-default login)
  app = initializeApp({ credential: applicationDefault(), projectId: 'rel-str' });
  console.log('✓ Firebase initialized with Application Default Credentials');
  return getFirestore(app);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n=== Backfill signal-history from signal-dates ===`);
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
  if (SINGLE_SYMBOL) console.log(`Symbol filter: ${SINGLE_SYMBOL}`);
  console.log('');

  const db = initFirestore();

  // 1. Get symbol list
  const symbolsRef = db.collection(SYMBOLS_COLLECTION);
  const symbolsSnap = SINGLE_SYMBOL
    ? await symbolsRef.where('symbol', '==', SINGLE_SYMBOL).get()
    : await symbolsRef.get();

  if (symbolsSnap.empty) {
    console.log('No symbols found.');
    return;
  }

  const symbols = symbolsSnap.docs.map(d => d.id);
  console.log(`Found ${symbols.length} symbol(s) to process.\n`);

  let totalDocs = 0;
  let totalWritten = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Process symbols sequentially to avoid overwhelming Firestore
  for (const symbol of symbols) {
    try {
      const { written, skipped } = await backfillSymbol(db, symbol);
      totalDocs += written + skipped;
      totalWritten += written;
      totalSkipped += skipped;
    } catch (err: any) {
      console.error(`  [ERROR] ${symbol}: ${err?.message}`);
      totalErrors++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Symbols processed: ${symbols.length}`);
  console.log(`Docs examined:     ${totalDocs}`);
  console.log(`Docs written:      ${totalWritten}`);
  console.log(`Docs skipped:      ${totalSkipped} (already existed in signal-history)`);
  console.log(`Errors:            ${totalErrors}`);
  if (DRY_RUN) console.log('\n(DRY RUN — no data was written)');
}

// ---------------------------------------------------------------------------
// Per-symbol backfill
// ---------------------------------------------------------------------------

async function backfillSymbol(
  db: Firestore,
  symbol: string
): Promise<{ written: number; skipped: number }> {
  const signalDatesRef = db
    .collection(SYMBOLS_COLLECTION)
    .doc(symbol)
    .collection(SIGNAL_DATES_SUB);

  const signalDatesSnap = await signalDatesRef.get();

  if (signalDatesSnap.empty) {
    console.log(`  ${symbol}: no signal-dates docs — skip`);
    return { written: 0, skipped: 0 };
  }

  // Check which signal-history docs already exist
  const signalHistoryRef = db
    .collection(SYMBOLS_COLLECTION)
    .doc(symbol)
    .collection(SIGNAL_HISTORY_SUB);

  const existingSnap = await signalHistoryRef.get();
  const existingDates = new Set(existingSnap.docs.map(d => d.id));

  const toWrite = signalDatesSnap.docs.filter(d => !existingDates.has(d.id));
  const skipped = signalDatesSnap.docs.length - toWrite.length;

  if (toWrite.length === 0) {
    console.log(`  ${symbol}: all ${signalDatesSnap.docs.length} doc(s) already in signal-history — skip`);
    return { written: 0, skipped: signalDatesSnap.docs.length };
  }

  console.log(`  ${symbol}: ${toWrite.length} doc(s) to write, ${skipped} already exist`);

  if (DRY_RUN) {
    for (const d of toWrite) {
      console.log(`    [dry-run] would write signal-history/${d.id}`);
    }
    return { written: toWrite.length, skipped };
  }

  // Write in batches
  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const chunk = toWrite.slice(i, i + BATCH_SIZE);

    for (const sourceDoc of chunk) {
      const data = sourceDoc.data();
      const barDate = sourceDoc.id;

      // Build signal-history doc from signal-dates doc.
      // signal-dates stores signals as a nested map keyed by signalType.
      // signal-history uses the same structure, adding sourceRunId per entry.
      const signalsMap: Record<string, any> = {};
      const sourceRunId: string = data['runId'] ?? '';

      if (data['signals'] && typeof data['signals'] === 'object') {
        for (const [signalType, entry] of Object.entries(data['signals'])) {
          signalsMap[`signals.${signalType}`] = { ...(entry as object), sourceRunId };
        }
      }

      if (Object.keys(signalsMap).length === 0) {
        console.log(`    [skip] signal-history/${barDate} — no signals in source doc`);
        continue;
      }

      const historyDocRef = signalHistoryRef.doc(barDate);
      batch.set(
        historyDocRef,
        {
          symbol,
          date: barDate,
          updatedAt: Timestamp.now(),
          canonicalizedAt: Timestamp.now(),
          ...signalsMap,
        },
        { merge: true }
      );
      written++;
    }

    await batch.commit();
    console.log(`    wrote batch: ${written} / ${toWrite.length}`);
  }

  return { written, skipped };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
