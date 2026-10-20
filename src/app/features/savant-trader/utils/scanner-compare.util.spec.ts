/**
 * Specs for scanner-compare.util — discovery + prune bucketing (#1098/#1138).
 *
 * Semantics settled by live probe (2026-10-20): a scoped+filtered
 * preview_scan returns only matchers, so a failing tracked symbol and a
 * scanner-uncovered one are indistinguishable from ONE call. Prune
 * therefore takes two eval outputs — `coverage` (unfiltered scope +
 * columns: every covered symbol returns, values populated) and `matched`
 * (filtered eval: passers). dead = ¬covered; drop = covered ∧ ¬matched
 * ∧ ¬noData, carrying the coverage row's values as dropDetail.
 *
 * `truncated` is an input flag — the caller derives it via the shared
 * isScanTruncated contract (both cap cases covered in
 * shared/scanner-contracts.spec.ts).
 */
import type { PreviewScanResult } from '@robinhood-mcp/contracts';
import { isScanTruncated } from '@st/scanner';
import type { ScanRow } from './scanner-rows.util';
import { compareDiscovery, comparePrune } from './scanner-compare.util';

const row = (symbol: string, values: Record<string, string> = {}): ScanRow => ({
  symbol,
  name: '',
  instrumentType: 'EQUITY',
  values,
  tracked: false,
});

const none = () => false;

describe('compareDiscovery (#1138)', () => {
  it('stamps tracked flags and buckets matched ∩ ¬tracked as addCandidates', () => {
    const rows = [row('AAPL'), row('NEWCO'), row('MSFT')];
    const res = compareDiscovery(
      rows,
      new Set(['AAPL', 'MSFT', 'ORPHAN']),
      false,
    );
    expect(res.rows.map((r) => r.tracked)).toEqual([true, false, true]);
    expect(res.buckets.addCandidates).toEqual(['NEWCO']);
    expect(res.buckets.dropCandidates).toEqual([]);
    expect(res.buckets.deadSymbols).toEqual([]);
    expect(res.buckets.noDataSymbols).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it('carries the truncated flag through', () => {
    const res = compareDiscovery([row('A')], new Set(), true);
    expect(res.truncated).toBe(true);
  });

  it('empty results + empty universe → empty everything, not an error', () => {
    const res = compareDiscovery([], new Set(), false);
    expect(res.buckets.addCandidates).toEqual([]);
    expect(res.truncated).toBe(false);
  });

  it('dedupes repeated tickers in the matched set', () => {
    const res = compareDiscovery([row('NEW'), row('NEW')], new Set(), false);
    expect(res.buckets.addCandidates).toEqual(['NEW']);
  });
});

describe('comparePrune (#1138)', () => {
  const blankKeyMetrics = (r: ScanRow) =>
    r.values['ROE'] === undefined && r.values['NPM'] === undefined;

  it('partitions the universe: passed keep / covered-failed drop / uncovered dead / blank no-data', () => {
    const coverage = [
      row('KEEP', { ROE: '0.2', NPM: '0.3' }),
      row('DROP', { ROE: '-0.4', NPM: '-0.1' }),
      row('NODATA', {}),
    ];
    const matched = [row('KEEP', { ROE: '0.2', NPM: '0.3' })];
    const res = comparePrune({
      coverage,
      matched,
      tracked: ['KEEP', 'DROP', 'NODATA', 'DEAD'],
      unevaluated: [],
      noDataPred: blankKeyMetrics,
      truncated: false,
    });
    expect(res.buckets.deadSymbols).toEqual(['DEAD']);
    expect(res.buckets.noDataSymbols).toEqual(['NODATA']);
    expect(res.buckets.dropCandidates).toEqual(['DROP']);
    expect(res.dropDetail['DROP']).toEqual({ ROE: '-0.4', NPM: '-0.1' });
  });

  it('unevaluated chunk symbols are flagged separately — not dead, not dropped', () => {
    const res = comparePrune({
      coverage: [row('KEEP', { ROE: '0.2' })],
      matched: [row('KEEP', { ROE: '0.2' })],
      tracked: ['KEEP', 'LOST-CHUNK'],
      unevaluated: ['LOST-CHUNK'],
      noDataPred: none,
      truncated: false,
    });
    expect(res.buckets.deadSymbols).toEqual([]);
    expect(res.buckets.dropCandidates).toEqual([]);
    expect(res.unevaluated).toEqual(['LOST-CHUNK']);
  });

  it('coverage evidence wins over a stale unevaluated entry', () => {
    const res = comparePrune({
      coverage: [row('BOTH', { ROE: '-1' })],
      matched: [],
      tracked: ['BOTH'],
      unevaluated: ['BOTH'], // contradictory input — the row is proof
      noDataPred: none,
      truncated: false,
    });
    expect(res.buckets.deadSymbols).toEqual([]);
    expect(res.buckets.dropCandidates).toEqual(['BOTH']);
    // …and the surfaced unevaluated list doesn't double-report it.
    expect(res.unevaluated).toEqual([]);
  });

  it('matched evidence also beats dead — a matched-only symbol is not dead', () => {
    // Coverage eval missed it but the filtered eval returned it —
    // absence-from-every-response is the dead test, not coverage alone.
    const res = comparePrune({
      coverage: [],
      matched: [row('PASSER', { ROE: '0.2' })],
      tracked: ['PASSER'],
      unevaluated: [],
      noDataPred: none,
      truncated: false,
    });
    expect(res.buckets.deadSymbols).toEqual([]);
    expect(res.buckets.dropCandidates).toEqual([]);
    expect(res.rows.find((r) => r.symbol === 'PASSER')?.tracked).toBe(true);
  });

  it('no-data beats pass: a matched row whose key metrics read blank → noDataSymbols', () => {
    // The canonicalization-drift case noDataPred exists for: backend
    // says pass, the row's metric cells are blank client-side.
    const res = comparePrune({
      coverage: [row('DRIFT', {})],
      matched: [row('DRIFT', {})],
      tracked: ['DRIFT'],
      unevaluated: [],
      noDataPred: blankKeyMetrics,
      truncated: false,
    });
    expect(res.buckets.noDataSymbols).toEqual(['DRIFT']);
    expect(res.buckets.dropCandidates).toEqual([]);
  });

  it('display rows = coverage ∪ matched deduped; dead symbols have no row', () => {
    const res = comparePrune({
      coverage: [row('KEEP', { ROE: '0.2' }), row('DROP', { ROE: '-1' })],
      matched: [row('KEEP', { ROE: '0.2' }), row('NEW')],
      tracked: ['KEEP', 'DROP', 'DEAD'],
      unevaluated: [],
      noDataPred: none,
      truncated: false,
    });
    expect(res.rows.map((r) => r.symbol)).toEqual(['KEEP', 'DROP', 'NEW']);
    expect(res.rows.find((r) => r.symbol === 'DEAD')).toBeUndefined();
    expect(res.rows.find((r) => r.symbol === 'DROP')?.tracked).toBe(true);
  });

  it('dropDetail is a copy — mutating a display row does not corrupt it', () => {
    const res = comparePrune({
      coverage: [row('DROP', { ROE: '-1' })],
      matched: [],
      tracked: ['DROP'],
      unevaluated: [],
      noDataPred: none,
      truncated: false,
    });
    res.rows[0].values['ROE'] = 'mutated';
    expect(res.dropDetail['DROP']['ROE']).toBe('-1');
  });

  it('a covered-but-unmatched untracked symbol is not a drop candidate', () => {
    // Coverage evals the tracked universe only — but guard anyway.
    const res = comparePrune({
      coverage: [row('STRANGER', { ROE: '-1' })],
      matched: [],
      tracked: ['KEEP'],
      unevaluated: [],
      noDataPred: none,
      truncated: false,
    });
    expect(res.buckets.dropCandidates).toEqual([]);
    expect(res.buckets.deadSymbols).toEqual(['KEEP']);
  });

  it('untracked matched rows stamp tracked=false; matched tracked rows stamp true', () => {
    const res = comparePrune({
      coverage: [row('KEEP', { ROE: '0.2' })],
      matched: [row('KEEP', { ROE: '0.2' }), row('NEW')],
      tracked: ['KEEP'],
      unevaluated: [],
      noDataPred: none,
      truncated: false,
    });
    const keep = res.rows.find((r) => r.symbol === 'KEEP')!;
    const add = res.rows.find((r) => r.symbol === 'NEW')!;
    expect(keep.tracked).toBe(true);
    expect(add.tracked).toBe(false);
    expect(res.buckets.addCandidates).toEqual(['NEW']);
  });

  it('no-data rows are not drop candidates even when unmatched', () => {
    const res = comparePrune({
      coverage: [row('BLANK', {})],
      matched: [],
      tracked: ['BLANK'],
      unevaluated: [],
      noDataPred: blankKeyMetrics,
      truncated: false,
    });
    expect(res.buckets.noDataSymbols).toEqual(['BLANK']);
    expect(res.buckets.dropCandidates).toEqual([]);
    expect(res.dropDetail['BLANK']).toBeUndefined();
  });

  it('symbol matching is case-insensitive and whitespace-tolerant', () => {
    const res = comparePrune({
      coverage: [row('aapl', { ROE: '0.2' })],
      matched: [row(' AAPL ', { ROE: '0.2' })],
      tracked: ['AAPL'],
      unevaluated: [],
      noDataPred: none,
      truncated: false,
    });
    expect(res.buckets.deadSymbols).toEqual([]);
    expect(res.buckets.dropCandidates).toEqual([]);
  });

  it('empty universe → all buckets empty', () => {
    const res = comparePrune({
      coverage: [],
      matched: [],
      tracked: [],
      unevaluated: [],
      noDataPred: none,
      truncated: false,
    });
    expect(res.buckets).toEqual({
      addCandidates: [],
      dropCandidates: [],
      deadSymbols: [],
      noDataSymbols: [],
    });
    expect(res.unevaluated).toEqual([]);
  });

  it('empty results + non-empty universe → everything dead except unevaluated', () => {
    const res = comparePrune({
      coverage: [],
      matched: [],
      tracked: ['A', 'B', 'C'],
      unevaluated: ['C'],
      noDataPred: none,
      truncated: false,
    });
    expect(res.buckets.deadSymbols.sort()).toEqual(['A', 'B']);
    expect(res.unevaluated).toEqual(['C']);
  });

  it('dropDetail keys only cover drop candidates', () => {
    const res = comparePrune({
      coverage: [row('KEEP', { ROE: '0.2' }), row('DROP', { ROE: '-1' })],
      matched: [row('KEEP', { ROE: '0.2' })],
      tracked: ['KEEP', 'DROP', 'DEAD'],
      unevaluated: [],
      noDataPred: none,
      truncated: false,
    });
    expect(Object.keys(res.dropDetail)).toEqual(['DROP']);
  });

  it('carries the truncated flag through', () => {
    const res = comparePrune({
      coverage: [],
      matched: [],
      tracked: [],
      unevaluated: [],
      noDataPred: none,
      truncated: true,
    });
    expect(res.truncated).toBe(true);
  });
});

describe('truncation boundary (#1138)', () => {
  // The caller derives `truncated` via the shared isScanTruncated rule —
  // pin the boundary here so both cap forms land in this suite.
  const result = (total: number, rows: number): PreviewScanResult => ({
    total_items: total,
    results: Array.from({ length: rows }, () => ({
      ticker: 'X',
      instrument_id: 'i',
      instrument_type: 'EQUITY',
      columns: {},
    })),
    sorted_by: 'Last desc',
    filters_applied: [],
  });

  it('total-items cap (393 total > 200 rows) flags the compare', () => {
    expect(compareDiscovery([], new Set(), isScanTruncated(result(393, 200))).truncated).toBe(true);
  });

  it('row cap (200/200 ambiguous full page) flags the compare', () => {
    expect(compareDiscovery([], new Set(), isScanTruncated(result(200, 200))).truncated).toBe(true);
  });

  it('non-capped result does not flag', () => {
    expect(compareDiscovery([], new Set(), isScanTruncated(result(45, 45))).truncated).toBe(false);
  });

  it('partial page (total 300 > 100 rows) flags — the total>rows rule, not just the caps', () => {
    expect(compareDiscovery([], new Set(), isScanTruncated(result(300, 100))).truncated).toBe(true);
  });
});
