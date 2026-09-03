import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { OccurrenceDecisionService } from '../services/occurrence-decision.service';
import { ReviewDecision } from '../common/constants';
import { SignalTimeframe, SignalDirection } from '../common/constants';
import type { StSignalItem, StOccurrenceDecision } from '../services/types';

describe('OccurrenceDecisionStore', () => {
  let store: InstanceType<typeof OccurrenceDecisionStore>;
  let occurrenceService: any;
  let snackBar: any;

  const RUN_ID = 'run-2026-08-25';
  const MARKET_DATE = '2026-08-25';

  function mockSignal(overrides: Partial<StSignalItem> = {}): StSignalItem {
    return {
      id: MARKET_DATE,
      symbol: 'AAPL',
      barDate: MARKET_DATE,
      marketDate: MARKET_DATE,
      runId: RUN_ID,
      timeframe: SignalTimeframe.WEEKLY,
      direction: SignalDirection.LONG,
      signalType: 'D_ZONE_V1_UPTICK',
      status: 'ACTIVE' as any,
      indicators: {},
      ...overrides,
    };
  }

  function mockDecision(overrides: Partial<StOccurrenceDecision> = {}): StOccurrenceDecision {
    return {
      id: 'test-id',
      runId: RUN_ID,
      marketDate: MARKET_DATE,
      symbol: 'AAPL',
      timeframe: SignalTimeframe.WEEKLY,
      direction: SignalDirection.LONG,
      signalType: 'D_ZONE_V1_UPTICK',
      barDate: MARKET_DATE,
      decisionType: ReviewDecision.ACCEPT,
      decidedAt: new Date().toISOString(),
      isCurrentInLatestRun: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    occurrenceService = {
      persistDecisionsBatch: jasmine.createSpy('persistDecisionsBatch').and.returnValue(of(undefined)),
      deleteDecisionsBatch: jasmine.createSpy('deleteDecisionsBatch').and.returnValue(of(undefined)),
      deleteDecisionIds: jasmine.createSpy('deleteDecisionIds').and.returnValue(of(undefined)),
      deleteAllDecisionsForSymbol: jasmine.createSpy('deleteAllDecisionsForSymbol').and.returnValue(of(undefined)),
      loadDecisionsForRun: jasmine.createSpy('loadDecisionsForRun').and.returnValue(of([])),
      loadDecisionsForLastNDays: jasmine.createSpy('loadDecisionsForLastNDays').and.returnValue(of([])),
    };

    snackBar = { open: jasmine.createSpy('open') };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: OccurrenceDecisionService, useValue: occurrenceService },
        { provide: MatSnackBar, useValue: snackBar },
        OccurrenceDecisionStore,
      ],
    });

    store = TestBed.inject(OccurrenceDecisionStore);
  });

  describe('statusForSymbol', () => {
    it('returns PENDING when no decisions exist', () => {
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.PENDING);
    });

    it('returns ACCEPT after accepting signals', () => {
      occurrenceService.persistDecisionsBatch.and.returnValue(of(undefined));
      store.acceptSignals([mockSignal()], RUN_ID, MARKET_DATE);
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.ACCEPT);
    });

    it('returns REJECT after rejecting signals', () => {
      occurrenceService.persistDecisionsBatch.and.returnValue(of(undefined));
      store.rejectSignals([mockSignal()], RUN_ID, MARKET_DATE);
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.REJECT);
    });

    it('returns PENDING after resetSymbol', () => {
      occurrenceService.persistDecisionsBatch.and.returnValue(of(undefined));
      store.acceptSignals([mockSignal()], RUN_ID, MARKET_DATE);
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.ACCEPT);
      occurrenceService.deleteDecisionIds.and.returnValue(of(undefined));
      store.resetSymbol('AAPL', RUN_ID);
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.PENDING);
    });

    it('normalizes symbol to uppercase', () => {
      occurrenceService.persistDecisionsBatch.and.returnValue(of(undefined));
      store.acceptSignals([mockSignal({ symbol: 'aapl' })], RUN_ID, MARKET_DATE);
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.ACCEPT);
    });

    it('includes decisions regardless of isCurrentInLatestRun flag', () => {
      occurrenceService.loadDecisionsForRun.and.returnValue(of([
        mockDecision({ isCurrentInLatestRun: false, decisionType: ReviewDecision.ACCEPT }),
      ]));
      store.loadDecisionsForRun(RUN_ID);
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.ACCEPT);
    });

    it('latest decision by decidedAt wins when both ACCEPT and REJECT exist', () => {
      occurrenceService.loadDecisionsForRun.and.returnValue(of([
        mockDecision({ id: 'd1', signalType: 'D_ZONE_V1_UPTICK', decisionType: ReviewDecision.REJECT, decidedAt: '2026-08-25T10:00:00.000Z' }),
        mockDecision({ id: 'd2', signalType: 'D_ZONE_V1_DOWNTICK', decisionType: ReviewDecision.ACCEPT, decidedAt: '2026-08-25T12:00:00.000Z' }),
      ]));
      store.loadDecisionsForRun(RUN_ID);
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.ACCEPT);
    });

    it('earlier decision loses to a later one even if ACCEPT came first', () => {
      occurrenceService.loadDecisionsForRun.and.returnValue(of([
        mockDecision({ id: 'd1', signalType: 'D_ZONE_V1_UPTICK', decisionType: ReviewDecision.ACCEPT, decidedAt: '2026-08-25T10:00:00.000Z' }),
        mockDecision({ id: 'd2', signalType: 'D_ZONE_V1_DOWNTICK', decisionType: ReviewDecision.REJECT, decidedAt: '2026-08-25T12:00:00.000Z' }),
      ]));
      store.loadDecisionsForRun(RUN_ID);
      expect(store.statusForSymbol('AAPL')).toBe(ReviewDecision.REJECT);
    });
  });

  describe('statusBySymbol', () => {
    it('returns empty map when no decisions exist', () => {
      expect(store.statusBySymbol()).toEqual({});
    });

    it('returns per-symbol status map for current run decisions', () => {
      occurrenceService.loadDecisionsForRun.and.returnValue(of([
        mockDecision({ id: 'd1', symbol: 'AAPL', decisionType: ReviewDecision.ACCEPT }),
        mockDecision({ id: 'd2', symbol: 'MSFT', decisionType: ReviewDecision.REJECT }),
      ]));
      store.loadDecisionsForRun(RUN_ID);
      expect(store.statusBySymbol()).toEqual({
        AAPL: ReviewDecision.ACCEPT,
        MSFT: ReviewDecision.REJECT,
      });
    });

    it('includes decisions regardless of isCurrentInLatestRun flag', () => {
      occurrenceService.loadDecisionsForRun.and.returnValue(of([
        mockDecision({ id: 'd1', symbol: 'AAPL', isCurrentInLatestRun: false }),
      ]));
      store.loadDecisionsForRun(RUN_ID);
      expect(store.statusBySymbol()).toEqual({
        AAPL: ReviewDecision.ACCEPT,
      });
    });
  });

  describe('durableStatusCounts', () => {
    it('returns zero counts when no decisions exist', () => {
      const counts = store.durableStatusCounts();
      expect(counts.ACCEPT).toBe(0);
      expect(counts.REJECT).toBe(0);
      expect(counts.PENDING).toBe(0);
    });

    it('counts unique symbols per durable status', () => {
      occurrenceService.loadDecisionsForRun.and.returnValue(of([
        mockDecision({ id: 'd1', symbol: 'AAPL', decisionType: ReviewDecision.ACCEPT }),
        mockDecision({ id: 'd2', symbol: 'MSFT', decisionType: ReviewDecision.ACCEPT }),
        mockDecision({ id: 'd3', symbol: 'GOOG', decisionType: ReviewDecision.REJECT }),
      ]));
      store.loadDecisionsForRun(RUN_ID);
      const counts = store.durableStatusCounts();
      expect(counts.ACCEPT).toBe(2);
      expect(counts.REJECT).toBe(1);
    });

    it('counts each symbol once even with multiple occurrences', () => {
      occurrenceService.loadDecisionsForRun.and.returnValue(of([
        mockDecision({ id: 'd1', symbol: 'AAPL', signalType: 'D_ZONE_V1_UPTICK', decisionType: ReviewDecision.ACCEPT }),
        mockDecision({ id: 'd2', symbol: 'AAPL', signalType: 'D_ZONE_V1_DOWNTICK', decisionType: ReviewDecision.ACCEPT }),
      ]));
      store.loadDecisionsForRun(RUN_ID);
      const counts = store.durableStatusCounts();
      expect(counts.ACCEPT).toBe(1);
    });
  });
});
