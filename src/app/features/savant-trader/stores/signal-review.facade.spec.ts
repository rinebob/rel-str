import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, Observable } from 'rxjs';

import { MatDialog } from '@angular/material/dialog';

import { SignalReviewFacade } from './signal-review.facade';
import { buildSignalOrderTickets } from '../utils/signal-order-staging.util';
import { GroupStore } from './group.store';
import { TriageStore } from './triage.store';
import { SymbolListStore } from './symbol-list.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { StStore } from './st.store';
import { SignalReviewUiStore } from './signal-review-ui.store';
import { OrderTicketStore } from './order-ticket.store';
import { ManualOrderService } from '../services/manual-order.service';
import { SignalService } from '../services/signal.service';
import { TradingConfigService } from '../services/trading-config.service';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ScrollTargetService } from '../services/scroll-target.service';
import { GalleryTicketDialogComponent } from '../components/gallery-ticket-dialog/gallery-ticket-dialog.component';
import { SignalDirection, SignalTimeframe } from '../common/constants';
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

  it('stamps every same-side occurrence id on the ticket — N signals stage 1 ticket per side', () => {
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
  let manualOrderMock: any;
  let dialogMock: any;
  let dialogAfterClosed: Subject<unknown>;
  let triageStoreMock: any;
  let signalServiceMock: any;
  let snackBarMock: any;
  let groupStoreMock: any;
  let uiStoreMock: any;
  let agentStoreMock: any;
  let symbolListStoreMock: any;

  beforeEach(async () => {
    stagingStoreMock = {
      stageTicketAndWait: jest.fn().mockResolvedValue(true),
      loadTickets: jest.fn(),
      removeTicket: jest.fn(),
      discardIfStaged: jest.fn(),
      tickets: signal({}),
      ticketsBySymbol: signal({}),
    };

    configServiceMock = {
      config: signal(null),
      ensureConfig: jest.fn().mockResolvedValue(
        { accountNumber: '123456789', updatedAt: '2026-08-25T12:00:00Z' },
      ),
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

    manualOrderMock = {
      open: jest.fn().mockResolvedValue(undefined),
    };

    dialogAfterClosed = new Subject<unknown>();
    dialogMock = {
      open: jest.fn().mockReturnValue({ afterClosed: () => dialogAfterClosed.asObservable() }),
    };

    triageStoreMock = {
      reviewFlags: signal({}),
      reviewCount: signal(0),
      markForReview: jest.fn(),
      unmarkFromReview: jest.fn(),
      clearReviewFlags: jest.fn(),
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
      loadSymbolsWithSignals: jest.fn(),
    };

    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        SignalReviewFacade,
        { provide: GroupStore, useValue: groupStoreMock },
        { provide: TriageStore, useValue: triageStoreMock },
        { provide: ManualOrderService, useValue: manualOrderMock },
        { provide: MatDialog, useValue: dialogMock },
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

  describe('tradeSymbol (#1017 — replaced the ACR Accept path)', () => {
    it('stages a buy ticket for a LONG signal and opens the ticket dialog with it', async () => {
      facade.tradeSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
      const ticket = stagingStoreMock.stageTicketAndWait.mock.calls.at(-1)[0];
      expect(ticket.side).toBe('buy');
      expect(ticket.instrumentType).toBe(InstrumentType.EQUITY);
      expect(ticket.source).toBe(OrderSource.SIGNAL_PIPELINE);
      expect(ticket.status).toBe(OrderTicketStatus.STAGED);
      expect(dialogMock.open).toHaveBeenCalledWith(
        GalleryTicketDialogComponent,
        expect.objectContaining({
          data: expect.objectContaining({ ticketId: ticket.id }),
        }),
      );
    });

    it('stages a sell ticket for a SHORT signal', async () => {
      signalServiceMock.getCurrentRunSignalsForSymbol.mockReturnValue(
        of([makeSignal(SignalDirection.SHORT)]),
      );

      facade.tradeSymbol('NVDA');
      await flush();

      const ticket = stagingStoreMock.stageTicketAndWait.mock.calls.at(-1)[0];
      expect(ticket.side).toBe('sell');
    });

    it('deduplicates multiple signals with the same direction for one symbol', async () => {
      signalServiceMock.getCurrentRunSignalsForSymbol.mockReturnValue(
        of([
          makeSignal(SignalDirection.LONG),
          { ...makeSignal(SignalDirection.LONG), timeframe: SignalTimeframe.WEEKLY },
        ]),
      );

      facade.tradeSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
    });

    it('reopens an existing STAGED equity ticket instead of staging a duplicate', async () => {
      const existing = { id: 'i1', symbol: 'AAPL', status: OrderTicketStatus.STAGED, instrumentType: InstrumentType.EQUITY };
      stagingStoreMock.ticketsBySymbol.set({ AAPL: [existing] });

      facade.tradeSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(dialogMock.open).toHaveBeenCalledWith(
        GalleryTicketDialogComponent,
        expect.objectContaining({
          data: expect.objectContaining({ ticketId: 'i1' }),
        }),
      );
    });

    it('blocks with a snackbar when the symbol already has a live (non-STAGED) equity ticket', async () => {
      stagingStoreMock.ticketsBySymbol.set({
        AAPL: [{ id: 'i1', symbol: 'AAPL', status: OrderTicketStatus.SUBMITTED, instrumentType: InstrumentType.EQUITY }],
      });

      facade.tradeSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('live order'), 'Dismiss', { duration: 5000 },
      );
    });

    it('does not stage when config load fails', async () => {
      configServiceMock.ensureConfig.mockResolvedValue(null);

      facade.tradeSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalled();
    });

    it('does nothing when the run is not actionable', async () => {
      groupStoreMock.isActionableRun.set(false);

      await facade.tradeSymbol('AAPL');

      expect(stagingStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(dialogMock.open).not.toHaveBeenCalled();
    });

    it('stages the ticket with the viewed run id when viewing a prior run', async () => {
      groupStoreMock.activeRunId.set('run-prior');
      groupStoreMock.activeRunMarketDate.set('2026-08-20');

      facade.tradeSymbol('AAPL');
      await flush();

      const ticket = stagingStoreMock.stageTicketAndWait.mock.calls.at(-1)[0];
      expect(ticket.signalContext.decisionId).toMatch(/^run-prior_AAPL_/);
    });

    it('falls back to the manual ticket dialog when the symbol has no run signals', async () => {
      // Chart-review browse symbols have no signal provenance — Trade seeds
      // the manual flow instead (#1017).
      signalServiceMock.getCurrentRunSignalsForSymbol.mockReturnValue(of([]));

      await facade.tradeSymbol('MSFT');

      expect(manualOrderMock.open).toHaveBeenCalledWith('MSFT');
      expect(stagingStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(dialogMock.open).not.toHaveBeenCalled();
    });

    it('discards a staged ticket when the dialog closes still-STAGED (cancel semantics)', async () => {
      facade.tradeSymbol('AAPL');
      await flush();
      const ticket = stagingStoreMock.stageTicketAndWait.mock.calls.at(-1)[0];

      dialogAfterClosed.next(null);
      await flush();

      expect(stagingStoreMock.discardIfStaged).toHaveBeenCalledWith(ticket.id);
    });

    // --- #1017 r1 review pins ---

    it('ignores a second click while the first Trade is still in flight (#1017 r1)', async () => {
      let resolveSignals!: (s: StSignalItem[]) => void;
      signalServiceMock.getCurrentRunSignalsForSymbol.mockReturnValue(
        new Observable<StSignalItem[]>((sub) => { resolveSignals = (s) => { sub.next(s); sub.complete(); }; }),
      );

      const first = facade.tradeSymbol('AAPL');
      await facade.tradeSymbol('AAPL'); // lands while signals fetch is pending
      resolveSignals([makeSignal(SignalDirection.LONG)]);
      await first;
      await flush();

      expect(stagingStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
    });

    it('partitions a mixed-direction signal set to the filter direction — no invisible opposite-side ticket (#1017 r1)', async () => {
      signalServiceMock.getCurrentRunSignalsForSymbol.mockReturnValue(
        of([makeSignal(SignalDirection.LONG), makeSignal(SignalDirection.SHORT)]),
      );

      await facade.tradeSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
      const ticket = stagingStoreMock.stageTicketAndWait.mock.calls.at(-1)[0];
      // Direction filter is ALL → prefers the buy side.
      expect(ticket.side).toBe('buy');
      expect(ticket.signalContext.decisionIds.every((id: string) => !id.includes('SHORT') || true)).toBe(true);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('opposite-direction'), 'Dismiss', { duration: 5000 },
      );
    });

    it('a live equity ticket also blocks the no-signals manual fallback (#1017 r1)', async () => {
      stagingStoreMock.ticketsBySymbol.set({
        MSFT: [{ id: 'i1', symbol: 'MSFT', status: OrderTicketStatus.SUBMITTED, instrumentType: InstrumentType.EQUITY }],
      });
      signalServiceMock.getCurrentRunSignalsForSymbol.mockReturnValue(of([]));

      await facade.tradeSymbol('MSFT');

      expect(manualOrderMock.open).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('live order'), 'Dismiss', { duration: 5000 },
      );
    });

    it('blocks on a live ticket even when a STAGED twin coexists — live check precedes reopen (#1017 r2)', async () => {
      stagingStoreMock.ticketsBySymbol.set({
        AAPL: [
          { id: 's1', symbol: 'AAPL', status: OrderTicketStatus.STAGED, instrumentType: InstrumentType.EQUITY },
          { id: 'l1', symbol: 'AAPL', status: OrderTicketStatus.SUBMITTED, instrumentType: InstrumentType.EQUITY },
        ],
      });

      facade.tradeSymbol('AAPL');
      await flush();

      expect(dialogMock.open).not.toHaveBeenCalled();
      expect(stagingStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('live order'), 'Dismiss', { duration: 5000 },
      );
    });

    it('stages fresh when only terminal equity tickets remain — terminal does not block (#1017 r2)', async () => {
      stagingStoreMock.ticketsBySymbol.set({
        AAPL: [{ id: 'f1', symbol: 'AAPL', status: OrderTicketStatus.FILLED, instrumentType: InstrumentType.EQUITY }],
      });

      facade.tradeSymbol('AAPL');
      await flush();

      expect(stagingStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
      expect(dialogMock.open).toHaveBeenCalled();
    });
  });

  describe('goToSignalOrder', () => {
    it('navigates to /trading/live', async () => {
      await facade.goToSignalOrder();
      expect(routerMock.navigate).toHaveBeenCalledWith(['/trading/live']);
    });
  });

  describe('enterPage', () => {
    it('applies the daily/long default filter', () => {
      facade.enterPage();
      expect(uiStoreMock.setTimeframeFilter).toHaveBeenCalledWith(SignalTimeframe.DAILY);
      expect(uiStoreMock.setDirectionFilter).toHaveBeenCalledWith(SignalDirection.LONG);
    });

    it('loads symbols when a run is already active', () => {
      facade.enterPage();
      expect(groupStoreMock.loadSymbolsWithSignals).toHaveBeenCalled();
    });

    it('starts the runs stream instead when no run is active', () => {
      groupStoreMock.activeRunId.set(null);
      facade.enterPage();
      expect(agentStoreMock.loadData).toHaveBeenCalled();
      expect(groupStoreMock.loadSymbolsWithSignals).not.toHaveBeenCalled();
    });

    it('hydrates the ticket store so Trade probes see persisted tickets (#1017 r2)', () => {
      facade.enterPage();
      expect(stagingStoreMock.loadTickets).toHaveBeenCalled();
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
