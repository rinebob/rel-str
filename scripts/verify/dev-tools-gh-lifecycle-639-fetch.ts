/**
 * Verifies the gh-lifecycle fetch shell (task #639) against REAL GitHub:
 *   1. SUPPORTED_REPOS resolves rel-str
 *   2. fetchLifecycleData walks the real topic tree end-to-end
 *      (search → batched nodes → subIssues pagination → status decode)
 *   3. fetchFileText reads the real TOPICS-INVENTORY.md
 *   4. Shared transforms (buildTree → parseInventoryGroups → orderTopics)
 *      assemble the fetched payload into sections
 *
 * Token: GITHUB_READ_TOKEN env, else `gh auth token` fallback.
 * Read-only — no mutations, no Firestore.
 *
 * Usage: npx tsx scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts
 */

import { execSync } from 'node:child_process';
import {
  fetchLifecycleData,
  fetchFileText,
  githubGql,
} from '../../functions/src/gh-lifecycle/github-client';
import { SUPPORTED_REPOS } from '../../functions/src/gh-lifecycle/config';
import {
  buildTree,
  orderTopics,
  parseInventoryGroups,
} from '../../shared/lifecycle-tree';

let failures = 0;
function check(label: string, cond: boolean, detail = ''): void {
  if (cond) {
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function token(): string {
  if (process.env.GITHUB_READ_TOKEN) return process.env.GITHUB_READ_TOKEN;
  try {
    return execSync('gh auth token', { encoding: 'utf8' }).trim();
  } catch {
    console.error('No GITHUB_READ_TOKEN and `gh auth token` failed');
    process.exit(2);
  }
}

async function main(): Promise<void> {
  const entry = SUPPORTED_REPOS.find(r => r.owner === 'rinebob' && r.repo === 'rel-str');
  check('SUPPORTED_REPOS contains rinebob/rel-str', !!entry);
  if (!entry) process.exit(1);

  console.log('\n--- fetchLifecycleData (real GitHub BFS) ---');
  const tok = token();
  const res = await fetchLifecycleData(entry, githubGql(tok));
  check('topic roots found', res.roots.length > 0, `${res.roots.length} roots`);
  check('truncatedNodes === 0', res.truncatedNodes === 0, String(res.truncatedNodes));
  const t619 = res.roots.find(r => r.number === 619);
  check('topic #619 present', !!t619);
  check('#619 has children incl. thread #621',
    (res.childrenOf.get(619) ?? []).some(c => c.number === 621));
  check('every root has number/title/state/url',
    res.roots.every(r => r.number > 0 && !!r.title && !!r.state && !!r.url));
  check('statusOf populated for rel-str', res.statusOf.size > 0, `${res.statusOf.size}`);
  console.log(`  roots: ${res.roots.length}, nodes with children: ${res.childrenOf.size}, statuses: ${res.statusOf.size}`);

  console.log('\n--- fetchFileText (real TOPICS-INVENTORY.md) ---');
  const md = await fetchFileText(tok, entry, 'docs/dev-notes/TOPICS-INVENTORY.md');
  check('inventory doc fetched', !!md && md.includes('## Open Topics'));

  console.log('\n--- shared transforms over real payload ---');
  const trees = buildTree(res.roots, res.childrenOf, res.statusOf);
  const groups = md ? parseInventoryGroups(md) : null;
  const sections = orderTopics(trees, groups);
  check('buildTree emits topic nodes', trees.every(t => t.nodeType === 'topic'));
  check('sections non-empty', sections.length > 0, `${sections.length} sections`);
  check('#619 lands in a section', sections.some(s => s.topics.some(t => t.number === 619)));

  console.log('\n=== ' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`) + ' ===');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('verify crashed:', err);
  process.exit(1);
});
