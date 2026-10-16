/**
 * @topic #984 — ST Firestore Reorg (task #999)
 *
 * Shape pins for the canonical st- doc-id builders (shared/st-ids.ts).
 * Every st- writer must mint ids through these — they are the only place
 * the segment layouts live.
 */
import {
  stSignalOccurrenceId,
  stTicketId,
  stTradeId,
  stPositionGroupId,
  ORIGIN_TYPE_TO_TRADE_CODE,
} from './st-ids';

const DATE = new Date(Date.UTC(2026, 8, 27)); // 2026-09-27 → 260927

describe('stSignalOccurrenceId', () => {
  it('builds {SYM}_{barDate}_{signalType}', () => {
    expect(stSignalOccurrenceId('ADPT', '2026-10-14', 'D_ST_TREND_RIDER_V2_LONG'))
      .toBe('ADPT_2026-10-14_D_ST_TREND_RIDER_V2_LONG');
  });

  it('uppercases the symbol', () => {
    expect(stSignalOccurrenceId('adpt', '2026-10-14', 'X')).toBe('ADPT_2026-10-14_X');
  });

  it('rejects a malformed barDate — catches the signalDedupeKey arg-order swap', () => {
    // legacy signalDedupeKey(sym, signalType, barDate) has the same signature
    // with swapped args; passing signalType into barDate must throw, not mint
    // a wrong-layout id.
    expect(() => stSignalOccurrenceId('ADPT', 'D_ST_TREND_RIDER_V2_LONG', '2026-10-14'))
      .toThrow(/YYYY-MM-DD/);
    expect(() => stSignalOccurrenceId('ADPT', '2026-1-4', 'X')).toThrow(/YYYY-MM-DD/);
  });

  it('rejects empty symbol and signalType', () => {
    expect(() => stSignalOccurrenceId('', '2026-10-14', 'X')).toThrow(/non-empty/);
    expect(() => stSignalOccurrenceId('ADPT', '2026-10-14', '')).toThrow(/non-empty/);
  });

  it("rejects '/' and '_' in symbol — layout separator + Firestore-illegal", () => {
    expect(() => stSignalOccurrenceId('BRK_B', '2026-10-14', 'X')).toThrow(/_/);
    expect(() => stSignalOccurrenceId('BRK/B', '2026-10-14', 'X')).toThrow(/\//);
    expect(() => stSignalOccurrenceId('ADPT', '2026-10-14', 'A/B')).toThrow(/\//);
  });
});

describe('stTicketId', () => {
  it('prefixes by mode — liv_ live, pap_ paper', () => {
    expect(stTicketId('live', 'abc123')).toBe('liv_abc123');
    expect(stTicketId('paper', 'ADPT-260927-sig-EQ-01')).toBe('pap_ADPT-260927-sig-EQ-01');
  });

  it('throws on an invalid mode', () => {
    // @ts-expect-error — deliberate bad runtime input
    expect(() => stTicketId('sandbox', 'x')).toThrow(/mode/);
  });

  it('throws on an empty id segment', () => {
    expect(() => stTicketId('paper', '')).toThrow(/non-empty/);
  });
});

describe('stTradeId', () => {
  it('equity omits the contract segment: {SYM}-{YYMMDD}-{origin}-{expr}-{NN}', () => {
    expect(stTradeId('ADPT', DATE, 'signal', 'EQ', undefined, undefined, 1))
      .toBe('ADPT-260927-sig-EQ-01');
  });

  it('option includes -{exp}-{strike}- before NN', () => {
    expect(stTradeId('ADPT', DATE, 'signal', 'CSP', '260116', '10.00', 1))
      .toBe('ADPT-260927-sig-CSP-260116-10.00-01');
  });

  it('uppercase-normalizes expr like the symbol', () => {
    expect(stTradeId('adpt', DATE, 'signal', 'csp-030-45', '260116', '10.00', 1))
      .toBe('ADPT-260927-sig-CSP-030-45-260116-10.00-01');
  });

  it('rejects a non-numeric or dash-bearing exp and strike', () => {
    // PaperTrade.expiration is ISO YYYY-MM-DD — passed verbatim it would
    // mint phantom segments; exp is pinned to 6 or 8 digits.
    expect(() => stTradeId('ADPT', DATE, 'signal', 'CSP', '2026-01-16', '10.00', 1))
      .toThrow(/exp/);
    expect(() => stTradeId('ADPT', DATE, 'signal', 'CSP', '030', '10.00', 1))
      .toThrow(/exp/);
    expect(() => stTradeId('ADPT', DATE, 'signal', 'CSP', '260116', '10-00', 1))
      .toThrow(/strike/);
    expect(() => stTradeId('ADPT', DATE, 'signal', 'CSP', '260116', '1/2', 1))
      .toThrow(/strike/);
  });

  it("rejects an invalid Date and '/'-bearing segments", () => {
    expect(() => stTradeId('ADPT', new Date(NaN), 'signal', 'EQ', undefined, undefined, 1))
      .toThrow(/valid Date/);
    expect(() => stPositionGroupId('ADPT', new Date(NaN), 1)).toThrow(/valid Date/);
    expect(() => stTradeId('A/B', DATE, 'signal', 'EQ', undefined, undefined, 1)).toThrow(/\//);
    expect(() => stTradeId('ADPT', DATE, 'signal', 'C/D', undefined, undefined, 1)).toThrow(/\//);
    expect(() => stPositionGroupId('A/B', DATE, 1)).toThrow(/\//);
    expect(() => stTicketId('paper', 'a/b')).toThrow(/\//);
  });

  it('throws on an unknown origin, incl. prototype-member keys', () => {
    // @ts-expect-error — deliberate bad runtime input
    expect(() => stTradeId('ADPT', DATE, 'toString', 'EQ', undefined, undefined, 1)).toThrow(/unknown origin/);
    // @ts-expect-error — deliberate bad runtime input
    expect(() => stTradeId('ADPT', DATE, 'webhook', 'EQ', undefined, undefined, 1)).toThrow(/unknown origin/);
  });

  it('maps all four origin types to their codes', () => {
    expect(ORIGIN_TYPE_TO_TRADE_CODE).toEqual({
      signal: 'sig', program: 'prg', manual: 'man', management: 'mgmt',
    });
    for (const [type, code] of Object.entries(ORIGIN_TYPE_TO_TRADE_CODE)) {
      const id = stTradeId('ADPT', DATE, type as keyof typeof ORIGIN_TYPE_TO_TRADE_CODE, 'EQ', undefined, undefined, 1);
      expect(id).toContain(`-${code}-`);
    }
  });

  it('pads NN to 2 digits minimum, rolls past 99', () => {
    expect(stTradeId('ADPT', DATE, 'manual', 'EQ', undefined, undefined, 1))
      .toBe('ADPT-260927-man-EQ-01');
    expect(stTradeId('ADPT', DATE, 'manual', 'EQ', undefined, undefined, 10))
      .toBe('ADPT-260927-man-EQ-10');
    expect(stTradeId('ADPT', DATE, 'manual', 'EQ', undefined, undefined, 100))
      .toBe('ADPT-260927-man-EQ-100');
  });

  it('rejects non-positive and non-integer sequences', () => {
    for (const seq of [0, -1, 1.5, NaN]) {
      expect(() => stTradeId('ADPT', DATE, 'manual', 'EQ', undefined, undefined, seq)).toThrow(/positive integer/);
      expect(() => stPositionGroupId('ADPT', DATE, seq)).toThrow(/positive integer/);
    }
  });

  it('throws when exp and strike are asymmetric', () => {
    expect(() => stTradeId('ADPT', DATE, 'signal', 'CSP', '260116', undefined, 1)).toThrow();
    expect(() => stTradeId('ADPT', DATE, 'signal', 'CSP', undefined, '10.00', 1)).toThrow();
  });

  it('uppercases the symbol', () => {
    expect(stTradeId('adpt', DATE, 'manual', 'EQ', undefined, undefined, 1))
      .toBe('ADPT-260927-man-EQ-01');
  });
});

describe('stPositionGroupId', () => {
  it('builds {SYM}-{YYMMDD}-grp-{NN}', () => {
    expect(stPositionGroupId('ADPT', DATE, 1)).toBe('ADPT-260927-grp-01');
  });

  it('rolls NN past 99', () => {
    expect(stPositionGroupId('ADPT', DATE, 100)).toBe('ADPT-260927-grp-100');
  });
});
