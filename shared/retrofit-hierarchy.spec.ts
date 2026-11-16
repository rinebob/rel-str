/**
 * Retrofit-hierarchy specs — pure parse/diff/plan/apply logic behind
 * scripts/retrofit-gh-subissues.ts (task #1524). The read transport seam is
 * exercised via fixture IssueReaders — the pipeline's highest testable seam.
 */
import { isTopicRoot } from './lifecycle-tree';
import {
  extractDeclaredRefs,
  resolveEdges,
  diffEdges,
  partitionBlockedCycles,
  planRetrofit,
  applyEdges,
  type IntendedEdge,
  type RetrofitIssue,
  type MutationOps,
} from './retrofit-hierarchy';

describe('isTopicRoot', () => {
  it.each([
    ['Topic: GitHub read-only issue UI', true],
    ['TOPIC: Strategy Builder', true],
    ['topic: lowercase', true],
    ['Thread: Topic Viewer UI polish', false],
    ['INVENTORY: Topic Viewer misc-fixes lane', false],
    ['Idea: Topic Viewer UI polish & misc fixes', false],
    ['SHARED Blueprint — contract v2', false],
    ['Post-ship polish: topic list', false],
  ])('%s → %s', (title, expected) => {
    expect(isTopicRoot(title)).toBe(expected);
  });
});

const LEGACY_TOPIC_BODY = [
  '**Topic:** Strategy Builder UI',
  '',
  '## Stage Issues',
  '',
  '- Idea #138 — Complete',
  '- Plan #141 — Complete',
  '- QA BE #153 — Resolved',
  '- QA FE #155 — Resolved',
  '',
  '## Blueprint Issues',
  '',
  '- SHARED Blueprint #142',
  '  - Task #145 — Closed',
  '- BE Blueprint #143',
  '  - Task #146 — Closed',
  '- FE Blueprint #144',
  '  - Task #147 — Closed',
  '  - Task #148 — Resolved',
  '  - Task #149 — Closed',
  '  - Task #157 — Closed',
  '',
  '## Threads',
  '',
  '- Thread #621 — Lifecycle viewer — 3_BLUEPRINT — In Progress',
  '- [Thread: Topic Viewer UI polish](https://github.com/rinebob/rel-str/issues/697) — topic-viewer-polish — In Progress',
  '',
  '## Tasks',
  '',
  '- [INVENTORY: misc-fixes lane](https://github.com/rinebob/rel-str/issues/713) — #713',
  '',
  '## Docs',
  '',
  '- See #999 — not structural, must not be extracted',
].join('\n');

describe('extractDeclaredRefs', () => {
  it('extracts refs from structural sections only, preserving indent', () => {
    const refs = extractDeclaredRefs(LEGACY_TOPIC_BODY);
    expect(refs.map((r) => r.issue)).toEqual([
      138, 141, 153, 155,            // Stage Issues
      142, 145, 143, 146, 144, 147, 148, 149, 157, // Blueprint Issues
      621, 697,                       // Threads
      713,                            // Tasks
    ]);
    expect(refs.map((r) => r.issue)).not.toContain(999);
  });

  it('marks nested bullets with a deeper indent level', () => {
    const refs = extractDeclaredRefs(LEGACY_TOPIC_BODY);
    const byIssue = new Map(refs.map((r) => [r.issue, r.indent]));
    expect(byIssue.get(142)).toBe(0);
    expect(byIssue.get(145)).toBe(1);
    expect(byIssue.get(157)).toBe(1);
    expect(byIssue.get(621)).toBe(0);
  });

  it('extracts every ref in a multi-issue bullet at the same indent', () => {
    const body = [
      '## Blueprint Issues',
      '- SHARED Blueprint #633 / BE Blueprint #634 / FE Blueprint #635 — In Progress',
    ].join('\n');
    const refs = extractDeclaredRefs(body);
    expect(refs.map((r) => r.issue)).toEqual([633, 634, 635]);
    expect(refs.every((r) => r.indent === 0)).toBe(true);
  });

  it('stops a structural section at the next heading', () => {
    const body = [
      '## Threads',
      '- Thread #621',
      '## Description',
      '- mentions #42 in prose',
    ].join('\n');
    expect(extractDeclaredRefs(body).map((r) => r.issue)).toEqual([621]);
  });

  it('ignores bullets outside structural sections', () => {
    const body = ['## Description', '- related to #55'].join('\n');
    expect(extractDeclaredRefs(body)).toEqual([]);
  });
});

describe('resolveEdges', () => {
  it('resolves top-level refs to the anchor and indented refs to their enclosing issue', () => {
    const refs = extractDeclaredRefs(LEGACY_TOPIC_BODY);
    const edges = resolveEdges(137, refs);
    expect(edges).toContainEqual({ parent: 137, child: 138 });
    expect(edges).toContainEqual({ parent: 137, child: 142 });
    expect(edges).toContainEqual({ parent: 142, child: 145 });
    expect(edges).toContainEqual({ parent: 143, child: 146 });
    expect(edges).toContainEqual({ parent: 144, child: 157 });
    expect(edges).toContainEqual({ parent: 137, child: 621 });
    expect(edges).toContainEqual({ parent: 137, child: 713 });
    expect(edges).toHaveLength(16);
  });

  it('gives multi-ref bullets the same parent', () => {
    const body = ['## Blueprint Issues', '- A #10 / B #11 / C #12', '  - Task #20'].join('\n');
    const edges = resolveEdges(1, extractDeclaredRefs(body));
    expect(edges).toEqual([
      { parent: 1, child: 10 },
      { parent: 1, child: 11 },
      { parent: 1, child: 12 },
      { parent: 12, child: 20 },
    ]);
  });

  it('dedupes a child declared twice and skips self-edges', () => {
    const body = ['## Stage Issues', '- Idea #1', '- Idea #1', '- Self #99'].join('\n');
    const edges = resolveEdges(99, extractDeclaredRefs(body));
    expect(edges).toEqual([{ parent: 99, child: 1 }]);
  });
});

describe('diffEdges', () => {
  const intended = [
    { parent: 137, child: 154 },
    { parent: 137, child: 138 },
    { parent: 137, child: 142 },
    { parent: 137, child: 200 },
    { parent: 137, child: 999 },
  ];

  it('partitions edges into proposed / alreadyCorrect / conflicts / unresolved', () => {
    const parentOf = new Map<number, number | null>([
      [154, 137],
      [138, null],
      [142, 261],
      [200, null],
      // 999 absent — could not be fetched
    ]);
    const diff = diffEdges(intended, parentOf);
    expect(diff.alreadyCorrect).toEqual([{ parent: 137, child: 154 }]);
    expect(diff.proposed).toEqual([
      { parent: 137, child: 138 },
      { parent: 137, child: 200 },
    ]);
    expect(diff.conflicts).toEqual([{ parent: 137, child: 142, actualParent: 261 }]);
    expect(diff.unresolved).toEqual([{ parent: 137, child: 999 }]);
  });

  it('proposes nothing when every edge is already correct', () => {
    const parentOf = new Map<number, number | null>([[154, 137]]);
    const diff = diffEdges([{ parent: 137, child: 154 }], parentOf);
    expect(diff.proposed).toEqual([]);
    expect(diff.conflicts).toEqual([]);
  });
});

describe('partitionBlockedCycles', () => {
  const resolverOf = (live: Map<number, number | null>) =>
    async (n: number) => live.get(n) ?? null;

  it('blocks an edge whose child is already an ancestor of the parent', async () => {
    // Inverted pair: #142's live parent is #145, so #145 under #142 cycles.
    const [kept, blocked] = await partitionBlockedCycles(
      [{ parent: 142, child: 145 }],
      resolverOf(new Map([[142, 145], [145, null]])),
    );
    expect(kept).toEqual([]);
    expect(blocked).toEqual([{ parent: 142, child: 145, via: 145 }]);
  });

  it('blocks a two-edge proposed cycle', async () => {
    const [kept, blocked] = await partitionBlockedCycles(
      [{ parent: 50, child: 60 }, { parent: 60, child: 50 }],
      resolverOf(new Map([[50, 60], [60, 50]])),
    );
    expect(kept).toEqual([]);
    expect(blocked).toHaveLength(2);
  });

  it('keeps edges whose ancestors never reach the child', async () => {
    const [kept, blocked] = await partitionBlockedCycles(
      [{ parent: 10, child: 20 }],
      resolverOf(new Map([[10, 99]])),
    );
    expect(kept).toEqual([{ parent: 10, child: 20 }]);
    expect(blocked).toEqual([]);
  });
});

describe('planRetrofit', () => {
  function issue(n: number, overrides: Partial<RetrofitIssue> = {}): RetrofitIssue {
    return {
      id: `I_${n}`, number: n, title: `Issue ${n}`, state: 'OPEN',
      stateReason: null, body: '', parentNumber: null, ...overrides,
    };
  }
  const readerOf = (issues: RetrofitIssue[]) => {
    const byNum = new Map(issues.map((i) => [i.number, i]));
    return async (numbers: number[]) => new Map(numbers.map((n) => [n, byNum.get(n) ?? null]));
  };

  it('walks declared children through descendant bodies (BFS)', async () => {
    const plan = await planRetrofit(
      [1],
      readerOf([
        issue(1, { body: '## Stage Issues\n- Idea #2\n## Blueprint Issues\n- BP #3\n  - Task #4' }),
        issue(3, { body: '## Tasks\n- Extra #5' }),
      ]),
    );
    const keys = plan.intended.map((e) => `${e.parent}->${e.child}`);
    expect(keys).toEqual(['1->2', '1->3', '3->4', '3->5']);
  });

  it('marks a child declared under two issues as superseded, not silently dropped', async () => {
    const plan = await planRetrofit(
      [1],
      readerOf([
        issue(1, { body: '## Threads\n- T #2\n- T #3' }),
        issue(2, { body: '## Tasks\n- X #9' }),
        issue(3, { body: '## Tasks\n- X #9' }),
      ]),
    );
    expect(plan.intended).toContainEqual({ parent: 2, child: 9 });
    expect(plan.superseded).toEqual([{ parent: 3, child: 9, declaredBy: 2 }]);
  });

  it('skips edges that would nest an anchor under a descendant', async () => {
    const plan = await planRetrofit(
      [1],
      readerOf([
        issue(1, { body: '## Threads\n- T #2' }),
        issue(2, { body: '## Tasks\n- Back #1' }),
      ]),
    );
    expect(plan.intended).toEqual([{ parent: 1, child: 2 }]);
    expect(plan.skippedAnchorChildren).toEqual([{ parent: 2, child: 1 }]);
  });

  it('reports children that fail to resolve as unresolved', async () => {
    const plan = await planRetrofit(
      [1],
      readerOf([issue(1, { body: '## Stage Issues\n- Idea #7' })]),
    );
    expect(plan.diff.unresolved).toEqual([{ parent: 1, child: 7 }]);
  });

  it('blocks a cycle whose intermediate ancestor was never declared (lazy fetch)', async () => {
    // #9 under #1 is proposed; #1's live parent is #7 (undeclared — not in
    // the BFS); #7's parent is #9. The walk must lazily fetch #7 to see the
    // cycle — this is the case GitHub rejected server-side in production.
    const plan = await planRetrofit(
      [1],
      readerOf([
        issue(1, { body: '## Stage Issues\n- X #9', parentNumber: 7 }),
        issue(7, { parentNumber: 9 }),
        issue(9, { parentNumber: null }),
      ]),
    );
    expect(plan.diff.proposed).toEqual([]);
    expect(plan.blocked).toEqual([{ parent: 1, child: 9, via: 9 }]);
  });

  it('partitions proposed vs already-correct vs conflicts from live parents', async () => {
    const plan = await planRetrofit(
      [1],
      readerOf([
        issue(1, { body: '## Stage Issues\n- A #2\n- B #3\n- C #4' }),
        issue(2, { parentNumber: 1 }),
        issue(3),
        issue(4, { parentNumber: 99 }),
      ]),
    );
    expect(plan.diff.alreadyCorrect).toEqual([{ parent: 1, child: 2 }]);
    expect(plan.diff.proposed).toEqual([{ parent: 1, child: 3 }]);
    expect(plan.diff.conflicts).toEqual([{ parent: 1, child: 4, actualParent: 99 }]);
  });
});

describe('applyEdges', () => {
  function fakeOps(calls: string[], overrides: Partial<MutationOps> = {}): MutationOps {
    return {
      addSubIssue: (p, c) => calls.push(`link:${p}->${c}`),
      setIssueState: (id, open, reason) =>
        calls.push(`${open ? 'reopen' : 'close'}:${id}${reason ? `:${reason}` : ''}`),
      log: () => undefined,
      ...overrides,
    };
  }
  const details = new Map([
    [1, { id: 'P1', state: 'OPEN', stateReason: null }],
    [2, { id: 'P2', state: 'CLOSED', stateReason: 'NOT_PLANNED' }],
    [3, { id: 'P3', state: 'CLOSED', stateReason: 'COMPLETED' }],
    [10, { id: 'C10', state: 'CLOSED', stateReason: null }],
    [20, { id: 'C20', state: 'CLOSED', stateReason: null }],
  ]);

  it('links directly under an open parent with no state calls', () => {
    const calls: string[] = [];
    const res = applyEdges([{ parent: 1, child: 10 }], details, fakeOps(calls));
    expect(res.applied).toEqual([{ parent: 1, child: 10 }]);
    expect(calls).toEqual(['link:P1->C10']);
  });

  it('reopens a closed parent, links, then re-closes — in order', () => {
    const calls: string[] = [];
    applyEdges([{ parent: 3, child: 20 }], details, fakeOps(calls));
    expect(calls).toEqual(['reopen:P3', 'link:P3->C20', 'close:P3:COMPLETED']);
  });

  it('restores the original stateReason on re-close', () => {
    const calls: string[] = [];
    applyEdges([{ parent: 2, child: 20 }], details, fakeOps(calls));
    expect(calls).toContain('close:P2:NOT_PLANNED');
  });

  it('still re-closes the parent when the link fails', () => {
    const calls: string[] = [];
    const ops = fakeOps(calls, { addSubIssue: () => { throw new Error('boom'); } });
    const res = applyEdges([{ parent: 2, child: 20 }], details, ops);
    expect(res.failed).toHaveLength(1);
    expect(res.applied).toEqual([]);
    expect(calls.indexOf('close:P2:NOT_PLANNED')).toBeGreaterThan(calls.indexOf('reopen:P2'));
  });

  it('records a failure when fetched detail is missing', () => {
    const res = applyEdges([{ parent: 1, child: 999 }], details, fakeOps([]));
    expect(res.failed).toEqual([{ edge: { parent: 1, child: 999 }, error: 'missing fetched detail' }]);
  });
});
