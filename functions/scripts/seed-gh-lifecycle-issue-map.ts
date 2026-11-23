/**
 * @topic #619 — GitHub read-only issue UI (task #1695 / Blueprint #1694)
 *
 * One-time seed for the issueNumber → Topic-root map. Runs the existing
 * monolith `fetchLifecycleData` (full BFS — `childrenOf` covers every
 * issue in the hierarchy) and writes `entries` on
 * `gh-lifecycle-issue-map/{owner}-{repo}`.
 *
 * After the seed, `getLifecycleTopicTree` keeps the map fresh — every
 * fetched subtree upserts its nodes and prunes entries pointing at its
 * root that the tree no longer contains — and `resolveLifecycleIssue`
 * upserts cold misses on demand. Re-running this seed is safe; it merges.
 *
 *   cd functions && npx tsx scripts/seed-gh-lifecycle-issue-map.ts          # dry — census only
 *   cd functions && npx tsx scripts/seed-gh-lifecycle-issue-map.ts --apply  # write the map
 *
 * Env: GITHUB_READ_TOKEN (real repo read) + ADC with Firestore access
 * (--apply only; the dry run never opens the doc).
 */

import { FieldValue } from 'firebase-admin/firestore';

import { fetchLifecycleData } from '../src/gh-lifecycle/lifecycle-fetch';
import { githubGql } from '../src/gh-lifecycle/github-client';
import { SUPPORTED_REPOS } from '../src/gh-lifecycle/config';
import {
  buildTreeIssueMap,
  mapDocId,
  readIssueMap,
  ISSUE_MAP_COLLECTION,
} from '../src/gh-lifecycle/issue-map';

const APPLY = process.argv.includes('--apply');

async function main() {
  const token = process.env.GITHUB_READ_TOKEN;
  if (!token) throw new Error('GITHUB_READ_TOKEN is not set');
  const gql = githubGql(token);
  const { db } = APPLY ? await import('../src/firebase-admin-init').then(m => ({ db: m.db })) : { db: null };

  for (const entry of SUPPORTED_REPOS) {
    console.log(`— monolith BFS over ${entry.owner}/${entry.repo} —`);
    let data;
    try {
      data = await fetchLifecycleData(entry, gql);
    } catch (err) {
      // A supported repo with no lifecycle topics (e.g. av-proxy-api)
      // shouldn't sink the others' seed.
      console.warn(`skipped ${entry.owner}/${entry.repo}: ${err instanceof Error ? err.message : err}`);
      continue;
    }
    const map = buildTreeIssueMap(data);
    const roots = data.roots.length;
    const count = Object.keys(map).length;
    const sample = Object.entries(map).slice(0, 10)
      .map(([n, r]) => `#${n}→#${r}`).join(' ');
    console.log(`roots: ${roots} · issues mapped: ${count} · truncatedNodes: ${data.truncatedNodes}`);
    console.log(`sample: ${sample} …`);
    if (data.truncatedNodes > 0) {
      console.error('TRUNCATED — refusing to write an incomplete map');
      process.exit(1);
    }
    if (!APPLY || !db) continue;
    // A complete (untruncated) census can also prune: stored entries
    // absent from the map are reparented or deleted issues.
    const stored = await readIssueMap(db, entry);
    const nested: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(map)) nested[k] = v;
    let pruned = 0;
    for (const k of Object.keys(stored)) {
      if (map[Number(k)] === undefined) { nested[k] = FieldValue.delete(); pruned++; }
    }
    await db.collection(ISSUE_MAP_COLLECTION).doc(mapDocId(entry))
      .set({ entries: nested, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    console.log(`WROTE ${count} entries (pruned ${pruned} stale) → ${ISSUE_MAP_COLLECTION}/${mapDocId(entry)}`);
  }
  if (!APPLY) console.log('DRY — no write. Re-run with --apply to seed the doc.');
}

main().catch(err => { console.error(err); process.exit(1); });
