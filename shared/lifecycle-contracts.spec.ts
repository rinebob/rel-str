/**
 * Tests for the lifecycle-viewer shared contracts — assert the shape of
 * real buildTree/orderTopics output rather than hand-written fixtures, so
 * a contract change fails loudly
 * (Blueprint #633 / task #637).
 */

import {
  buildTree,
  orderTopics,
  type LifecycleRawIssue,
} from './lifecycle-tree';
import type {
  LifecycleTopicSection,
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

describe('LifecycleTopicSection shape (via orderTopics)', () => {
  it('is name + topics only', () => {
    const [node] = buildTree([raw], new Map(), new Map());
    const [section] = orderTopics([node], null);
    const s: LifecycleTopicSection = section;
    expect(Object.keys(s).sort()).toEqual(['name', 'topics']);
    expect(s.topics[0]).toBe(node);
  });
});

describe('LifecycleTreeResponse', () => {
  it('truncatedNodes is required; groupingWarning is optional', () => {
    const [node] = buildTree([raw], new Map(), new Map());
    const res: LifecycleTreeResponse = {
      sections: orderTopics([node], null),
      fetchedAt: '2026-09-28T00:00:00Z',
      truncatedNodes: 0,
    };
    expect(res.truncatedNodes).toBe(0);
    expect(res.groupingWarning).toBeUndefined();
    expect(Object.keys(res).sort()).toEqual(['fetchedAt', 'sections', 'truncatedNodes']);
  });
});
