/**
 * Tests for the lifecycle-viewer shared contracts — assert the shape of
 * real buildTree/assignGroups output rather than hand-written fixtures, so
 * a contract change fails loudly
 * (Blueprint #633 / task #637, contract v2 in #1522).
 */

import {
  assignGroups,
  buildTree,
  UNGROUPED_SECTION,
  type LifecycleRawIssue,
} from './lifecycle-tree';
import type {
  LifecycleTopic,
  LifecycleTreeResponse,
} from './lifecycle-contracts';

const raw: LifecycleRawIssue = {
  number: 1,
  title: 'Task: something',
  state: 'OPEN',
  url: 'https://github.com/o/r/issues/1',
  labels: ['INTERNAL'],
  updatedAt: '2026-09-28T00:00:00Z',
};

describe('LifecycleNode shape (via buildTree)', () => {
  const [node] = buildTree([raw], new Map(), new Map());

  it('emits exactly the contract fields', () => {
    expect(Object.keys(node).sort()).toEqual([
      'children', 'labels', 'nodeType', 'number', 'state', 'title',
      'updatedAt', 'url',
    ]);
  });

  it('omits optional fields entirely when unset', () => {
    expect('stageLabel' in node).toBe(false);
    expect('status' in node).toBe(false);
  });

  it('includes optional fields when set', () => {
    const [n] = buildTree(
      [{ ...raw, labels: ['INTERNAL', '4_BACKLOG'] }],
      new Map(),
      new Map([[1, 'NOT STARTED']]),
    );
    expect(n.stageLabel).toBe('4_BACKLOG');
    expect(n.status).toBe('NOT STARTED');
  });
});

describe('LifecycleTopic shape (via assignGroups)', () => {
  it('is a LifecycleNode plus group', () => {
    const [node] = buildTree([raw], new Map(), new Map());
    const { topics } = assignGroups([node], null);
    const t: LifecycleTopic = topics[0];
    expect(t.group).toBe(UNGROUPED_SECTION);
    expect(Object.keys(t).sort()).toEqual([
      'children', 'group', 'labels', 'nodeType', 'number', 'state', 'title',
      'updatedAt', 'url',
    ]);
  });
});

describe('LifecycleTreeResponse', () => {
  it('flat topics + groupOrder + fetchedAt; groupingWarning optional', () => {
    const [node] = buildTree([raw], new Map(), new Map());
    const res: LifecycleTreeResponse = {
      ...assignGroups([node], null),
      fetchedAt: '2026-09-28T00:00:00Z',
    };
    expect(res.topics).toHaveLength(1);
    expect(res.topics[0].group).toBe(UNGROUPED_SECTION);
    expect(res.groupOrder).toEqual([]);
    expect(res.groupingWarning).toBeUndefined();
    expect(Object.keys(res).sort()).toEqual(['fetchedAt', 'groupOrder', 'topics']);
  });
});
