/**
 * Specs for scanner-rows.util — ScanRow parse + column coercion (#1136).
 *
 * The parse fixture is derived verbatim from live capture
 * dep-prev-scan-01.json (docs/topics/657-rh-mcp/captures) — every column
 * value is stringified, even numerics.
 */
import type { PreviewScanResult, ScanColumn } from '@robinhood-mcp/contracts';
import {
  buildColumnLookup,
  canonicalColumnName,
  mergeLookup,
  numericColumn,
  parseScanRows,
  percentColumn,
  type ScanRow,
} from './scanner-rows.util';

const row = (symbol: string, values: Record<string, string> = {}): ScanRow => ({
  symbol,
  name: '',
  instrumentId: '',
  instrumentType: 'EQUITY',
  values,
  tracked: false,
});

// dep-prev-scan-01.json — first two rows verbatim.
const CAPTURE: PreviewScanResult = {
  total_items: 393,
  sorted_by: 'Last desc',
  results: [
    {
      ticker: 'BRK.A',
      instrument_id: '28356967-fa97-4e30-9b0b-2bc0cc975e95',
      instrument_type: 'EQUITY',
      columns: {
        '% Change': '0.0043759588759788165',
        'Asset type': 'STOCK',
        Last: '758092.93',
        Name: 'Berkshire Hathaway Inc Class A',
        'Net change': '3302.930000000051',
        Symbol: 'BRK.A',
        Volume: '64.070068',
      },
    },
    {
      ticker: 'NVR',
      instrument_id: '55394fd1-3702-4371-8a89-c424ab3d0a40',
      instrument_type: 'EQUITY',
      columns: {
        '% Change': '-0.006352344486432047',
        'Asset type': 'STOCK',
        Last: '5955.775',
        Name: 'NVR',
        'Net change': '-38.07500000000073',
        Symbol: 'NVR',
        Volume: '26578.289207',
      },
    },
  ],
};

describe('parseScanRows (#1136)', () => {
  it('maps capture rows to ScanRow — symbol/name/type + raw column map', () => {
    const rows = parseScanRows(CAPTURE);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      symbol: 'BRK.A',
      name: 'Berkshire Hathaway Inc Class A',
      instrumentId: '28356967-fa97-4e30-9b0b-2bc0cc975e95',
      instrumentType: 'EQUITY',
      values: CAPTURE.results[0].columns,
      tracked: false,
    });
    expect(rows[1].symbol).toBe('NVR');
  });

  it('drops rows with a missing or blank ticker', () => {
    const rows = parseScanRows({
      total_items: 3,
      results: [
        { ticker: '', instrument_id: 'x', instrument_type: 'EQUITY', columns: {} },
        { ticker: 'AAPL', instrument_id: 'y', instrument_type: 'EQUITY', columns: {} },
        // Malformed wire row — no ticker field at all.
        { instrument_id: 'z', instrument_type: 'EQUITY', columns: {} } as never,
      ],
    });
    expect(rows.map((r) => r.symbol)).toEqual(['AAPL']);
  });

  it('empty results produce an empty array', () => {
    expect(parseScanRows({ total_items: 0, results: [] })).toEqual([]);
  });
});

describe('numericColumn / percentColumn (#1136)', () => {
  const [row] = parseScanRows(CAPTURE);

  it('coerces stringified numerics', () => {
    expect(numericColumn(row, 'Last')).toBe(758092.93);
    expect(numericColumn(row, 'Volume')).toBe(64.070068);
  });

  it('returns null for missing and blank values — fundamentals are blank-scarce', () => {
    expect(numericColumn(row, 'PEG')).toBeNull();
    const blank = { ...row, values: { ...row.values, ROE: '' } };
    expect(numericColumn(blank, 'ROE')).toBeNull();
    const bad = { ...row, values: { ...row.values, ROE: 'n/a' } };
    expect(numericColumn(bad, 'ROE')).toBeNull();
  });

  it('whitespace-only cells are null, not 0 — "no data" feeds the noData bucket', () => {
    const ws = { ...row, values: { ...row.values, ROE: '   ' } };
    expect(numericColumn(ws, 'ROE')).toBeNull();
  });

  it('percentColumn scales fractions to percent points (ROE 0.149 → 14.9)', () => {
    const fraction = { ...row, values: { ...row.values, ROE: '0.149' } };
    expect(percentColumn(fraction, 'ROE')).toBeCloseTo(14.9);
    expect(percentColumn(row, 'ROE')).toBeNull();
  });
});

describe('columnLookup / canonicalColumnName (#1136)', () => {
  it('maps a requested display_name to the canonical column the backend returned', () => {
    // Observed live: an 'ROE' display_name came back as 'Return on equity'
    // — the backend canonicalizes filter-identical expressions.
    const requested: ScanColumn[] = [
      { display_name: 'ROE', expression: 'roe' },
      { display_name: 'Market cap' },
    ];
    const lookup = buildColumnLookup(
      [
        {
          filter_type: 'Return on equity',
          filter_type_enum: 'FILTER_TYPE_CUSTOM',
          predicate: 'PREDICATE_GREATER_THAN',
          values: ['0.15'],
          expression: 'roe',
        },
      ],
      requested,
    );
    expect(canonicalColumnName(lookup, 'ROE')).toBe('Return on equity');
    // Non-expression columns pass through unchanged.
    expect(canonicalColumnName(lookup, 'Market cap')).toBe('Market cap');
    // Unknown names pass through (lookup miss → raw name).
    expect(canonicalColumnName(lookup, 'Anything')).toBe('Anything');
  });

  it('numericColumn resolves through the lookup', () => {
    const row = {
      symbol: 'AAPL',
      name: 'Apple',
      instrumentId: '',
      instrumentType: 'EQUITY',
      values: { 'Return on equity': '0.149' },
      tracked: false,
    };
    const lookup = buildColumnLookup(
      [
        {
          filter_type: 'Return on equity',
          filter_type_enum: 'FILTER_TYPE_CUSTOM',
          predicate: '=',
          values: ['x'],
          expression: 'roe',
        },
      ],
      [{ display_name: 'ROE', expression: 'roe' }],
    );
    expect(numericColumn(row, 'ROE', lookup)).toBeCloseTo(0.149);
    // Without the lookup the canonical column is invisible under 'ROE'.
    expect(numericColumn(row, 'ROE')).toBeNull();
  });

  it('no applied/requested inputs produce an empty lookup', () => {
    expect(buildColumnLookup().size).toBe(0);
  });

  it('a display_title echo does not blank the column — mapped key falls back to the raw name', () => {
    // dep-prev-scan-04: filter {expression, display_title: 'P/C vol > 1'}
    // echoes filter_type 'P/C vol > 1' while the row's column key is the
    // requested 'P/C volume'. Lookup maps to the title; the actual key
    // wins via presence fallback.
    const row = {
      symbol: 'X',
      name: 'X',
      instrumentId: '',
      instrumentType: 'EQUITY',
      values: { 'P/C volume': '1.5' },
      tracked: false,
    };
    const lookup = buildColumnLookup(
      [
        {
          filter_type: 'P/C vol > 1',
          filter_type_enum: 'FILTER_TYPE_CUSTOM',
          predicate: '>',
          values: ['1'],
          expression: 'optionsPutDayVolume / optionsCallDayVolume',
        },
      ],
      [{ display_name: 'P/C volume', expression: 'optionsPutDayVolume / optionsCallDayVolume' }],
    );
    expect(numericColumn(row, 'P/C volume', lookup)).toBe(1.5);
  });

  it('mergeLookup: the response echo wins when it names a real row key (#1197)', () => {
    const rows = [row('AAPL', { 'ROE canonical': '0.2' })];
    const recipe = {
      columns: [{ display_name: 'ROE', expression: 'roe' }],
      columnLookup: new Map([['ROE', 'Return on equity']]),
    };
    const applied = [
      {
        filter_type: 'ROE canonical',
        filter_type_enum: 'FILTER_TYPE_CUSTOM',
        predicate: '>',
        values: ['0.1'],
        expression: 'roe',
      },
    ];
    expect(mergeLookup(recipe, applied, rows).get('ROE')).toBe('ROE canonical');
  });

  it('mergeLookup: a bad echo (display_title) falls back to the static map the rows carry', () => {
    // dep-prev-scan-04 shape — echo names a filter title no row carries.
    const rows = [row('AAPL', { 'Return on equity': '0.2' })];
    const recipe = {
      columns: [{ display_name: 'ROE', expression: 'roe' }],
      columnLookup: new Map([['ROE', 'Return on equity']]),
    };
    const applied = [
      {
        filter_type: 'ROE > 10%',
        filter_type_enum: 'FILTER_TYPE_CUSTOM',
        predicate: '>',
        values: ['0.1'],
        expression: 'roe',
      },
    ];
    expect(mergeLookup(recipe, applied, rows).get('ROE')).toBe('Return on equity');
  });

  it('mergeLookup: unverifiable candidates → static map wins; unmapped names pass through', () => {
    const rows = [row('AAPL', { Last: '100' })];
    const recipe = {
      columns: [
        { display_name: 'ROE', expression: 'roe' },
        { display_name: 'Last' },
      ],
      columnLookup: new Map([['ROE', 'Return on equity']]),
    };
    const lookup = mergeLookup(recipe, undefined, rows);
    // No candidate key exists in rows — static mapping still wins.
    expect(lookup.get('ROE')).toBe('Return on equity');
    // 'Last' resolves to itself — absent from the remap map.
    expect(lookup.get('Last')).toBeUndefined();
  });

  it('expression matching ignores whitespace — echoes can inject spacing', () => {
    const lookup = buildColumnLookup(
      [
        {
          filter_type: 'Return on equity',
          filter_type_enum: 'FILTER_TYPE_CUSTOM',
          predicate: '>',
          values: ['0.15'],
          expression: 'roe( period = "1d" )',
        },
      ],
      [{ display_name: 'ROE', expression: 'roe(period="1d")' }],
    );
    expect(canonicalColumnName(lookup, 'ROE')).toBe('Return on equity');
  });
});
