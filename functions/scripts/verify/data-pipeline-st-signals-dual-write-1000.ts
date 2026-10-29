/**
 * RETIRED — the legacy savant-trader/data/symbols evidence this relay
 * verified against was archived + deleted at #1019 ship (see
 * functions/scripts/output/legacy-archive-1013/). Unregistered from
 * run-all; kept for reference.
 *
 * Read-only dual-write parity audit for #1000 — st-signals vs legacy
 * run-ids subcollection.
 *
 * For every tracked symbol, reads `savant-trader/data/symbols/{SYM}/run-ids`
 * docs whose `marketDate` equals the target date (the legacy real-time
 * path — every run writes here, nightly included). Each `signals.{type}`
 * entry is an expected canonical occurrence: the script asserts
 *
 *   1. `st-signals/{SYM}_{barDate}_{signalType}` exists
 *   2. `runIds` contains that run's runId (deduped)
 *   3. `status` equals the legacy entry's status (barStatus-resolved)
 *   4. `direction` is the normalized TradeSide of the legacy 'LONG'/'SHORT'
 *   5. `marketDate`/`sourceRunId` are the FIRST detection's — i.e.
 *      sourceRunId ∈ runIds and the sourceRunId run-ids doc's own
 *      marketDate equals the doc's marketDate
 *
 * Run AFTER a deployed run completes for the date (intraday or nightly —
 * the nightly run also writes run-ids before signal-history).
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-st-signals-dual-write-1000.ts <marketDate> [SYMBOL]
 *
 * marketDate  YYYY-MM-DD — defaults to today PT
 * SYMBOL      optional — restrict to one symbol (e.g. ADPT)
 *
 * Read-only — never writes. Exit 0 when every expected occurrence checks
 * out; nonzero on any missing doc or field mismatch.
 */
import { db } from '../../src/firebase-admin-init';
import {
  ST_SYMBOLS_COLLECTION,
  ST_RUN_IDS_SUBCOLLECTION,
  ST_SIGNALS_ROOT,
} from '../../src/common/st-collections';
import { signalEntriesFromDoc } from '../../src/st-cloud-function/signals';
import { stSignalOccurrenceId } from '@st/ids';
import { normalizeStSignalDirection } from '@st/signals';

const marketDate =
  process.argv[2] ??
  new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
const onlySymbol = process.argv[3]?.toUpperCase();

interface ExpectedOccurrence {
  symbol: string;
  runId: string;
  barDate: string;
  signalType: string;
  status: string;
  direction: string;
}

let symbols: string[];
if (onlySymbol) {
  symbols = [onlySymbol];
} else {
  const snap = await db.collection(ST_SYMBOLS_COLLECTION).get();
  symbols = snap.docs.map((d) => d.id);
}

console.log(`st-signals dual-write audit — marketDate ${marketDate}, ${symbols.length} symbol(s)\n`);

const expected: ExpectedOccurrence[] = [];
const runDocMarketDate = new Map<string, string>(); // `${SYM}/${runId}` → marketDate

for (const symbol of symbols) {
  const runsSnap = await db
    .collection(ST_SYMBOLS_COLLECTION)
    .doc(symbol)
    .collection(ST_RUN_IDS_SUBCOLLECTION)
    .where('marketDate', '==', marketDate)
    .get();

  for (const runDoc of runsSnap.docs) {
    runDocMarketDate.set(`${symbol}/${runDoc.id}`, runDoc.get('marketDate'));
    const entries = signalEntriesFromDoc(runDoc.data());
    for (const [signalType, entry] of Object.entries(entries)) {
      expected.push({
        symbol,
        runId: runDoc.id,
        barDate: entry.barDate,
        signalType,
        status: entry.status,
        direction: String(entry.direction),
      });
    }
  }
}

// One canonical doc serves every run that (re)detected it — same-day
// intraday INTERIM + nightly CONFIRMED are two legacy rows for ONE
// occurrence. Collapse to per-occurrence expectations: runIds must contain
// every run that detected it; expected status is the most-resolved one
// (CONFIRMED wins — the nightly write legitimately upgrades the doc).
const byOccurrence = new Map<string, { runIds: Set<string>; status: string; direction: string; symbol: string; barDate: string; signalType: string }>();
const malformed: string[] = [];
for (const exp of expected) {
  let id: string;
  try {
    id = stSignalOccurrenceId(exp.symbol, exp.barDate, exp.signalType);
  } catch (err) {
    malformed.push(`MALFORMED ${exp.symbol} barDate='${exp.barDate}' type='${exp.signalType}' run=${exp.runId} — ${String(err)}`);
    continue;
  }
  const agg = byOccurrence.get(id) ?? {
    runIds: new Set<string>(),
    status: exp.status,
    direction: exp.direction,
    symbol: exp.symbol,
    barDate: exp.barDate,
    signalType: exp.signalType,
  };
  agg.runIds.add(exp.runId);
  if (exp.status === 'CONFIRMED') agg.status = 'CONFIRMED';
  byOccurrence.set(id, agg);
}

console.log(`${expected.length} legacy entries → ${byOccurrence.size} unique occurrences\n`);

let ok = 0;
let missing = 0;
let mismatched = 0;
const failures: string[] = [];

for (const [id, exp] of byOccurrence) {
  const snap = await db.collection(ST_SIGNALS_ROOT).doc(id).get();
  const label = `${id} (runs: ${[...exp.runIds].join(', ')})`;

  if (!snap.exists) {
    missing++;
    failures.push(`MISSING  ${label}`);
    continue;
  }
  const doc = snap.data()!;

  const problems: string[] = [];
  const runIds = (doc.runIds as string[]) ?? [];
  for (const runId of exp.runIds) {
    if (!runIds.includes(runId)) problems.push(`runIds missing ${runId}`);
  }
  if (runIds.length !== new Set(runIds).size) problems.push('runIds has dupes');
  if (doc.status !== exp.status) problems.push(`status ${doc.status} ≠ expected ${exp.status}`);
  if (doc.direction !== normalizeStSignalDirection(exp.direction)) {
    problems.push(`direction ${doc.direction} ≠ ${normalizeStSignalDirection(exp.direction)}`);
  }
  const sourceRunId = doc.sourceRunId as string | undefined;
  if (!sourceRunId || !runIds.includes(sourceRunId)) {
    problems.push(`sourceRunId '${sourceRunId}' ∉ runIds`);
  } else {
    const srcMarketDate = runDocMarketDate.get(`${exp.symbol}/${sourceRunId}`);
    if (srcMarketDate !== undefined && srcMarketDate !== doc.marketDate) {
      problems.push(`marketDate ${doc.marketDate} ≠ source run's ${srcMarketDate}`);
    }
  }

  if (problems.length > 0) {
    mismatched++;
    failures.push(`MISMATCH ${label} — ${problems.join('; ')}`);
  } else {
    ok++;
  }
}

console.log(`ok=${ok} missing=${missing} mismatched=${mismatched} malformed=${malformed.length} total=${expected.length}\n`);
for (const f of failures) console.log(f);
for (const m of malformed) console.log(m);

if (expected.length === 0) {
  console.log('\nNo expected occurrences — nothing to verify (no run-ids docs for this date).');
} else if (missing === 0 && mismatched === 0 && malformed.length === 0) {
  console.log('\n=== DUAL-WRITE PARITY OK ===');
} else {
  console.log('\n=== PARITY FAILURES — see above ===');
  process.exit(1);
}
