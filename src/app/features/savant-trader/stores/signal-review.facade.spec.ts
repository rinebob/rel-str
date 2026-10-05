import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { SignalReviewFacade } from './signal-review.facade';
import { buildSignalOrderTickets } from '../utils/signal-order-staging.util';
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

  it('stamps every same-side decision id on the ticket — one accept writes N decisions but stages 1 ticket per side (#719)', () => {
    const signals = [
      makeSignal(SignalDirection.LONG), // daily
      { ...makeSignal(SignalDirection.LONG), timeframe: SignalTimeframe.WEEKLY },
      makeSignal(SignalDirection.SHORT),
    ] as StSignalItem[];

    const tickets = buildSignalOrderTickets('AAPL', signals, {
      runId: 'run-1',
      accountNumber: 'agentic-account',
      defaultDollarAmount: 100,
      now: new Date('2026-08-26T12:00:00Z'),
      buildId: (_symbol, side) => `AAPL-${side}`,
      buildRefId: () => 'uuid',
    });

    const buy = tickets.find((t) => t.side === 'buy')!;
    const sell = tickets.find((t) => t.side === 'sell')!;
    expect(buy.signalContext?.decisionIds).toEqual([
      'run-1_AAPL_D_DAILY_BREAKOUT',
      'run-1_AAPL_W_DAILY_BREAKOUT',
    ]);
    expect(sell.signalContext?.decisionIds).toEqual(['run-1_AAPL_D_DAILY_BREAKOUT']);
    // Primary decisionId remains the first same-side signal's id.
    expect(buy.signalContext?.decisionId).toBe('run-1_AAPL_D_DAILY_BREAKOUT');
  });

  it('captures the signal closePrice into signalContext.signalPrice (anchor for % change since signal)', () => {
    const tickets = buildSignalOrderTickets(
      'AAPL',
      [{ ...makeSignal(SignalDirection.LONG), closePrice: 187.5 }],
      {
        runId: 'run-1',
        accountNumber: 'agentic-account',
        defaultDollarAmount: 100,
        now: new Date('2026-08-26T12:00:00Z'),
        buildId: (_s, side) => `AAPL-${side}`,
        buildRefId: () => '550e8400-e29b-41d4-a716-446655440000',
      },
    );

    expect(tickets[0].signalContext?.signalPrice).toBe(187.5);
  });

  it('omits signalPrice when the signal has no closePrice', () => {
    const tickets = buildSignalOrderTickets('AAPL', [makeSignal(SignalDirection.LONG)], {
      runId: 'run-1',
      accountNumber: 'agentic-account',
      defaultDollarAmount: 100,
      now: new Date('2026-08-26T12:00:00Z'),
      buildId: (_s, side) => `AAPL-${side}`,
      buildRefId: () => '550e8400-e29b-41d4-a716-446655440000',
    });

    expect('signalPrice' in (tickets[0].signalContext ?? {})).toBe(false);
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
  let uiStoreMock: any;
  let agentStoreMock: any;
  let symbolListStoreMock: any;

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
      loading: signal(false),
      loadRecentDecisions: jest.fn(),
    };

    triageStoreMock = {
      setScreeningStatus: jest.fn(),
    };

    uiStoreMock = {
      signalFilter: signal({ timeframe: SignalTimeframe.ALL, direction: SignalDirection.ALL }),
      expandedGroups: signal<Record<string, boolean>>({}),
      setTimeframeFilter: jest.fn(),
      setDirectionFilter: jest.fn(),
    };

    agentStoreMock = {
      latestCompletedRun: signal(null),
      runsReceived: signal(false),
      loadData: jest.fn(),
    };

    symbolListStoreMock = {
      symbolListsLoading: signal(false),
    };

    signalServiceMock = {
      getCurrentRunSignalsForSymbol: jest.fn().mockReturnValue(
        of([makeSignal(SignalDirection.LONG)]),
      ),
    };

    groupStoreMock = {
      isActionableRun: signal(true),
      activeRunId: signal<string | null>('run-daily'),
      activeRunMarketDate: signal('2026-08-25'),
      latestCompletedRun: signal(null),
      symbolsLoading: signal(false),
      groups: signal<any[]>([]),
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
        { provide: SymbolListStore, useValue: symbolListStoreMock },
        { provide: SymbolHistoryStore, useValue: { signalHistoryCache: signal({}) } },
        { provide: StStore, useValue: agentStoreMock },
        { provide: SignalReviewUiStore, useValue: uiStoreMock },
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
      // Canonical decision-doc id format: runId_SYMBOL_tf_type (underscores) —
      // the queue's removal path deletes decisions by this exact id (#719).
      expect(ticket.signalContext.decisionId).toMatch(/^run-prior_AAPL_/);
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
    it('navigates to /trading/live', async () => {
      await facade.goToSignalOrder();
      expect(routerMock.navigate).toHaveBeenCalledWith(['/trading/live']);
    });
  });

  describe('enterPage', () => {
    it('enters fullscreen and applies the daily/long default filter', () => {
      facade.enterPage();
      expect(uiStoreMock.setTimeframeFilter).toHaveBeenCalledWith(SignalTimeframe.DAILY);
      expect(uiStoreMock.setDirectionFilter).toHaveBeenCalledWith(SignalDirection.LONG);
    });

    it('loads symbols and decisions when a run is already active', () => {
      facade.enterPage();
      expect(groupStoreMock.loadSymbolsWithSignals).toHaveBeenCalled();
      expect(occurrenceStoreMock.loadRecentDecisions).toHaveBeenCalled();
    });

    it('starts the runs stream instead when no run is active', () => {
      groupStoreMock.activeRunId.set(null);
      facade.enterPage();
      expect(agentStoreMock.loadData).toHaveBeenCalled();
      expect(groupStoreMock.loadSymbolsWithSignals).not.toHaveBeenCalled();
    });
  });

  describe('pageInitializing', () => {
    it('is true while no run is active and the runs stream has not emitted', () => {
      groupStoreMock.activeRunId.set(null);
      agentStoreMock.runsReceived.set(false);
      expect(facade.pageInitializing()).toBe(true);
    });

    it('is true while symbols are loading', () => {
      agentStoreMock.runsReceived.set(true);
      groupStoreMock.symbolsLoading.set(true);
      expect(facade.pageInitializing()).toBe(true);
    });

    it('is true while the first list-catalog emission is pending', () => {
      agentStoreMock.runsReceived.set(true);
      symbolListStoreMock.symbolListsLoading.set(true);
      expect(facade.pageInitializing()).toBe(true);
    });

    it('is false once run, symbols, and lists have settled', () => {
      agentStoreMock.runsReceived.set(true);
      expect(facade.pageInitializing()).toBe(false);
    });
  });

  describe('filteredSignalCount', () => {
    it('sums filtered signal counts, counting not-yet-loaded rows as 1', () => {
      groupStoreMock.groups.set([
        {
          key: 'tech', label: 'Technology', longCount: 2, shortCount: 0,
          rows: [
            { profile: { symbol: 'AAA' }, signals: [makeSignal(), makeSignal()] },
            { profile: { symbol: 'BBB' } }, // history not loaded — counts as 1
          ],
        },
      ]);
      expect(facade.filteredSignalCount()).toBe(3);
    });

    it('returns 0 when no groups are visible', () => {
      expect(facade.filteredSignalCount()).toBe(0);
    });
  });
});
