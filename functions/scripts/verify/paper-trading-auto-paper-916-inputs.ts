/**
 * @topic #553 — Paper Trading Infra (task #916 — auto-paper contracts)
 *
 * Verifies the PROD data assumptions the auto-paper ingest depends on —
 * read-only, no writes:
 *
 *   1. Finds a recent COMPLETED run with signal-producing jobs
 *      (`createdOpportunity == true`).
 *   2. Reads that symbol's `run-ids/{runId}` doc — entries are stored as
 *      literal flattened `signals.{signalType}` top-level fields; confirms
 *      each carries direction/status/barDate/marketDate/indicators.
 *   3. Reads `symbols/{SYMBOL}` — confirms sector/industry/marketCapTier
 *      are populated (the slice dims the ingest denormalizes); checks a
 *      user-scoped `symbol-lists/{uid}_PRIMARY` doc exists.
 *   4. Prints the tradeId / signalId / scope ids the ingest WOULD derive —
 *      proving the contract maps onto real data.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-auto-paper-916-inputs.ts [runId]
 *
 * Requires: ADC (rel-str). No writes — read-only audit.
 *
 * PASS: a qualifying signal entry exists and every stamp source field is
 * present; exit 0. If no signaled run is found in the recent window, the
 * script reports that honestly and exits 1 (re-run after a signaling day).
 */

import { db } from '../../src/firebase-admin-init';
import {
  ST_RUNS_COLLECTION,
  ST_JOBS_SUBCOLLECTION,
  ST_SYMBOLS_COLLECTION,
  ST_RUN_IDS_SUBCOLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
} from '../../src/common/st-collections';
import {
  signalTradeDesc,
  signalDedupeKey,
  buildTradeId,
  paperTradingItemsPath,
  PaperTradingKind,
  statsScopeSignalType,
  statsScopeSector,
  statsScopeIndustry,
  statsScopeCapTier,
} from '../../../shared/paper-trading-ids';
import type { StSignalEntry } from '../../src/st-cloud-function/signals';

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

async function findRunWithSignals(argRunId?: string): Promise<string | null> {
  if (argRunId) return argRunId;
  const snap = await db
    .collection(ST_RUNS_COLLECTION)
    .orderBy('completedAt', 'desc')
    .limit(10)
    .get();
  for (const run of snap.docs) {
    const jobs = await db
      .collection(ST_RUNS_COLLECTION)
      .doc(run.id)
      .collection(ST_JOBS_SUBCOLLECTION)
      .where('createdOpportunity', '==', true)
      .limit(1)
      .get();
    if (!jobs.empty) return run.id;
  }
  return null;
}

async function main(): Promise<void> {
  const runId = await findRunWithSignals(process.argv[2]);
  check('found a run with signaled jobs', runId !== null, runId ?? 'none in last 10 runs');
  if (!runId) process.exit(1);

  const jobs = await db
    .collection(ST_RUNS_COLLECTION)
    .doc(runId)
    .collection(ST_JOBS_SUBCOLLECTION)
    .where('createdOpportunity', '==', true)
    .limit(5)
    .get();
  check('signaled jobs listed', !jobs.empty, `${jobs.size} candidates`);
  if (jobs.empty) process.exit(1);
  const symbol = jobs.docs[0].id;

  const runIdDoc = await db
    .collection(ST_SYMBOLS_COLLECTION)
    .doc(symbol)
    .collection(ST_RUN_IDS_SUBCOLLECTION)
    .doc(runId)
    .get();
  check(`run-ids doc exists for ${symbol}`, runIdDoc.exists);
  if (!runIdDoc.exists) process.exit(1);

  // Prod run-ids docs store entries as literal flattened top-level keys
  // ('signals.D_ST_...'), not a nested `signals` map — enumerate by prefix.
  // Older/other writers produce a nested map; tolerate both shapes.
  const data = runIdDoc.data() ?? {};
  const entries: StSignalEntry[] = Object.entries(data)
    .filter(([k, v]) => k.startsWith('signals.') && v && typeof v === 'object')
    .map(([, v]) => v as StSignalEntry);
  if (data.signals && typeof data.signals === 'object') {
    entries.push(...(Object.values(data.signals) as StSignalEntry[]));
  }
  check('signals entries non-empty (flattened keys)', entries.length > 0, `${entries.length} entries`);
  if (entries.length === 0) process.exit(1);

  const e = entries.find((x) => x.signalType?.startsWith('D_ST_TREND_RIDER')) ?? entries[0];
  check('entry.signalType', typeof e.signalType === 'string', e.signalType);
  check('entry.direction LONG|SHORT', e.direction === 'LONG' || e.direction === 'SHORT', String(e.direction));
  check('entry.status INTERIM|CONFIRMED', e.status === 'INTERIM' || e.status === 'CONFIRMED', String(e.status));
  check('entry.barDate YYYY-MM-DD', /^\d{4}-\d{2}-\d{2}$/.test(e.barDate), e.barDate);
  check('entry.marketDate', typeof e.marketDate === 'string' && e.marketDate.length === 10, e.marketDate);
  check('entry.indicators is an object', typeof e.indicators === 'object' && e.indicators !== null,
    `${Object.keys(e.indicators ?? {}).length} keys`);

  // Overview fields live on the symbols doc itself — sector is UPPERCASE.
  const meta = await db.collection(ST_SYMBOLS_COLLECTION).doc(symbol).get();
  const m = meta.data() ?? {};
  check(`${symbol} symbols-doc sector`, typeof m.sector === 'string' && m.sector.length > 0, String(m.sector));
  check(`${symbol} symbols-doc industry`, typeof m.industry === 'string' && m.industry.length > 0, String(m.industry));
  check(`${symbol} symbols-doc marketCapTier`, typeof m.marketCapTier === 'string' && m.marketCapTier.length > 0, String(m.marketCapTier));

  // Symbol lists are user-scoped: doc id {uid}_{KEY}, members in symbols[].
  const lists = await db
    .collection(ST_SYMBOL_LISTS_COLLECTION)
    .where('key', '==', 'PRIMARY')
    .get();
  check('a PRIMARY list doc exists', !lists.empty);
  const primary = lists.docs[0]?.data() ?? {};
  check('PRIMARY list has symbols[]', Array.isArray(primary.symbols), `${primary.symbols?.length ?? 0} members`);

  // Derived ids — what the ingest would stamp/write.
  let desc: string;
  try {
    desc = signalTradeDesc(e.signalType);
  } catch {
    check(`signalTradeDesc supports '${e.signalType}'`, false);
    process.exit(1);
  }
  const tradeId = buildTradeId(new Date(), 'sig', symbol, desc);
  const signalId = signalDedupeKey(symbol, e.signalType, e.barDate);
  console.log(`\nderived for ${symbol}:`);
  console.log(`  tradeId   ${tradeId}`);
  console.log(`  signalId  ${signalId}`);
  console.log(`  scopes    ${statsScopeSignalType(e.signalType)} ${statsScopeSector(String(m.sector))} ${statsScopeIndustry(String(m.industry))} ${statsScopeCapTier(String(m.marketCapTier))}`);

  // Dedupe pre-check must not collide with an existing doc unexpectedly.
  const existing = await db
    .collection(paperTradingItemsPath(PaperTradingKind.TRADE))
    .doc(tradeId)
    .get();
  console.log(`  trade doc ${existing.exists ? 'EXISTS (would dedupe)' : 'absent (would create)'}`);

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify error:', err);
  process.exit(1);
});
