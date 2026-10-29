import { convertOptionsContractListDoc, convertOptionsReplayRunDoc } from './options-replay-firestore-converter';

const ts = (iso: string) => ({ toDate: () => new Date(iso) });

describe('options-replay-firestore-converter', () => {
  describe('convertOptionsReplayRunDoc', () => {
    it('maps a full run doc', () => {
      const ui = convertOptionsReplayRunDoc('run-1', {
        templateId: 'csp-45-20',
        symbols: ['spy', 'qqq'],
        startDate: '2026-01-02',
        status: 'running',
        totalLists: 2,
        completedLists: 1,
        failedLists: 0,
        createdAt: ts('2026-10-28T15:00:00Z'),
        updatedAt: '2026-10-28T15:05:00Z',
      });

      expect(ui.runId).toBe('run-1');
      expect(ui.templateId).toBe('csp-45-20');
      expect(ui.symbols).toEqual(['SPY', 'QQQ']);
      expect(ui.startDate).toBe('2026-01-02');
      expect(ui.status).toBe('running');
      expect(ui.totalLists).toBe(2);
      expect(ui.completedLists).toBe(1);
      expect(ui.failedLists).toBe(0);
      expect(ui.createdAtIso).toBe('2026-10-28T15:00:00.000Z');
      expect(ui.updatedAtIso).toBe('2026-10-28T15:05:00Z');
      expect(ui.completedAtIso).toBeUndefined();
      expect(ui.error).toBeUndefined();
    });

    it('fills defaults for a sparse doc', () => {
      const ui = convertOptionsReplayRunDoc('run-2', {});
      expect(ui.status).toBe('pending');
      expect(ui.symbols).toEqual([]);
      expect(ui.totalLists).toBe(0);
      expect(ui.createdAtIso).toBe('');
    });
  });

  describe('convertOptionsContractListDoc', () => {
    it('maps a success doc with rows + pickDocMeta', () => {
      const rows = [{ kind: 'pick', entryDate: '2026-01-02', contractId: 'SPY_260220P500' }];
      const pickDocMeta = {
        coordinate: { type: 'put', targetDelta: -0.2, expiry: { mode: 'nearestDte', dte: 45 } },
        gridVersion: 3,
        pickCount: 10,
        missCount: 2,
        firstDate: '2026-01-02',
        lastDate: '2026-01-15',
      };
      const ui = convertOptionsContractListDoc('run-1_SPY', {
        runId: 'run-1',
        symbol: 'SPY',
        templateId: 'csp-45-20',
        status: 'success',
        rows,
        pickDocMeta,
        generatedAt: ts('2026-10-28T15:01:00Z'),
      });

      expect(ui.listId).toBe('run-1_SPY');
      expect(ui.status).toBe('success');
      expect(ui.rows).toEqual(rows);
      expect(ui.pickDocMeta?.pickCount).toBe(10);
      expect(ui.generatedAtIso).toBe('2026-10-28T15:01:00.000Z');
    });

    it('maps a failed doc — rows/meta absent, error present', () => {
      const ui = convertOptionsContractListDoc('run-1_QQQ', {
        runId: 'run-1',
        symbol: 'QQQ',
        status: 'failed',
        error: 'pick doc not found for SPY-put-20-45',
      });

      expect(ui.status).toBe('failed');
      expect(ui.rows).toEqual([]);
      expect(ui.pickDocMeta).toBeUndefined();
      expect(ui.error).toBe('pick doc not found for SPY-put-20-45');
    });
  });
});
