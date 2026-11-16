/**
 * @topic #1238 — Options Backtest, Thread #1240 (Selection Replay)
 * @task #1275 — SHARED: Replay contracts
 *
 * Fixture-shape tests for the selection-replay shared contracts: pick-doc
 * wire types (SA-served shape), contract-list row union, run/list doc
 * schemas, and callable/task payload types.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import {
  ContractListRow,
  isPickDocPick,
  legToPickDocCoordinate,
  templateToOptionLeg,
  OPTIONS_CONTRACT_LIST_STATUSES,
  OPTIONS_REPLAY_RUN_STATUSES,
  OptionLeg,
  OptionsContractListDoc,
  OptionsReplayPermutationPayload,
  OptionsReplayRun,
  OptionsReplayStartRequest,
  OptionsReplayStartResponse,
  PickDocCoordinate,
  PickDocDay,
  PickDocDayEntry,
  PickDocument,
  PickDocMeta,
  PickDocMiss,
  ReplayTemplate,
  ReplayVariant,
  StockLeg,
  VariantLeg,
  VariantSnapshot,
} from './options-replay-contracts';

describe('options-replay-contracts', () => {
  describe('PickDocCoordinate', () => {
    it('accepts a nearestDte put coordinate', () => {
      const coord: PickDocCoordinate = {
        type: OptionType.PUT,
        targetDelta: -0.2,
        expiry: { mode: 'nearestDte', dte: 45 },
      };
      expect(coord.expiry.dte).toBe(45);
    });
  });

  describe('ReplayTemplate', () => {
    it('carries a pick-doc coordinate plus a stamped side', () => {
      const template: ReplayTemplate = {
        id: 'csp-45-20',
        name: '45DTE 20Δ put (CSP)',
        description: 'Sell one 45DTE 20-delta put daily',
        side: TradeSide.SHORT,
        coordinate: {
          type: OptionType.PUT,
          targetDelta: -0.2,
          expiry: { mode: 'nearestDte', dte: 45 },
        },
      };
      expect(template.side).toBe(TradeSide.SHORT);
      expect(template.coordinate.targetDelta).toBe(-0.2);
    });
  });

  describe('VariantLeg (Thread #1270)', () => {
    it('option leg carries type + signed targetDelta + dte + side', () => {
      const leg: OptionLeg = {
        kind: 'option',
        type: OptionType.PUT,
        targetDelta: -0.2,
        dte: 45,
        side: TradeSide.SHORT,
      };
      expect(leg.kind).toBe('option');
      expect(leg.targetDelta).toBe(-0.2);
    });

    it('stock leg carries side only — no pick-doc fields', () => {
      const leg: StockLeg = { kind: 'stock', side: TradeSide.LONG };
      expect(leg.kind).toBe('stock');
      // @ts-expect-error — stock legs have no option coordinate fields
      expect(leg.targetDelta).toBeUndefined();
    });

    it('narrows on kind across the VariantLeg union', () => {
      const legs: VariantLeg[] = [
        { kind: 'option', type: OptionType.CALL, targetDelta: 0.2, dte: 30, side: TradeSide.LONG },
        { kind: 'stock', side: TradeSide.LONG },
      ];
      const optionLegs = legs.filter((l): l is OptionLeg => l.kind === 'option');
      expect(optionLegs).toHaveLength(1);
      expect(optionLegs[0].type).toBe(OptionType.CALL);
    });
  });

  describe('legToPickDocCoordinate (Thread #1270)', () => {
    it('maps a put leg to the signed SA coordinate + nearestDte expiry', () => {
      const leg: OptionLeg = {
        kind: 'option',
        type: OptionType.PUT,
        targetDelta: -0.2,
        dte: 45,
        side: TradeSide.SHORT,
      };
      expect(legToPickDocCoordinate(leg)).toEqual({
        type: OptionType.PUT,
        targetDelta: -0.2,
        expiry: { mode: 'nearestDte', dte: 45 },
      });
    });

    it('keeps call deltas positive — side never enters the coordinate', () => {
      const leg: OptionLeg = {
        kind: 'option',
        type: OptionType.CALL,
        targetDelta: 0.15,
        dte: 30,
        side: TradeSide.LONG,
      };
      const coord = legToPickDocCoordinate(leg);
      expect(coord.targetDelta).toBe(0.15);
      expect(coord.expiry.mode).toBe('nearestDte');
      expect('side' in coord).toBe(false);
    });
  });

  describe('templateToOptionLeg (Thread #1270)', () => {
    it('round-trips: legToPickDocCoordinate(templateToOptionLeg(t)) == t.coordinate', () => {
      const template: ReplayTemplate = {
        id: 'csp-45-20',
        name: '45DTE 20Δ put (CSP)',
        description: 'Sell one 45DTE 20-delta put daily',
        side: TradeSide.SHORT,
        coordinate: {
          type: OptionType.PUT,
          targetDelta: -0.2,
          expiry: { mode: 'nearestDte', dte: 45 },
        },
      };
      const leg = templateToOptionLeg(template);
      expect(leg).toEqual({
        kind: 'option',
        type: OptionType.PUT,
        targetDelta: -0.2,
        dte: 45,
        side: TradeSide.SHORT,
      });
      expect(legToPickDocCoordinate(leg)).toEqual(template.coordinate);
    });
  });

  describe('ReplayVariant / VariantSnapshot (Thread #1270)', () => {
    const vertical: VariantLeg[] = [
      { kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT },
      { kind: 'option', type: OptionType.PUT, targetDelta: -0.1, dte: 45, side: TradeSide.LONG },
    ];

    it('variant carries concrete legs + optional structure label', () => {
      const variant: ReplayVariant = {
        id: 'pcs-45-20-10',
        name: '45DTE 20/10Δ put credit spread',
        description: 'Sell 20Δ put, buy 10Δ put at 45DTE.',
        structure: 'put-credit-spread',
        legs: vertical,
      };
      expect(variant.legs).toHaveLength(2);
      expect(variant.structure).toBe('put-credit-spread');
    });

    it('snapshot is self-describing — legs + name + optional variantId', () => {
      const snapshot: VariantSnapshot = {
        variantId: 'pcs-45-20-10',
        name: '45DTE 20/10Δ put credit spread',
        legs: vertical,
      };
      expect(snapshot.legs[1].side).toBe(TradeSide.LONG);
      const inline: VariantSnapshot = { name: 'ad-hoc', legs: vertical };
      expect(inline.variantId).toBeUndefined();
    });
  });

  describe('PickDocument', () => {
    it('matches the SA pick-doc wire shape verbatim', () => {
      const day: PickDocDay = {
        underlyingClose: 603.21,
        contractId: 'QQQ260130P00578000',
        expiration: '2026-01-30',
        dte: 45,
        strike: 578,
        delta: -0.148,
        iv: 0.213,
        mark: 3.01,
        bid: 2.98,
        ask: 3.05,
        volume: 412,
        openInterest: 5331,
      };
      const doc: PickDocument = {
        symbol: 'QQQ',
        type: OptionType.PUT,
        targetDelta: -0.2,
        expiry: { mode: 'nearestDte', dte: 45 },
        gridVersion: 3,
        firstDate: '2025-12-15',
        lastDate: '2026-03-20',
        pickCount: 64,
        missCount: 3,
        days: { '2025-12-15': day },
      };
      const entry = doc.days['2025-12-15'];
      expect(isPickDocPick(entry)).toBe(true);
      if (isPickDocPick(entry)) {
        expect(entry.contractId).toBe('QQQ260130P00578000');
      }
      expect(doc.pickCount + doc.missCount).toBe(67);
    });

    it('days map carries explicit miss entries alongside picks (SA CellYearDoc parity)', () => {
      // Confirmed against av-proxy-api shared/options/options-delta-picks.types.ts:
      // the wire doc embeds DayMiss entries — consumers must not assume
      // every days entry is a pick.
      const miss: PickDocMiss = { status: 'no_chain', underlyingClose: 617.8 };
      const doc: PickDocument = {
        symbol: 'QQQ',
        type: OptionType.PUT,
        targetDelta: -0.2,
        expiry: { mode: 'nearestDte', dte: 45 },
        gridVersion: 1,
        firstDate: '2026-04-01',
        lastDate: '2026-04-14',
        pickCount: 1,
        missCount: 1,
        days: {
          '2026-04-01': {
            underlyingClose: 584.31,
            contractId: 'QQQ260515P00565000',
            expiration: '2026-05-15',
            dte: 44,
            strike: 565,
            delta: -0.204,
            iv: 0.198,
            mark: 8.42,
            bid: 8.3,
            ask: 8.54,
            volume: 412,
            openInterest: 5210,
          },
          '2026-04-14': miss,
        },
        updatedAt: '2026-04-15T00:00:00Z',
      };
      const entries: PickDocDayEntry[] = Object.values(doc.days);
      expect(entries.filter(isPickDocPick)).toHaveLength(1);
      expect(doc.days['2026-04-14']).toEqual(miss);
    });

    it('isPickDocPick narrows on contractId presence — misses carry no pick fields', () => {
      const miss: PickDocDayEntry = { status: 'no_match', reason: 'no expiration near target' };
      if (isPickDocPick(miss)) {
        throw new Error('miss should not narrow to pick');
      }
      // @ts-expect-error — contractId exists only on pick entries
      expect(miss.contractId).toBeUndefined();
    });
  });

  describe('ContractListRow', () => {
    it('pick row carries all pick-day fields plus stamped side and repeat flag', () => {
      const row: ContractListRow = {
        kind: 'pick',
        entryDate: '2025-12-15',
        side: TradeSide.SHORT,
        contractId: 'QQQ260130P00578000',
        expiration: '2026-01-30',
        dte: 45,
        strike: 578,
        delta: -0.148,
        iv: 0.213,
        mark: 3.01,
        bid: 2.98,
        ask: 3.05,
        volume: 412,
        openInterest: 5331,
        underlyingClose: 603.21,
        repeatsPrevious: false,
      };
      expect(row.kind).toBe('pick');
      expect(row.repeatsPrevious).toBe(false);
    });

    it('no-selection marker row carries only the entry date', () => {
      const row: ContractListRow = { kind: 'no-selection', entryDate: '2025-12-16' };
      expect(row.kind).toBe('no-selection');
    });

    it('pick rows extend PickDocDay — day fields land verbatim', () => {
      const day: PickDocDay = {
        underlyingClose: 603.21,
        contractId: 'QQQ260130P00578000',
        expiration: '2026-01-30',
        dte: 45,
        strike: 578,
        delta: -0.148,
        iv: 0.213,
        mark: 3.01,
        bid: 2.98,
        ask: 3.05,
        volume: 412,
        openInterest: 5331,
      };
      const row: ContractListRow = {
        kind: 'pick',
        entryDate: '2025-12-15',
        side: TradeSide.SHORT,
        repeatsPrevious: true,
        ...day,
      };
      expect(row).toMatchObject(day);
    });

    it('narrows on kind — marker rows carry no pick fields', () => {
      const rows: ContractListRow[] = [
        { kind: 'no-selection', entryDate: '2025-12-16' },
      ];
      const row = rows[0];
      if (row.kind === 'pick') {
        expect(row.contractId).toBeDefined();
      } else {
        // @ts-expect-error — contractId exists only on pick rows
        expect(row.contractId).toBeUndefined();
        expect(row.entryDate).toBe('2025-12-16');
      }
    });

    it('marker rows may carry a reason', () => {
      const row: ContractListRow = { kind: 'no-selection', entryDate: '2026-03-21', reason: 'out-of-range' };
      expect(row.reason).toBe('out-of-range');
    });
  });

  describe('OptionsReplayRun', () => {
    it('accepts a single-symbol run doc — a run IS one (template, symbol) selection', () => {
      const run: OptionsReplayRun = {
        runId: 'or-abc123_SPY',
        templateId: 'csp-45-20',
        symbol: 'SPY',
        startDate: '2026-01-05',
        status: 'running',
        createdAt: '2026-10-25T00:00:00Z',
        updatedAt: '2026-10-25T00:05:00Z',
      };
      expect(run.symbol).toBe('SPY');
      expect(run.completedAt).toBeUndefined();
    });

    it('run status values match the exported vocabulary const', () => {
      expect(OPTIONS_REPLAY_RUN_STATUSES).toEqual([
        'pending',
        'running',
        'completed',
        'failed',
        'cancelled',
      ]);
    });
  });

  describe('OptionsContractListDoc', () => {
    it('accepts a per-symbol list doc with rows and pick-doc provenance', () => {
      const meta: PickDocMeta = {
        coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
        gridVersion: 3,
        pickCount: 64,
        missCount: 3,
        firstDate: '2025-12-15',
        lastDate: '2026-03-20',
      };
      const doc: OptionsContractListDoc = {
        runId: 'or-abc123',
        symbol: 'QQQ',
        templateId: 'csp-45-20',
        status: 'success',
        rows: [{ kind: 'no-selection', entryDate: '2025-12-16' }],
        pickDocMeta: meta,
        generatedAt: '2026-10-25T00:05:00Z',
      };
      expect(doc.pickDocMeta.gridVersion).toBe(3);
      expect(doc.rows).toHaveLength(1);
    });

    it('list-doc status values match the exported vocabulary const', () => {
      expect(OPTIONS_CONTRACT_LIST_STATUSES).toEqual(['pending', 'running', 'success', 'failed']);
    });
  });

  describe('callable + task payloads', () => {
    const legs: VariantLeg[] = [
      { kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT },
    ];

    it('legacy templateId form still compiles (migration window)', () => {
      const req: OptionsReplayStartRequest = {
        templateId: 'csp-45-20',
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      const res: OptionsReplayStartResponse = { runIds: ['or-abc123_SPY'] };
      expect(req.symbols).toHaveLength(1);
      expect(res.runIds).toHaveLength(1);
    });

    it('variantId form — registry lookup request', () => {
      const req: OptionsReplayStartRequest = {
        variantId: 'pcs-45-20-10',
        symbols: ['SPY', 'QQQ'],
        startDate: '2026-01-05',
      };
      expect(req.variantId).toBe('pcs-45-20-10');
    });

    it('legs form — inline concrete legs + optional display name', () => {
      const req: OptionsReplayStartRequest = {
        legs,
        variantName: 'ad-hoc spread',
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      expect(req.legs).toHaveLength(1);
      if ('variantName' in req) expect(req.variantName).toBe('ad-hoc spread');
    });

    it('variantName exists only on the legs form', () => {
      // @ts-expect-error — named variants supply their own name
      const onVariant: OptionsReplayStartRequest = {
        variantId: 'pcs-45-20-10',
        variantName: 'x',
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      // @ts-expect-error — the legacy form never carried a label
      const onLegacy: OptionsReplayStartRequest = {
        templateId: 'csp-45-20',
        variantName: 'x',
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      expect([onVariant, onLegacy]).toHaveLength(2);
    });

    it('forms are mutually exclusive in the type', () => {
      // @ts-expect-error — variantId + legs together is not a valid form
      const both: OptionsReplayStartRequest = {
        variantId: 'pcs-45-20-10',
        legs,
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      // @ts-expect-error — neither form key present is not a valid request
      const neither: OptionsReplayStartRequest = {
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      // @ts-expect-error — templateId cannot combine with variantId
      const mixed: OptionsReplayStartRequest = {
        templateId: 'csp-45-20',
        variantId: 'pcs-45-20-10',
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      // @ts-expect-error — templateId cannot combine with legs either
      const mixedLegs: OptionsReplayStartRequest = {
        templateId: 'csp-45-20',
        legs,
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      expect([both, neither, mixed, mixedLegs]).toHaveLength(4);
    });

    it('OptionsReplayPermutationPayload is just the run identity — run doc carries the rest', () => {
      const payload: OptionsReplayPermutationPayload = {
        runId: 'or-abc123',
        symbol: 'QQQ',
      };
      expect(payload.symbol).toBe('QQQ');
      // @ts-expect-error — templateId/startDate left the payload in #1491;
      // the worker reads them off the run doc
      expect(payload.templateId).toBeUndefined();
    });

    it('run doc may carry a stamped variantSnapshot', () => {
      const run: OptionsReplayRun = {
        runId: 'or-abc123_SPY',
        templateId: 'csp-45-20',
        symbol: 'SPY',
        startDate: '2026-01-05',
        status: 'running',
        createdAt: '2026-10-25T00:00:00Z',
        updatedAt: '2026-10-25T00:05:00Z',
        variantSnapshot: {
          variantId: 'csp-45-20',
          name: '45DTE 20Δ put (CSP)',
          legs: [{ kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT }],
        },
      };
      expect(run.variantSnapshot?.legs).toHaveLength(1);
    });
  });
});
