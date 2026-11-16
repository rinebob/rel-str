/**
 * Verifies the lifecycle-viewer SHARED contract pipeline (task #637,
 * contract v2 in #1522):
 *   1. parseInventoryGroups against the real docs/dev-notes/TOPICS-INVENTORY.md
 *   2. buildTree + assignGroups on a GitHub-shaped payload end-to-end
 *
 * Read-only, no credentials needed.
 *
 * Usage: npx tsx scripts/verify/dev-tools-lifecycle-contracts-637.ts
 */

import { readFileSync } from 'node:fs';
import {
  assignGroups,
  buildTree,
  parseInventoryGroups,
  UNGROUPED_SECTION,
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

// --- 1. Inventory doc parse (real file) -------------------------------------
console.log('\n--- parseInventoryGroups (real TOPICS-INVENTORY.md) ---');
const md = readFileSync('docs/dev-notes/TOPICS-INVENTORY.md', 'utf8');
const groups = parseInventoryGroups(md);
check('parses ≥1 group', !!groups && groups.length > 0);
check('every group has ≥1 topic', !!groups && groups.every(g => g.topicNumbers.length > 0));
if (groups) {
  console.log(`  groups: ${groups.map(g => `"${g.name}" (${g.topicNumbers.length})`).join(', ')}`);
}

// --- 2. Full transform path on a GitHub-shaped payload -----------------------
console.log('\n--- buildTree + assignGroups (fixture payload) ---');
const raw = (
  number: number, labels: string[], updatedAt: string,
  state: LifecycleRawIssue['state'] = 'OPEN', title = `Issue ${number}`,
): LifecycleRawIssue => ({
  number, title, state, url: `https://github.com/rinebob/rel-str/issues/${number}`, labels, updatedAt,
});

const roots = [
  raw(619, ['INTERNAL', 'DEV-TOOLS', '3_BLUEPRINT'], '2026-09-28T00:00:00Z', 'OPEN', 'Topic: GitHub read-only issue UI'),
  raw(500, ['FEATURE', 'PORTFOLIO', '8_LIVE'], '2026-09-01T00:00:00Z', 'CLOSED', 'Topic: Old thing'),
  raw(594, ['FEATURE', 'SWING-ANALYSIS', '3_BLUEPRINT'], '2026-09-10T00:00:00Z', 'OPEN', 'Topic: Swing Analysis'), // 594 is listed in the real TOPICS-INVENTORY.md
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
const trees = buildTree(roots, children, status);

check('root typed as topic', trees[0].nodeType === 'topic');
check('thread typed as thread', trees[0].children[0].nodeType === 'thread');
check('stage issue typed as stage', trees[0].children[0].children[1].nodeType === 'stage');
check('task typed as task', trees[0].children[0].children[1].children[0].nodeType === 'task');
check('updatedAt propagates max up the tree', trees[0].updatedAt === '2026-09-28T02:00:00Z');
check('status mapped from project', trees[0].status === 'IN PROGRESS');
check('closed state normalized', trees[1].state === 'closed');
check('stage label decoded on the emitted node', trees[0].stageLabel === '3_BLUEPRINT');
check('non-stage labels retained as tags', trees[0].labels.includes('DEV-TOOLS'));

const { topics, groupOrder } = assignGroups(trees, groups);
check('topics non-empty', topics.length > 0);
check('every fixture topic emitted exactly once', topics.length === trees.length);
const t594 = topics.find(t => t.number === 594);
check('inventory-listed topic (#594) stamped with a named group, not Ungrouped',
  !!t594 && t594.group !== UNGROUPED_SECTION,
  t594 ? `stamped "${t594.group}"` : 'missing entirely');
check('groupOrder covers every stamped group',
  groupOrder.length === 0 || topics.every(t => groupOrder.includes(t.group)));
const flat = assignGroups(trees, null);
check('groups:null → all Ungrouped + empty groupOrder',
  flat.topics.every(t => t.group === UNGROUPED_SECTION) &&
  flat.groupOrder.length === 0);

console.log('\n=== ' + (failures === 0 ? 'ALL CHECKS PASSED' : `${failures} FAILURES`) + ' ===');
process.exit(failures === 0 ? 0 : 1);
