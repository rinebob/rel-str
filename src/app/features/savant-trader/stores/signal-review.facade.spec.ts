import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
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
import type { StSignalItem } from '../services/types';

/** Flush pending async work — native async/await (e.g. firstValueFrom inside
 *  stageTicketForSymbol) is not interceptable by fakeAsync under the
 *  jest-preset-angular transformer. Awaiting one macrotask boundary drains the
 *  entire microtask queue regardless of how many awaits the implementation has.
 *  (setImmediate is unavailable under jest-environment-jsdom; a zero-ms timer
 *  is the deterministic equivalent — it yields until the microtask queue is empty,
 *  not for a duration.) */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
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
      stageTicket: jest.fn(),
      removeTicket: jest.fn(),
      ticketsBySymbol: signal({}),
    };

    configServiceMock = {
      loadConfig: jest.fn().mockReturnValue(
        of({ accountNumber: '123456789', updatedAt: '2026-08-25T12:00:00Z' }),
      ),
    };

    routerMock = {
      navigate: jest.fn(),
    };

    snackBarMock = {
      open: jest.fn(),
    };

    occurrenceStoreMock = {
      acceptedSymbols: signal<string[]>([]),
      acceptSignals: jest.fn(),
      rejectSignals: jest.fn(),
      resetSymbol: jest.fn(),
    };

    triageStoreMock = {
      setScreeningStatus: jest.fn(),
    };

    signalServiceMock = {
      getCurrentRunSignalsForSymbol: jest.fn().mockReturnValue(
        of([makeSignal(SignalDirection.LONG)]),
      ),
    };

    groupStoreMock = {
      isActionableRun: signal(true),
      activeRunId: signal('run-daily'),
      activeRunMarketDate: signal('2026-08-25'),
      latestCompletedRun: signal(null),
      setActiveRun: jest.fn(),
      setFullscreen: jest.fn(),
      loadSymbolsWithSignals: jest.fn(),
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
        { provide: StStore, useValue: { latestCompletedRun: signal(null) } },
        { provide: SignalReviewUiStore, useValue: {} },
        { provide: OrderTicketStore, useValue: stagingStoreMock },
        { provide: SignalService, useValue: signalServiceMock },
        { provide: TradingConfigService, useValue: configServiceMock },
        { provide: UiStateService, useValue: { setFullscreen: jest.fn(), fullscreen: signal(false) } },
        { provide: ScrollTargetService, useValue: {} },
        { provide: Router, useValue: routerMock },
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    });

    facade = TestBed.inject(SignalReviewFacade);
  });

  describe('acceptSymbol', () => {
    it('stages a buy ticket for a LONG signal', async () => {
      facade.acceptSymbol('AAPL');
      await flush();

      expect(occurrenceStoreMock.acceptSignals).toHaveBeenCalled();
      expect(stagingStoreMock.stageTicket).toHaveBeenCalledTimes(1);
      const ticket = stagingStoreMock.stageTicket.mock.calls.at(-1)[0];
      expect(ticket.side).toBe('buy');
      expect(ticket.instrumentType).toBe(InstrumentType.EQUITY);
      expect(ticket.source).toBe(OrderSource.SIGNAL_PIPELINE);
      expect(ticket.status).toBe(OrderTicketStatus.STAGED);
    });

    it('stages a sell ticket for a SHORT signal', async () => {
      signalServiceMock.getCurrentRunSignalsForSymbol.mockReturnValue(
        of([makeSignal(SignalDirection.SHORT)]),
      );

      facade.acceptSymbol('NVDA');
      await flush();

      const ticket = stagingStoreMock.stageTicket.mock.calls.at(-1)[0];
      expect(ticket.side).toBe('sell');
    });

    it('deduplicates multiple signals with the same direction for one symbol', async () => {
      signalServiceMock.getCurrentRunSignalsForSymbol.mockReturnValue(
        of([
          makeSignal(SignalDirection.LONG),
          { ...makeSignal(SignalDirection.LONG), timeframe: SignalTimeframe.WEEKLY },
        ]),
      );

      facade.acceptSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicket).toHaveBeenCalledTimes(1);
    });

    it('removes the staged ticket and resets the occurrence when re-accepting an accepted symbol', async () => {
      occurrenceStoreMock.acceptedSymbols.set(['AAPL']);
      stagingStoreMock.ticketsBySymbol.set({
        AAPL: [
          { id: 'i1', symbol: 'AAPL', status: OrderTicketStatus.STAGED },
        ],
      });

      facade.acceptSymbol('AAPL');
      await flush();

      expect(occurrenceStoreMock.resetSymbol).toHaveBeenCalledWith('AAPL', 'run-daily');
      expect(stagingStoreMock.removeTicket).toHaveBeenCalledWith('i1');
      expect(occurrenceStoreMock.acceptSignals).not.toHaveBeenCalled();
      expect(stagingStoreMock.stageTicket).not.toHaveBeenCalled();
    });

    it('does not stage when config load fails', async () => {
      configServiceMock.loadConfig.mockReturnValue(of(null));

      facade.acceptSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicket).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalled();
    });

    it('shows a snackbar and does nothing when the run is not actionable', () => {
      groupStoreMock.isActionableRun.set(false);

      facade.acceptSymbol('AAPL');

      expect(occurrenceStoreMock.acceptSignals).not.toHaveBeenCalled();
      expect(stagingStoreMock.stageTicket).not.toHaveBeenCalled();
    });

    it('stages the ticket with the viewed run id when viewing a prior run', async () => {
      groupStoreMock.activeRunId.set('run-prior');
      groupStoreMock.activeRunMarketDate.set('2026-08-20');

      facade.acceptSymbol('AAPL');
      await flush();

      const ticket = stagingStoreMock.stageTicket.mock.calls.at(-1)[0];
      expect(ticket.signalContext.decisionId.startsWith('run-prior-')).toBe(true);
      expect(occurrenceStoreMock.acceptSignals).toHaveBeenCalledWith(
        expect.anything(),
        'run-prior',
        '2026-08-20',
      );
    });

    it('de-accept on a prior run removes the staged ticket and resets against the viewed run', async () => {
      groupStoreMock.activeRunId.set('run-prior');
      occurrenceStoreMock.acceptedSymbols.set(['AAPL']);
      stagingStoreMock.ticketsBySymbol.set({
        AAPL: [{ id: 'i1', symbol: 'AAPL', status: OrderTicketStatus.STAGED }],
      });

      facade.acceptSymbol('AAPL');
      await flush();

      expect(occurrenceStoreMock.resetSymbol).toHaveBeenCalledWith('AAPL', 'run-prior');
      expect(stagingStoreMock.removeTicket).toHaveBeenCalledWith('i1');
      expect(occurrenceStoreMock.acceptSignals).not.toHaveBeenCalled();
    });

    it('reject on a prior run writes the decision against the viewed run', async () => {
      groupStoreMock.activeRunId.set('run-prior');
      groupStoreMock.activeRunMarketDate.set('2026-08-20');

      facade.rejectSymbol('AAPL');
      await flush();

      expect(occurrenceStoreMock.rejectSignals).toHaveBeenCalledWith(
        expect.anything(),
        'run-prior',
        '2026-08-20',
      );
    });
  });

  describe('rejectSymbol', () => {
    it('rejects signals and removes any staged ticket', async () => {
      stagingStoreMock.ticketsBySymbol.set({
        AAPL: [
          { id: 'i1', symbol: 'AAPL', status: OrderTicketStatus.STAGED },
        ],
      });

      facade.rejectSymbol('AAPL');
      await flush();

      expect(occurrenceStoreMock.rejectSignals).toHaveBeenCalled();
      expect(stagingStoreMock.removeTicket).toHaveBeenCalledWith('i1');
    });
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

    it('resets against the viewed run when viewing a prior run', () => {
      groupStoreMock.activeRunId.set('run-prior');
      facade.resetSymbol('AAPL');
      expect(occurrenceStoreMock.resetSymbol).toHaveBeenCalledWith('AAPL', 'run-prior');
    });
  });

  describe('goToSignalOrder', () => {
    it('navigates to /signal-order', async () => {
      await facade.goToSignalOrder();
      expect(routerMock.navigate).toHaveBeenCalledWith(['/signal-order']);
    });
  });
});
