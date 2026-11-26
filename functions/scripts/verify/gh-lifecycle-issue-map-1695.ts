/**
 * @topic #619 — GitHub read-only issue UI (task #1695 / Blueprint #1694)
 *
 * Verify: issue-number → root map end-to-end.
 *
 * DRY (default, no env): handler-level checks through the real callables
 * with fixture deps — index emits the map, resolver returns root→issue
 * path + upserts every chain number, tree fetch syncs non-blockingly.
 *
 * `--live`: real seams —
 *   1. `fetchIssueAncestorChain` against real GitHub for a known deep
 *      issue (#1696 under Thread #1609 → root #619) — needs GITHUB_READ_TOKEN.
 *   2. `gh-lifecycle-issue-map/rinebob-rel-str` doc read — needs ADC
 *      (skips with a WARN, not a FAIL, when the doc hasn't been seeded).
 *
 *   npx tsx scripts/verify/gh-lifecycle-issue-map-1695.ts [--live]
 */

import {
  handleGetLifecycleTopicIndex,
  handleGetLifecycleTopicTree,
  type GhLifecycleDeps,
} from '../../src/gh-lifecycle/callables';
import { handleResolveLifecycleIssue } from '../../src/gh-lifecycle/resolve-callable';
import {
  buildTreeIssueMap,
  mapDocId,
  readIssueMap,
  ISSUE_MAP_COLLECTION,
} from '../../src/gh-lifecycle/issue-map';
import { fetchIssueAncestorChain } from '../../src/gh-lifecycle/lifecycle-fetch';
import { githubGql } from '../../src/gh-lifecycle/github-client';
import { SUPPORTED_REPOS } from '../../src/gh-lifecycle/config';
import type { LifecycleFetchResult } from '../../src/gh-lifecycle/lifecycle-fetch';
import type { LifecycleRawIssue } from '../../../shared/lifecycle-tree';
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { LifecycleResolveIssueRequest } from '../../../shared/lifecycle-contracts';

const LIVE = process.argv.includes('--live');
const entry = SUPPORTED_REPOS[0];

let passed = 0, failed = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { passed++; console.log(`OK   ${name}`); }
  else { failed++; console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`); }
};
const warn = (name: string, detail = '') => console.log(`WARN ${name}${detail ? ` — ${detail}` : ''}`);

const raw = (n: number, title = `Issue ${n}`): LifecycleRawIssue => ({
  number: n, title, state: 'OPEN',
  url: `https://github.com/rinebob/rel-str/issues/${n}`,
  labels: [], updatedAt: '2026-11-23T00:00:00Z',
});

const TREE: LifecycleFetchResult = {
  roots: [raw(619, 'Topic: GitHub read-only issue UI')],
  childrenOf: new Map([
    [619, [raw(1609, 'Thread: perf')]],
    [1609, [raw(1694)]],
    [1694, [raw(1695)]],
    [1695, []],
  ]),
  statusOf: new Map(),
  truncatedNodes: 0,
};

function fixtureDeps(overrides: Partial<GhLifecycleDeps> = {}): GhLifecycleDeps {
  return {
    fetchData: async () => TREE,
    fetchIndexData: async () => ({
      roots: TREE.roots, childrenOf: new Map(), statusOf: new Map(), truncatedNodes: 0,
    }),
    fetchTopicRef: async () => ({ number: 619, id: 'I_619', title: 'Topic: GitHub read-only issue UI' }),
    fetchSubtreeData: async () => TREE,
    readIssueMap: async () => ({ 1609: 619, 1695: 619 }),
    syncIssueMapFromTree: async () => undefined,
    upsertIssueMapEntries: async () => undefined,
    fetchIssueChain: async () => ({
      issue: raw(1695, 'BE-IMPL: issue-map'),
      ancestors: [raw(1694), raw(1609), raw(619, 'Topic: GitHub read-only issue UI')],
    }),
    ...overrides,
  };
}

const REQ = <T>(data: unknown) =>
  ({ data, auth: { uid: 'verify' } }) as unknown as CallableRequest<T>;

async function dry() {
  console.log('== inversion ==');
  const map = buildTreeIssueMap(TREE);
  check('every node maps to its topic root (root self-maps)',
    map[619] === 619 && map[1609] === 619 && map[1694] === 619 && map[1695] === 619
    && Object.keys(map).length === 4);
  check('doc id is owner-repo keyed', mapDocId(entry) === 'rinebob-rel-str');

  console.log('== index emit ==');
  const idx = await handleGetLifecycleTopicIndex(REQ({ owner: 'rinebob', repo: 'rel-str' }), fixtureDeps());
  check('index response carries issueMap', idx.issueMap?.[1695] === 619);
  const idxDegraded = await handleGetLifecycleTopicIndex(
    REQ({ owner: 'rinebob', repo: 'rel-str' }),
    fixtureDeps({ readIssueMap: async () => { throw new Error('firestore down'); } }),
  );
  check('map-read failure omits the field, topics still return',
    idxDegraded.issueMap === undefined && idxDegraded.topics[0].number === 619);

  console.log('== tree sync (non-blocking) ==');
  let synced = false;
  const tree = await handleGetLifecycleTopicTree(
    REQ({ owner: 'rinebob', repo: 'rel-str', topicNumber: 619 }),
    fixtureDeps({ syncIssueMapFromTree: async () => { synced = true; } }),
  );
  check('tree fetch synced the map', synced && tree.topics[0].number === 619);
  const treeSyncFail = await handleGetLifecycleTopicTree(
    REQ({ owner: 'rinebob', repo: 'rel-str', topicNumber: 619 }),
    fixtureDeps({ syncIssueMapFromTree: async () => { throw new Error('firestore down'); } }),
  );
  check('sync failure never fails the tree response', treeSyncFail.topics[0].number === 619);

  console.log('== resolver ==');
  let upserted: Record<number, number> | undefined;
  const res = await handleResolveLifecycleIssue(
    REQ<LifecycleResolveIssueRequest>({ owner: 'rinebob', repo: 'rel-str', issueNumber: 1695 }),
    fixtureDeps({ upsertIssueMapEntries: async (_e, e) => { upserted = e; } }),
  );
  check('path is root→issue inclusive', JSON.stringify(res.path) === '[619,1609,1694,1695]');
  check('resolver upserts every chain number → root',
    JSON.stringify(upserted) === '{"619":619,"1609":619,"1694":619,"1695":619}');
  const orphan = await handleResolveLifecycleIssue(
    REQ<LifecycleResolveIssueRequest>({ owner: 'rinebob', repo: 'rel-str', issueNumber: 7 }),
    fixtureDeps({ fetchIssueChain: async () => ({ issue: raw(7), ancestors: [] }) }),
  );
  check('issue with no topic ancestor → no path', orphan.issue.number === 7 && orphan.path === undefined);
  const nonTopic = await handleResolveLifecycleIssue(
    REQ<LifecycleResolveIssueRequest>({ owner: 'rinebob', repo: 'rel-str', issueNumber: 8 }),
    fixtureDeps({ fetchIssueChain: async () => ({ issue: raw(8), ancestors: [raw(9, 'Plain issue')] }) }),
  );
  check('non-Topic top ancestor → no path', nonTopic.path === undefined);
  const notFound = await handleResolveLifecycleIssue(
    REQ<LifecycleResolveIssueRequest>({ owner: 'rinebob', repo: 'rel-str', issueNumber: 999999 }),
    fixtureDeps({ fetchIssueChain: async () => null }),
  ).catch(e => e);
  check('unknown issue → not-found', (notFound as { code?: string }).code === 'not-found');
}

async function live() {
  const token = process.env.GITHUB_READ_TOKEN;
  if (!token) { warn('GITHUB_READ_TOKEN unset — skipping live GitHub checks'); return; }
  const gql = githubGql(token);

  console.log('== live parent-chain walk ==');
  const chain = await fetchIssueAncestorChain(entry, 1696, gql);
  check('#1696 resolves', chain?.issue.number === 1696);
  check('ancestor chain ends at Topic #619',
    chain?.ancestors[chain.ancestors.length - 1]?.number === 619
    && chain.ancestors.length >= 3);

  console.log('== live map doc ==');
  try {
    const { db } = await import('../../src/firebase-admin-init');
    const map = await readIssueMap(db, entry);
    if (Object.keys(map).length === 0) {
      warn(`${ISSUE_MAP_COLLECTION}/${mapDocId(entry)} empty or unseeded — run seed-gh-lifecycle-issue-map.ts --apply`);
    } else {
      check(`map doc populated (${Object.keys(map).length} entries)`, true);
      check('map knows a deep issue → #619', map[1696] === 619, `#1696→${map[1696]}`);
    }
  } catch (err) {
    warn(`Firestore doc read skipped — ${(err as Error).message}`);
  }
}

async function main() {
  console.log(LIVE ? '== gh-lifecycle issue-map verify — LIVE ==' : '== gh-lifecycle issue-map verify — DRY ==');
  await dry();
  if (LIVE) await live();
  console.log(`\n=== ${passed} passed, ${failed} failed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
