/// <reference types="jest" />
/**
 * Tests for the plotted-pairs parser (plotted-pairs.util.ts).
 * Seam: pure function — pasted text + page symbol in, entries + rejects out.
 */

import { dominantUnderlying, parsePlottedEntries } from './plotted-pairs.util';
import type { PlottedEntry } from '@options-contract/contracts';

const QQQ_PUT = 'QQQ260619P00470000';
const QQQ_CALL = 'QQQ260619C00475000';
const SPY_PUT = 'SPY260619P00500000';

describe('parsePlottedEntries', () => {
  it('parses a comma-separated (date, contractId) pair', () => {
    const { entries, rejected } = parsePlottedEntries(`2026-06-15,${QQQ_PUT}`, 'QQQ');
    expect(rejected).toEqual([]);
    expect(entries).toEqual([
      { contractId: QQQ_PUT, openDate: '2026-06-15', markerDates: ['2026-06-15'] },
    ]);
  });

  it('accepts whitespace and tab separators so spreadsheet columns paste in', () => {
    const { entries, rejected } = parsePlottedEntries(
      `2026-06-15 ${QQQ_PUT}\n2026-06-16\t${QQQ_CALL}`,
      'QQQ',
    );
    expect(rejected).toEqual([]);
    expect(entries).toEqual([
      { contractId: QQQ_PUT, openDate: '2026-06-15', markerDates: ['2026-06-15'] },
      { contractId: QQQ_CALL, openDate: '2026-06-16', markerDates: ['2026-06-16'] },
    ]);
  });

  it('accepts a bare contract ID with null openDate', () => {
    const { entries, rejected } = parsePlottedEntries(QQQ_PUT, 'QQQ');
    expect(rejected).toEqual([]);
    expect(entries).toEqual([{ contractId: QQQ_PUT, openDate: null, markerDates: [] }]);
  });

  it('skips blank lines without rejecting them', () => {
    const { entries, rejected } = parsePlottedEntries(
      `\n${QQQ_PUT}\n\n\n${QQQ_CALL}\n`,
      'QQQ',
    );
    expect(rejected).toEqual([]);
    expect(entries.map((e) => e.contractId)).toEqual([QQQ_PUT, QQQ_CALL]);
  });

  it('normalizes contract IDs to uppercase', () => {
    const { entries } = parsePlottedEntries('2026-06-15,qqq260619p00470000', 'QQQ');
    expect(entries[0].contractId).toBe(QQQ_PUT);
  });

  it('rejects an unparseable line as invalid-contract', () => {
    const { entries, rejected } = parsePlottedEntries('not-a-contract', 'QQQ');
    expect(entries).toEqual([]);
    expect(rejected).toEqual([
      expect.objectContaining({ raw: 'not-a-contract', reason: 'invalid-contract' }),
    ]);
  });

  it('rejects a line whose date field is not a valid ISO date', () => {
    const { entries, rejected } = parsePlottedEntries(`06/15/2026,${QQQ_PUT}`, 'QQQ');
    expect(entries).toEqual([]);
    expect(rejected).toEqual([
      expect.objectContaining({ raw: `06/15/2026,${QQQ_PUT}`, reason: 'invalid-date' }),
    ]);
  });

  it('rejects impossible calendar dates', () => {
    const { rejected } = parsePlottedEntries(`2026-13-40,${QQQ_PUT}`, 'QQQ');
    expect(rejected).toEqual([
      expect.objectContaining({ reason: 'invalid-date' }),
    ]);
  });

  it('parses any underlying when no symbol is given — the auto-swap path decides the target itself', () => {
    const { entries, rejected } = parsePlottedEntries(`2026-06-15,${SPY_PUT}`);
    expect(entries).toEqual([
      { contractId: SPY_PUT, openDate: '2026-06-15', markerDates: ['2026-06-15'] },
    ]);
    expect(rejected).toEqual([]);
  });

  it('rejects a valid contract on the wrong underlying', () => {
    const { entries, rejected } = parsePlottedEntries(`2026-06-15,${SPY_PUT}`, 'QQQ');
    expect(entries).toEqual([]);
    expect(rejected).toEqual([
      expect.objectContaining({ raw: `2026-06-15,${SPY_PUT}`, reason: 'wrong-underlying' }),
    ]);
  });

  it('keeps valid entries when other lines are rejected', () => {
    const { entries, rejected } = parsePlottedEntries(
      `2026-06-15,${QQQ_PUT}\ngarbage\n${QQQ_CALL}`,
      'QQQ',
    );
    expect(entries.map((e) => e.contractId)).toEqual([QQQ_PUT, QQQ_CALL]);
    expect(rejected).toHaveLength(1);
  });

  it('deduplicates repeated contract IDs, keeping the earliest supplied open date', () => {
    const { entries } = parsePlottedEntries(
      `2026-06-16,${QQQ_PUT}\n2026-06-15,${QQQ_PUT}\n${QQQ_PUT}`,
      'QQQ',
    );
    expect(entries).toEqual([
      { contractId: QQQ_PUT, openDate: '2026-06-15', markerDates: ['2026-06-15', '2026-06-16'] },
    ]);
  });

  it('unions every supplied date into markerDates for a repeated contract', () => {
    const { entries } = parsePlottedEntries(
      `2026-06-17,${QQQ_PUT}\n2026-06-15,${QQQ_PUT}\n2026-06-16,${QQQ_PUT}`,
      'QQQ',
    );
    expect(entries).toEqual([
      { contractId: QQQ_PUT, openDate: '2026-06-15', markerDates: ['2026-06-15', '2026-06-16', '2026-06-17'] },
    ]);
  });

  it('does not duplicate a repeated date in markerDates', () => {
    const { entries } = parsePlottedEntries(
      `2026-06-15,${QQQ_PUT}\n2026-06-15,${QQQ_PUT}`,
      'QQQ',
    );
    expect(entries[0].markerDates).toEqual(['2026-06-15']);
  });

  it('a single-date entry still carries its markerDates', () => {
    const { entries } = parsePlottedEntries(`2026-06-15,${QQQ_PUT}`, 'QQQ');
    expect(entries[0].markerDates).toEqual(['2026-06-15']);
  });

  it('a bare ID carries an empty markerDates list', () => {
    const { entries } = parsePlottedEntries(QQQ_PUT, 'QQQ');
    expect(entries[0].markerDates).toEqual([]);
  });

  it('returns empty result for empty input', () => {
    const { entries, rejected } = parsePlottedEntries('   \n  ', 'QQQ');
    expect(entries).toEqual([]);
    expect(rejected).toEqual([]);
  });
});

describe('dominantUnderlying', () => {
  const entry = (contractId: string): PlottedEntry => ({ contractId, openDate: null, markerDates: [] });

  it('returns the majority symbol across entries', () => {
    expect(
      dominantUnderlying([entry(SPY_PUT), entry(SPY_PUT), entry(QQQ_PUT)]),
    ).toBe('SPY');
  });

  it('resolves a tie to the first-seen symbol', () => {
    expect(dominantUnderlying([entry(QQQ_PUT), entry(SPY_PUT)])).toBe('QQQ');
    expect(dominantUnderlying([entry(SPY_PUT), entry(QQQ_PUT)])).toBe('SPY');
  });

  it('returns null for an empty list', () => {
    expect(dominantUnderlying([])).toBeNull();
  });
});
