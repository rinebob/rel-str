/**
 * Verifies the getLifecycleTree callable's handler (task #640) end-to-end:
 * real ghLifecycleDeps wiring → real GitHub fetch → shared transforms →
 * response shape — everything except the HTTP onCall wrapper.
 *
 * Token: GITHUB_READ_TOKEN env, else `gh auth token` fallback (read-only).
 *
 * Usage: npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts
 */

import { execSync } from 'node:child_process';
import type { CallableRequest } from 'firebase-functions/v2/https';
import {
  handleGetLifecycleTree,
  ghLifecycleDeps,
} from '../../functions/src/gh-lifecycle/callables';
import type { LifecycleNode, LifecycleRepoRequest } from '../../shared/lifecycle-contracts';

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

  console.log('\n--- getLifecycleTree handler, real deps (rel-str) ---');
  const res = await handleGetLifecycleTree(
    req({ owner: 'rinebob', repo: 'rel-str' }), deps);

  check('response parses to LifecycleTreeResponse v2 shape',
    Array.isArray(res.topics) && Array.isArray(res.groupOrder) &&
    typeof res.fetchedAt === 'string');
  check('no legacy sections key on the response',
    !('sections' in (res as object)));
  check('fetchedAt is fresh ISO', Date.now() - Date.parse(res.fetchedAt) < 60_000);
  check('topics non-empty', res.topics.length > 0, `${res.topics.length} topics`);
  check('every topic carries a group', res.topics.every(t => !!t.group));
  // Degrade path (doc 404/parse fail) yields groupOrder [] with all topics
  // Ungrouped — legitimate, signaled via groupingWarning below.
  check('every stamped group appears in groupOrder',
    res.groupOrder.length === 0 ||
    res.topics.every(t => res.groupOrder.includes(t.group)));
  const all: LifecycleNode[] = [];
  const walk = (ns: LifecycleNode[]) => {
    for (const n of ns) { all.push(n); if (n.children.length) walk(n.children); }
  };
  walk(res.topics);
  const t619 = all.find(t => t.number === 619);
  check('topic #619 emitted as nodeType topic', t619?.nodeType === 'topic');
  check('#619 contains thread #621',
    (t619?.children ?? []).some(c => c.number === 621 && c.nodeType === 'thread'));
  check('every node has number/title/state/url (recursive)', all.every(t =>
    t.number > 0 && !!t.title && (t.state === 'open' || t.state === 'closed') && !!t.url));
  check('nodes carry stageLabel (stages/threads labeled)', all.some(n => n.stageLabel));
  // Named groups only required when the inventory doc fetched and parsed.
  if (res.groupingWarning || res.groupOrder.length === 0) {
    console.log('  info no named groups — doc 404 or parse warning is legitimate');
  }
  if (res.groupingWarning) console.log(`  info groupingWarning: ${res.groupingWarning}`);

  console.log('\n--- validation (fixture deps) ---');
  const bad = await handleGetLifecycleTree(
    req({ owner: 'nobody', repo: 'elsewhere' }), deps).catch(e => e);
  check('unsupported repo → invalid-argument', bad?.code === 'invalid-argument',
    String(bad?.code));
  const unauth = await handleGetLifecycleTree(
    { data: { owner: 'rinebob', repo: 'rel-str' } } as any, deps).catch(e => e);
  check('no auth → unauthenticated', unauth?.code === 'unauthenticated',
    String(unauth?.code));

  console.log('\n=== ' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`) + ' ===');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('verify crashed:', err);
  process.exit(1);
});
