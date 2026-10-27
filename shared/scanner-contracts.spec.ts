/**
 * @topic #1098 — RH Scanner (task #1131)
 *
 * Pins the scanner domain contracts both FE and the functions verify relay
 * consume: filter narrowing, ANY_OF chunk math, truncation detection, and
 * the Curation Proposal doc shape the FE persists to
 * st-scanner/proposals/items (collection paths land in #1132).
 * Wire-shape fixtures below are copied verbatim from live captures in
 * docs/topics/657-rh-mcp/captures/dep-prev-scan-01.json.
 */
import {
  chunkSymbols,
  isEnumFilter,
  isExpressionFilter,
  isScanTruncated,
  parseCurationProposal,
  parseScanLatestRun,
  serializeCurationProposal,
  serializeScanLatestRun,
  CurationProposal,
  ScanLatestRun,
} from './scanner-contracts';
import type {
  PreviewScanResult,
  ScanColumn,
  ScanEnumFilter,
  ScanExpressionFilter,
} from './robinhood-mcp-contracts';

describe('filter narrowing', () => {
  const enumFilter: ScanEnumFilter = {
    filter_type: 'FILTER_TYPE_INSTRUMENT_TYPE',
    predicate: 'PREDICATE_ANY_OF',
    values: ['STOCK'],
  };
  const expressionFilter: ScanExpressionFilter = {
    expression: 'fundamental.returnOnEquity >= 0.15',
    predicate: '=',
    values: ['True'],
    display_title: 'ROE >= 15%',
  };

  it('isEnumFilter identifies filter_type-bearing filters', () => {
    expect(isEnumFilter(enumFilter)).toBe(true);
    expect(isEnumFilter(expressionFilter)).toBe(false);
  });

  it('isExpressionFilter identifies expression-bearing filters', () => {
    expect(isExpressionFilter(expressionFilter)).toBe(true);
    expect(isExpressionFilter(enumFilter)).toBe(false);
  });
});

describe('chunkSymbols', () => {
  it('chunks the 925-symbol tracked universe into 150-symbol ANY_OF batches', () => {
    const symbols = Array.from({ length: 925 }, (_, i) => `S${i}`);
    const chunks = chunkSymbols(symbols, 150);
    expect(chunks).toHaveLength(7);
    expect(chunks[0]).toHaveLength(150);
    expect(chunks[6]).toHaveLength(25);
    // 7 calls leaves headroom under the 20-call /api/rh/batch cap.
    expect(chunks.length).toBeLessThanOrEqual(20);
  });

  it('preserves order and returns [] for empty input', () => {
    expect(chunkSymbols(['A', 'B', 'C'], 2)).toEqual([['A', 'B'], ['C']]);
    expect(chunkSymbols([], 150)).toEqual([]);
  });
});

describe('isScanTruncated', () => {
  const row = (symbol: string) => ({
    ticker: symbol,
    instrument_id: 'id',
    instrument_type: 'EQUITY',
    columns: { Symbol: symbol },
  });
  const result = (total: number, rows: number): PreviewScanResult => ({
    total_items: total,
    results: Array.from({ length: rows }, (_, i) => row(`S${i}`)),
  });

  it('true when total_items exceeds returned rows (dep-prev-scan-01: 393 total, 200 rows)', () => {
    expect(isScanTruncated(result(393, 200))).toBe(true);
  });

  it('true when the 200-row display cap is hit even at equal totals (cap is indistinguishable)', () => {
    expect(isScanTruncated(result(200, 200))).toBe(true);
  });

  it('false for a fully-returned scan', () => {
    expect(isScanTruncated(result(45, 45))).toBe(false);
    expect(isScanTruncated(result(0, 0))).toBe(false);
  });
});

describe('PreviewScanResult wire shape (live capture dep-prev-scan-01)', () => {
  // Verbatim captured row — every column value is a string, including numerics.
  const captured: PreviewScanResult = {
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
    ],
    filters_applied: [
      {
        filter_type: 'Asset type',
        filter_type_enum: 'FILTER_TYPE_INSTRUMENT_TYPE',
        predicate: 'ANY_OF',
        values: ['STOCK'],
        expression: 'type',
      },
    ],
  };

  it('compiles against the captured shape and exposes string column values', () => {
    expect(captured.results[0].columns['Symbol']).toBe('BRK.A');
    expect(captured.results[0].columns['Last']).toBe('758092.93');
    expect(captured.sorted_by).toBe('Last desc');
    expect(captured.filters_applied?.[0].filter_type_enum).toBe(
      'FILTER_TYPE_INSTRUMENT_TYPE',
    );
  });

  it('empty results with total_items 0 is a valid outcome', () => {
    const empty: PreviewScanResult = { total_items: 0, results: [] };
    expect(isScanTruncated(empty)).toBe(false);
  });

  it('ScanColumn: expression is optional — standard and expression columns both type', () => {
    const standard: ScanColumn = { display_name: 'Market cap' };
    const expr: ScanColumn = {
      display_name: 'P/C volume',
      expression: 'optionsPutDayVolume / optionsCallDayVolume',
      visible: true,
      order: 1,
    };
    expect(standard.expression).toBeUndefined();
    expect(expr.expression).toContain('optionsPutDayVolume');
  });
});

describe('CurationProposal doc shape', () => {
  const proposal: CurationProposal = {
    recipeId: 'quality-large',
    ranAt: '2026-10-20T14:00:00.000Z',
    universeSize: 925,
    matchedCount: 182,
    truncated: false,
    addCandidates: ['XYZ'],
    dropCandidates: ['ABC', 'DEF'],
    deadSymbols: ['GONE'],
    noDataSymbols: ['BLANK'],
    dropDetail: { ABC: { 'Return on equity': '0.02' } },
  };

  it('serialize → parse round-trips every field', () => {
    const wire = serializeCurationProposal(proposal);
    const parsed = parseCurationProposal(
      JSON.parse(JSON.stringify(wire)) as Record<string, unknown>,
    );
    expect(parsed).toEqual(proposal);
  });

  it('parse accepts a proposal with no dropDetail', () => {
    const { dropDetail: _dropDetail, ...rest } = proposal;
    const parsed = parseCurationProposal(serializeCurationProposal(rest));
    expect(parsed.dropDetail).toBeUndefined();
    expect(parsed.addCandidates).toEqual(['XYZ']);
  });

  it('parse rejects docs missing required fields', () => {
    expect(() => parseCurationProposal({ recipeId: 'x' })).toThrow();
    expect(() => parseCurationProposal({})).toThrow();
    expect(() =>
      parseCurationProposal({ ...serializeCurationProposal(proposal), universeSize: '925' }),
    ).toThrow();
  });
});

describe('ScanLatestRun doc shape (#1232/#1254)', () => {
  const run: ScanLatestRun = {
    recipeId: 'quality-large',
    ranAt: '2026-10-26T14:00:00.000Z',
    totalItems: 182,
    truncated: false,
    rows: [
      {
        ticker: 'XYZ',
        instrument_id: 'abc-123',
        instrument_type: 'EQUITY',
        columns: { 'Return on equity': '0.02', Last: '42.10' },
      },
      {
        ticker: 'ABC',
        instrument_id: 'def-456',
        instrument_type: 'ETF',
        columns: {},
      },
    ],
  };

  it('serialize → parse round-trips every field', () => {
    const wire = serializeScanLatestRun(run);
    const parsed = parseScanLatestRun(
      JSON.parse(JSON.stringify(wire)) as Record<string, unknown>,
    );
    expect(parsed).toEqual(run);
  });

  it('serialize output is plain Firestore-safe data (no undefined leaves)', () => {
    const wire = serializeScanLatestRun(run);
    // toStrictEqual (not toEqual) — catches undefined properties a JSON
    // round-trip would silently drop.
    expect(JSON.parse(JSON.stringify(wire))).toStrictEqual(wire);
  });

  it('a 200-row truncated run round-trips — parse has no size guard (TEST edge)', () => {
    const full: ScanLatestRun = {
      ...run,
      truncated: true,
      rows: Array.from({ length: 200 }, (_, i) => ({
        ticker: `SYM${i}`,
        instrument_id: `id-${i}`,
        instrument_type: 'EQUITY',
        columns: { Last: `${i}.00`, 'Return on equity': '0.02' },
      })),
    };
    expect(parseScanLatestRun(serializeScanLatestRun(full))).toEqual(full);
  });

  it('empty rows round-trip — a zero-match scan is a valid latest run', () => {
    const empty: ScanLatestRun = { ...run, totalItems: 0, rows: [] };
    expect(parseScanLatestRun(serializeScanLatestRun(empty))).toEqual(empty);
  });

  it('parse tolerates extra fields (forward-compat)', () => {
    const wire = { ...serializeScanLatestRun(run), futureField: { nested: 1 } };
    expect(parseScanLatestRun(wire)).toEqual(run);
  });

  it('parse rejects missing/mistyped scalars', () => {
    expect(() => parseScanLatestRun({})).toThrow();
    expect(() =>
      parseScanLatestRun({ ...serializeScanLatestRun(run), recipeId: 42 }),
    ).toThrow();
    expect(() =>
      parseScanLatestRun({ ...serializeScanLatestRun(run), totalItems: '182' }),
    ).toThrow();
    expect(() =>
      parseScanLatestRun({ ...serializeScanLatestRun(run), truncated: 'yes' }),
    ).toThrow();
    expect(() =>
      parseScanLatestRun({ ...serializeScanLatestRun(run), ranAt: 172 }),
    ).toThrow();
  });

  it('parse passes instrument_id/instrument_type through unchecked — documented asymmetry', () => {
    // Per IMPL-SHARED: only ticker/columns are strict; the instrument_*
    // fields are open-string wire fields that pass through like other
    // consumers' posture (scanner-rows.util normalizes at read).
    const wire = {
      ...serializeScanLatestRun(run),
      rows: [{ ticker: 'XYZ', columns: {} }],
    };
    const parsed = parseScanLatestRun(wire);
    expect(parsed.rows[0].ticker).toBe('XYZ');
    expect(parsed.rows[0].instrument_id).toBeUndefined();
  });

  it('parse rejects malformed rows', () => {
    expect(() =>
      parseScanLatestRun({ ...serializeScanLatestRun(run), rows: 'XYZ' }),
    ).toThrow();
    expect(() =>
      parseScanLatestRun({ ...serializeScanLatestRun(run), rows: [{ columns: {} }] }),
    ).toThrow();
    expect(() =>
      parseScanLatestRun({
        ...serializeScanLatestRun(run),
        rows: [{ ticker: 'XYZ', columns: { Last: 42 } }],
      }),
    ).toThrow();
  });
});
