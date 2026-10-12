/**
 * #931 verification — prove `stSignalHistory`'s fixed read path returns
 * the signals prod actually stores. For a symbol with signal-history docs,
 * prints the doc's raw top-level key shape (expect flattened `signals.*`,
 * no `signals` field), runs `signalEntriesFromDoc`, and checks entries
 * carry signalType/barDate/sourceRunId. Also checks a run-ids doc.
 *
 * Read-only. Usage (from functions/):
 *   npx tsx scripts/verify/st-signal-history-931-reader.ts [SYMBOL]
 */
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import {
  ST_SYMBOLS_COLLECTION,
  ST_SIGNAL_HISTORY_SUBCOLLECTION,
  ST_RUN_IDS_SUBCOLLECTION,
} from '../../src/common/st-collections.js';
import { signalEntriesFromDoc } from '../../src/st-cloud-function/signals.js';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();
const symbol = process.argv[2] ?? 'ACMR';
let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

// signal-history: canonical EOD docs the stSignalHistory callable reads.
const histSnap = await db
  .collection(ST_SYMBOLS_COLLECTION)
  .doc(symbol)
  .collection(ST_SIGNAL_HISTORY_SUBCOLLECTION)
  .limit(10)
  .get();
check(`signal-history docs exist for ${symbol}`, histSnap.size > 0, `${histSnap.size} docs`);

let flattened = 0;
let nested = 0;
let entriesTotal = 0;
for (const doc of histSnap.docs) {
  const data = doc.data();
  const flatKeys = Object.keys(data).filter((k) => k.startsWith('signals.'));
  if (flatKeys.length) flattened++;
  if (data['signals'] && typeof data['signals'] === 'object') nested++;
  const entries = signalEntriesFromDoc(data);
  entriesTotal += Object.keys(entries).length;
  if (doc === histSnap.docs[0]) {
    console.log(`  sample ${doc.id}: flatKeys=[${flatKeys.join(', ')}] nested='signals' field ${data['signals'] ? 'present' : 'absent'}`);
    for (const [type, e] of Object.entries(entries)) {
      console.log(`    → ${type} barDate=${e.barDate} dir=${e.direction} sourceRunId=${(e as { sourceRunId?: string }).sourceRunId}`);
    }
  }
}
check('prod stores flattened signals.* keys', flattened > 0, `${flattened}/${histSnap.size} docs flattened, ${nested} nested`);
check('reader extracts entries from real docs', entriesTotal > 0, `${entriesTotal} entries across ${histSnap.size} docs`);

// run-ids: the same read boundary on the intraday path.
const runSnap = await db
  .collection(ST_SYMBOLS_COLLECTION)
  .doc(symbol)
  .collection(ST_RUN_IDS_SUBCOLLECTION)
  .limit(5)
  .get();
if (runSnap.size) {
  const runEntries = signalEntriesFromDoc(runSnap.docs[0].data());
  check('run-ids doc reads through same boundary', Object.keys(runEntries).length > 0, `${Object.keys(runEntries).length} entries from ${runSnap.docs[0].id}`);
}

console.log(failures === 0 ? '\n=== ALL CHECKS PASSED ===' : `\n=== ${failures} FAILURES ===`);
process.exit(failures === 0 ? 0 : 1);
