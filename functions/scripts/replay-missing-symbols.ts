/**
 * Replay Missing Symbols — Reconcile RS against SA's tracked-symbols universe.
 *
 * Diffs SA's partnerListTrackedSymbolsV2 response against our `rh-agent-symbols`
 * and `symbol-data` collections. Symbols that SA tracks but we don't have are
 * the gap from the `createdAtUTC` vs `addedAtUTC` bug (or any other drop).
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/replay-missing-symbols.ts            # dry-run: print the gap
 *   npx tsx scripts/replay-missing-symbols.ts --replay    # replay missing symbols
 *
 * Prerequisites:
 *   - Application Default Credentials with prod Firestore + partner API access:
 *       gcloud auth application-default login
 *     or set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON key.
 *   - Do NOT set FUNCTIONS_EMULATOR=true (this targets prod).
 */
import { db, FieldValue } from '../src/firebase-admin-init';
import { callPartnerTrackedSymbols } from '../src/partner-proxy';
import { syncSymbolToSymbolData } from '../src/symbol-data-sync/symbol-data-backfill';
import { fetchAndWriteSymbolOverview } from '../src/common/rh-agent-overview-helper';
import { createDailyRun, getDeadlineISO } from '../src/common/rh-agent-run-creation';
import { createJobAndEnqueue } from '../src/common/rh-agent-job-enqueueing';
import {
  getMarketDatePT,
  getRunDatePT,
  getRunIdPT,
} from '../src/common/pt-date-utils';
import {
  DEFAULT_SYMBOL_LIST_NAME,
  RH_AGENT_SYMBOLS_COLLECTION,
  RH_AGENT_SYMBOL_LISTS_COLLECTION,
  RhAgentSymbol,
} from '../src/common/rh-agent-collections';
import { SYMBOL_DATA_COLLECTION } from '../src/webhooks/webhooks-config';

const RUN_DEADLINE_MINUTES = 30;

/** Fetch all doc IDs from a collection. */
async function getCollectionIds(collection: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const snap = await db.collection(collection).listDocuments();
  for (const ref of snap) {
    ids.add(ref.id);
  }
  return ids;
}

/** Add a symbol to the default PRIMARY watchlist (mirrors the consumer). */
async function addSymbolToDefaultList(symbol: string): Promise<void> {
  await db
    .collection(RH_AGENT_SYMBOL_LISTS_COLLECTION)
    .doc(DEFAULT_SYMBOL_LIST_NAME)
    .set(
      { name: DEFAULT_SYMBOL_LIST_NAME, symbols: FieldValue.arrayUnion(symbol) },
      { merge: true },
    );
}

/** Trigger a single-symbol RH Agent run (mirrors the consumer). */
async function triggerSymbolAddedRun(symbol: string): Promise<void> {
  const marketDate = getMarketDatePT();
  const runStartedAt = new Date().toISOString();
  const runDate = getRunDatePT();
  const uniqueRunId = `${getRunIdPT(runDate, 'symbol-added')}_${symbol}`;
  const runId = await createDailyRun(
    marketDate,
    1,
    getDeadlineISO(RUN_DEADLINE_MINUTES),
    'symbol-added',
    uniqueRunId,
    runDate,
    'symbol-added',
  );
  await createJobAndEnqueue(runId, symbol, marketDate, runStartedAt, 'symbol-added');
  console.log(`    run enqueued: ${runId}`);
}

/**
 * Replay a single symbol through the same onboarding steps as the pubsub
 * consumer: backfill → enable → list add → overview → run trigger.
 */
async function replaySymbol(symbol: string): Promise<{ ok: boolean; error?: string }> {
  try {
    // 1. Backfill into symbol-data
    const result = await syncSymbolToSymbolData(symbol, true);
    if (result.status !== 'ok') {
      return { ok: false, error: result.error ?? 'backfill not ok' };
    }
    console.log(
      `    backfilled: D=${result.dailyCount} W=${result.weeklyCount} M=${result.monthlyCount}`,
    );

    // 2. Enable in rh-agent-symbols (preserve existing createdAt)
    const symbolDocRef = db.collection(RH_AGENT_SYMBOLS_COLLECTION).doc(symbol);
    const existingSnap = await symbolDocRef.get();
    const existingData = existingSnap.data() as Partial<RhAgentSymbol> | undefined;

    const symbolDoc: Partial<RhAgentSymbol> = {
      symbol,
      enabled: true,
    };
    if (!existingData?.createdAt) {
      symbolDoc.createdAt = new Date().toISOString();
    }
    await symbolDocRef.set(symbolDoc, { merge: true });

    // 3-5. Best-effort follow-up steps
    await Promise.all([
      addSymbolToDefaultList(symbol).catch((err) => {
        console.warn(`    list add failed: ${err?.message}`);
      }),
      fetchAndWriteSymbolOverview(symbol).catch((err) => {
        console.warn(`    overview failed: ${err?.message}`);
      }),
      triggerSymbolAddedRun(symbol).catch((err) => {
        console.warn(`    run trigger failed: ${err?.message}`);
      }),
    ]);

    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message };
  }
}

async function main() {
  const doReplay = process.argv.includes('--replay');

  if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.error('This script targets prod. Unset FUNCTIONS_EMULATOR and retry.');
    process.exit(1);
  }

  console.log('=== Replay Missing Symbols ===\n');

  // 1. Fetch SA's tracked universe
  console.log('Fetching SA tracked symbols...');
  const partnerResp = await callPartnerTrackedSymbols();
  // Partner returns objects with a .symbol property, not plain strings
  const saSymbols = new Set(
    (partnerResp.symbols as unknown[])
      .map((s) => {
        if (typeof s === 'string') return s.trim();
        if (s && typeof s === 'object' && 'symbol' in s) return (s as { symbol: string }).symbol.trim();
        return null;
      })
      .filter((s): s is string => s !== null && s.length > 0),
  );
  console.log(`  SA reports ${saSymbols.size} tracked symbols\n`);

  // 2. Fetch our collections
  console.log('Fetching RS rh-agent-symbols...');
  const ourRhAgentSymbols = await getCollectionIds(RH_AGENT_SYMBOLS_COLLECTION);
  console.log(`  RS has ${ourRhAgentSymbols.size} symbols in rh-agent-symbols`);

  console.log('Fetching RS symbol-data...');
  const ourSymbolData = await getCollectionIds(SYMBOL_DATA_COLLECTION);
  console.log(`  RS has ${ourSymbolData.size} symbols in symbol-data\n`);

  // 3. Diff
  const missingFromRhAgent = [...saSymbols].filter((s) => !ourRhAgentSymbols.has(s));
  const missingFromSymbolData = [...saSymbols].filter((s) => !ourSymbolData.has(s));
  const missingFromBoth = missingFromRhAgent.filter((s) => missingFromSymbolData.includes(s));

  console.log('=== Gap Report ===');
  console.log(`  Missing from rh-agent-symbols: ${missingFromRhAgent.length}`);
  console.log(`  Missing from symbol-data:      ${missingFromSymbolData.length}`);
  console.log(`  Missing from both:             ${missingFromBoth.length}`);

  if (missingFromRhAgent.length > 0) {
    console.log(`\n  Symbols missing from rh-agent-symbols:`);
    console.log(`  ${missingFromRhAgent.join(', ')}`);
  }
  if (missingFromSymbolData.length > 0 && missingFromSymbolData.length !== missingFromRhAgent.length) {
    console.log(`\n  Symbols missing from symbol-data (but may exist in rh-agent-symbols):`);
    const onlySymbolData = missingFromSymbolData.filter((s) => ourRhAgentSymbols.has(s));
    console.log(`  ${onlySymbolData.join(', ')}`);
  }

  // 4. Replay (union of all missing — a symbol missing from either collection needs onboarding)
  const toReplay = [...new Set([...missingFromRhAgent, ...missingFromSymbolData])];

  if (toReplay.length === 0) {
    console.log('\nNo gap detected. RS is in sync with SA.');
    return;
  }

  if (!doReplay) {
    console.log(`\n${toReplay.length} symbol(s) need replay. Run with --replay to onboard them.`);
    return;
  }

  console.log(`\n=== Replaying ${toReplay.length} symbol(s) ===\n`);

  const results: { symbol: string; ok: boolean; error?: string }[] = [];
  for (const symbol of toReplay) {
    console.log(`[${symbol}]`);
    const result = await replaySymbol(symbol);
    results.push({ symbol, ...result });
    if (result.ok) {
      console.log(`  OK`);
    } else {
      console.log(`  FAILED: ${result.error}`);
    }
  }

  const okCount = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);

  console.log(`\n=== Replay Complete ===`);
  console.log(`  OK: ${okCount}/${toReplay.length}`);
  if (failed.length > 0) {
    console.log(`  Failed: ${failed.map((f) => f.symbol).join(', ')}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
