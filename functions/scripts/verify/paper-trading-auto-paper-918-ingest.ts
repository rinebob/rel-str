/**
 * @topic #553 — Paper Trading Infra (task #918 — auto-paper ingest fill)
 *
 * Read-only DRY-RUN of the ingest selection pipeline against prod — no
 * writes, no RH session, no task enqueues. Proves the #918 wiring maps
 * onto real run data end to end:
 *
 *   1. Finds a recent completed run (or takes --runId <id>).
 *   2. Jobs where createdOpportunity==true → candidate symbols.
 *   3. List gate — intersects candidates with the PRIMARY symbol-list
 *      (the configured capture scope; `key == 'PRIMARY'` first-match,
 *      same fallback the pass uses without ownerUid).
 *   4. Per admitted candidate: run-ids signals (flattened+nested reader),
 *      filtered to the default allowlist; symbol-doc meta
 *      (sector/industry/capTier); deterministic barDate-keyed tradeId +
 *      signalId; getTrade dedupe check.
 *   5. Prints the would-be trades — quote and fill are the only steps
 *      stubbed (noted per row).
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-auto-paper-918-ingest.ts [--runId <id>]
 *
 * Requires: ADC (rel-str). Read-only.
 * PASS: a completed run exists, candidates parse, work items resolve to
 * well-formed tradeIds/signalIds; exit 0. No signal-bearing run in the
 * recent window → honest FAIL exit 1.
 */

import { db } from '../../src/firebase-admin-init';
import {
  ST_JOBS_SUBCOLLECTION,
  ST_RUN_IDS_SUBCOLLECTION,
  ST_RUNS_COLLECTION,
  ST_SYMBOLS_COLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
} from '../../src/common/st-collections';
import { StRunStatus } from '../../src/common/st-runs';
import { isValidMarketDate } from '../../src/common/pt-date-utils';
import {
  AUTO_PAPER_DEFAULT_SIGNAL_TYPES,
  signalEntriesFromRunDoc,
} from '../../src/paper-trading/passes/auto-paper-ingest-pass';
import {
  buildTradeId,
  signalDedupeKey,
  signalTradeDesc,
} from '@paper-trading/ids';
import { getTrade } from '../../src/paper-trading/repository';

const checks: { name: string; ok: boolean; detail?: string }[] = [];
const check = (n: string, ok: boolean, d?: string) => checks.push({ name: n, ok, detail: d });

async function findRunId(): Promise<string | undefined> {
  const argIdx = process.argv.indexOf('--runId');
  if (argIdx >= 0) return process.argv[argIdx + 1];
  const snap = await db
    .collection(ST_RUNS_COLLECTION)
    .orderBy('completedAt', 'desc')
    .limit(10)
    .get();
  return snap.docs.find((d) => {
    const s = d.data()?.status;
    return s === StRunStatus.SUCCESS || s === StRunStatus.PARTIAL;
  })?.id;
}

async function main(): Promise<void> {
  const runId = await findRunId();
  check('found a completed run', !!runId, runId);
  if (!runId) throw new Error('no completed run found in last 10');

  const jobs = await db
    .collection(ST_RUNS_COLLECTION)
    .doc(runId)
    .collection(ST_JOBS_SUBCOLLECTION)
    .where('createdOpportunity', '==', true)
    .get();
  const candidates = jobs.docs.map((d) => d.id);
  check('candidate query returns symbols', candidates.length > 0, `${candidates.length} candidates`);

  // List gate — PRIMARY is the configured capture scope.
  const listSnap = await db
    .collection(ST_SYMBOL_LISTS_COLLECTION)
    .where('key', '==', 'PRIMARY')
    .get();
  const primary = new Set<string>((listSnap.docs[0]?.data()?.symbols ?? []) as string[]);
  check('PRIMARY list resolves', primary.size > 0, `${primary.size} members (${listSnap.size} docs)`);
  const admitted = candidates.filter((s) => primary.has(s));
  console.log(
    `\nrun ${runId}: ${candidates.length} candidates, ` +
      `${admitted.length} in PRIMARY — ${admitted.join(', ')}`,
  );

  let workItems = 0;
  let deduped = 0;
  for (const symbol of admitted.slice(0, 10)) {
    const doc = await db
      .collection(ST_SYMBOLS_COLLECTION)
      .doc(symbol)
      .collection(ST_RUN_IDS_SUBCOLLECTION)
      .doc(runId)
      .get();
    const signals = doc.exists ? signalEntriesFromRunDoc(doc.data() ?? {}) : {};
    const meta = (await db.collection(ST_SYMBOLS_COLLECTION).doc(symbol).get()).data() ?? {};
    for (const [signalType, entry] of Object.entries(signals)) {
      if (!AUTO_PAPER_DEFAULT_SIGNAL_TYPES.includes(signalType)) continue;
      if (!isValidMarketDate(entry.barDate)) {
        console.log(`  ${symbol} ${signalType} INVALID barDate=${entry.barDate} — filtered`);
        continue;
      }
      // Same keying as the pass: tradeId derives from the signal's barDate.
      const tradeId = buildTradeId(
        new Date(`${entry.barDate}T12:00:00Z`),
        'sig',
        symbol,
        signalTradeDesc(signalType),
      );
      const signalId = signalDedupeKey(symbol, signalType, entry.barDate);
      const existing = await getTrade(db, tradeId);
      if (existing) deduped++;
      workItems++;
      console.log(
        `  ${symbol} ${signalType} dir=${entry.direction} bar=${entry.barDate} ` +
          `sector=${meta.sector ?? '-'} → tradeId=${tradeId} signalId=${signalId} ` +
          `${existing ? 'DEDUPED(exists)' : 'new'} [quote+fill stubbed]`,
      );
    }
  }

  check(
    'qualifying signal entries resolve to tradeIds/signalIds',
    workItems > 0,
    `${workItems} work items, ${deduped} already exist`,
  );

  console.log('');
  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    if (!c.ok) failed++;
  }
  console.log(`\n=== ${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECKS FAILED`} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify error:', err);
  process.exit(1);
});
