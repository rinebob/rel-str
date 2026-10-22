/**
 * scanner-sort.util spec (#1098/#1197) — click-cycle multi-level sort for
 * the auto-run scanner tables. Mirrors the option-chart contract-catalog
 * idiom: click adds a column ascending, second click flips to desc, third
 * removes it; array order is sort priority.
 */
import type { ScanRow } from './scanner-rows.util';
import {
  nextSortLevels,
  sortInfo,
  sortRows,
  type SortLevel,
} from './scanner-sort.util';

const row = (symbol: string, values: Record<string, string> = {}): ScanRow => ({
  symbol,
  name: values['Name'] ?? '',
  instrumentId: `iid-${symbol.toLowerCase()}`,
  instrumentType: 'EQUITY',
  values,
  tracked: false,
});

const cellFor = (r: ScanRow, key: string): unknown => r.values[key];

describe('nextSortLevels', () => {
  it('cycles a column absent → asc → desc → removed', () => {
    let levels = nextSortLevels([], 'ROE');
    expect(levels).toEqual([{ key: 'ROE', direction: 'asc' }]);
    levels = nextSortLevels(levels, 'ROE');
    expect(levels).toEqual([{ key: 'ROE', direction: 'desc' }]);
    levels = nextSortLevels(levels, 'ROE');
    expect(levels).toEqual([]);
  });

  it('appends a second column as a tiebreak — click order is priority', () => {
    const levels = nextSortLevels(
      nextSortLevels([], '% Change'),
      'Volume',
    );
    expect(levels).toEqual([
      { key: '% Change', direction: 'asc' },
      { key: 'Volume', direction: 'asc' },
    ]);
  });

  it('removing a mid-chain entry preserves the remaining order', () => {
    const levels: SortLevel[] = [
      { key: 'a', direction: 'asc' },
      { key: 'b', direction: 'desc' },
      { key: 'c', direction: 'asc' },
    ];
    expect(nextSortLevels(levels, 'b')).toEqual([
      { key: 'a', direction: 'asc' },
      { key: 'c', direction: 'asc' },
    ]);
  });
});

describe('sortInfo', () => {
  const levels: SortLevel[] = [
    { key: 'a', direction: 'desc' },
    { key: 'b', direction: 'asc' },
  ];

  it('reports 1-based priority + direction; null when not sorted', () => {
    expect(sortInfo(levels, 'a')).toEqual({ priority: 1, direction: 'desc' });
    expect(sortInfo(levels, 'b')).toEqual({ priority: 2, direction: 'asc' });
    expect(sortInfo(levels, 'x')).toBeNull();
  });
});

describe('sortRows', () => {
  const rows = [
    row('BBB', { v: '2', s: 'y' }),
    row('AAA', { v: '10', s: 'x' }),
    row('CCC', { v: '1', s: 'x' }),
  ];

  it('sorts numeric-looking strings numerically, not lexically', () => {
    const out = sortRows(rows, [{ key: 'v', direction: 'desc' }], cellFor);
    expect(out.map((r) => r.symbol)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('parses %/$/comma-decorated numerics before comparing', () => {
    const pct = [
      row('AAA', { p: '12.5%' }),
      row('BBB', { p: '9%' }),
      row('CCC', { p: '$1,200' }),
    ];
    const out = sortRows(pct, [{ key: 'p', direction: 'asc' }], cellFor);
    expect(out.map((r) => r.symbol)).toEqual(['BBB', 'AAA', 'CCC']);
  });

  it('secondary key breaks primary ties', () => {
    const tied = [
      row('ZZZ', { v: '1', s: 'b' }),
      row('AAA', { v: '1', s: 'a' }),
      row('MMM', { v: '2', s: 'a' }),
    ];
    const out = sortRows(
      tied,
      [
        { key: 's', direction: 'asc' },
        { key: 'v', direction: 'desc' },
      ],
      cellFor,
    );
    // s groups first ('a' < 'b'); v desc only breaks the 'a'-group tie.
    expect(out.map((r) => r.symbol)).toEqual(['MMM', 'AAA', 'ZZZ']);
  });

  it('blank/NaN cells sink last in BOTH directions', () => {
    const withBlanks = [
      row('AAA', { v: '5' }),
      row('BBB', { v: '' }),
      row('CCC', { v: 'n/a' }),
      row('DDD', { v: '1' }),
    ];
    for (const direction of ['asc', 'desc'] as const) {
      const out = sortRows(
        withBlanks,
        [{ key: 'v', direction }],
        cellFor,
      );
      expect(out.map((r) => r.symbol).slice(0, 2)).toEqual(
        direction === 'asc' ? ['DDD', 'AAA'] : ['AAA', 'DDD'],
      );
      // Blank + unparseable always trail.
      expect(out.map((r) => r.symbol).slice(2).sort()).toEqual(['BBB', 'CCC']);
    }
  });

  it('falls back to localeCompare on non-numeric strings', () => {
    const out = sortRows(
      [row('X', { t: 'cherry' }), row('Y', { t: 'apple' }), row('Z', { t: 'Banana' })],
      [{ key: 't', direction: 'asc' }],
      cellFor,
    );
    // Case-insensitive asc: apple < Banana < cherry.
    expect(out.map((r) => r.symbol)).toEqual(['Y', 'Z', 'X']);
  });

  it('full ties keep input order (stable sort)', () => {
    const tied = [row('C', { v: '1' }), row('A', { v: '1' }), row('B', { v: '1' })];
    expect(
      sortRows(tied, [{ key: 'v', direction: 'asc' }], cellFor).map(
        (r) => r.symbol,
      ),
    ).toEqual(['C', 'A', 'B']);
  });

  it('empty chain returns rows untouched (stable input order)', () => {
    expect(sortRows(rows, [], cellFor).map((r) => r.symbol)).toEqual([
      'BBB',
      'AAA',
      'CCC',
    ]);
  });
});
