/**
 * Tests for lifecycle-tree transforms — label decode, node typing, tree
 * assembly, inventory-group parsing, and topic ordering
 * (Blueprint #633 / task #637).
 */

import {
  buildTree,
  decodeLabels,
  nodeTypeFor,
  orderTopics,
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

describe('orderTopics', () => {
  const t = (n: number, updatedAt: string) => ({
    number: n, title: `Topic ${n}`, state: 'open' as const, url: `u${n}`,
    nodeType: 'topic' as const, labels: [], updatedAt, children: [],
  });

  it('orders groups by doc order, topics by doc order, ungrouped by updatedAt desc', () => {
    const topics = [t(10, '2026-09-01T00:00:00Z'), t(1, '2026-09-01T00:00:00Z'),
      t(2, '2026-09-20T00:00:00Z'), t(9, '2026-09-25T00:00:00Z')];
    const groups = [
      { name: 'A', topicNumbers: [2, 1] },
      { name: 'B', topicNumbers: [9] },
    ];
    const sections = orderTopics(topics, groups);
    expect(sections.map(s => s.name)).toEqual(['A', 'B', UNGROUPED_SECTION]);
    expect(sections[0].topics.map(x => x.number)).toEqual([2, 1]);
    expect(sections[2].topics.map(x => x.number)).toEqual([10]); // only ungrouped, desc
  });

  it('groups:null produces a single section sorted by updatedAt desc', () => {
    const topics = [t(1, '2026-09-01T00:00:00Z'), t(2, '2026-09-20T00:00:00Z')];
    const sections = orderTopics(topics, null);
    expect(sections).toEqual([{ name: UNGROUPED_SECTION, topics: [topics[1], topics[0]] }]);
  });

  it('drops stale group refs whose topic is absent', () => {
    const sections = orderTopics([t(9, '2026-09-01T00:00:00Z')], [
      { name: 'A', topicNumbers: [999, 9] },
    ]);
    expect(sections[0].topics.map(x => x.number)).toEqual([9]);
  });

  it('empty topic list still returns one Ungrouped section (sections never [])', () => {
    const sections = orderTopics([], [{ name: 'A', topicNumbers: [999] }]);
    expect(sections).toEqual([{ name: UNGROUPED_SECTION, topics: [] }]);
    expect(orderTopics([], null)).toEqual([{ name: UNGROUPED_SECTION, topics: [] }]);
  });
});
