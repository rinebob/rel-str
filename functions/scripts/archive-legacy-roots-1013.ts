/**
 * #1013 — archive + delete for the retired legacy Firestore roots.
 *
 * Two phases, always archive-first:
 *   1. ARCHIVE — dump every doc of every retiring collection (with
 *      subcollections) to functions/scripts/output/legacy-archive-1013/
 *      as JSON. Files are written atomically (tmp + rename); re-running
 *      overwrites unless --resume skips existing files.
 *   2. DELETE — `recursiveDelete` per retired root (subcollections
 *      handled server-side). Each collection's delete is gated on a
 *      valid, parseable archive file existing for it first.
 *
 * DEFAULT IS DRY-RUN — prints the counts + paths it would touch and
 * writes/deletes nothing. --apply archives then deletes. --archive-only
 * archives without deleting.
 *
 * Run the parity relay FIRST and confirm zero FAILs — this script gates
 * deletes only on archive-file existence, not on canonical parity:
 *   npx tsx scripts/verify/data-pipeline-legacy-roots-1013.ts
 *
 * Ordering requirement: the #1003/#1007/#1008 soak mirrors must be
 * undeployed (firebase deploy --only functions) BEFORE delete runs —
 * deleting a mirrored source propagates the delete into canonical.
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/archive-legacy-roots-1013.ts              # dry-run
 *   npx tsx scripts/archive-legacy-roots-1013.ts --archive-only
 *   npx tsx scripts/archive-legacy-roots-1013.ts --apply
 *   npx tsx scripts/archive-legacy-roots-1013.ts --apply --only rh-agent-runs,backtest-runs
 *   npx tsx scripts/archive-legacy-roots-1013.ts --apply --resume  # skip collections already archived
 *
 * --only matches on exact manifest name or exact collection path —
 *   e.g. `--only rh-agent-runs` hits exactly one target.
 *
 * Prerequisites: ADC with prod Firestore access; do NOT set
 * FUNCTIONS_EMULATOR=true.
 *
 * Archive fidelity: JSON.stringify of `doc.data()` — Timestamps/
 * GeoPoints/DocRefs serialize to their JSON projections, not typed
 * round-trip forms. Sufficient for forensic inspection; restoring docs
 * would need type reconstruction.
 */
import { db } from '../src/firebase-admin-init';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Collections retired by #1013 — full paths incl. anchored `items` legs. */
const RETIRED: { name: string; path: string }[] = [
  { name: 'savant-trader-order-intents', path: 'savant-trader/data/order-intents' },
  { name: 'savant-trader-review-list', path: 'savant-trader/data/review-list' },
  { name: 'savant-trader-status', path: 'savant-trader/data/status' },
  { name: 'savant-trader-symbol-lists', path: 'savant-trader/data/symbol-lists' },
  { name: 'savant-trader-trading-config', path: 'savant-trader/data/trading-config' },
  { name: 'savant-trader-occurrence-decisions', path: 'savant-trader/data/occurrence-decisions' },
  { name: 'savant-trader-symbol-meta', path: 'savant-trader/data/symbol-meta' },
  { name: 'options-strategy-instances', path: 'options-strategy-instances' },
  { name: 'options-strategy-positions', path: 'options-strategy-positions' },
  { name: 'options-strategy-stats', path: 'options-strategy-stats' },
  { name: 'portfolio-buckets-items', path: 'portfolio/buckets/items' },
  { name: 'portfolio-attributions-items', path: 'portfolio/attributions/items' },
  { name: 'backtest-runs', path: 'backtest-runs' },
  { name: 'backtest-permutations', path: 'backtest-permutations' },
  { name: 'paper-trading-accounts-items', path: 'paper-trading/accounts/items' },
  { name: 'paper-trading-trades-items', path: 'paper-trading/trades/items' },
  { name: 'paper-trading-stats-items', path: 'paper-trading/stats/items' },
  { name: 'paper-trading-raw-quotes-items', path: 'paper-trading/raw-quotes/items' },
  { name: 'rh-agent-runs', path: 'rh-agent-runs' },
  { name: 'rh-agent-opportunities', path: 'rh-agent-opportunities' },
  { name: 'rh-agent-symbols', path: 'rh-agent-symbols' },
  { name: 'rh-agent-triage-decisions', path: 'rh-agent-triage-decisions' },
  { name: 'rh-agent-occurrence-decisions', path: 'rh-agent-occurrence-decisions' },
  { name: 'rh-agent-symbol-lists', path: 'rh-agent-symbol-lists' },
  { name: 'rh-agent-status', path: 'rh-agent-status' },
  { name: 'rh-agent-symbol-meta', path: 'rh-agent-symbol-meta' },
];

const ARCHIVE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'output', 'legacy-archive-1013');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const ARCHIVE_ONLY = args.includes('--archive-only');
const RESUME = args.includes('--resume');
const only = args.includes('--only')
  ? new Set(args[args.indexOf('--only') + 1].split(','))
  : null;

/** Retry on transient gRPC failures (DEADLINE_EXCEEDED=4, UNAVAILABLE=14)
 *  — 4 backoff retries, then one final attempt (5 tries total). */
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return await fn();
    } catch (e) {
      const code = (e as { code?: number }).code;
      if (code !== 4 && code !== 14) throw e;
      const wait = 2000 * 2 ** attempt;
      console.log(`  retry ${attempt + 1}/4 on ${label} (code ${code}, ${wait}ms)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return fn();
}

/** Bounded-concurrency map — 8 in-flight doc enumerations at a time. */
async function mapConcurrent<T, R>(items: T[], fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(8, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Enumerate a doc's own subcollections so they archive with it. */
async function subcollectionDocs(
  docPath: string,
): Promise<{ path: string; data: FirebaseFirestore.DocumentData }[]> {
  const ref = db.doc(docPath);
  const subs = await withRetry(() => ref.listCollections(), docPath);
  const out: { path: string; data: FirebaseFirestore.DocumentData }[] = [];
  for (const sub of subs) {
    const snap = await withRetry(() => sub.get(), sub.path);
    const nested = await mapConcurrent(snap.docs, async (d) => [
      { path: d.ref.path, data: d.data() },
      ...(await subcollectionDocs(d.ref.path)),
    ]);
    for (const row of nested) out.push(...row);
  }
  return out;
}

async function main() {
  const targets = RETIRED.filter((t) => !only || [...only].some((o) => t.name === o || t.path === o));
  if (!APPLY && !ARCHIVE_ONLY) {
    console.log('DRY-RUN — pass --apply to archive+delete, --archive-only to archive without deleting.\n');
  }

  const summary: { name: string; docs: number; subDocs: number; skipped?: boolean }[] = [];
  for (const t of targets) {
    const archiveFile = join(ARCHIVE_DIR, `${t.name}.json`);
    if (RESUME && existsSync(archiveFile)) {
      console.log(`skip ${t.name} — archive exists (resume)`);
      summary.push({ name: t.name, docs: 0, subDocs: 0, skipped: true });
      continue;
    }
    console.log(`archiving ${t.path} …`);
    const snap = await withRetry(() => db.collection(t.path).get(), t.path);
    const rows: { path: string; data: unknown }[] = [];
    let subDocs = 0;
    let done = 0;
    const subRows = await mapConcurrent(snap.docs, async (d) => {
      const subs = await subcollectionDocs(d.ref.path);
      if (++done % 100 === 0) console.log(`  ${t.name}: ${done}/${snap.size} docs enumerated`);
      return [{ path: d.ref.path, data: d.data() }, ...subs];
    });
    for (const row of subRows) {
      subDocs += row.length - 1;
      rows.push(...row);
    }
    summary.push({ name: t.name, docs: snap.size, subDocs });

    if (APPLY || ARCHIVE_ONLY) {
      mkdirSync(ARCHIVE_DIR, { recursive: true });
      // Atomic write — a truncated archive must never satisfy the delete gate.
      const tmp = `${archiveFile}.tmp`;
      writeFileSync(tmp, JSON.stringify({ archivedAt: new Date().toISOString(), docs: rows }, null, 2));
      renameSync(tmp, archiveFile);
      console.log(`archived ${rows.length} doc(s) → ${archiveFile}`);
    }
  }

  console.log('\nCollection                          docs  subcol-docs');
  for (const s of summary) {
    console.log(`${s.name.padEnd(38)} ${String(s.docs).padStart(5)} ${String(s.subDocs).padStart(11)}`);
  }
  const total = summary.reduce((a, s) => a + s.docs + s.subDocs, 0);
  console.log(`${'TOTAL'.padEnd(38)} ${String(total).padStart(5)}\n`);

  if (APPLY && !ARCHIVE_ONLY) {
    for (const t of targets) {
      const archiveFile = join(ARCHIVE_DIR, `${t.name}.json`);
      let parsed: { docs?: unknown[] } | null = null;
      try {
        parsed = JSON.parse(readFileSync(archiveFile, 'utf8'));
      } catch { /* no/invalid archive */ }
      if (!parsed || !Array.isArray(parsed.docs)) {
        console.error(`REFUSING delete of ${t.path} — no valid archive at ${archiveFile}. Run --archive-only first.`);
        process.exit(1);
      }
      // recursiveDelete walks subcollections server-side — no enumeration
      // cost, deletes the collection in bulk batches.
      await withRetry(() => db.recursiveDelete(db.collection(t.path)), t.path);
      const check = await withRetry(() => db.collection(t.path).limit(1).get(), t.path);
      console.log(`deleted ${t.path} — remaining docs: ${check.size}`);
    }
    console.log('\nDone. Verify: npx tsx scripts/verify/data-pipeline-legacy-roots-1013.ts');
  } else if (!ARCHIVE_ONLY) {
    console.log('Dry-run complete — nothing was archived or deleted.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
