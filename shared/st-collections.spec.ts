/**
 * @topic #984 — ST Firestore Reorg (task #997)
 *
 * Pins the canonical `st-`-prefixed collection/doc paths and the path-helper
 * contract both BE (functions) and FE (Angular) consume via `@st/collections`.
 */
import {
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
  ST_CONFIG_ROOT,
  ST_CONFIG_STATUS_DOC,
  ST_JOBS_SUBCOLLECTION_NAME,
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
  ST_ORDER_TICKETS_ROOT,
  ST_PAPER_TRADING_ROOT,
  ST_PORTFOLIO_ROOT,
  ST_POSITION_GROUPS_ROOT,
  ST_RUNS_ROOT,
  ST_SCANNER_LATEST_RUNS_ANCHOR,
  ST_SCANNER_PROPOSALS_ANCHOR,
  ST_SCANNER_ROOT,
  ST_SIGNALS_ROOT,
  ST_STRATEGY_INSTANCES_ROOT,
  ST_SYMBOL_LISTS_ROOT,
  ST_SYMBOLS_ROOT,
  StPaperTradingKind,
  StPortfolioKind,
  stRunJobsPath,
  stRunJobDocPath,
  stPaperTradingDocPath,
  stPaperTradingItemsPath,
  stPortfolioDocPath,
  stPortfolioItemsPath,
  stScannerLatestRunDocPath,
  stScannerLatestRunsPath,
  stScannerProposalDocPath,
  stScannerProposalsPath,
  stOptionsContractListDocId,
} from './st-collections';
import {
  PaperTradingKind,
  paperTradingItemsPath,
} from './paper-trading-ids';
import {
  PORTFOLIO_ATTRIBUTIONS_COLLECTION,
  PORTFOLIO_BUCKETS_COLLECTION,
} from './portfolio-allocation-ids';

const FLAT_ROOTS = [
  ST_SYMBOLS_ROOT,
  ST_SIGNALS_ROOT,
  ST_RUNS_ROOT,
  ST_ORDER_TICKETS_ROOT,
  ST_POSITION_GROUPS_ROOT,
  ST_STRATEGY_INSTANCES_ROOT,
  ST_CONFIG_ROOT,
  ST_SYMBOL_LISTS_ROOT,
  ST_BACKTEST_RUNS_ROOT,
  ST_BACKTEST_PERMUTATIONS_ROOT,
  ST_OPTIONS_REPLAY_RUNS_ROOT,
  ST_OPTIONS_CONTRACT_LISTS_ROOT,
] as const;

const ANCHORED_ROOTS = [ST_PAPER_TRADING_ROOT, ST_PORTFOLIO_ROOT, ST_SCANNER_ROOT] as const;

describe('st-collections roots', () => {
  it('exposes the canonical flat roots', () => {
    expect(ST_SYMBOLS_ROOT).toBe('st-symbols');
    expect(ST_SIGNALS_ROOT).toBe('st-signals');
    expect(ST_RUNS_ROOT).toBe('st-runs');
    expect(ST_ORDER_TICKETS_ROOT).toBe('st-order-tickets');
    expect(ST_POSITION_GROUPS_ROOT).toBe('st-position-groups');
    expect(ST_STRATEGY_INSTANCES_ROOT).toBe('st-strategy-instances');
    expect(ST_CONFIG_ROOT).toBe('st-config');
    expect(ST_SYMBOL_LISTS_ROOT).toBe('st-symbol-lists');
    expect(ST_BACKTEST_RUNS_ROOT).toBe('st-backtest-runs');
    expect(ST_BACKTEST_PERMUTATIONS_ROOT).toBe('st-backtest-permutations');
    expect(ST_OPTIONS_REPLAY_RUNS_ROOT).toBe('st-options-replay-runs');
    expect(ST_OPTIONS_CONTRACT_LISTS_ROOT).toBe('st-options-contract-lists');
  });

  it('pins renamed singleton ids (legacy current → status; jobs subcollection)', () => {
    expect(ST_CONFIG_STATUS_DOC).toBe('status');
    expect(ST_JOBS_SUBCOLLECTION_NAME).toBe('jobs');
  });

  it('flat roots are single path segments (collection paths)', () => {
    for (const root of FLAT_ROOTS) {
      expect(root.split('/')).toHaveLength(1);
      expect(root.startsWith('st-')).toBe(true);
    }
  });

  it('anchored roots are single path segments', () => {
    for (const root of ANCHORED_ROOTS) {
      expect(root.split('/')).toHaveLength(1);
      expect(root.startsWith('st-')).toBe(true);
    }
  });
});

describe('st-runs jobs path', () => {
  it('stRunJobsPath builds the jobs subcollection path', () => {
    expect(stRunJobsPath('run-abc')).toBe('st-runs/run-abc/jobs');
  });

  it('stRunJobsPath yields an odd segment count (collection path)', () => {
    expect(stRunJobsPath('run-abc').split('/').length % 2).toBe(1);
  });

  it('stRunJobDocPath builds a doc path (even segments)', () => {
    expect(stRunJobDocPath('run-abc', 'ADPT')).toBe('st-runs/run-abc/jobs/ADPT');
    expect(stRunJobDocPath('run-abc', 'ADPT').split('/').length % 2).toBe(0);
  });

  it('stRunJobDocPath uppercases the symbol', () => {
    expect(stRunJobDocPath('run-abc', 'adpt')).toBe('st-runs/run-abc/jobs/ADPT');
  });
});

describe('st-paper-trading anchored paths', () => {
  it('maps each kind to its anchor', () => {
    expect(stPaperTradingItemsPath(StPaperTradingKind.ACCOUNT)).toBe('st-paper-trading/accounts/items');
    expect(stPaperTradingItemsPath(StPaperTradingKind.TRADE)).toBe('st-paper-trading/trades/items');
    expect(stPaperTradingItemsPath(StPaperTradingKind.STATS)).toBe('st-paper-trading/stats/items');
    expect(stPaperTradingItemsPath(StPaperTradingKind.RAW_QUOTE)).toBe('st-paper-trading/raw-quotes/items');
  });

  it('carries exactly the migrated kind set (instances/cohorts moved out)', () => {
    expect(Object.values(StPaperTradingKind).sort()).toEqual([
      'account',
      'raw-quote',
      'stats',
      'trade',
    ]);
  });

  it('accepts legacy PaperTradingKind values cast-free for dual-write code', () => {
    expect(stPaperTradingItemsPath(PaperTradingKind.TRADE)).toBe('st-paper-trading/trades/items');
    expect(stPaperTradingItemsPath(PaperTradingKind.ACCOUNT)).toBe('st-paper-trading/accounts/items');
  });

  it('throws for kinds with no st-paper-trading anchor (instance/cohort)', () => {
    expect(() => stPaperTradingItemsPath(PaperTradingKind.INSTANCE)).toThrow(/no anchor/);
    expect(() => stPaperTradingItemsPath(PaperTradingKind.COHORT)).toThrow(/no anchor/);
  });

  it('throws for non-member strings incl. Object.prototype names', () => {
    // 'toString' is truthy via prototype lookup — must not build a path.
    expect(() => stPaperTradingItemsPath('toString' as StPaperTradingKind)).toThrow(/no anchor/);
  });

  it('st- paths mirror legacy anchors (drift pin)', () => {
    const stKinds = new Set<string>(Object.values(StPaperTradingKind));
    const sharedKinds = Object.values(PaperTradingKind).filter((k) => stKinds.has(k));
    for (const kind of sharedKinds) {
      expect(stPaperTradingItemsPath(kind)).toBe(`st-${paperTradingItemsPath(kind)}`);
    }
    expect(stPortfolioItemsPath(StPortfolioKind.BUCKET)).toBe(
      PORTFOLIO_BUCKETS_COLLECTION.replace('portfolio/', 'st-portfolio/'),
    );
    expect(stPortfolioItemsPath(StPortfolioKind.ATTRIBUTION)).toBe(
      PORTFOLIO_ATTRIBUTIONS_COLLECTION.replace('portfolio/', 'st-portfolio/'),
    );
  });

  it('items paths are collection paths (odd segments), doc paths even', () => {
    for (const kind of Object.values(StPaperTradingKind)) {
      expect(stPaperTradingItemsPath(kind).split('/').length % 2).toBe(1);
      expect(stPaperTradingDocPath(kind, 'doc-1').split('/').length % 2).toBe(0);
    }
    expect(stPaperTradingDocPath(StPaperTradingKind.TRADE, 'ADPT-260927-sig-EQ-01')).toBe(
      'st-paper-trading/trades/items/ADPT-260927-sig-EQ-01',
    );
  });
});

describe('st-portfolio anchored paths', () => {
  it('maps each kind to its anchor', () => {
    expect(stPortfolioItemsPath(StPortfolioKind.BUCKET)).toBe('st-portfolio/buckets/items');
    expect(stPortfolioItemsPath(StPortfolioKind.ATTRIBUTION)).toBe('st-portfolio/attributions/items');
  });

  it('items paths are collection paths (odd segments), doc paths even', () => {
    for (const kind of Object.values(StPortfolioKind)) {
      expect(stPortfolioItemsPath(kind).split('/').length % 2).toBe(1);
      expect(stPortfolioDocPath(kind, 'doc-1').split('/').length % 2).toBe(0);
    }
    expect(stPortfolioDocPath(StPortfolioKind.BUCKET, 'bucket-1')).toBe(
      'st-portfolio/buckets/items/bucket-1',
    );
  });

  it('throws for non-member strings (plural anchor is not a kind)', () => {
    expect(() => stPortfolioItemsPath('buckets' as StPortfolioKind)).toThrow(/no anchor/);
  });
});

describe('st-scanner anchored paths', () => {
  it('exposes the root and proposals anchor', () => {
    expect(ST_SCANNER_ROOT).toBe('st-scanner');
    expect(ST_SCANNER_PROPOSALS_ANCHOR).toBe('proposals');
  });

  it('stScannerProposalsPath builds the items collection path (odd segments)', () => {
    expect(stScannerProposalsPath()).toBe('st-scanner/proposals/items');
    expect(stScannerProposalsPath().split('/').length % 2).toBe(1);
  });

  it('stScannerProposalDocPath builds a doc path (even segments)', () => {
    expect(stScannerProposalDocPath('prop-1')).toBe('st-scanner/proposals/items/prop-1');
    expect(stScannerProposalDocPath('prop-1').split('/').length % 2).toBe(0);
  });

  it('exposes the latest-runs anchor (#1232/#1254)', () => {
    expect(ST_SCANNER_LATEST_RUNS_ANCHOR).toBe('latest-runs');
  });

  it('stScannerLatestRunsPath builds the items collection path (odd segments)', () => {
    expect(stScannerLatestRunsPath()).toBe('st-scanner/latest-runs/items');
    expect(stScannerLatestRunsPath().split('/').length % 2).toBe(1);
  });

  it('stScannerLatestRunDocPath builds a recipeId doc path (even segments)', () => {
    expect(stScannerLatestRunDocPath('quality-large')).toBe(
      'st-scanner/latest-runs/items/quality-large',
    );
    expect(stScannerLatestRunDocPath('quality-large').split('/').length % 2).toBe(0);
  });
});

describe('st-options selection-replay doc ids', () => {
  it('stOptionsContractListDocId builds {runId}_{symbol}', () => {
    expect(stOptionsContractListDocId('or-abc123', 'QQQ')).toBe('or-abc123_QQQ');
    expect(stOptionsContractListDocId('or-abc123', 'qqq')).toBe('or-abc123_QQQ');
  });
});
