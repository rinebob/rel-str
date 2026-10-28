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
  OPTIONS_CONTRACT_LIST_STATUSES,
  OPTIONS_REPLAY_RUN_STATUSES,
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
    it('accepts a run doc with progress counters', () => {
      const run: OptionsReplayRun = {
        runId: 'or-abc123',
        templateId: 'csp-45-20',
        symbols: ['SPY', 'QQQ'],
        startDate: '2026-01-05',
        status: 'running',
        totalLists: 2,
        completedLists: 1,
        failedLists: 0,
        createdAt: '2026-10-25T00:00:00Z',
        updatedAt: '2026-10-25T00:05:00Z',
      };
      expect(run.totalLists).toBe(2);
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
    it('OptionsReplayStartRequest carries templateId, symbols, startDate', () => {
      const req: OptionsReplayStartRequest = {
        templateId: 'csp-45-20',
        symbols: ['SPY'],
        startDate: '2026-01-05',
      };
      const res: OptionsReplayStartResponse = { runId: 'or-abc123' };
      expect(req.symbols).toHaveLength(1);
      expect(res.runId).toBe('or-abc123');
    });

    it('OptionsReplayPermutationPayload carries runId, symbol, templateId, startDate', () => {
      const payload: OptionsReplayPermutationPayload = {
        runId: 'or-abc123',
        symbol: 'QQQ',
        templateId: 'csp-45-20',
        startDate: '2026-01-05',
      };
      expect(payload.symbol).toBe('QQQ');
    });
  });
});
