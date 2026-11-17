/**
 * @topic #619 — GitHub read-only issue UI, Thread #697
 * @task #1523 — SHARED: Label write contracts + system-label guard
 *
 * Fixture-shape tests for the label-management contracts and the
 * system-label guard the FE picker hides and the BE enforces.
 */
import {
  CATEGORY_LABELS,
  DOMAIN_LABELS,
  isSystemLabel,
  STAGE_LABEL_PATTERN,
  STRUCTURAL_LABELS,
  SYSTEM_LABEL_PATTERNS,
  type ListRepoLabelsResponse,
  type ManageRepoLabelRequest,
  type ManageRepoLabelResponse,
  type RepoLabel,
  type UpdateIssueLabelsRequest,
  type UpdateIssueLabelsResponse,
} from './lifecycle-labels';

describe('lifecycle-labels contracts', () => {
  it('RepoLabel mirrors the REST labels payload', () => {
    const label: RepoLabel = {
      name: 'DEV-TOOLS',
      color: 'a1b2c3',
      description: 'internal tooling',
    };
    const res: ListRepoLabelsResponse = {
      labels: [label],
      fetchedAt: '2026-11-15T00:00:00Z',
    };
    expect(res.labels[0].name).toBe('DEV-TOOLS');
  });

  it('UpdateIssueLabelsRequest carries add/remove name lists per issue', () => {
    const req: UpdateIssueLabelsRequest = {
      owner: 'rinebob',
      repo: 'rel-str',
      issueNumber: 1522,
      add: ['scratch'],
      remove: ['old-scratch', 'temp'],
    };
    expect(req.add).toHaveLength(1);
    expect(req.remove).toHaveLength(2);
    // Either side may be omitted entirely (remove-only / add-only ops).
    const removeOnly: UpdateIssueLabelsRequest = {
      owner: 'rinebob',
      repo: 'rel-str',
      issueNumber: 1,
      remove: ['x'],
    };
    expect(removeOnly.add).toBeUndefined();
  });

  it('UpdateIssueLabelsResponse reports final labels + minted names', () => {
    const res: UpdateIssueLabelsResponse = {
      labels: ['INTERNAL', 'DEV-TOOLS', 'scratch'],
      created: ['scratch'],
    };
    expect(res.created).toEqual(['scratch']);
  });

  it('ManageRepoLabelRequest op union covers create/update/delete', () => {
    const ops: ManageRepoLabelRequest['op'][] = ['create', 'update', 'delete'];
    for (const op of ops) {
      const req: ManageRepoLabelRequest = {
        owner: 'rinebob',
        repo: 'rel-str',
        op,
        name: 'scratch',
        ...(op === 'update' ? { newName: 'scratch-2' } : {}),
      };
      expect(req.op).toBe(op);
    }
  });

  it('ManageRepoLabelResponse carries the delete usage count', () => {
    const res: ManageRepoLabelResponse = { op: 'delete', usageCount: 3 };
    expect(res.usageCount).toBe(3);
  });
});

describe('STAGE_LABEL_PATTERN', () => {
  it.each([
    '1_IDEA', '2_PLAN', '3_BLUEPRINT', '4_BACKLOG',
    '5_IMPLEMENT', '6_REVIEW', '7_QA', '8_LIVE',
  ])('matches the workflow stage label %s', name => {
    expect(STAGE_LABEL_PATTERN.test(name)).toBe(true);
  });

  it.each(['9_FUTURE', 'IDEA', 'IMPL_5', '_5_IMPLEMENT', 'implement'])(
    'does not match non-stage name %s', name => {
      expect(STAGE_LABEL_PATTERN.test(name)).toBe(false);
    },
  );
});

describe('isSystemLabel', () => {
  it.each([
    '5_IMPLEMENT', '1_IDEA', // stage
    'IMPL', 'QA', 'BE', 'FE', 'SHARED', 'CONFIG', 'CHORE', 'DOCS',
    'BUG', 'TRIAGE', 'REFACTOR', 'TESTING', 'BLOCKED', 'WONTFIX', // structural
    'FEATURE', 'TECH DEBT', 'CORE', 'APP', 'PARTNER', 'INTERNAL',
    'MAINT', // Category
    'DEV-TOOLS', 'SAVANT-TRADER', 'OPTIONS', 'MULTI-LEG-SPREAD', // domain
  ])('excludes system label %s', name => {
    expect(isSystemLabel(name)).toBe(true);
  });

  it.each([...DOMAIN_LABELS])('excludes every mirrored domain label (%s)', name => {
    expect(isSystemLabel(name)).toBe(true);
  });

  it('pins the mirrored vocabulary — the manually-synced sets are content-checked', () => {
    // Literal lists, not set-vs-set identity: a drifted mirror fails here.
    expect([...STRUCTURAL_LABELS].sort()).toEqual([
      'BE', 'BLOCKED', 'BUG', 'CHORE', 'CONFIG', 'DOCS', 'FE', 'IMPL',
      'QA', 'REFACTOR', 'SHARED', 'TESTING', 'TRIAGE', 'WONTFIX',
    ]);
    expect([...CATEGORY_LABELS].sort()).toEqual([
      'APP', 'CORE', 'FEATURE', 'INTERNAL', 'MAINT', 'PARTNER', 'TECH DEBT',
    ]);
    expect([...DOMAIN_LABELS].sort()).toEqual([
      'BACKTEST', 'CHART-REVIEW', 'DATA-PIPELINE', 'DESIGN-SYSTEM',
      'DEV-TOOLS', 'FLEX-CHART', 'GALLERY-VIEW', 'HYBRID-QUOTE-PROVIDER',
      'INDICATOR-LIB', 'MULTI-LEG-SPREAD', 'OPTIONS', 'ORDER',
      'PAPER-TRADING', 'PORTFOLIO', 'RH-ACTUAL', 'RH-AGENT',
      'RH-AGENT-OBSERVATION', 'RH-FUNDAMENTALS', 'RH-MCP', 'RS',
      'RUN-DASHBOARD', 'SAV-TRAD-NAV', 'SAVANT-TRADER', 'SCREENSHOT',
      'SIGNAL-REVIEW', 'SPREAD-PRICING', 'SPREAD-VIEWER', 'STRAT-BUILD-UI',
      'STRAT-LIB', 'STRAT-MANAGE', 'STRATEGIES', 'SWING-ANALYSIS',
      'WATCHLIST', 'WORKFLOWS',
    ]);
    // The aggregate is exactly the union of the three named sets.
    expect(SYSTEM_LABEL_PATTERNS.size).toBe(
      STRUCTURAL_LABELS.size + CATEGORY_LABELS.size + DOMAIN_LABELS.size,
    );
  });

  it.each(['impl', 'Dev-Tools', 'core', 'wontfix'])(
    'matches case-insensitively — GitHub resolves %s to the taxonomy label',
    name => {
      expect(isSystemLabel(name)).toBe(true);
    },
  );

  it.each([
    'documentation', 'enhancement', 'good first issue', // GitHub defaults
    'my-scratch-label', 'wip-idea', 'zzz',
  ])('lets arbitrary user labels pass (%s)', name => {
    expect(isSystemLabel(name)).toBe(false);
  });
});
