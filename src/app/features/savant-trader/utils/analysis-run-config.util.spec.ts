/**
 * analysis-run-config.util spec (Thread #1059, task #1082) — the pure
 * validation/parse helpers the run-config form uses to block invalid
 * input before generateTradeDataset fires (AC3).
 */
import {
  EXIT_RULE_RE,
  ISO_DATE_RE,
  isValidExitRule,
  matchesDatasetSearch,
  parseSymbolScope,
  parseTags,
  toIsoDate,
} from './analysis-run-config.util';
import { PaperTradingKind } from '@paper-trading/contracts';
import type { AnalysisDatasetDoc } from '@paper-trading/analysis';

function doc(over: Partial<AnalysisDatasetDoc> = {}): AnalysisDatasetDoc {
  return {
    kind: PaperTradingKind.ANALYSIS_DATASET,
    id: 'ds-20261020-replay-abc',
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    origin: 'replay',
    status: 'ready',
    symbolScope: ['AMAT', 'NVDA'],
    signalTypes: ['D_ST_TREND_RIDER_V1_LONG'],
    exitRule: 'trailing-8',
    barRange: { from: '2023-01-01', to: '2026-10-20' },
    entryConvention: 'signal-bar-close',
    generatedAt: '2026-10-20T12:00:00Z',
    gcsPath: 'analysis-datasets/ds.csv',
    tags: ['oct-run'],
    notes: 'semis basket',
    ...over,
  };
}

describe('isValidExitRule — registry grammar mirror', () => {
  it.each([
    'trailing-8',
    'trailing-20',
    'trailing-12.5',
    'initial-stop-10',
    'initial-stop-7.5',
    'time-9d',
    'time-30d',
    ' trailing-8 ', // trims
  ])('accepts %s', (rule) => {
    expect(isValidExitRule(rule)).toBe(true);
  });

  it.each([
    '',
    'trailing-',
    'trailing-x',
    'trailing-8d',
    'exit-14d',          // legacy paper-ledger keys are NOT the registry grammar
    'limit-stddev-1',    // parses BE-side but not a governing family
    'time-30',
    'time-0.5d',
    'stop-10',
    'TRAILING-8',        // grammar is case-sensitive
    'trailing -8',
  ])('rejects %s', (rule) => {
    expect(isValidExitRule(rule)).toBe(false);
  });
});

describe('toIsoDate', () => {
  it('formats local-midnight dates without a UTC day-shift', () => {
    expect(toIsoDate(new Date(2026, 9, 20))).toBe('2026-10-20');
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('parseSymbolScope', () => {
  it('splits, trims, uppercases, dedupes', () => {
    expect(parseSymbolScope('amat, NVDA ,amat,,')).toEqual(['AMAT', 'NVDA']);
  });

  it('empty input → empty scope (all symbols per contract)', () => {
    expect(parseSymbolScope('')).toEqual([]);
    expect(parseSymbolScope('  , ,')).toEqual([]);
  });
});

describe('parseTags', () => {
  it('splits, trims, dedupes, preserves case', () => {
    expect(parseTags('amat, V2 ,amat,')).toEqual(['amat', 'V2']);
  });
});

describe('ISO_DATE_RE', () => {
  it('matches YYYY-MM-DD only', () => {
    expect(ISO_DATE_RE.test('2026-10-20')).toBe(true);
    expect(ISO_DATE_RE.test('10/20/2026')).toBe(false);
  });
});

describe('matchesDatasetSearch — library search (AC1)', () => {
  it.each([
    ['amat', true, 'symbol in scope'],
    ['AMAT', true, 'case-insensitive'],
    ['oct-run', true, 'tag'],
    ['abc', true, 'dataset id (name)'],
    ['semis', true, 'notes'],
    ['replay', true, 'origin'],
    ['trailing-8', true, 'exit rule'],
    ['tsm', false, 'absent symbol'],
  ])('query %s → %s (%s)', (q, expected) => {
    expect(matchesDatasetSearch(doc(), q)).toBe(expected);
  });

  it('empty query matches everything', () => {
    expect(matchesDatasetSearch(doc(), '   ')).toBe(true);
  });

  it('a doc without notes still matches other fields', () => {
    expect(matchesDatasetSearch(doc({ notes: undefined }), 'nvda')).toBe(true);
  });
});

describe('EXIT_RULE_RE', () => {
  it('is anchored end-to-end (no partial matches)', () => {
    expect(EXIT_RULE_RE.test('xtrailing-8x')).toBe(false);
  });
});
