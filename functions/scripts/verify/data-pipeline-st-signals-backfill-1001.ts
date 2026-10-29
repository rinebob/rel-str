/**
 * RETIRED — the legacy savant-trader/data/symbols evidence this relay
 * verified against was archived + deleted at #1019 ship (see
 * functions/scripts/output/legacy-archive-1013/). Unregistered from
 * run-all; kept for reference.
 *
 * Read-only backfill parity audit for #1001 — verifies that every legacy
 * signal occurrence (signal-history CONFIRMED + run-ids detections) has a
 * canonical `st-signals/{SYM}_{barDate}_{signalType}` doc, across ALL dates
 * (unlike the #1000 audit which scopes to one marketDate).
 *
 * Two findings tiers:
 *
 *   FAIL (drives exit 1):
 *   - expected occurrence missing from st-signals
 *   - doc.runIds missing an expected run, contains dupes, or isn't an array
 *   - doc.status not in {INTERIM, CONFIRMED}, or expected-CONFIRMED ≠ CONFIRMED
 *     (an expected-INTERIM doc observed CONFIRMED is allowed — a live run
 *     may legitimately have upgraded it)
 *   - doc.barDate/signalType ≠ the id-derived expected values (corruption —
 *     these fields can't legitimately diverge)
 *   - sourceRunId missing or ∉ runIds; marketDate/createdAt absent
 *   - EXTRA canonical doc for the symbol (live writes also create a
 *     run-ids doc in the same batch, so EXTRA implies foreign data)
 *   - malformed legacy entries incl. non-entry-shaped signals.* values
 *
 *   WARN (reported, does not fail):
 *   - provenance/payload divergence consistent with a doc the #1000
 *     dual-write live-created BEFORE the backfill: sourceRunId ∈ runIds
 *     but ≠ expected first-detection, marketDate ≠ expected,
 *     direction/timeframe/indicators ≠ expected (live payload came from
 *     a run entry while the aggregate prefers history), runIds extras
 *     from a post-backfill live re-detection
 *
 * Caveats: expectations come from the same aggregateOccurrences as the
 * backfill — this certifies WRITE fidelity, not aggregation correctness.
 * Run outside live-run windows for a clean signal.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-st-signals-backfill-1001.ts [--symbol SYMBOL]
 *
 * Read-only — never writes. Exit 0 when every symbol verifies; nonzero on
 * any FAIL finding.
 */
import { FieldPath } from 'firebase-admin/firestore';
import { db } from '../../src/firebase-admin-init';
import {
  ST_SYMBOLS_COLLECTION,
  ST_SIGNALS_ROOT,
} from '../../src/common/st-collections';
import {
  aggregateOccurrences,
  loadSymbolInputs,
} from '../backfill-st-signals-1001';

const symArg = process.argv.find((a) => a === '--symbol' || a.startsWith('--symbol='));
let onlySymbol: string | undefined;
if (symArg) {
  const raw = symArg.includes('=')
    ? symArg.split('=')[1]
    : process.argv[process.argv.indexOf(symArg) + 1];
  if (!raw || raw.startsWith('--')) {
    console.error('--symbol requires a value');
    process.exit(1);
  }
  onlySymbol = raw.toUpperCase();
}
// Positional arg kept for backward compat: `npx tsx ... ADPT`
if (!onlySymbol && process.argv[2] && !process.argv[2].startsWith('--')) {
  onlySymbol = process.argv[2].toUpperCase();
}

let symbols: string[];
if (onlySymbol) {
  symbols = [onlySymbol];
} else {
  const snap = await db.collection(ST_SYMBOLS_COLLECTION).get();
  symbols = snap.docs.map((d) => d.id);
}

console.log(`st-signals backfill audit — ${symbols.length} symbol(s)\n`);

let totalOk = 0;
let totalMissing = 0;
let totalMismatched = 0;
let totalExtra = 0;
let totalMalformed = 0;
let totalWarn = 0;
const failures: string[] = [];
const warnings: string[] = [];

for (const symbol of symbols) {
  try {
    const inputs = await loadSymbolInputs(db, symbol);
    const { occurrences, malformed, notes } = aggregateOccurrences(
      symbol,
      inputs.historyDocs,
      inputs.runDocs,
    );
    malformed.push(...inputs.dropped.map((d) => `${symbol}/${d}`));
    totalMalformed += malformed.length;
    for (const m of malformed) failures.push(`MALFORMED ${m}`);
    for (const n of notes) {
      totalWarn++;
      warnings.push(`NOTE ${n}`);
    }

    // symbol-field query finds live/backfill docs; a doc-id prefix scan
    // also catches EXTRAs whose symbol field is missing or miscased.
    const [byField, byPrefix] = await Promise.all([
      db.collection(ST_SIGNALS_ROOT).where('symbol', '==', symbol).get(),
      db
        .collection(ST_SIGNALS_ROOT)
        .where(FieldPath.documentId(), '>=', `${symbol}_`)
        .where(FieldPath.documentId(), '<', `${symbol}_\uf8ff`)
        .get(),
    ]);
    const canonById = new Map(
      [...byField.docs, ...byPrefix.docs].map((d) => [d.id, d.data()]),
    );

    let symMissing = 0;
    let symMismatched = 0;
    for (const [id, exp] of occurrences) {
      const doc = canonById.get(id);
      canonById.delete(id);
      if (!doc) {
        symMissing++;
        failures.push(`MISSING  ${id}`);
        continue;
      }
      const problems: string[] = [];
      const warns: string[] = [];
      const runIds = Array.isArray(doc.runIds) ? (doc.runIds as string[]) : null;
      if (!runIds) {
        problems.push('runIds not an array');
      } else {
        for (const runId of exp.runIds) {
          if (!runIds.includes(runId)) problems.push(`runIds missing ${runId}`);
        }
        const expectedRuns = new Set(exp.runIds);
        for (const runId of runIds) {
          if (!expectedRuns.has(runId)) warns.push(`runIds has unexpected '${runId}'`);
        }
        if (runIds.length !== new Set(runIds).size) problems.push('runIds dupes');
      }
      if (doc.status !== 'INTERIM' && doc.status !== 'CONFIRMED') {
        problems.push(`status '${doc.status}' not canonical`);
      } else if (exp.status === 'CONFIRMED' && doc.status !== 'CONFIRMED') {
        problems.push(`status ${doc.status} ≠ expected CONFIRMED`);
      }
      if (doc.direction !== exp.direction) {
        warns.push(`direction ${doc.direction} ≠ ${exp.direction}`);
      }
      if (doc.barDate !== exp.barDate) problems.push(`barDate ${doc.barDate} ≠ ${exp.barDate}`);
      if (doc.signalType !== exp.signalType) problems.push(`signalType ${doc.signalType} ≠ ${exp.signalType}`);
      if (doc.timeframe !== exp.timeframe) warns.push(`timeframe ${doc.timeframe} ≠ ${exp.timeframe}`);
      if (JSON.stringify(doc.indicators ?? {}) !== JSON.stringify(exp.indicators)) {
        warns.push('indicators differ from expected payload');
      }
      if (!doc.sourceRunId || !(runIds ?? []).includes(doc.sourceRunId as string)) {
        problems.push(`sourceRunId '${doc.sourceRunId}' ∉ runIds`);
      } else if (doc.sourceRunId !== exp.sourceRunId) {
        // Provenance is create-only: a doc live-created before the backfill
        // keeps the run it saw first — expected, not corruption.
        warns.push(`sourceRunId ${doc.sourceRunId} ≠ expected first-detection ${exp.sourceRunId}`);
      }
      if (!doc.marketDate) {
        problems.push('marketDate missing');
      } else if (doc.marketDate !== exp.marketDate) {
        warns.push(`marketDate ${doc.marketDate} ≠ ${exp.marketDate}`);
      }
      if (!doc.createdAt) problems.push('createdAt missing');
      if (problems.length > 0) {
        symMismatched++;
        failures.push(`MISMATCH ${id} — ${problems.join('; ')}`);
      } else if (warns.length > 0) {
        totalWarn++;
        warnings.push(`WARN ${id} — ${warns.join('; ')}`);
        totalOk++;
      } else {
        totalOk++;
      }
    }
    totalMissing += symMissing;
    totalMismatched += symMismatched;
    totalExtra += canonById.size;
    for (const extraId of canonById.keys()) {
      failures.push(`EXTRA    ${extraId} (no legacy occurrence)`);
    }

    if (occurrences.size > 0 || canonById.size > 0 || malformed.length > 0) {
      console.log(
        `${symbol}: expected=${occurrences.size} missing=${symMissing} ` +
        `mismatched=${symMismatched} extra=${canonById.size}` +
        (malformed.length ? ` malformed=${malformed.length}` : ''),
      );
    }
  } catch (err) {
    totalMismatched++;
    failures.push(`FAILED   ${symbol} — ${String(err)}`);
    console.log(`${symbol}: AUDIT FAILED — ${String(err)}`);
  }
}

console.log(
  `\nok=${totalOk} missing=${totalMissing} mismatched=${totalMismatched} ` +
  `extra=${totalExtra} malformed=${totalMalformed} warnings=${totalWarn}`,
);
for (const f of failures.slice(0, 100)) console.log(f);
if (failures.length > 100) console.log(`… +${failures.length - 100} more`);
if (warnings.length > 0) {
  console.log('\nWarnings (not failures — adjudicate vs live-created provenance):');
  for (const w of warnings.slice(0, 100)) console.log(`  ${w}`);
  if (warnings.length > 100) console.log(`  … +${warnings.length - 100} more`);
}

if (totalMissing === 0 && totalMismatched === 0 && totalExtra === 0 && totalMalformed === 0) {
  console.log('\n=== BACKFILL PARITY OK ===');
} else {
  console.log('\n=== PARITY FAILURES — see above ===');
  process.exit(1);
}
