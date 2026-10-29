/**
 * RETIRED — the legacy savant-trader/data/symbols evidence this relay
 * verified against was archived + deleted at #1019 ship (see
 * functions/scripts/output/legacy-archive-1013/). Unregistered from
 * run-all; kept for reference.
 *
 * Read-only reader-equivalence relay for #1019 — proves the canonical
 * st-signals read paths return what the legacy run-ids / signal-history
 * reads returned, before the legacy parent is archived+deleted.
 *
 * Checks (all read-only, on a single run + sampled symbols):
 *   A. RUN-SCOPED SYMBOL SET — legacy collectionGroup('run-ids')
 *      where runId == R  vs  st-signals where runIds array-contains R.
 *      The symbol sets must be IDENTICAL (stGetSymbolsWithSignals semantic).
 *   B. RUN-SCOPED ENTRY SET — for each sampled symbol, legacy
 *      run-ids/{R} entry keys ({signalType}@{barDate}) vs st-signals
 *      (symbol == S AND runIds contains R) occurrence keys. IDENTICAL
 *      (getSymbolSignalsForRun / auto-paper getSignals semantic).
 *   C. HISTORY COVERAGE — for the sampled symbol, every legacy
 *      signal-history entry must have an st-signals counterpart (any
 *      status — legacy history itself carries INTERIM entries for open
 *      weekly/monthly periods). Canonical extras are allowed: INTERIM
 *      docs minted from run-ids-only occurrences are the new coverage.
 *      Status correctness (INTERIM vs CONFIRMED) is the #1001 audit's
 *      job — this check proves the new reader returns a superset of
 *      the legacy read.
 *
 * Floors: legacy sets must be non-empty — an empty source can never
 * produce a green pass (a wiped legacy root FAILs, it can't sign off).
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-st-signals-readers-1019.ts [--run ID] [--symbol SYM] [--sample N]
 *
 *   --run     runId to audit (default: newest st-runs doc by id)
 *   --symbol  restrict B/C to one symbol
 *   --sample  symbols sampled for B and C (default 10)
 *
 * Exit 0 on all checks passing; nonzero on any FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import {
  ST_RUNS_ROOT,
  ST_SYMBOLS_COLLECTION,
  ST_RUN_IDS_SUBCOLLECTION,
  ST_SIGNAL_HISTORY_SUBCOLLECTION,
  ST_SIGNALS_ROOT,
} from '../../src/common/st-collections';
import { signalEntriesFromDoc } from '../../src/st-cloud-function/signals';
import type { StSignal } from '@st/signals';

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const onlySymbol = arg('symbol')?.toUpperCase();
const SAMPLE = Number(arg('sample') ?? 10);
if (!Number.isInteger(SAMPLE) || SAMPLE < 1) {
  console.error(`--sample must be a positive integer, got '${arg('sample')}'`);
  process.exit(1);
}

const entryKey = (e: { signalType: string; barDate: string }): string =>
  `${e.signalType}@${e.barDate}`;

let failures = 0;
const ok = (label: string, detail: string): void => console.log(`OK   ${label} — ${detail}`);
const fail = (label: string, detail: string): void => {
  failures++;
  console.log(`FAIL ${label} — ${detail}`);
};

async function main(): Promise<void> {
  // Resolve the run to audit.
  let runId = arg('run');
  if (!runId) {
    const snap = await db.collection(ST_RUNS_ROOT).select().get();
    runId = snap.docs.map((d) => d.id).sort().pop();
    if (!runId) { console.error('no st-runs docs found'); process.exit(1); }
  }
  console.log(`st-signals reader-equivalence — runId ${runId}\n`);

  // ── A. run-scoped symbol set ────────────────────────────────────────────
  const legacyRunIds = await db
    .collectionGroup(ST_RUN_IDS_SUBCOLLECTION)
    .where('runId', '==', runId)
    .get();
  const legacySymbols = new Set(
    legacyRunIds.docs.map((d) => (d.data() as { symbol?: string }).symbol).filter(Boolean) as string[],
  );
  const canonicalSnap = await db
    .collection(ST_SIGNALS_ROOT)
    .where('runIds', 'array-contains', runId)
    .get();
  const canonicalSymbols = new Set(
    canonicalSnap.docs.map((d) => (d.data() as StSignal).symbol).filter(Boolean),
  );

  const missing = [...legacySymbols].filter((s) => !canonicalSymbols.has(s));
  const extra = [...canonicalSymbols].filter((s) => !legacySymbols.has(s));
  if (legacySymbols.size === 0) {
    fail('A run-scoped symbol set', 'legacy run-ids returned ZERO docs — no evidence');
  } else if (missing.length || extra.length) {
    fail('A run-scoped symbol set',
      `legacy=${legacySymbols.size} canonical=${canonicalSymbols.size} missing=[${missing}] extra=[${extra}]`);
  } else {
    ok('A run-scoped symbol set', `${canonicalSymbols.size} symbols identical`);
  }

  // ── B + C. per-symbol entry sets ─────────────────────────────────────────
  const sample = onlySymbol ? [onlySymbol] : [...legacySymbols].sort().slice(0, SAMPLE);
  let bChecked = 0;
  let bEntries = 0;
  const bDiffs: string[] = [];
  for (const sym of sample) {
    const legacyDoc = await db
      .collection(ST_SYMBOLS_COLLECTION).doc(sym)
      .collection(ST_RUN_IDS_SUBCOLLECTION).doc(runId)
      .get();
    const legacyKeys = new Set(
      legacyDoc.exists
        ? Object.values(signalEntriesFromDoc(legacyDoc.data() ?? {})).map(entryKey)
        : [],
    );
    const canon = await db
      .collection(ST_SIGNALS_ROOT)
      .where('symbol', '==', sym)
      .where('runIds', 'array-contains', runId)
      .get();
    const canonKeys = new Set(canon.docs.map((d) => entryKey(d.data() as StSignal)));
    bEntries += legacyKeys.size + canonKeys.size;
    const m = [...legacyKeys].filter((k) => !canonKeys.has(k));
    const x = [...canonKeys].filter((k) => !legacyKeys.has(k));
    if (m.length || x.length) bDiffs.push(`${sym} missing=[${m}] extra=[${x}]`);
    bChecked++;
  }
  if (bChecked === 0 || bEntries === 0) {
    fail('B run-scoped entry sets', `sample compared ZERO entries (${bChecked} symbols) — no evidence`);
  } else if (bDiffs.length) {
    fail('B run-scoped entry sets', `${bDiffs.length}/${bChecked} symbols diverged: ${bDiffs.slice(0, 3).join(' | ')}`);
  } else {
    ok('B run-scoped entry sets', `${bChecked} symbols identical`);
  }

  let cChecked = 0;
  let cInterim = 0;
  let cHistTotal = 0;
  const cDiffs: string[] = [];
  for (const sym of sample) {
    const histSnap = await db
      .collection(ST_SYMBOLS_COLLECTION).doc(sym)
      .collection(ST_SIGNAL_HISTORY_SUBCOLLECTION).get();
    const histKeys = new Set(
      histSnap.docs.flatMap((d) => Object.values(signalEntriesFromDoc(d.data())).map(entryKey)),
    );
    cHistTotal += histKeys.size;
    const canonHist = await db
      .collection(ST_SIGNALS_ROOT)
      .where('symbol', '==', sym)
      .get();
    const canonKeys = new Set(canonHist.docs.map((d) => entryKey(d.data() as StSignal)));
    cInterim += canonHist.docs.filter((d) => (d.data() as StSignal).status === 'INTERIM').length;
    const missed = [...histKeys].filter((k) => !canonKeys.has(k));
    if (missed.length) cDiffs.push(`${sym} missing=[${missed.slice(0, 5)}${missed.length > 5 ? '…' : ''}]`);
    cChecked++;
  }
  if (cHistTotal === 0) {
    fail('C history coverage', 'sampled symbols have ZERO legacy signal-history entries — no evidence');
  } else if (cDiffs.length) {
    fail('C history coverage', `${cDiffs.length}/${cChecked} symbols missing occurrences: ${cDiffs.join(' | ')}`);
  } else {
    ok('C history coverage', `${cChecked} symbols covered (${cHistTotal} legacy entries), +${cInterim} INTERIM (new coverage)`);
  }

  console.log(failures === 0 ? '\n=== READER-EQUIVALENCE OK ===' : `\n=== ${failures} CHECK(S) FAILED ===`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
