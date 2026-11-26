/**
 * Verifies the lifecycle-viewer SHARED contract pipeline (task #637,
 * contract v2 in #1522):
 *   buildTree on a GitHub-shaped payload end-to-end
 *
 * Read-only, no credentials needed.
 *
 * Usage: npx tsx scripts/verify/dev-tools-lifecycle-contracts-637.ts
 */

import {
  buildTree,
  type LifecycleRawIssue,
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

// --- Full transform path on a GitHub-shaped payload -----------------------
console.log('\n--- buildTree (fixture payload) ---');
const raw = (
  number: number, labels: string[], updatedAt: string,
  state: LifecycleRawIssue['state'] = 'OPEN', title = `Issue ${number}`,
): LifecycleRawIssue => ({
  number, title, state, url: `https://github.com/rinebob/rel-str/issues/${number}`, labels, updatedAt,
});

const roots = [
  raw(619, ['INTERNAL', 'DEV-TOOLS', '3_BLUEPRINT'], '2026-09-28T00:00:00Z', 'OPEN', 'Topic: GitHub read-only issue UI'),
  raw(500, ['FEATURE', 'PORTFOLIO', '8_LIVE'], '2026-09-01T00:00:00Z', 'CLOSED', 'Topic: Old thing'),
  raw(594, ['FEATURE', 'SWING-ANALYSIS', '3_BLUEPRINT'], '2026-09-10T00:00:00Z', 'OPEN', 'Topic: Swing Analysis'),
];
const children = new Map<number, LifecycleRawIssue[]>([
  [619, [raw(621, ['3_BLUEPRINT', 'INTERNAL', 'DEV-TOOLS'], '2026-09-27T00:00:00Z', 'OPEN', 'Thread: Lifecycle viewer')]],
  [621, [
    raw(622, ['1_IDEA'], '2026-09-26T00:00:00Z', 'CLOSED', 'Idea: Lifecycle viewer'),
    raw(633, ['3_BLUEPRINT', 'SHARED', 'IMPL'], '2026-09-28T01:00:00Z', 'OPEN', 'SHARED Blueprint: Lifecycle viewer'),
  ]],
  [633, [raw(637, ['4_BACKLOG', 'SHARED', 'IMPL'], '2026-09-28T02:00:00Z', 'OPEN', 'SHARED-IMPL: contract')]],
]);
const status = new Map([[619, 'IN PROGRESS'], [621, 'IN PROGRESS']]);
const topics = buildTree(roots, children, status);

check('root typed as topic', topics[0].nodeType === 'topic');
check('thread typed as thread', topics[0].children[0].nodeType === 'thread');
check('stage issue typed as stage', topics[0].children[0].children[1].nodeType === 'stage');
check('task typed as task', topics[0].children[0].children[1].children[0].nodeType === 'task');
check('updatedAt propagates max up the tree', topics[0].updatedAt === '2026-09-28T02:00:00Z');
check('status mapped from project', topics[0].status === 'IN PROGRESS');
check('closed state normalized', topics[1].state === 'closed');
check('stage label decoded on the emitted node', topics[0].stageLabel === '3_BLUEPRINT');
check('non-stage labels retained as tags', topics[0].labels.includes('DEV-TOOLS'));
check('every fixture topic emitted exactly once', topics.length === 3);

console.log('\n=== ' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`) + ' ===');
process.exit(failures === 0 ? 0 : 1);
