import { TestBed, fakeAsync, tick } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { SignalReviewFacade, buildSignalOrderTickets } from './signal-review.facade';
import { GroupStore } from './group.store';
import { TriageStore } from './triage.store';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { StStore } from './st.store';
import { SignalReviewUiStore } from './signal-review-ui.store';
import { OrderTicketStore } from './order-ticket.store';
import { SignalService } from '../services/signal.service';
import { TradingConfigService } from '../services/trading-config.service';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ScrollTargetService } from '../services/scroll-target.service';
import { SignalDirection, SignalTimeframe, ReviewDecision } from '../common/constants';
import { OrderTicketStatus, OrderSource, InstrumentType } from '../services/order-ticket.types';
import type { StSignalItem, StOccurrenceDecision } from '../services/types';

function signal<T>(initial: T) {
  let value = initial;
  const s: any = () => value;
  s.set = (v: T) => { value = v; };
  return s;
}

function makeSignal(direction: SignalDirection = SignalDirection.LONG): StSignalItem {
  return {
    direction,
    timeframe: SignalTimeframe.DAILY,
    signalType: 'DAILY_BREAKOUT',
    barDate: '2026-08-25',
  } as StSignalItem;
}

describe('buildSignalOrderTickets', () => {
  it('stages one ticket per symbol and side with a stable UUID ref id', () => {
    const signals = [
      makeSignal(SignalDirection.LONG),
      { ...makeSignal(SignalDirection.LONG), timeframe: SignalTimeframe.WEEKLY },
      makeSignal(SignalDirection.SHORT),
    ] as StSignalItem[];

    const tickets = buildSignalOrderTickets('AAPL', signals, {
      runId: 'run-1',
      accountNumber: 'agentic-account',
      defaultDollarAmount: 100,
      now: new Date('2026-08-26T12:00:00Z'),
      buildId: (_symbol, side) => `AAPL-${side}`,
      buildRefId: () => '550e8400-e29b-41d4-a716-446655440000',
    });

    expect(tickets.length).toBe(2);
    expect(tickets.map((ticket) => ticket.side)).toEqual(['buy', 'sell']);
    expect(tickets.every((ticket) => ticket.accountNumber === 'agentic-account')).toBe(true);
    expect(tickets.every((ticket) => ticket.refId === '550e8400-e29b-41d4-a716-446655440000')).toBe(true);
    expect(tickets.every((ticket) => ticket.dollarAmount === '100')).toBe(true);
  });
});

describe('SignalReviewFacade', () => {
  let facade: SignalReviewFacade;
  let stagingStoreMock: any;
  let configServiceMock: any;
  let routerMock: any;
  let occurrenceStoreMock: any;
  let triageStoreMock: any;
  let signalServiceMock: any;
  let snackBarMock: any;
  let groupStoreMock: any;

  beforeEach(async () => {
    stagingStoreMock = {
      stageTicket: jasmine.createSpy('stageTicket'),
      removeTicket: jasmine.createSpy('removeTicket'),
      ticketsBySymbol: signal({}),
    };

    configServiceMock = {
      loadConfig: jasmine.createSpy('loadConfig').and.returnValue(
        of({ accountNumber: '123456789', updatedAt: '2026-08-25T12:00:00Z' }),
      ),
    };

    routerMock = {
      navigate: jasmine.createSpy('navigate'),
    };

    snackBarMock = {
      open: jasmine.createSpy('open'),
    };

    occurrenceStoreMock = {
      acceptedSymbols: signal<string[]>([]),
      acceptSignals: jasmine.createSpy('acceptSignals'),
      rejectSignals: jasmine.createSpy('rejectSignals'),
      resetSymbol: jasmine.createSpy('resetSymbol'),
    };

    triageStoreMock = {
      setScreeningStatus: jasmine.createSpy('setScreeningStatus'),
    };

    signalServiceMock = {
      getCurrentRunSignalsForSymbol: jasmine.createSpy('getCurrentRunSignalsForSymbol').and.returnValue(
        of([makeSignal(SignalDirection.LONG)]),
      ),
    };

    groupStoreMock = {
      isActionableRun: signal(true),
      activeRunId: signal('run-daily'),
      activeRunMarketDate: signal('2026-08-25'),
      latestCompletedRun: signal(null),
      setActiveRun: jasmine.createSpy('setActiveRun'),
      setFullscreen: jasmine.createSpy('setFullscreen'),
      loadSymbolsWithSignals: jasmine.createSpy('loadSymbolsWithSignals'),
    };

    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        SignalReviewFacade,
        { provide: GroupStore, useValue: groupStoreMock },
        { provide: TriageStore, useValue: triageStoreMock },
        { provide: OccurrenceDecisionStore, useValue: occurrenceStoreMock },
        { provide: SymbolListStore, useValue: {} },
        { provide: SymbolHistoryStore, useValue: { signalHistoryCache: signal({}) } },
        { provide: StStore, useValue: {} },
        { provide: SignalReviewUiStore, useValue: {} },
        { provide: OrderTicketStore, useValue: stagingStoreMock },
        { provide: SignalService, useValue: signalServiceMock },
        { provide: TradingConfigService, useValue: configServiceMock },
        { provide: UiStateService, useValue: { setFullscreen: jasmine.createSpy('setFullscreen'), fullscreen: signal(false) } },
        { provide: ScrollTargetService, useValue: {} },
        { provide: Router, useValue: routerMock },
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    });

    facade = TestBed.inject(SignalReviewFacade);
  });

  describe('acceptSymbol', () => {
    it('stages a buy ticket for a LONG signal', fakeAsync(() => {
      facade.acceptSymbol('AAPL');
      tick();

      expect(occurrenceStoreMock.acceptSignals).toHaveBeenCalled();
      expect(stagingStoreMock.stageTicket).toHaveBeenCalledTimes(1);
      const ticket = stagingStoreMock.stageTicket.calls.mostRecent().args[0];
      expect(ticket.side).toBe('buy');
      expect(ticket.instrumentType).toBe(InstrumentType.EQUITY);
      expect(ticket.source).toBe(OrderSource.SIGNAL_PIPELINE);
      expect(ticket.status).toBe(OrderTicketStatus.STAGED);
    }));

    it('stages a sell ticket for a SHORT signal', fakeAsync(() => {
      signalServiceMock.getCurrentRunSignalsForSymbol.and.returnValue(
        of([makeSignal(SignalDirection.SHORT)]),
      );

      facade.acceptSymbol('NVDA');
      tick();

      const ticket = stagingStoreMock.stageTicket.calls.mostRecent().args[0];
      expect(ticket.side).toBe('sell');
    }));

    it('deduplicates multiple signals with the same direction for one symbol', fakeAsync(() => {
      signalServiceMock.getCurrentRunSignalsForSymbol.and.returnValue(
        of([
          makeSignal(SignalDirection.LONG),
          { ...makeSignal(SignalDirection.LONG), timeframe: SignalTimeframe.WEEKLY },
        ]),
      );

      facade.acceptSymbol('AAPL');
      tick();

      expect(stagingStoreMock.stageTicket).toHaveBeenCalledTimes(1);
    }));

    it('removes the staged ticket and resets the occurrence when re-accepting an accepted symbol', fakeAsync(() => {
      occurrenceStoreMock.acceptedSymbols.set(['AAPL']);
      stagingStoreMock.ticketsBySymbol.set({
        AAPL: [
          { id: 'i1', symbol: 'AAPL', status: OrderTicketStatus.STAGED },
        ],
      });

      facade.acceptSymbol('AAPL');
      tick();

      expect(occurrenceStoreMock.resetSymbol).toHaveBeenCalledWith('AAPL', 'run-daily');
      expect(stagingStoreMock.removeTicket).toHaveBeenCalledWith('i1');
      expect(occurrenceStoreMock.acceptSignals).not.toHaveBeenCalled();
      expect(stagingStoreMock.stageTicket).not.toHaveBeenCalled();
    }));

    it('does not stage when config load fails', fakeAsync(() => {
      configServiceMock.loadConfig.and.returnValue(of(null));

      facade.acceptSymbol('AAPL');
      tick();

      expect(stagingStoreMock.stageTicket).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalled();
    }));

    it('shows a snackbar and does nothing when the run is not actionable', () => {
      groupStoreMock.isActionableRun.set(false);

      facade.acceptSymbol('AAPL');

      expect(occurrenceStoreMock.acceptSignals).not.toHaveBeenCalled();
      expect(stagingStoreMock.stageTicket).not.toHaveBeenCalled();
    });
  });

  describe('rejectSymbol', () => {
    it('rejects signals and removes any staged ticket', fakeAsync(() => {
      stagingStoreMock.ticketsBySymbol.set({
        AAPL: [
          { id: 'i1', symbol: 'AAPL', status: OrderTicketStatus.STAGED },
        ],
      });

      facade.rejectSymbol('AAPL');
      tick();

      expect(occurrenceStoreMock.rejectSignals).toHaveBeenCalled();
      expect(stagingStoreMock.removeTicket).toHaveBeenCalledWith('i1');
    }));
  });

  describe('considerSymbol and watchSymbol', () => {
    it('sets CONSIDER status through the triage store', () => {
      facade.considerSymbol('AAPL');
      expect(triageStoreMock.setScreeningStatus).toHaveBeenCalledWith('AAPL', ReviewDecision.CONSIDER);
    });

    it('sets WATCH status through the triage store', () => {
      facade.watchSymbol('AAPL');
      expect(triageStoreMock.setScreeningStatus).toHaveBeenCalledWith('AAPL', ReviewDecision.WATCH);
    });
  });

  describe('resetSymbol', () => {
    it('resets the occurrence for the symbol in the active run', () => {
      facade.resetSymbol('AAPL');
      expect(occurrenceStoreMock.resetSymbol).toHaveBeenCalledWith('AAPL', 'run-daily');
    });
  });

  describe('goToSignalOrder', () => {
    it('navigates to /signal-order', async () => {
      await facade.goToSignalOrder();
      expect(routerMock.navigate).toHaveBeenCalledWith(['/signal-order']);
    });
  });
});
