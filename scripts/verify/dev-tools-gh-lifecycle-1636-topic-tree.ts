/**
 * Verifies the getLifecycleTopicTree callable's handler (task #1636)
 * end-to-end: real ghLifecycleDeps wiring → real GitHub root probe +
 * shared BFS → shared transforms → per-topic response — everything
 * except the HTTP onCall wrapper.
 *
 * Contract under test:
 *   - probe + isTopicRoot guard: non-Topic: → invalid-argument;
 *     unknown number → not-found
 *   - single-root scoping: response carries exactly one topic
 *   - subtree fully walked: childrenOf populated (children nonempty
 *     for a topic known to have children)
 *   - metadata parity with the monolith pipeline
 *
 * Token: GITHUB_READ_TOKEN env, else `gh auth token` fallback (read-only).
 *
 * Usage: npx tsx scripts/verify/dev-tools-gh-lifecycle-1636-topic-tree.ts [topicNumber]
 *        topicNumber defaults to 619 (the Topic anchor for this work).
 */

import { execSync } from 'node:child_process';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  handleGetLifecycleTopicTree,
  ghLifecycleDeps,
} from '../../functions/src/gh-lifecycle/callables';
import type { LifecycleTopicTreeRequest } from '../../shared/lifecycle-contracts';
import { isTopicRoot } from '../../shared/lifecycle-tree';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function token(): void {
  if (process.env.GITHUB_READ_TOKEN) return;
  try {
    process.env.GITHUB_READ_TOKEN = execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    console.error('No GITHUB_READ_TOKEN and `gh auth token` failed');
    process.exit(2);
  }
}

const req = (data: LifecycleTopicTreeRequest): CallableRequest<LifecycleTopicTreeRequest> =>
  ({ data, auth: { uid: 'verify-script' } }) as CallableRequest<LifecycleTopicTreeRequest>;

async function main(): Promise<void> {
  token();
  const topicNumber = Number(process.argv[2] ?? 619);
  if (!Number.isInteger(topicNumber) || topicNumber <= 0) {
    console.error(`usage: topicNumber must be a positive integer, got "${process.argv[2]}"`);
    process.exit(2);
  }
  const deps = ghLifecycleDeps();

  console.log(`\n--- getLifecycleTopicTree #${topicNumber} (real GitHub, per-topic BFS) ---`);
  const t0 = Date.now();
  const res = await handleGetLifecycleTopicTree(
    req({ owner: 'rinebob', repo: 'rel-str', topicNumber }), deps);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  subtree fetch took ${elapsed}s`);

  check('exactly one topic returned', res.topics.length === 1, `${res.topics.length} topics`);
  const topic = res.topics[0];
  check('it is the requested topic', topic.number === topicNumber, `got #${topic.number}`);
  check('root passes the ^Topic: filter', isTopicRoot(topic.title));
  check('subtree was actually walked (non-empty children)',
    topic.children.length > 0, '0 children — BFS did not expand');
  check('root metadata intact (title/state/url/updatedAt)',
    !!topic.title && !!topic.state && !!topic.url && !!topic.updatedAt);
  check('labels[] present', Array.isArray(topic.labels));
  check('nodeType is topic', topic.nodeType === 'topic');
  check('descendants carry nodeTypes', topic.children.every(c => !!c.nodeType));
  check('fetchedAt stamped', /^\d{4}-\d{2}-\d{2}T/.test(res.fetchedAt));
  const count = (nodes: typeof topic.children): number =>
    nodes.reduce((acc, n) => acc + 1 + count(n.children), 0);
  console.log(`  #${topic.number} "${topic.title}" — ${count(topic.children)} descendants, ` +
    `status "${topic.status ?? '(unset)'}"`);

  console.log('\n--- guard paths ---');
  // A direct Thread child of the topic — exists but is not a Topic: root.
  const nonTopic = await handleGetLifecycleTopicTree(
    req({ owner: 'rinebob', repo: 'rel-str', topicNumber: 697 }), deps).catch(e => e);
  check('non-Topic: issue → invalid-argument',
    nonTopic?.code === 'invalid-argument', `got ${nonTopic?.code ?? 'no error'}`);
  const unknown = await handleGetLifecycleTopicTree(
    req({ owner: 'rinebob', repo: 'rel-str', topicNumber: 999999 }), deps).catch(e => e);
  check('unknown number → not-found',
    unknown?.code === 'not-found', `got ${unknown?.code ?? 'no error'}`);
  const badNum = await handleGetLifecycleTopicTree(
    req({ owner: 'rinebob', repo: 'rel-str', topicNumber: 0 }), deps).catch(e => e);
  check('topicNumber 0 → invalid-argument',
    badNum?.code === 'invalid-argument', `got ${badNum?.code ?? 'no error'}`);
  const badRepo = await handleGetLifecycleTopicTree(
    req({ owner: 'x', repo: 'y', topicNumber }), deps).catch(e => e);
  check('unsupported repo → invalid-argument',
    badRepo?.code === 'invalid-argument', `got ${badRepo?.code ?? 'no error'}`);
  const unauth = await handleGetLifecycleTopicTree(
    { data: { owner: 'rinebob', repo: 'rel-str', topicNumber }, auth: undefined } as never,
    deps).catch(e => e);
  check('unauthenticated → unauthenticated',
    unauth?.code === 'unauthenticated', `got ${unauth?.code ?? 'no error'}`);

  console.log('\n=== ' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`) + ' ===');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('verify crashed:', err);
  process.exit(1);
});
