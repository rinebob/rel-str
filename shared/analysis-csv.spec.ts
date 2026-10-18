/**
 * @topic #553 — Paper Trading Infra · Thread #1059 Trade Analysis & Forensics
 *         (task #1074)
 *
 * Specs for the deterministic CSV codec (`shared/analysis-csv.ts`):
 * `serializeDataset` must produce byte-identical output for the same row
 * set regardless of input order (stable tradeId sort), honor the
 * ANALYSIS_COLUMNS manifest order, emit RFC-4180 quoting, fixed-precision
 * percent-units, ISO dates, and empty cells for absent values. A minimal
 * RFC-4180 parser (papaparse-equivalent) proves the round-trip.
 */
import { TradeSide } from './common';
import { PaperTradeStatus } from './paper-trading-contracts';
import {
  ANALYSIS_COLUMNS,
  AnalysisCohort,
  type TradeAnalysisRow,
} from './analysis-dataset-contracts';
import {
  COLUMN_TYPES,
  serializeDataset,
} from './analysis-csv';

const ROW_A: TradeAnalysisRow = {
  datasetId: 'ds-1',
  tradeId: '261015-sig-AMAT-EQ',
  signalId: 'sig-1',
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  cohortId: 'cohort-1',
  positionGroupId: 'AMAT-261015-grp-01',
  symbol: 'AMAT',
  direction: TradeSide.LONG,
  expression: 'EQ',
  captureList: 'PRIMARY',
  sector: 'Technology',
  industry: 'Semiconductors',
  capTier: 'large',
  source: 'replay',
  analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
  status: PaperTradeStatus.CLOSED,
  signalStatus: 'CONFIRMED',
  signalBarDate: '2026-10-15',
  entryDate: '2026-10-15',
  entryPrice: 119.46,
  exitDate: '2026-11-20',
  exitPrice: 112.9,
  qty: 100,
  daysHeld: 36,
  exitReason: 'trailing-8',
  tradeRetPct: -5.27,
  symbolMovePct: -5.27,
  realizedPnl: -527,
  capitalRequired: 11946,
  mfePct: 5.16,
  maePct: -8.35,
  mfeDate: '2026-10-29',
  maeDate: '2026-10-22',
  daysToMfe: 14,
  givebackRatio: -2.02,
  excursionSource: 'replay',
  'ind.delta': 1,
  'ind.windowV2': 3,
  'ind.zoneV1': 3,
  'ind.zoneV1Prev': 2,
  'ind.zoneV2': null,
  'ind.zoneV2Prev': null,
  'strength.diPlus': 31.89,
  'strength.diMinus': 16.18,
  'strength.diHist': 15.71,
  'strength.adx': 31.02,
};

const ROW_B: TradeAnalysisRow = {
  ...ROW_A,
  tradeId: '261020-sig-AMAT-EQ',
  signalBarDate: '2026-10-20',
  entryDate: '2026-10-20',
  // Delimiter-bearing fields must survive quoting verbatim.
  sector: 'Tech, Large',
  industry: 'Semis "Bleeding Edge"',
  exitReason: 'trailing-8\nmanual note',
};

/** Sparse row — every nullable key null. */
const ROW_C: TradeAnalysisRow = {
  ...ROW_A,
  tradeId: '261030-sig-AMAT-EQ',
  signalId: null,
  signalType: null,
  cohortId: null,
  positionGroupId: null,
  captureList: null,
  sector: null,
  industry: null,
  capTier: null,
  signalStatus: null,
  signalBarDate: null,
  entryDate: null,
  entryPrice: null,
  exitDate: null,
  exitPrice: null,
  qty: null,
  daysHeld: null,
  exitReason: null,
  tradeRetPct: null,
  symbolMovePct: null,
  realizedPnl: null,
  capitalRequired: null,
  mfePct: null,
  maePct: null,
  mfeDate: null,
  maeDate: null,
  daysToMfe: null,
  givebackRatio: null,
  'ind.delta': null,
  'ind.windowV2': null,
  'ind.zoneV1': null,
  'ind.zoneV1Prev': null,
  'strength.diPlus': null,
  'strength.diMinus': null,
  'strength.diHist': null,
  'strength.adx': null,
};

/** Minimal RFC-4180 parser — spec-local papaparse equivalent. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const push = () => {
    row.push(cell);
    cell = '';
    quoted = false;
  };
  const newline = () => {
    push();
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      push();
    } else if (ch === '\n') {
      newline();
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    push();
    rows.push(row);
  }
  return rows;
}

/** Parse then coerce cells per COLUMN_TYPES — the FE parser's contract. */
function parseRows(text: string): Record<string, unknown>[] {
  const [header, ...body] = parseCsv(text);
  return body.map((cells) =>
    Object.fromEntries(
      header.map((key, i) => {
        const raw = cells[i] ?? '';
        const kind =
          COLUMN_TYPES[key as keyof TradeAnalysisRow & string];
        if (raw === '') return [key, null];
        return [key, kind === 'number' ? Number(raw) : raw];
      }),
    ),
  );
}

describe('serializeDataset', () => {
  it('emits the manifest column order as the header', () => {
    const csv = serializeDataset([ROW_A]);
    expect(csv.split('\n')[0]).toBe(
      ANALYSIS_COLUMNS.map((c) => c.key).join(','),
    );
  });

  it('sorts rows by tradeId — byte-identical output on shuffled input', () => {
    const forward = serializeDataset([ROW_A, ROW_B, ROW_C]);
    const shuffled = serializeDataset([ROW_C, ROW_A, ROW_B]);
    expect(shuffled).toBe(forward);
    const ids = parseRows(forward).map((r) => r.tradeId);
    expect(ids).toEqual([
      '261015-sig-AMAT-EQ',
      '261020-sig-AMAT-EQ',
      '261030-sig-AMAT-EQ',
    ]);
  });

  it('round-trips: serialize → parse → deep-equal (delimiters + empties)', () => {
    const parsed = parseRows(serializeDataset([ROW_A, ROW_B, ROW_C]));
    expect(parsed).toEqual([ROW_A, ROW_B, ROW_C]);
  });

  it('quotes fields containing commas, quotes, and newlines', () => {
    const csv = serializeDataset([ROW_B]);
    expect(csv).toContain('"Tech, Large"');
    expect(csv).toContain('"Semis ""Bleeding Edge"""');
    expect(csv).toContain('"trailing-8\nmanual note"');
  });

  it('null and undefined serialize to empty cells — never "undefined"', () => {
    const csv = serializeDataset([ROW_C]);
    expect(csv).not.toContain('undefined');
    expect(csv).not.toContain('null');
    const row = parseRows(csv)[0];
    expect(row.exitReason).toBeNull();
    expect(row['ind.zoneV1']).toBeNull();
    expect(row.tradeRetPct).toBeNull();
    // Runtime input may arrive with a key genuinely undefined (row builders
    // precede the codec) — same empty-cell path as null.
    const builderRow: Partial<TradeAnalysisRow> = { ...ROW_A };
    delete builderRow.exitReason;
    const parsed = parseRows(
      serializeDataset([builderRow as TradeAnalysisRow]),
    )[0];
    expect(parsed.exitReason).toBeNull();
  });

  it('numbers emit shortest round-trip repr — integers bare, fractions lossless', () => {
    const row: TradeAnalysisRow = {
      ...ROW_A,
      exitPrice: 112.9, // trailing zero is cosmetic — '112.9', not '112.90'
      capitalRequired: 11946.5, // fractional dollars survive verbatim
      'ind.delta': 0.0001, // sub-cent precision is never padded or truncated
    };
    const csv = serializeDataset([row]);
    const cells = parseCsv(csv.split('\n')[1])[0];
    const idx = (k: string) => ANALYSIS_COLUMNS.findIndex((c) => c.key === k);
    expect(cells[idx('entryPrice')]).toBe('119.46');
    expect(cells[idx('exitPrice')]).toBe('112.9');
    expect(cells[idx('daysHeld')]).toBe('36');
    expect(cells[idx('tradeRetPct')]).toBe('-5.27');
    expect(cells[idx('capitalRequired')]).toBe('11946.5');
    expect(cells[idx('ind.delta')]).toBe('0.0001');
  });

  it('zero and negative percents serialize literally', () => {
    const row: TradeAnalysisRow = {
      ...ROW_A,
      tradeRetPct: 0,
      maePct: -0.01,
      givebackRatio: -0.5,
    };
    const cells = parseRows(serializeDataset([row]))[0];
    expect(cells.tradeRetPct).toBe(0);
    expect(cells.maePct).toBe(-0.01);
    expect(cells.givebackRatio).toBe(-0.5);
  });

  it('non-finite numbers serialize to empty cells (never NaN/Infinity)', () => {
    const row: TradeAnalysisRow = {
      ...ROW_A,
      tradeRetPct: Number.NaN,
      mfePct: Number.POSITIVE_INFINITY,
    };
    const parsed = parseRows(serializeDataset([row]))[0];
    expect(parsed.tradeRetPct).toBeNull();
    expect(parsed.mfePct).toBeNull();
  });

  it('respects a column subset — header and cells narrow together', () => {
    const subset = ANALYSIS_COLUMNS.filter((c) =>
      ['tradeId', 'symbol', 'tradeRetPct'].includes(c.key),
    );
    const csv = serializeDataset([ROW_A], subset);
    expect(csv.split('\n')[0]).toBe('tradeId,symbol,tradeRetPct');
    expect(parseRows(csv)).toEqual([
      { tradeId: '261015-sig-AMAT-EQ', symbol: 'AMAT', tradeRetPct: -5.27 },
    ]);
  });

  it('duplicate tradeIds keep input order — the sort is stable', () => {
    const dup1: TradeAnalysisRow = { ...ROW_A, symbol: 'AAA' };
    const dup2: TradeAnalysisRow = { ...ROW_A, symbol: 'ZZZ' };
    const parsed = parseRows(serializeDataset([dup2, dup1]));
    expect(parsed.map((r) => r.symbol)).toEqual(['ZZZ', 'AAA']);
  });

  it('an empty row set emits the bare header + newline', () => {
    expect(serializeDataset([])).toBe(
      ANALYSIS_COLUMNS.map((c) => c.key).join(',') + '\n',
    );
  });

  it('golden fixture — byte-pinned output for a 2-row dataset', () => {
    const csv = serializeDataset([ROW_B, ROW_A]);
    const expected =
      'datasetId,tradeId,signalId,signalType,cohortId,positionGroupId,symbol,direction,expression,captureList,sector,industry,capTier,source,analysisCohort,status,signalStatus,signalBarDate,entryDate,entryPrice,exitDate,exitPrice,qty,daysHeld,exitReason,tradeRetPct,symbolMovePct,realizedPnl,capitalRequired,mfePct,maePct,mfeDate,maeDate,daysToMfe,givebackRatio,excursionSource,ind.delta,ind.windowV2,ind.zoneV1,ind.zoneV1Prev,ind.zoneV2,ind.zoneV2Prev,strength.diPlus,strength.diMinus,strength.diHist,strength.adx\n' +
      'ds-1,261015-sig-AMAT-EQ,sig-1,D_ST_TREND_RIDER_V2_LONG,cohort-1,AMAT-261015-grp-01,AMAT,long,EQ,PRIMARY,Technology,Semiconductors,large,replay,signal-equity,CLOSED,CONFIRMED,2026-10-15,2026-10-15,119.46,2026-11-20,112.9,100,36,trailing-8,-5.27,-5.27,-527,11946,5.16,-8.35,2026-10-29,2026-10-22,14,-2.02,replay,1,3,3,2,,,31.89,16.18,15.71,31.02\n' +
      'ds-1,261020-sig-AMAT-EQ,sig-1,D_ST_TREND_RIDER_V2_LONG,cohort-1,AMAT-261015-grp-01,AMAT,long,EQ,PRIMARY,"Tech, Large","Semis ""Bleeding Edge""",large,replay,signal-equity,CLOSED,CONFIRMED,2026-10-20,2026-10-20,119.46,2026-11-20,112.9,100,36,"trailing-8\nmanual note",-5.27,-5.27,-527,11946,5.16,-8.35,2026-10-29,2026-10-22,14,-2.02,replay,1,3,3,2,,,31.89,16.18,15.71,31.02\n';
    expect(csv).toBe(expected);
  });
});

describe('COLUMN_TYPES', () => {
  it('covers every manifest key with its declared kind', () => {
    expect(Object.keys(COLUMN_TYPES).sort()).toEqual(
      ANALYSIS_COLUMNS.map((c) => c.key).sort(),
    );
    for (const c of ANALYSIS_COLUMNS) {
      expect(COLUMN_TYPES[c.key]).toBe(c.kind);
    }
  });
});
