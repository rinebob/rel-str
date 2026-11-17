/**
 * @topic #1238 — Options Backtest, Thread #1240 (Selection Replay)
 * @task #1275 — SHARED: Replay contracts
 * @task #1493 — SHARED: Position-row v2 schema + v1 narrowing shim
 *
 * Fixture-shape tests for the selection-replay shared contracts: pick-doc
 * wire types (SA-served shape), contract-list row union, run/list doc
 * schemas, and callable/task payload types.
 */

import { OptionType } from './options-common';
import { TradeSide } from './common';
import {
  ContractListNoSelectionRow,
  ContractListNoSelectionRowV1,
  ContractListPickRowV1,
  ContractListPositionRow,
  ContractListRow,
  ContractListRowV1,
  isPickDocPick,
  legToPickDocCoordinate,
  positionRepeatsPrevious,
  templateToOptionLeg,
  v1ListDocToV2,
  v1PickToPosition,
  v1RowsToPositionRows,
  OPTIONS_CONTRACT_LIST_STATUSES,
  OPTIONS_REPLAY_RUN_STATUSES,
  OptionLeg,
  OptionsContractListDoc,
  OptionsContractListDocV1,
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
  PositionOptionLeg,
  PositionStockLeg,
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

  describe('ContractListRowV1 — legacy pick rows', () => {
    it('pick row carries all pick-day fields plus stamped side and repeat flag', () => {
      const row: ContractListRowV1 = {
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
      const row: ContractListRowV1 = { kind: 'no-selection', entryDate: '2025-12-16' };
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
      const row: ContractListRowV1 = {
        kind: 'pick',
        entryDate: '2025-12-15',
        side: TradeSide.SHORT,
        repeatsPrevious: true,
        ...day,
      };
      expect(row).toMatchObject(day);
    });

    it('narrows on kind — marker rows carry no pick fields', () => {
      const rows: ContractListRowV1[] = [
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
      const row: ContractListRowV1 = { kind: 'no-selection', entryDate: '2026-03-21', reason: 'out-of-range' };
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
    it('accepts a per-symbol v1 list doc with rows and pick-doc provenance', () => {
      const meta: PickDocMeta = {
        coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
        gridVersion: 3,
        pickCount: 64,
        missCount: 3,
        firstDate: '2025-12-15',
        lastDate: '2026-03-20',
      };
      const doc: OptionsContractListDocV1 = {
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

  describe('position-row schema v2 (task #1493)', () => {
    const coordinate: PickDocCoordinate = {
      type: OptionType.PUT,
      targetDelta: -0.3,
      expiry: { mode: 'nearestDte', dte: 30 },
    };
    const day: PickDocDay = {
      underlyingClose: 603.21,
      contractId: 'QQQ260130P00578000',
      expiration: '2026-01-30',
      dte: 30,
      strike: 578,
      delta: -0.148,
      iv: 0.213,
      mark: 3.01,
      bid: 2.98,
      ask: 3.05,
      volume: 412,
      openInterest: 5331,
    };
    const optionLeg: PositionOptionLeg = {
      kind: 'option',
      side: TradeSide.SHORT,
      coordinate,
      ...day,
    };
    const stockLeg: PositionStockLeg = {
      kind: 'stock',
      side: TradeSide.LONG,
      underlyingClose: 603.21,
    };

    it('option leg extends PickDocDay — day fields + coordinate + side', () => {
      expect(optionLeg).toMatchObject(day);
      expect(optionLeg.coordinate).toBe(coordinate);
      expect(optionLeg.side).toBe(TradeSide.SHORT);
    });

    it('stock leg carries side + underlyingClose — no pick-day fields', () => {
      expect(stockLeg).toEqual({
        kind: 'stock',
        side: TradeSide.LONG,
        underlyingClose: 603.21,
      });
      // @ts-expect-error — stock legs have no contract resolution
      void stockLeg.contractId;
      // @ts-expect-error — stock legs have no pick-doc coordinate
      void stockLeg.coordinate;
    });

    it('position row carries legs + entry date + repeat flag; single-leg IS legs.length 1', () => {
      const single: ContractListPositionRow = {
        kind: 'position',
        entryDate: '2025-12-15',
        legs: [optionLeg],
        repeatsPrevious: false,
      };
      const mixed: ContractListPositionRow = {
        kind: 'position',
        entryDate: '2025-12-15',
        legs: [optionLeg, stockLeg],
        repeatsPrevious: true,
      };
      expect(single.legs).toHaveLength(1);
      expect(mixed.legs.map((l) => l.kind)).toEqual(['option', 'stock']);
    });

    it('pick kind is retired — ContractListRow is position | no-selection', () => {
      const position: ContractListRow = {
        kind: 'position',
        entryDate: '2025-12-15',
        legs: [optionLeg],
        repeatsPrevious: false,
      };
      const marker: ContractListRow = {
        kind: 'no-selection',
        entryDate: '2025-12-16',
        legMisses: [{ legIndex: 0, coordinate }],
      };
      expect(position.kind).toBe('position');
      expect(marker.kind).toBe('no-selection');
      // @ts-expect-error — 'pick' is the v1 row kind; v2 emits position rows
      const retired: ContractListRow = { kind: 'pick', entryDate: '2025-12-15' };
      void retired;
    });

    it('no-selection rows name each failing leg — legIndex + coordinate + reason', () => {
      const row: ContractListNoSelectionRow = {
        kind: 'no-selection',
        entryDate: '2025-12-16',
        reason: 'miss',
        legMisses: [
          { legIndex: 0, coordinate, reason: 'miss' },
          {
            legIndex: 1,
            coordinate: { type: OptionType.PUT, targetDelta: -0.1, expiry: { mode: 'nearestDte', dte: 30 } },
            reason: 'gap',
          },
        ],
      };
      expect(row.legMisses).toHaveLength(2);
      expect(row.legMisses[1].coordinate.targetDelta).toBe(-0.1);
      expect(row.legMisses[1].reason).toBe('gap');
    });

    it('legMisses is required — a v2 no-selection row always names its misses', () => {
      // @ts-expect-error — v1-shaped marker without legMisses is not a v2 row
      const row: ContractListNoSelectionRow = { kind: 'no-selection', entryDate: '2025-12-16' };
      void row;
      // @ts-expect-error — an empty miss list is unrepresentable: a failed day names ≥1 leg
      const empty: ContractListNoSelectionRow = { kind: 'no-selection', entryDate: '2025-12-16', legMisses: [] };
      void empty;
    });

    it('v2 list doc carries schemaVersion 2 + legMetas (one per option leg)', () => {
      const meta: PickDocMeta = {
        coordinate,
        gridVersion: 3,
        pickCount: 64,
        missCount: 3,
        firstDate: '2025-12-15',
        lastDate: '2026-03-20',
      };
      const doc: OptionsContractListDoc = {
        runId: 'or-abc123',
        symbol: 'QQQ',
        templateId: 'csp-30-30',
        status: 'success',
        schemaVersion: 2,
        rows: [
          {
            kind: 'position',
            entryDate: '2025-12-15',
            legs: [optionLeg],
            repeatsPrevious: false,
          },
        ],
        legMetas: [meta, meta],
        generatedAt: '2026-10-25T00:05:00Z',
      };
      expect(doc.schemaVersion).toBe(2);
      expect(doc.legMetas).toHaveLength(2);
      // @ts-expect-error — pickDocMeta is the v1 provenance field
      void doc.pickDocMeta;
    });
  });

  describe('v1 narrowing shim (task #1493)', () => {
    const coordinate: PickDocCoordinate = {
      type: OptionType.PUT,
      targetDelta: -0.2,
      expiry: { mode: 'nearestDte', dte: 45 },
    };
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
    const pick: ContractListPickRowV1 = {
      kind: 'pick',
      entryDate: '2025-12-15',
      side: TradeSide.SHORT,
      repeatsPrevious: false,
      ...day,
    };

    it('v1PickToPosition narrows field-for-field — every day field + side + stamped coordinate', () => {
      const pos = v1PickToPosition(pick, coordinate);
      expect(pos.kind).toBe('position');
      expect(pos.entryDate).toBe('2025-12-15');
      expect(pos.repeatsPrevious).toBe(false);
      expect(pos.legs).toHaveLength(1);
      const leg = pos.legs[0];
      expect(leg.kind).toBe('option');
      expect(leg).toMatchObject(day);
      expect(leg).toMatchObject({ side: TradeSide.SHORT, coordinate });
    });

    it('v1RowsToPositionRows converts a sequence — marker gains leg-0 miss detail', () => {
      const gap: ContractListNoSelectionRowV1 = {
        kind: 'no-selection',
        entryDate: '2025-12-16',
        reason: 'miss',
      };
      const rows = v1RowsToPositionRows([pick, gap], coordinate);
      expect(rows.map((r) => r.kind)).toEqual(['position', 'no-selection']);
      const marker = rows[1];
      if (marker.kind !== 'no-selection') throw new Error('expected no-selection');
      expect(marker.reason).toBe('miss');
      expect(marker.legMisses).toEqual([{ legIndex: 0, coordinate, reason: 'miss' }]);
    });

    it('marker without a reason still fills legMisses — reason left unset', () => {
      const gap: ContractListNoSelectionRowV1 = { kind: 'no-selection', entryDate: '2025-12-16' };
      const rows = v1RowsToPositionRows([gap], coordinate);
      const marker = rows[0];
      if (marker.kind !== 'no-selection') throw new Error('expected no-selection');
      expect(marker.legMisses).toEqual([{ legIndex: 0, coordinate }]);
    });

    it('repeatsPrevious resets across no-selection gaps even when v1 data claims a repeat', () => {
      const gap: ContractListNoSelectionRowV1 = { kind: 'no-selection', entryDate: '2025-12-16' };
      const staleRepeat: ContractListPickRowV1 = { ...pick, entryDate: '2025-12-17', repeatsPrevious: true };
      const rows = v1RowsToPositionRows([pick, gap, staleRepeat], coordinate);
      const after = rows[2];
      if (after.kind !== 'position') throw new Error('expected position');
      expect(after.repeatsPrevious).toBe(false);
    });

    it('a first row can never repeat — flag normalized to false', () => {
      const staleRepeat: ContractListPickRowV1 = { ...pick, repeatsPrevious: true };
      const rows = v1RowsToPositionRows([staleRepeat], coordinate);
      const first = rows[0];
      if (first.kind !== 'position') throw new Error('expected position');
      expect(first.repeatsPrevious).toBe(false);
    });

    it('consecutive picks carry repeatsPrevious verbatim', () => {
      const again: ContractListPickRowV1 = { ...pick, entryDate: '2025-12-16', repeatsPrevious: true };
      const rows = v1RowsToPositionRows([pick, again], coordinate);
      const second = rows[1];
      if (second.kind !== 'position') throw new Error('expected position');
      expect(second.repeatsPrevious).toBe(true);
    });

    it('a corrupt flag survives nothing — repeat claim with a different contractId normalizes false', () => {
      const different: ContractListPickRowV1 = {
        ...pick,
        entryDate: '2025-12-16',
        contractId: 'QQQ260130P00565000',
        repeatsPrevious: true,
      };
      const rows = v1RowsToPositionRows([pick, different], coordinate);
      const second = rows[1];
      if (second.kind !== 'position') throw new Error('expected position');
      expect(second.repeatsPrevious).toBe(false);
    });

    it('v1ListDocToV2 narrows a whole doc — meta becomes legMetas[0], schemaVersion stamped', () => {
      const meta: PickDocMeta = {
        coordinate,
        gridVersion: 3,
        pickCount: 64,
        missCount: 3,
        firstDate: '2025-12-15',
        lastDate: '2026-03-20',
      };
      const v1: OptionsContractListDocV1 = {
        runId: 'or-abc123',
        symbol: 'QQQ',
        templateId: 'csp-45-20',
        status: 'success',
        rows: [pick, { kind: 'no-selection', entryDate: '2025-12-16', reason: 'gap' }],
        pickDocMeta: meta,
        generatedAt: '2026-10-25T00:05:00Z',
      };
      const doc = v1ListDocToV2(v1);
      expect(doc.schemaVersion).toBe(2);
      expect(doc.legMetas).toEqual([meta]);
      expect(doc.rows.map((r) => r.kind)).toEqual(['position', 'no-selection']);
      expect(doc.runId).toBe('or-abc123');
      expect(doc.generatedAt).toBe(v1.generatedAt);
    });

    it('throws a clear error on a v1 stub doc — stubs merge-write Partial fields', () => {
      // JSON.parse is what Firestore actually hands back — a Partial-shaped
      // stub behind the full type, not a type-erasing cast.
      const stub = JSON.parse('{"runId":"or-dead","status":"failed"}') as OptionsContractListDocV1;
      expect(() => v1ListDocToV2(stub)).toThrow(/incomplete v1 list doc/);
    });
  });

  describe('positionRepeatsPrevious — all-legs-match semantics (task #1493)', () => {
    const legA: PositionOptionLeg = {
      kind: 'option',
      side: TradeSide.SHORT,
      coordinate: { type: OptionType.PUT, targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
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
    const legB: PositionOptionLeg = {
      ...legA,
      side: TradeSide.LONG,
      coordinate: { type: OptionType.PUT, targetDelta: -0.1, expiry: { mode: 'nearestDte', dte: 45 } },
      contractId: 'QQQ260130P00565000',
    };
    const stock: PositionStockLeg = { kind: 'stock', side: TradeSide.LONG, underlyingClose: 603.21 };

    it('false when there is no previous position', () => {
      expect(positionRepeatsPrevious(undefined, [legA])).toBe(false);
    });

    it('true when every leg matches — marks may drift, identity cannot', () => {
      const later: PositionOptionLeg = { ...legA, mark: 3.4, delta: -0.16 };
      expect(positionRepeatsPrevious([legA], [later])).toBe(true);
    });

    it('false when any single option leg picks a different contract', () => {
      const other: PositionOptionLeg = { ...legB, contractId: 'QQQ260130P00560000' };
      expect(positionRepeatsPrevious([legA, legB], [legA, other])).toBe(false);
    });

    it('false when leg count or leg kind changes', () => {
      expect(positionRepeatsPrevious([legA, legB], [legA])).toBe(false);
      expect(positionRepeatsPrevious([legA, stock], [legA, legB])).toBe(false);
    });

    it('stock legs match on kind + side — a stock leg has no contractId', () => {
      const flipped: PositionStockLeg = { ...stock, side: TradeSide.SHORT };
      expect(positionRepeatsPrevious([stock], [{ ...stock, underlyingClose: 610.0 }])).toBe(true);
      expect(positionRepeatsPrevious([stock], [flipped])).toBe(false);
    });
  });
});
