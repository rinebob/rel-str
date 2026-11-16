/**
 * Tests for lifecycle-tree transforms — label decode, node typing, tree
 * assembly, inventory-group parsing, and group assignment
 * (Blueprint #633 / task #637, contract v2 in #1522).
 */

import {
  assignGroups,
  buildTree,
  decodeLabels,
  isTopicRoot,
  nodeTypeFor,
  parseInventoryGroups,
  UNGROUPED_SECTION,
  type LifecycleRawIssue,
} from './lifecycle-tree';

function raw(
  number: number,
  labels: string[] = [],
  updatedAt = '2026-09-01T00:00:00Z',
  state: LifecycleRawIssue['state'] = 'OPEN',
  title = `Issue ${number}`,
): LifecycleRawIssue {
  return { number, title, state, url: `https://github.com/o/r/issues/${number}`, labels, updatedAt };
}

describe('decodeLabels', () => {
  it('detects a stage label and preserves the rest as tags in order', () => {
    expect(decodeLabels(['INTERNAL', '5_IMPLEMENT', 'DEV-TOOLS', 'IMPL'])).toEqual({
      stageLabel: '5_IMPLEMENT',
      tags: ['INTERNAL', 'DEV-TOOLS', 'IMPL'],
    });
  });

  it('returns no stageLabel when none match', () => {
    expect(decodeLabels(['INTERNAL', 'BE'])).toEqual({ stageLabel: undefined, tags: ['INTERNAL', 'BE'] });
  });

  it('does not treat non-stage labels as stage labels', () => {
    expect(decodeLabels(['TECH DEBT', 'PAPER-TRADING'])).toEqual({
      stageLabel: undefined,
      tags: ['TECH DEBT', 'PAPER-TRADING'],
    });
  });

  it('rejects lowercase and out-of-vocabulary lookalikes', () => {
    expect(decodeLabels(['1_idea']).stageLabel).toBeUndefined();
    expect(decodeLabels(['9_DEPLOY', '42_ANYTHING']).stageLabel).toBeUndefined();
  });

  it('two stage labels → highest ordinal wins, the stale one is dropped from tags', () => {
    expect(decodeLabels(['INTERNAL', '4_BACKLOG', '5_IMPLEMENT'])).toEqual({
      stageLabel: '5_IMPLEMENT',
      tags: ['INTERNAL'],
    });
  });
});

describe('nodeTypeFor', () => {
  it('depth 0 is always a topic regardless of title', () => {
    expect(nodeTypeFor('Anything', 0)).toBe('topic');
  });

  it.each([
    ['Thread: Lifecycle viewer', 'thread'],
    ['Idea: Lifecycle viewer', 'stage'],
    ['Plan: Lifecycle viewer', 'stage'],
    ['Review: something', 'stage'],
    ['QA: something', 'stage'],
    ['BE Blueprint: Lifecycle viewer', 'stage'],
    ['SHARED Blueprint: contracts', 'stage'],
    ['BE-IMPL: fetch shell', 'task'],
    ['Anything else', 'task'],
  ])('maps "%s" → %s', (title, expected) => {
    expect(nodeTypeFor(title, 1)).toBe(expected);
  });
});

describe('buildTree', () => {
  it('assembles a topic-rooted tree and propagates max updatedAt', () => {
    const roots = [raw(1, ['3_BLUEPRINT'])];
    const children = new Map<number, LifecycleRawIssue[]>([
      [1, [raw(10, ['3_BLUEPRINT'], '2026-09-20T00:00:00Z')]],
      [10, [raw(20, [], '2026-09-27T00:00:00Z'), raw(21, ['4_BACKLOG'], '2026-09-15T00:00:00Z')]],
    ]);
    const status = new Map([[10, 'IN PROGRESS']]);
    const [tree] = buildTree(roots, children, status);

    expect(tree.number).toBe(1);
    expect(tree.stageLabel).toBe('3_BLUEPRINT');
    expect(tree.children.map(c => c.number)).toEqual([10]);
    const thread = tree.children[0];
    expect(thread.status).toBe('IN PROGRESS');
    expect(thread.children.map(c => c.number)).toEqual([20, 21]);
    expect(tree.updatedAt).toBe('2026-09-27T00:00:00Z');
    expect(thread.updatedAt).toBe('2026-09-27T00:00:00Z');
    expect(thread.children[1].updatedAt).toBe('2026-09-15T00:00:00Z');
  });

  it('expands a node seen under two parents only at its first occurrence', () => {
    const roots = [raw(1), raw(2)];
    const shared = raw(9, [], '2026-09-10T00:00:00Z');
    const children = new Map<number, LifecycleRawIssue[]>([
      [1, [shared]],
      [2, [shared]],
    ]);
    const [a, b] = buildTree(roots, children, new Map());
    expect(a.children[0].number).toBe(9);
    expect(b.children).toEqual([]);
  });

  it('returns empty arrays for missing children/status lookups', () => {
    const [tree] = buildTree([raw(5)], new Map(), new Map());
    expect(tree.children).toEqual([]);
    expect(tree.status).toBeUndefined();
  });

  it('decodes the stage label on a closed issue', () => {
    const [tree] = buildTree([raw(7, ['8_LIVE'], '2026-09-01T00:00:00Z', 'CLOSED')], new Map(), new Map());
    expect(tree.state).toBe('closed');
    expect(tree.stageLabel).toBe('8_LIVE');
  });

  it('a root that is also a child of an earlier root is not re-emitted', () => {
    const roots = [raw(1), raw(9)];
    const children = new Map<number, LifecycleRawIssue[]>([[1, [raw(9)]]]);
    const trees = buildTree(roots, children, new Map());
    expect(trees.map(t => t.number)).toEqual([1]);
    expect(trees[0].children[0].number).toBe(9);
  });

  it('terminates on a cycle (a → b → a)', () => {
    const children = new Map<number, LifecycleRawIssue[]>([
      [1, [raw(2)]],
      [2, [raw(1)]],
    ]);
    const [tree] = buildTree([raw(1)], children, new Map());
    expect(tree.children[0].number).toBe(2);
    expect(tree.children[0].children).toEqual([]);
  });

  it('root-first order pins the inverse: 9 as root means 1 loses its child', () => {
    const roots = [raw(9), raw(1)];
    const children = new Map<number, LifecycleRawIssue[]>([[1, [raw(9)]]]);
    const trees = buildTree(roots, children, new Map());
    expect(trees.map(t => t.number)).toEqual([9, 1]);
    expect(trees[1].children).toEqual([]);
  });

  it('deep nesting composes: topic → thread → stage → task → subtask', () => {
    const children = new Map<number, LifecycleRawIssue[]>([
      [1, [raw(10, [], '2026-09-02T00:00:00Z', 'OPEN', 'Thread: X')]],
      [10, [raw(20, [], '2026-09-03T00:00:00Z', 'OPEN', 'Plan: X')]],
      [20, [raw(30, [], '2026-09-04T00:00:00Z')]],
      [30, [raw(40, [], '2026-09-05T00:00:00Z')]],
    ]);
    const [tree] = buildTree([raw(1)], children, new Map());
    const thread = tree.children[0];
    const stage = thread.children[0];
    const task = stage.children[0];
    expect(thread.nodeType).toBe('thread');
    expect(stage.nodeType).toBe('stage');
    expect(task.nodeType).toBe('task');
    expect(task.children[0].nodeType).toBe('task');
    expect(tree.updatedAt).toBe('2026-09-05T00:00:00Z');
  });
});

describe('parseInventoryGroups', () => {
  const md = [
    '# Topics Inventory',
    '',
    '## Open Topics',
    '',
    '### A. Trading UX',
    '',
    '- **[#593 - Watchlist](https://github.com/o/r/issues/593)** — `WATCHLIST` — `8_LIVE`',
    '  - [#599 - thread](https://github.com/o/r/issues/599) — nested rows ignored',
    '- **[#594 - Swing](https://github.com/o/r/issues/594)** — `SWING-ANALYSIS` — `3_BLUEPRINT`',
    '',
    '### B. Dev Tools',
    '',
    '- **[#619 - GH UI](https://github.com/o/r/issues/619)** — `DEV-TOOLS` — `3_BLUEPRINT`',
    '',
    '## Closed Topics',
    '',
    '### C. Old',
    '- **[#1](https://github.com/o/r/issues/1)** — old — `X` — `8_LIVE`',
  ].join('\n');

  it('parses group names + topic numbers from the Open Topics section', () => {
    expect(parseInventoryGroups(md)).toEqual([
      { name: 'A. Trading UX', topicNumbers: [593, 594] },
      { name: 'B. Dev Tools', topicNumbers: [619] },
    ]);
  });

  it('returns null when the doc has no Open Topics section', () => {
    expect(parseInventoryGroups('# Topics\n\nnothing here')).toBeNull();
  });

  it('returns null when the section has no groups', () => {
    expect(parseInventoryGroups('## Open Topics\n\n*None.*\n\n## Closed Topics')).toBeNull();
  });

  it('a topic listed under two groups belongs to the first', () => {
    const dup = [
      '## Open Topics',
      '### A. One', '- **[#5](https://github.com/o/r/issues/5)** — x',
      '### B. Two', '- **[#5](https://github.com/o/r/issues/5)** — x', '- **[#6](https://github.com/o/r/issues/6)** — y',
    ].join('\n');
    const groups = parseInventoryGroups(dup)!;
    expect(groups[0].topicNumbers).toEqual([5]);
    expect(groups[1].topicNumbers).toEqual([6]);
  });
});

describe('isTopicRoot', () => {
  it.each(['Topic: x', 'TOPIC: x', 'topic: x', '  Topic: padded'])(
    'accepts %p', (title) => {
      expect(isTopicRoot(title)).toBe(true);
    });

  it.each([
    'Thread: Topic Viewer polish',
    'INVENTORY: Topic Viewer',
    'Idea: Topic Viewer',
    'Not a topic at all',
    '',
  ])('rejects %p', (title) => {
    expect(isTopicRoot(title)).toBe(false);
  });
});

describe('assignGroups', () => {
  const t = (n: number, updatedAt: string) => ({
    number: n, title: `Topic ${n}`, state: 'open' as const, url: `u${n}`,
    nodeType: 'topic' as const, labels: [], updatedAt, children: [],
  });

  it('stamps group per root and emits doc-order groupOrder; no sorting', () => {
    const topics = [t(10, '2026-09-01T00:00:00Z'), t(1, '2026-09-01T00:00:00Z'),
      t(2, '2026-09-20T00:00:00Z'), t(9, '2026-09-25T00:00:00Z')];
    const groups = [
      { name: 'A', topicNumbers: [2, 1] },
      { name: 'B', topicNumbers: [9] },
    ];
    const { topics: out, groupOrder } = assignGroups(topics, groups);
    expect(groupOrder).toEqual(['A', 'B', UNGROUPED_SECTION]);
    const byNum = new Map(out.map(x => [x.number, x.group]));
    expect(byNum.get(1)).toBe('A');
    expect(byNum.get(2)).toBe('A');
    expect(byNum.get(9)).toBe('B');
    expect(byNum.get(10)).toBe(UNGROUPED_SECTION);
    // Input order preserved — ordering is a consumer concern.
    expect(out.map(x => x.number)).toEqual([10, 1, 2, 9]);
  });

  it('groups:null → every root Ungrouped, empty groupOrder', () => {
    const { topics: out, groupOrder } = assignGroups(
      [t(1, '2026-09-01T00:00:00Z'), t(2, '2026-09-20T00:00:00Z')], null);
    expect(out.every(x => x.group === UNGROUPED_SECTION)).toBe(true);
    expect(groupOrder).toEqual([]);
  });

  it('no Ungrouped entry appended when every root is grouped', () => {
    const { groupOrder } = assignGroups([t(9, '2026-09-01T00:00:00Z')], [
      { name: 'A', topicNumbers: [999, 9] }, // stale 999 ref — harmless
    ]);
    expect(groupOrder).toEqual(['A']);
  });

  it('dedupes groupOrder — repeated doc section names and a doc section named "Ungrouped"', () => {
    const { groupOrder } = assignGroups([
      t(1, '2026-09-01T00:00:00Z'), t(9, '2026-09-20T00:00:00Z'),
      t(5, '2026-09-10T00:00:00Z'), // unlisted — exercises the append guard
    ], [
      { name: 'A', topicNumbers: [1] },
      { name: 'A', topicNumbers: [9] },
      { name: 'Ungrouped', topicNumbers: [9] },
    ]);
    expect(groupOrder).toEqual(['A', 'Ungrouped']);
  });

  it('empty roots → empty topics; groupOrder still mirrors the doc', () => {
    const { topics: out, groupOrder } = assignGroups([], [
      { name: 'A', topicNumbers: [999] },
    ]);
    expect(out).toEqual([]);
    expect(groupOrder).toEqual(['A']);
    expect(assignGroups([], null)).toEqual({ topics: [], groupOrder: [] });
  });
});
