/**
 * @topic #1243 — Option Contract Time-Series Viewer | @task #1337
 *
 * Pure generator utils — query assembly, client-side refine, pair-line
 * emission (IMPL FE-1, TEST-FE unit targets).
 */
import {
  isInvertedRange,
  refineContracts,
  toAvailabilityQuery,
  toPairLines,
  type GeneratorQueryState,
  type GeneratorRefineState,
} from './option-group-generator.utils';
import type { ContractAvailabilityEntry } from '../../../../../shared/options-contract-contracts';

const baseQuery = (over: Partial<GeneratorQueryState> = {}): GeneratorQueryState => ({
  type: 'BOTH',
  ...over,
});

describe('toAvailabilityQuery', () => {
  it('emits only the fields that are set — optional params absent, not null', () => {
    const q = toAvailabilityQuery('QQQ', baseQuery({}));
    expect(q).toEqual({ symbol: 'QQQ' });
  });

  it('maps every axis verbatim (SA param names at the boundary)', () => {
    const q = toAvailabilityQuery('QQQ', baseQuery({
      expirationGte: '2026-05-01',
      expirationLte: '2026-08-31',
      strikeGte: 500,
      strikeLte: 600,
      strikeStep: 10,
      type: 'C',
      firstObservedLte: '2026-03-01',
    }));
    expect(q).toEqual({
      symbol: 'QQQ',
      expirationGte: '2026-05-01',
      expirationLte: '2026-08-31',
      strikeGte: 500,
      strikeLte: 600,
      strikeStep: 10,
      type: 'C',
      firstObservedLte: '2026-03-01',
    });
  });

  it('type BOTH is omitted from the wire (endpoint default)', () => {
    expect(toAvailabilityQuery('QQQ', baseQuery({ type: 'BOTH' }))).not.toHaveProperty('type');
    expect(toAvailabilityQuery('QQQ', baseQuery({ type: 'P' })).type).toBe('P');
  });

  it('a non-empty explicit expirations list overrides the range — range fields are dropped', () => {
    const q = toAvailabilityQuery('QQQ', baseQuery({
      expirationGte: '2026-05-01',
      expirationLte: '2026-08-31',
      expirations: [' 2026-05-15 ', '2026-04-17', ''],
    }));
    expect(q.expirations).toEqual(['2026-05-15', '2026-04-17']);
    expect(q).not.toHaveProperty('expirationGte');
    expect(q).not.toHaveProperty('expirationLte');
  });

  it('an empty/whitespace-only expirations list falls back to the range fields', () => {
    const q = toAvailabilityQuery('QQQ', baseQuery({
      expirationGte: '2026-05-01',
      expirations: ['  ', ''],
    }));
    expect(q).not.toHaveProperty('expirations');
    expect(q.expirationGte).toBe('2026-05-01');
  });

  it('strikeStep 0 means "no step" in the form — it does not go on the wire', () => {
    expect(toAvailabilityQuery('QQQ', baseQuery({ strikeStep: 0 }))).not.toHaveProperty('strikeStep');
    expect(toAvailabilityQuery('QQQ', baseQuery({ strikeStep: 10 })).strikeStep).toBe(10);
  });

  it('symbol normalizes to trimmed uppercase — same normalization the storage key uses', () => {
    expect(toAvailabilityQuery(' qqq ', baseQuery()).symbol).toBe('QQQ');
  });
});

describe('isInvertedRange', () => {
  it('true only when both bounds are set and gte exceeds lte', () => {
    expect(isInvertedRange('2026-08-01', '2026-05-01')).toBe(true);
    expect(isInvertedRange('2026-05-01', '2026-05-01')).toBe(false);
    expect(isInvertedRange('2026-05-01', '2026-08-01')).toBe(false);
    expect(isInvertedRange('2026-05-01', undefined)).toBe(false);
    expect(isInvertedRange(undefined, '2026-08-01')).toBe(false);
    expect(isInvertedRange(undefined, undefined)).toBe(false);
  });
});

const record = (over: Partial<ContractAvailabilityEntry> = {}): ContractAvailabilityEntry => ({
  contractId: 'QQQ260515C00540000',
  expiration: '2026-05-15',
  strike: 540,
  type: 'call',
  firstObserved: '2026-01-08',
  lastObserved: '2026-05-15',
  ...over,
});

describe('refineContracts', () => {
  const rows = [
    record({ contractId: 'A', strike: 500, type: 'call', firstObserved: '2026-01-02', lastObserved: '2026-05-15' }),
    record({ contractId: 'B', strike: 550, type: 'put', firstObserved: '2026-03-10', lastObserved: '2026-05-15' }),
    record({ contractId: 'C', strike: 600, type: 'call', expiration: '2026-04-17', firstObserved: '2026-01-05', lastObserved: '2026-04-17' }),
  ];
  const ids = (out: ContractAvailabilityEntry[]) => out.map((c) => c.contractId);

  it('empty refine state passes every record', () => {
    expect(ids(refineContracts(rows, {}))).toEqual(['A', 'B', 'C']);
  });

  it('strike bounds are inclusive on both ends', () => {
    expect(ids(refineContracts(rows, { strikeGte: 500, strikeLte: 600 }))).toEqual(['A', 'B', 'C']);
    expect(ids(refineContracts(rows, { strikeGte: 501, strikeLte: 599 }))).toEqual(['B']);
  });

  it('expiration bounds are inclusive; type matches the call/put literal', () => {
    expect(ids(refineContracts(rows, { expirationGte: '2026-05-01' }))).toEqual(['A', 'B']);
    expect(ids(refineContracts(rows, { type: 'put' }))).toEqual(['B']);
    expect(ids(refineContracts(rows, { type: 'call' }))).toEqual(['A', 'C']);
  });

  it('firstObservedLte keeps only contracts first observed on or before the bound', () => {
    expect(ids(refineContracts(rows, { firstObservedLte: '2026-03-01' }))).toEqual(['A', 'C']);
    // Bound is inclusive — A (01-02) and C (01-05) both pass.
    expect(ids(refineContracts(rows, { firstObservedLte: '2026-01-05' }))).toEqual(['A', 'C']);
  });

  it('explicit expirations is a membership filter; strikeStep keeps exact multiples', () => {
    expect(ids(refineContracts(rows, { expirations: ['2026-04-17', '  '] }))).toEqual(['C']);
    // A whitespace-only list is NO constraint — same rule as the wire path.
    expect(ids(refineContracts(rows, { expirations: ['  ', ''] }))).toEqual(['A', 'B', 'C']);
    expect(ids(refineContracts(rows, { expirations: ['2026-04-17', '2026-05-15'] }))).toEqual(['A', 'B', 'C']);
    expect(ids(refineContracts(rows, { strikeStep: 100 }))).toEqual(['A', 'C']);
    expect(ids(refineContracts(rows, { strikeStep: 50 }))).toEqual(['A', 'B', 'C']);
    // 0 = no constraint (form may emit 0 for "no step").
    expect(ids(refineContracts(rows, { strikeStep: 0 }))).toEqual(['A', 'B', 'C']);
  });

  it('firstObservedGte is the inclusive lower bound — pairs with Lte to bracket a window', () => {
    // A (01-02) and C (01-05) both fail the Gte; only B survives.
    expect(ids(refineContracts(rows, { firstObservedGte: '2026-01-06' }))).toEqual(['B']);
    // Bracketing keeps only C — A below Gte, B above Lte.
    expect(ids(refineContracts(rows, { firstObservedGte: '2026-01-05', firstObservedLte: '2026-03-01' }))).toEqual(['C']);
  });

  it('aliveRange keeps contracts observed at range start and still alive at range end', () => {
    // B first observed 03-10 (after window start) → out; C expired 04-17
    // (before window end) → out. Only A spans the whole window.
    expect(ids(refineContracts(rows, { aliveRange: { start: '2026-02-01', end: '2026-05-01' } }))).toEqual(['A']);
    // Window shifted earlier: A and C both span it; B still starts too late.
    expect(ids(refineContracts(rows, { aliveRange: { start: '2026-02-01', end: '2026-04-01' } }))).toEqual(['A', 'C']);
  });

  it('filters compose as AND — a record failing any axis is out', () => {
    expect(ids(refineContracts(rows, { type: 'call', strikeGte: 550 }))).toEqual(['C']);
    expect(ids(refineContracts(rows, { type: 'call', strikeGte: 550, expirationLte: '2026-04-30' }))).toEqual(['C']);
    expect(ids(refineContracts(rows, { type: 'call', strikeGte: 550, expirationLte: '2026-04-16' }))).toEqual([]);
  });
});

describe('toPairLines', () => {
  const unsorted = [
    record({ contractId: 'QQQ260515C00600000', expiration: '2026-05-15', strike: 600 }),
    record({ contractId: 'QQQ260417C00500000', expiration: '2026-04-17', strike: 500 }),
    record({ contractId: 'QQQ260515C00500000', expiration: '2026-05-15', strike: 500 }),
  ];

  it('sorts expiration → strike → contractId (endpoint order) regardless of input order', () => {
    expect(toPairLines(unsorted)).toEqual([
      'QQQ260417C00500000',
      'QQQ260515C00500000',
      'QQQ260515C00600000',
    ]);
  });

  it('prefixes the shared open date as `date,id` when supplied', () => {
    expect(toPairLines(unsorted, '2026-03-02')).toEqual([
      '2026-03-02,QQQ260417C00500000',
      '2026-03-02,QQQ260515C00500000',
      '2026-03-02,QQQ260515C00600000',
    ]);
  });

  it('a blank open date is treated as absent — bare ids', () => {
    expect(toPairLines(unsorted, '   ')).toEqual([
      'QQQ260417C00500000',
      'QQQ260515C00500000',
      'QQQ260515C00600000',
    ]);
  });

  it('empty input → empty array (never null)', () => {
    expect(toPairLines([])).toEqual([]);
  });
});
