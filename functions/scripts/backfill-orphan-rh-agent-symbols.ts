/**
 * Backfill orphan rh-agent-symbols docs directly.
 *
 * Orphan = doc has only { symbol, enabled } (no createdAt/source/etc).
 * For each orphan:
 *   1. Set source='manual-add-backfill_26-0713' and createdAt in rh-agent-symbols
 *   2. Trigger symbolDataSyncAdminHttp for D/W/M bars
 *   3. Trigger rhAgentOverviewSyncAdmin for company overview
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/backfill-orphan-rh-agent-symbols.ts [source-tag]
 *
 * Override source tag (defaults to manual-add-backfill_26-0713):
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

const COLLECTION = 'rh-agent-symbols';
// Source tag can be overridden via CLI arg or env var so this script is reusable.
const SOURCE = process.argv[2] || process.env.SOURCE || 'manual-add-backfill_26-0713';
const BARS_URL = 'https://us-central1-rel-str.cloudfunctions.net/symbolDataSyncAdminHttp';
const OVERVIEW_QUEUE = 'rhAgentOverviewSyncSymbol';
const serviceAccount = process.env.IMPERSONATE_SERVICE_ACCOUNT ?? '145446780542-compute@developer.gserviceaccount.com';

function needsBackfill(data: Record<string, unknown>): boolean {
  const keys = Object.keys(data);
  const isBareOrphan = keys.length <= 2 && keys.every((k) => k === 'symbol' || k === 'enabled');
  const isThisRun = data.source === SOURCE;
  const hasOverview = data.overviewFetchedAt != null || data.name != null;
  return isBareOrphan || (isThisRun && !hasOverview);
}

function getIdToken(audience: string): string {
  return execSync(
    `gcloud auth print-identity-token --audiences="${audience}" --impersonate-service-account="${serviceAccount}"`,
    { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

async function postJson(url: string, body: unknown): Promise<void> {
  const token = getIdToken(url);
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
  const batch = db.batch();
  for (const symbol of orphans) {
    const ref = db.collection(COLLECTION).doc(symbol);
    batch.update(ref, { source: SOURCE, createdAt });
  }
  await batch.commit();
  console.log(`Updated ${orphans.length} docs with source=${SOURCE} and createdAt=${createdAt}.`);

  // 2. Trigger D/W/M bars backfill.
  console.log('Triggering bars backfill...');
  await postJson(BARS_URL, { symbols: orphans, forceFullFetch: true });

  // 3. Enqueue company overview sync tasks directly.
  console.log('Enqueuing overview sync tasks...');
  const overviewQueue = getFunctions().taskQueue(OVERVIEW_QUEUE);
  let overviewEnqueued = 0;
  for (const symbol of orphans) {
    await overviewQueue.enqueue({ symbol, forceRefresh: true });
    overviewEnqueued++;
  }
  console.log(`Enqueued ${overviewEnqueued} overview sync tasks.`);

  // 4. Fallback enrichment: copy basic fields from symbol-data (bars sync writes
  // name, type, marketOpen/Close etc.) into rh-agent-symbols so the UI has a
  // display name even when partner overview API doesn't know the symbol.
  console.log('Enriching from symbol-data fallback...');
  let enriched = 0;
  for (const symbol of orphans) {
    const symbolDataSnap = await db.collection('symbol-data').doc(symbol).get();
    const symbolData = symbolDataSnap.data();
    if (symbolData?.name) {
      await db.collection(COLLECTION).doc(symbol).set(
        {
          name: symbolData.name,
          assetType: symbolData.type,
          exchange: symbolData.region,
          overviewFetchedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      enriched++;
    }
  }
  console.log(`Enriched ${enriched} docs with basic data from symbol-data.`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
