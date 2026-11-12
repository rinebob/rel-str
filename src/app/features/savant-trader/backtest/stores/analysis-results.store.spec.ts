import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { Subject } from 'rxjs';

import { AnalysisResultsStore } from './analysis-results.store';
import { winLossOf } from '../utils/analysis-results-metrics.util';
import { OptionsAnalysisRunsService } from '../services/options-analysis-runs.service';
import { OptionsReplayRunsService } from '../services/options-replay-runs.service';
import { EXIT_REGISTRY_VERSION, EXIT_STRATEGIES } from '@options-analysis/registry';
import { TradeSide } from '@common';
import type {
  AnalysisErrorTrade,
  AnalysisExitTrade,
  AnalysisExpiredTrade,
  AnalysisOpenTrade,
  AnalysisResultDoc,
  ExitTypeAggregate,
} from '@options-analysis/contracts';
import type { OptionsReplayRunUi } from '../common/options-replay.types';

function makeAggregate(overrides: Partial<ExitTypeAggregate> = {}): ExitTypeAggregate {
  return {
    exitId: 'target-90',
    contractCount: 10,
    exitedCount: 7,
    expiredCount: 2,
    openCount: 1,
    errorCount: 1,
    hitRatePct: 77.8,
    avgDaysToExit: 12.4,
    avgPremiumCapturedPct: 91.5,
    worstMae: 1.85,
    ...overrides,
  };
}

// Per-variant factories — one per union member so specs can't fabricate
// union-impossible shapes (AnalysisTradeBase isn't exported; the common
// fields are inlined here).
const tradeBase = () => ({
  runId: 'run-1',
  symbol: 'SPY',
  templateId: 'csp-45-20',
  contractListDocId: 'run-1_SPY',
  exitId: 'target-90',
  pickDate: '2026-06-10',
  contractId: 'SPY260619P00500000',
  entryMark: 2.5,
  daysHeld: 9,
  mae: { value: 1.2, date: '2026-06-12' },
  mfe: { value: 3.1, date: '2026-06-18' },
});

function makeExitRecord(overrides: Partial<AnalysisExitTrade> = {}): AnalysisExitTrade {
  return { ...tradeBase(), outcome: 'exit', exitDate: '2026-06-19', exitPrice: 0.25, ...overrides };
}

function makeExpiredRecord(overrides: Partial<AnalysisExpiredTrade> = {}): AnalysisExpiredTrade {
  return {
    ...tradeBase(),
    outcome: 'expired',
    expiredItm: false,
    intrinsicAtExpiry: 0,
    assignmentDistancePct: 3.2,
    ...overrides,
  };
}

function makeOpenRecord(overrides: Partial<AnalysisOpenTrade> = {}): AnalysisOpenTrade {
  return { ...tradeBase(), outcome: 'open', lastBarDate: '2026-06-18', ...overrides };
}

function makeErrorRecord(overrides: Partial<AnalysisErrorTrade> = {}): AnalysisErrorTrade {
  return {
    ...tradeBase(),
    outcome: 'error',
    error: 'no series',
    daysHeld: 0,
    ...overrides,
  };
}

function makeDoc(overrides: Partial<AnalysisResultDoc> = {}): AnalysisResultDoc {
  return {
    contractListDocId: 'run-1_SPY',
    runId: 'run-1',
    symbol: 'SPY',
    templateId: 'csp-45-20',
    exitId: 'target-90',
    registryVersion: EXIT_REGISTRY_VERSION,
    status: 'success',
    trades: [],
    aggregate: makeAggregate(),
    generatedAt: '2026-11-05T00:00:00Z',
    ...overrides,
  };
}

describe('AnalysisResultsStore', () => {
  let docsSubject: Subject<AnalysisResultDoc[]>;
  let subjectsByCall: Subject<AnalysisResultDoc[]>[];
  let runSubject: Subject<OptionsReplayRunUi | null>;
  let serviceStub: { watchListResultDocs: jest.Mock };
  let runsStub: { watchRunDoc: jest.Mock };

  async function setup() {
    docsSubject = new Subject();
    subjectsByCall = [docsSubject];
    runSubject = new Subject();
    serviceStub = {
      watchListResultDocs: jest.fn(() => {
        // One subject per call — mirrors distinct Firestore listeners so a
        // "stale" emission really is on a torn-down subscription.
        const s = subjectsByCall[subjectsByCall.length - 1];
        return s.asObservable();
      }),
    };
    runsStub = { watchRunDoc: jest.fn(() => runSubject.asObservable()) };

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        AnalysisResultsStore,
        { provide: OptionsAnalysisRunsService, useValue: serviceStub },
        { provide: OptionsReplayRunsService, useValue: runsStub },
      ],
    }).compileComponents();

    return TestBed.inject(AnalysisResultsStore);
  }

  it('streams docs for the listDocId and flips loaded on first emission', async () => {
    const store = await setup();
    store.watchList('run-1_SPY');

    expect(serviceStub.watchListResultDocs).toHaveBeenCalledWith('run-1_SPY');
    expect(store.loading()).toBe(true);

    docsSubject.next([makeDoc()]);
    expect(store.loading()).toBe(false);
    expect(store.docs().length).toBe(1);
  });

  it('empty state when the stream emits no docs', async () => {
    const store = await setup();
    store.watchList('run-1_SPY');
    docsSubject.next([]);

    expect(store.loading()).toBe(false);
    expect(store.empty()).toBe(true);
  });

  it('re-watching a different list resets docs and swaps the stream', async () => {
    const store = await setup();
    store.watchList('run-1_SPY');
    docsSubject.next([makeDoc()]);
    expect(store.docs().length).toBe(1);

    const secondSubject = new Subject<AnalysisResultDoc[]>();
    subjectsByCall.push(secondSubject);
    store.watchList('run-2_QQQ');
    expect(serviceStub.watchListResultDocs).toHaveBeenCalledWith('run-2_QQQ');
    expect(store.docs().length).toBe(0);
    expect(store.loading()).toBe(true);

    // A stale emission from the torn-down stream must not leak in.
    docsSubject.next([makeDoc()]);
    expect(store.docs().length).toBe(0);
  });

  it('records a stream error', async () => {
    const store = await setup();
    store.watchList('run-1_SPY');
    docsSubject.error(new Error('permission-denied'));

    expect(store.loading()).toBe(false);
    expect(store.streamError()).toBe('permission-denied');
  });

  describe('aggregateRows', () => {
    it('emits one row per registry strategy in registry order', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([]);

      const rows = store.aggregateRows();
      expect(rows.map((r) => r.exitId)).toEqual(
        [...EXIT_STRATEGIES].sort((a, b) => a.order - b.order).map((s) => s.exitId),
      );
      expect(rows.every((r) => r.status === 'missing')).toBe(true);
      expect(rows.every((r) => r.aggregate === null)).toBe(true);
    });

    it('joins each doc to its strategy row; a failed doc reports status + error', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({ exitId: 'target-90' }),
        makeDoc({ exitId: 'dte-21', status: 'failed', error: 'series fetch failed' }),
      ]);

      const rows = store.aggregateRows();
      const t90 = rows.find((r) => r.exitId === 'target-90')!;
      const dte = rows.find((r) => r.exitId === 'dte-21')!;
      const missing = rows.find((r) => r.exitId === 'expiry')!;

      expect(t90.status).toBe('success');
      expect(t90.aggregate?.hitRatePct).toBe(77.8);
      expect(dte.status).toBe('failed');
      expect(dte.error).toBe('series fetch failed');
      expect(missing.status).toBe('missing');
      // A failed sibling must not disturb the successful row.
      expect(t90.aggregate?.exitedCount).toBe(7);
    });
  });

  describe('eventRows', () => {
    it('flattens trades across docs with exit labels, sorted by pickDate then contractId', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({
          exitId: 'target-90',
          trades: [
            makeExitRecord({ pickDate: '2026-06-12', contractId: 'B' }),
            makeExitRecord({ pickDate: '2026-06-10', contractId: 'C' }),
          ],
        }),
        makeDoc({
          exitId: 'dte-21',
          trades: [makeExitRecord({ exitId: 'dte-21', pickDate: '2026-06-10', contractId: 'A' })],
        }),
      ]);

      const rows = store.eventRows();
      expect(rows.map((r) => `${r.record.pickDate}:${r.record.contractId}`)).toEqual([
        '2026-06-10:A',
        '2026-06-10:C',
        '2026-06-12:B',
      ]);
      const t90Label = EXIT_STRATEGIES.find((s) => s.exitId === 'target-90')!.label;
      expect(rows[1].exitLabel).toBe(t90Label);
    });

    it('exitFilter narrows to one exit type; all restores', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({ exitId: 'target-90', trades: [makeExitRecord()] }),
        makeDoc({ exitId: 'dte-21', trades: [makeExitRecord({ exitId: 'dte-21' })] }),
      ]);
      expect(store.eventRows().length).toBe(2);

      store.setExitFilter('dte-21');
      expect(store.eventRows().length).toBe(1);
      expect(store.eventRows()[0].exitId).toBe('dte-21');

      store.setExitFilter('all');
      expect(store.eventRows().length).toBe(2);
    });

    it('excludes trades from docs whose exitId is no longer registered', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({ exitId: 'target-90', trades: [makeExitRecord({ contractId: 'A' })] }),
        // 'removed-strategy' has no aggregate row or chip — its events must
        // not render as orphans.
        makeDoc({
          exitId: 'removed-strategy',
          trades: [makeExitRecord({ exitId: 'removed-strategy', contractId: 'ORPHAN' })],
        }),
      ]);

      expect(store.eventRows().map((r) => r.record.contractId)).toEqual(['A']);
    });
  });

  describe('staleness', () => {
    it('flags rows whose doc was written under a different registry version', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({ exitId: 'target-90', registryVersion: 0 }), // predates v1
        makeDoc({ exitId: 'dte-21', registryVersion: EXIT_REGISTRY_VERSION }),
      ]);

      const rows = store.aggregateRows();
      expect(rows.find((r) => r.exitId === 'target-90')!.stale).toBe(true);
      expect(rows.find((r) => r.exitId === 'dte-21')!.stale).toBe(false);
      // Missing docs are never stale.
      expect(rows.find((r) => r.status === 'missing')!.stale).toBe(false);
    });

    it('a failed doc from an unregistered exitId still surfaces in the banner rows', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({ exitId: 'removed-strategy', status: 'failed', error: 'worker blew up' }),
      ]);

      expect(store.failedRows().length).toBe(1);
      expect(store.failedRows()[0].error).toBe('worker blew up');
    });

    it('analyzedAt is the latest generatedAt across docs', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({ generatedAt: '2026-11-04T00:00:00Z' }),
        makeDoc({ exitId: 'dte-21', generatedAt: '2026-11-05T12:00:00Z' }),
      ]);

      expect(store.analyzedAt()).toBe('2026-11-05T12:00:00Z');
    });

    it('event rows carry the stale flag so the table can badge them', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({ exitId: 'target-90', registryVersion: 0, trades: [makeExitRecord()] }),
        makeDoc({ exitId: 'dte-21', trades: [makeExitRecord({ exitId: 'dte-21' })] }),
      ]);

      const events = store.eventRows();
      expect(events.find((r) => r.exitId === 'target-90')!.stale).toBe(true);
      expect(events.find((r) => r.exitId === 'dte-21')!.stale).toBe(false);
    });
  });

  // #1431 — outcome chips, wins/losses, header context.
  describe('1431 follow-ups', () => {
    it('outcomeFilter narrows rows to one outcome, ANDed with exitFilter; reset on watchList', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({
          exitId: 'target-90',
          trades: [
            makeExitRecord({ contractId: 'EXIT' }),
            makeOpenRecord({ contractId: 'OPEN' }),
            makeErrorRecord({ contractId: 'ERR' }),
          ],
        }),
        makeDoc({
          exitId: 'dte-21',
          trades: [makeOpenRecord({ exitId: 'dte-21', contractId: 'OPEN2' })],
        }),
      ]);
      expect(store.eventRows().length).toBe(4);

      store.setOutcomeFilter('open');
      expect(store.eventRows().map((r) => r.record.contractId)).toEqual(['OPEN', 'OPEN2']);

      store.setExitFilter('dte-21');
      expect(store.eventRows().map((r) => r.record.contractId)).toEqual(['OPEN2']);

      // Re-binding the route resets both filters.
      const second = new Subject<AnalysisResultDoc[]>();
      subjectsByCall.push(second);
      store.watchList('run-2_QQQ');
      expect(store.outcomeFilter()).toBe('all');
      expect(store.exitFilter()).toBe('all');
    });

    it('winLossOf — SHORT: exit below entry / expired-OTM wins; exit above / full-ITM losses; open/error/breakeven neither', () => {
      const wl = winLossOf(
        [
          makeExitRecord({ exitPrice: 0.25 }), // win (2.5 → 0.25)
          makeExitRecord({ exitPrice: 5.0, contractId: 'L' }), // loss
          makeExitRecord({ exitPrice: 2.5, contractId: 'BE' }), // breakeven
          makeExpiredRecord({ expiredItm: false, contractId: 'OTM' }), // win
          // Full ITM — intrinsic exceeds the premium collected → loss.
          makeExpiredRecord({ expiredItm: true, contractId: 'ITM', intrinsicAtExpiry: 5.0 }),
          // Partial ITM — assigned $0.50 against $2.50 collected → win
          // (binary-ITM would misprice this as a loss; review R1).
          makeExpiredRecord({ expiredItm: true, contractId: 'PART', intrinsicAtExpiry: 0.5 }),
          makeOpenRecord({ contractId: 'OPEN' }),
          makeErrorRecord({ contractId: 'ERR' }),
        ],
        TradeSide.SHORT,
      );
      expect(wl).toEqual({ wins: 3, losses: 2 });
    });

    it('winLossOf — LONG inverts; undefined side → null', () => {
      const wl = winLossOf(
        [
          makeExitRecord({ exitPrice: 5.0 }), // LONG win
          // ITM intrinsic above the premium paid → LONG win.
          makeExpiredRecord({ expiredItm: true, contractId: 'ITM', intrinsicAtExpiry: 5.0 }),
        ],
        TradeSide.LONG,
      );
      expect(wl).toEqual({ wins: 2, losses: 0 });
      expect(winLossOf([makeExitRecord()], undefined)).toBeNull();
    });

    it('aggregateRows expose winsLosses for success docs (csp-45-20 is SHORT)', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({
          exitId: 'target-90',
          trades: [
            makeExitRecord({ exitPrice: 0.25 }), // win
            makeExitRecord({ exitPrice: 5.0, contractId: 'L' }), // loss
          ],
        }),
      ]);

      const row = store.aggregateRows().find((r) => r.exitId === 'target-90')!;
      expect(row.winsLosses).toEqual({ wins: 1, losses: 1 });
      // Failed/missing docs carry null.
      const missing = store.aggregateRows().find((r) => r.status === 'missing')!;
      expect(missing.winsLosses).toBeNull();
    });

    it('positionCount/templateName/startDate drive the header', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([makeDoc()]);
      runSubject.next({
        runId: 'run-1_SPY',
        templateId: 'csp-45-20',
        symbol: 'SPY',
        startDate: '2026-01-05',
        status: 'completed',
        createdAtIso: '2026-01-05T00:00:00Z',
      });

      expect(runsStub.watchRunDoc).toHaveBeenCalledWith('run-1_SPY');
      expect(store.positionCount()).toBe(10);
      expect(store.templateName()).toBe('45DTE 20Δ put (CSP)');
      expect(store.startDate()).toBe('2026-01-05');
    });

    it('eventRows carry derived metrics — expired priceChange, capitalRoc under SHORT side', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([
        makeDoc({
          trades: [
            makeExpiredRecord({ expiredItm: true, intrinsicAtExpiry: 0.5 }), // 0.5 − 2.5 = −2.0
            makeOpenRecord({ contractId: 'QQQ260619P00400000' }),
          ],
        }),
      ]);

      const rows = store.eventRows();
      const expired = rows.find((r) => r.record.outcome === 'expired')!;
      expect(expired.priceChange).toEqual({ delta: -2.0, pct: -80 });
      expect(expired.outcomeText).toContain('expired ITM');
      // SPY260619P00500000 → strike 500 → capital $50,000, ROC 0.5%.
      expect(expired.capitalRoc).toEqual({ capital: 50000, rocPct: 0.5 });
      expect(expired.maePct).toBeCloseTo(48); // 1.2 / 2.5

      const open = rows.find((r) => r.record.outcome === 'open')!;
      expect(open.priceChange).toBeNull();
      expect(open.outcomeText).toContain('still open');
    });

    it('eventRows capitalRoc renders null for an unregistered template (side unknown)', async () => {
      const store = await setup();
      store.watchList('run-1_SPY');
      docsSubject.next([makeDoc({ templateId: 'not-registered', trades: [makeExitRecord()] })]);

      const row = store.eventRows()[0];
      expect(row.capitalRoc).toBeNull();
    });
  });
});
