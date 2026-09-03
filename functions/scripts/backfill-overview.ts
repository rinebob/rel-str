/**
 * Backfill company overview data for symbols that are missing it.
 *
 * Enqueues one `stOverviewSyncSymbol` Cloud Task per symbol with
 * forceRefresh=true. The worker fetches SA company overview and merges it
 * into the symbol-meta doc — it does not touch price bars, watchlists, or
 * trigger any ST runs.
 *
 * Symbol sources (in priority order):
 *   1. File path arg — reads symbols from a file (one per line; blank lines
 *      and lines starting with # are ignored):
 *        npx tsx scripts/backfill-overview.ts path/to/symbols.txt
 *   2. CLI args — inline symbol list:
 *        npx tsx scripts/backfill-overview.ts AAPL MSFT TSLA
 *   3. No args — queries savant-trader/data/symbols for enabled symbols
 *      where `overviewFetchedAt` is absent.
 *
 * Dry-run (list targets without enqueuing):
 *   DRY_RUN=true npx tsx scripts/backfill-overview.ts [symbols...]
 *
 * Override the impersonated service account if needed:
 *   IMPERSONATE_SERVICE_ACCOUNT="your-sa@rel-str.iam.gserviceaccount.com" \
 *     npx tsx scripts/backfill-overview.ts
 */
import { readFileSync } from 'fs';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';

const COLLECTION = 'savant-trader/data/symbols';
const OVERVIEW_QUEUE = 'stOverviewSyncSymbol';
const SERVICE_ACCOUNT =
  process.env.IMPERSONATE_SERVICE_ACCOUNT ?? '145446780542-compute@developer.gserviceaccount.com';

/** Parse a symbols file: one symbol per line, skip blanks and # comments. */
function parseSymbolsFile(path: string): string[] {
  const text = readFileSync(path, 'utf8');
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

/** Load enabled symbols missing overviewFetchedAt from Firestore. */
async function loadMissingOverviewSymbols(db: FirebaseFirestore.Firestore): Promise<{
  missing: string[];
  totalEnabled: number;
}> {
  const snapshot = await db.collection(COLLECTION).where('enabled', '==', true).get();
  const missing: string[] = [];
  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (data.overviewFetchedAt == null) {
      missing.push(doc.id);
    }
  }
  return { missing, totalEnabled: snapshot.size };
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  const args = process.argv.slice(2);

  // Resolve the symbol list.
  let symbols: string[];
  let source: string;

  if (args.length === 1) {
    // Could be a file path or a single symbol — try file first.
    try {
      symbols = parseSymbolsFile(args[0]);
      source = `file: ${args[0]}`;
    } catch {
      symbols = args;
      source = 'CLI args';
    }
  } else if (args.length > 1) {
    symbols = args;
    source = 'CLI args';
  } else {
    // Query Firestore for enabled symbols missing overview.
    const app =
      getApps().length === 0
        ? initializeApp({ projectId: 'rel-str', serviceAccountId: SERVICE_ACCOUNT })
        : getApps()[0];
    const db = getFirestore(app);
    const { missing, totalEnabled } = await loadMissingOverviewSymbols(db);
    symbols = missing;
    source = `Firestore query (${missing.length} of ${totalEnabled} enabled missing overview)`;
  }

  symbols = symbols.map((s) => s.trim().toUpperCase()).filter((s) => s.length > 0);

  // Dedupe while preserving order.
  const seen = new Set<string>();
  symbols = symbols.filter((s) => (seen.has(s) ? false : (seen.add(s), true)));

  console.log(`Symbol source: ${source}`);
  console.log(`Found ${symbols.length} symbol(s).`);
  if (symbols.length === 0) {
    return;
  }

  console.log('Symbols:', symbols.join(', '));

  if (dryRun) {
    console.log('DRY RUN — no tasks enqueued.');
    return;
  }

  // Initialize Firebase app if not already (needed when symbols came from
  // file/CLI and we skipped the Firestore query path).
  const app =
    getApps().length === 0
      ? initializeApp({ projectId: 'rel-str', serviceAccountId: SERVICE_ACCOUNT })
      : getApps()[0];

  // Enqueue one overview-sync task per symbol. The worker's Cloud Tasks config
  // handles rate limiting (maxConcurrentDispatches=10, maxDispatchesPerSecond=5)
  // and retry (maxAttempts=3, backoff 10-120s).
  console.log('Enqueuing overview sync tasks...');
  const queue = getFunctions(app).taskQueue(OVERVIEW_QUEUE);
  let enqueued = 0;
  let skipped = 0;

  for (const symbol of symbols) {
    try {
      await queue.enqueue({ symbol, forceRefresh: true });
      enqueued++;
    } catch (err: any) {
      console.error(`Failed to enqueue ${symbol}:`, err?.message || err);
      skipped++;
    }
  }

  console.log(`Done. Enqueued: ${enqueued}, skipped: ${skipped}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
