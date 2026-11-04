/**
 * Contract-list emit util specs (#1361).
 *
 * Pure seam: ContractListRow[] → `entryDate,id` lines / PlottedEntry[].
 * The lines land in the pairs textarea (duplicates preserved — each pick
 * day is a marker); the entries feed loadPlotted (per-contract marker
 * union, same result the pair parser would produce).
 */
import { TradeSide } from '@common';
import type {
  ContractListNoSelectionRow,
  ContractListPickRow,
} from '@options-replay/contracts';
import { rowsToPlottedEntries, toPairLines } from './contract-list-emit.util';

const pick = (over: Partial<ContractListPickRow> = {}): ContractListPickRow => ({
  kind: 'pick',
  entryDate: '2026-06-10',
  contractId: 'QQQ260619C00500000',
  side: TradeSide.LONG,
  repeatsPrevious: false,
  underlyingClose: 500,
  expiration: '2026-06-19',
  dte: 9,
  strike: 500,
  delta: 0.5,
  iv: 0.2,
  mark: 5,
  bid: 4.9,
  ask: 5.1,
  volume: 100,
  openInterest: 1000,
  ...over,
});

const miss = (entryDate: string): ContractListNoSelectionRow => ({
  kind: 'no-selection',
  entryDate,
  reason: 'miss',
});

describe('toPairLines', () => {
  it('emits one entryDate,id line per pick row ordered by entryDate then contractId', () => {
    const lines = toPairLines([
      pick({ entryDate: '2026-06-12', contractId: 'QQZ260619C00500000' }),
      pick({ entryDate: '2026-06-10', contractId: 'QQQ260619C00510000' }),
      pick({ entryDate: '2026-06-10' }),
    ]);
    expect(lines).toEqual([
      '2026-06-10,QQQ260619C00500000',
      '2026-06-10,QQQ260619C00510000',
      '2026-06-12,QQZ260619C00500000',
    ]);
  });

  it('preserves duplicate contract picks on different days verbatim', () => {
    const lines = toPairLines([
      pick({ entryDate: '2026-06-10' }),
      pick({ entryDate: '2026-06-11', repeatsPrevious: true }),
    ]);
    expect(lines).toEqual([
      '2026-06-10,QQQ260619C00500000',
      '2026-06-11,QQQ260619C00500000',
    ]);
  });

  it('excludes no-selection rows', () => {
    const lines = toPairLines([pick(), miss('2026-06-11')]);
    expect(lines).toEqual(['2026-06-10,QQQ260619C00500000']);
  });

  it('returns an empty list for empty input', () => {
    expect(toPairLines([])).toEqual([]);
    expect(toPairLines([miss('2026-06-11')])).toEqual([]);
  });
});

describe('rowsToPlottedEntries', () => {
  it('groups repeated picks into one entry with markerDates unioned', () => {
    const entries = rowsToPlottedEntries([
      pick({ entryDate: '2026-06-11' }),
      pick({ entryDate: '2026-06-10' }),
      pick({ entryDate: '2026-06-10' }),
    ]);
    expect(entries).toEqual([
      {
        contractId: 'QQQ260619C00500000',
        openDate: '2026-06-10',
        markerDates: ['2026-06-10', '2026-06-11'],
      },
    ]);
  });

  it('excludes no-selection rows and sorts entries by earliest date then id', () => {
    const entries = rowsToPlottedEntries([
      miss('2026-06-09'),
      pick({ entryDate: '2026-06-12', contractId: 'QQZ260619C00500000' }),
      pick({ entryDate: '2026-06-10', contractId: 'QQQ260619C00510000' }),
      pick({ entryDate: '2026-06-10' }),
    ]);
    expect(entries).toEqual([
      {
        contractId: 'QQQ260619C00500000',
        openDate: '2026-06-10',
        markerDates: ['2026-06-10'],
      },
      {
        contractId: 'QQQ260619C00510000',
        openDate: '2026-06-10',
        markerDates: ['2026-06-10'],
      },
      {
        contractId: 'QQZ260619C00500000',
        openDate: '2026-06-12',
        markerDates: ['2026-06-12'],
      },
    ]);
  });
});
