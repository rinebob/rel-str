/**
 * Backfill orphan rh-agent-symbols docs directly.
 *
 * Orphan = doc has only { symbol, enabled } (no createdAt/source/etc).
 * For each orphan:
 *   1. Set source to RhAgentSymbolSource.MANUAL_ADD and createdAt in rh-agent-symbols
 *   2. Trigger symbolDataSyncAdminHttp for D/W/M bars
 *   3. Trigger rhAgentOverviewSyncAdmin for company overview
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/backfill-orphan-rh-agent-symbols.ts [source]
 *
 * Override source (defaults to RhAgentSymbolSource.MANUAL_ADD):
 *   $env:SOURCE="custom-backfill"
 *   npx tsx scripts/backfill-orphan-rh-agent-symbols.ts
 *
 * Dry-run (just list targets):
 *   $env:DRY_RUN="true"
 *   npx tsx scripts/backfill-orphan-rh-agent-symbols.ts
 */
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getFunctions } from 'firebase-admin/functions';
import { execSync } from 'child_process';
import { RhAgentSymbol, RhAgentSymbolSource } from '../src/common/rh-agent-collections';

const COLLECTION = 'rh-agent-symbols';
// Source can be overridden via CLI arg or env var so this script is reusable.
// Default to the canonical enum value so the frontend source filter works.
const SOURCE = process.argv[2] || process.env.SOURCE || RhAgentSymbolSource.MANUAL_ADD;
const BARS_URL = 'https://us-central1-rel-str.cloudfunctions.net/symbolDataSyncAdminHttp';
const OVERVIEW_QUEUE = 'rhAgentOverviewSyncSymbol';
const serviceAccount = process.env.IMPERSONATE_SERVICE_ACCOUNT ?? '145446780542-compute@developer.gserviceaccount.com';

function hasCreatedAt(data: Record<string, unknown>): boolean {
  return data.createdAt != null && data.createdAt !== '';
}

function hasSource(data: Record<string, unknown>): boolean {
  return data.source != null && data.source !== '';
}

function needsBackfill(data: Record<string, unknown>): boolean {
  // Re-process any doc that is still missing the core onboarding fields.
  // Once both createdAt and source are present, the doc is considered backfilled.
  return !hasCreatedAt(data) || !hasSource(data);
}

function getIdToken(audience: string): string {
  return execSync(
    `gcloud auth print-identity-token --audiences="${audience}" --impersonate-service-account="${serviceAccount}"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

async function postJson(url: string, body: unknown, token: string): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`POST ${url} failed: ${res.status} ${text}`);
  }
  console.log(`POST ${url} -> ${res.status}: ${text.slice(0, 200)}`);
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === 'true';
  const app = getApps().length === 0
    ? initializeApp({ projectId: 'rel-str', serviceAccountId: '145446780542-compute@developer.gserviceaccount.com' })
    : getApps()[0];
  const db = getFirestore(app);

  const snapshot = await db.collection(COLLECTION).get();
  const createdAt = new Date().toISOString();
  const orphans: string[] = [];

  for (const doc of snapshot.docs) {
    const data = doc.data() as Record<string, unknown>;
    if (needsBackfill(data)) {
      orphans.push(doc.id);
    }
  }

  console.log(`Found ${orphans.length} orphan docs out of ${snapshot.size} total.`);
  if (orphans.length === 0) {
    return;
  }

  console.log('Orphans:', orphans.join(', '));

  if (dryRun) {
    console.log('DRY RUN — no updates or triggers.');
    return;
  }

  // 1. Stamp source + createdAt so the dialog can stop treating them as orphans.
  //    createdAt is only written if the doc does not already have one, preserving
  //    any value set by a previous (interrupted) run.
  const batch = db.batch();
  for (const symbol of orphans) {
    const ref = db.collection(COLLECTION).doc(symbol);
    const data = (await ref.get()).data() as Partial<RhAgentSymbol> | undefined;
    const update: Partial<RhAgentSymbol> = { source: SOURCE as RhAgentSymbol['source'] };
    if (!hasCreatedAt(data ?? {})) {
      update.createdAt = createdAt;
    }
    batch.update(ref, update);
  }
  await batch.commit();
  console.log(`Updated ${orphans.length} docs with source=${SOURCE} and createdAt (where missing).`);

  // 2. Trigger D/W/M bars backfill (one shared HTTP call; auth token reused).
  console.log('Triggering bars backfill...');
  const idToken = getIdToken(BARS_URL);
  await postJson(BARS_URL, { symbols: orphans, forceFullFetch: true }, idToken);

  // 3. Enqueue company overview sync tasks directly.
  console.log('Enqueuing overview sync tasks...');
  const overviewQueue = getFunctions().taskQueue(OVERVIEW_QUEUE);
  await Promise.all(
    orphans.map((symbol) => overviewQueue.enqueue({ symbol, forceRefresh: true })),
  );
  console.log(`Enqueued ${orphans.length} overview sync tasks.`);

  // 4. Fallback enrichment: copy basic fields from symbol-data (bars sync writes
  // name, type, marketOpen/Close etc.) into rh-agent-symbols so the UI has a
  // display name even when partner overview API doesn't know the symbol.
  console.log('Enriching from symbol-data fallback...');
  const fallbackData = await Promise.all(
    orphans.map(async (symbol) => {
      const symbolDataSnap = await db.collection('symbol-data').doc(symbol).get();
      const symbolData = symbolDataSnap.data();
      return { symbol, symbolData };
    }),
  );
  let enriched = 0;
  const enrichBatch = db.batch();
  for (const { symbol, symbolData } of fallbackData) {
    const fallback = symbolData as { name?: unknown; type?: unknown; region?: unknown } | undefined;
    if (typeof fallback?.name === 'string') {
      const ref = db.collection(COLLECTION).doc(symbol);
      const update: Partial<RhAgentSymbol> = {
        name: fallback.name,
        assetType: typeof fallback.type === 'string' ? fallback.type : undefined,
        exchange: typeof fallback.region === 'string' ? fallback.region : undefined,
        overviewFetchedAt: FieldValue.serverTimestamp(),
      };
      enrichBatch.update(ref, update);
      enriched++;
    }
  }
  await enrichBatch.commit();
  console.log(`Enriched ${enriched} docs with basic data from symbol-data.`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
