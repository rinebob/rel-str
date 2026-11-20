/**
 * Verifies the getLifecycleTopicIndex callable's handler (task #1635)
 * end-to-end: real ghLifecycleDeps wiring → real GitHub search + slim
 * nodes() batch → shared transforms → index response — everything
 * except the HTTP onCall wrapper.
 *
 * Index contract under test:
 *   - every topic root carries children: [] (no subIssues expansion)
 *   - root metadata intact: title/state/url/labels/updatedAt/Status
 *   - groupOrder + grouping parity with the monolith pipeline
 *   - ^Topic: root filter still applies
 *
 * Token: GITHUB_READ_TOKEN env, else `gh auth token` fallback (read-only).
 *
 * Usage: npx tsx scripts/verify/dev-tools-gh-lifecycle-1635-index.ts
 */

import { execSync } from 'node:child_process';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  handleGetLifecycleTopicIndex,
  ghLifecycleDeps,
} from '../../functions/src/gh-lifecycle/callables';
import type { LifecycleRepoRequest } from '../../shared/lifecycle-contracts';
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

const req = (data: LifecycleRepoRequest): CallableRequest<LifecycleRepoRequest> =>
  ({ data, auth: { uid: 'verify-script' } }) as CallableRequest<LifecycleRepoRequest>;

async function main(): Promise<void> {
  token();
  const deps = ghLifecycleDeps();

  console.log('\n--- getLifecycleTopicIndex (real GitHub, slim fetch) ---');
  const t0 = Date.now();
  const res = await handleGetLifecycleTopicIndex(
    req({ owner: 'rinebob', repo: 'rel-str' }), deps);
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`  index fetch took ${elapsed}s (monolith was 30-60s cold)`);

  check('topics returned', res.topics.length > 0, `${res.topics.length} topics`);
  check('topic #619 present', res.topics.some(t => t.number === 619));
  check('every root passes the ^Topic: filter',
    res.topics.every(t => isTopicRoot(t.title)),
    res.topics.filter(t => !isTopicRoot(t.title)).map(t => `#${t.number} "${t.title}"`).join('; '));
  check('every topic has children: [] — no subtree expansion',
    res.topics.every(t => Array.isArray(t.children) && t.children.length === 0),
    res.topics.filter(t => t.children.length > 0).map(t => `#${t.number} (${t.children.length} children)`).join('; '));
  check('every topic has number/title/state/url/updatedAt',
    res.topics.every(t => t.number > 0 && !!t.title && !!t.state && !!t.url && !!t.updatedAt));
  check('every topic carries labels[] (stage chips need them)',
    res.topics.every(t => Array.isArray(t.labels)),
    res.topics.filter(t => !Array.isArray(t.labels)).map(t => `#${t.number}`).join(','));
  check('every topic carries a group', res.topics.every(t => !!t.group));
  check('groupOrder array present', Array.isArray(res.groupOrder));
  check('fetchedAt stamped', /^\d{4}-\d{2}-\d{2}T/.test(res.fetchedAt));
  check('some topic has a project Status', res.topics.some(t => !!t.status),
    'no topic carried status — Status decode may be broken');
  check('nodeType is topic on every root', res.topics.every(t => t.nodeType === 'topic'));
  console.log(`  topics: ${res.topics.length}, groupOrder: [${res.groupOrder.join(', ')}]` +
    (res.groupingWarning ? `, warning: ${res.groupingWarning}` : ''));

  console.log('\n--- validation ---');
  const bad = await handleGetLifecycleTopicIndex(
    req({ owner: 'x', repo: 'y' }), deps).catch(e => e);
  check('unsupported repo → invalid-argument',
    bad?.code === 'invalid-argument', `got ${bad?.code ?? JSON.stringify(bad)}`);
  const unauth = await handleGetLifecycleTopicIndex(
    { data: { owner: 'rinebob', repo: 'rel-str' }, auth: undefined } as never,
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
