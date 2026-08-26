import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, throwError } from 'rxjs';

import { SignalReviewFacade } from './signal-review.facade';
import { GroupStore } from './group.store';
import { TriageStore } from './triage.store';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { StStore } from './st.store';
import { SignalReviewUiStore } from './signal-review-ui.store';
import { OrderStagingStore } from './order-staging.store';
import { SignalService } from '../services/signal.service';
import { TradingConfigService } from '../services/trading-config.service';
import { UiStateService } from '../../../core/services/ui-state.service';
import { ScrollTargetService } from '../services/scroll-target.service';
import { SignalDirection, SignalTimeframe } from '../common/constants';
import { OrderIntentStatus, OrderSource, InstrumentType } from '../services/order-intent.types';
import { StOccurrenceDecision } from '../services/types';

function makeDecision(
  symbol: string,
  direction: SignalDirection,
  id: string = `dec-${symbol}`,
): StOccurrenceDecision {
  return {
    id,
    runId: 'run-daily',
    marketDate: '2026-08-25',
    symbol,
    timeframe: SignalTimeframe.DAILY,
    direction,
    signalType: 'DAILY_BREAKOUT',
    barDate: '2026-08-25',
    decisionType: 'ACCEPT' as any,
    decidedAt: '2026-08-25T12:00:00Z',
    isCurrentInLatestRun: true,
    indicators: {},
  };
}

describe('SignalReviewFacade.stageAcceptedIntents', () => {
  let facade: SignalReviewFacade;
  let stagingStoreMock: any;
  let configServiceMock: any;
  let routerMock: any;
  let occurrenceStoreMock: any;
  let snackBarMock: any;

  beforeEach(async () => {
    stagingStoreMock = {
      stageIntent: jasmine.createSpy('stageIntent'),
      intents: signal({}),
      loading: signal(false),
      error: signal(null),
      loadIntents: jasmine.createSpy('loadIntents'),
      removeIntent: jasmine.createSpy('removeIntent'),
      updateIntent: jasmine.createSpy('updateIntent'),
      submitIntent: jasmine.createSpy('submitIntent'),
      retryIntent: jasmine.createSpy('retryIntent'),
      cancelIntent: jasmine.createSpy('cancelIntent'),
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
      acceptedCount: signal(2),
      activeOrderDecisions: signal<StOccurrenceDecision[]>([]),
      acceptedSymbols: signal<string[]>([]),
      activeOrderSymbols: signal<string[]>([]),
      statusForSymbol: jasmine.createSpy('statusForSymbol'),
      acceptSignals: jasmine.createSpy('acceptSignals'),
      rejectSignals: jasmine.createSpy('rejectSignals'),
      resetSignals: jasmine.createSpy('resetSignals'),
      durableStatusCounts: signal({ ACCEPT: 0, REJECT: 0, WATCH: 0, PENDING: 0 }),
    };

    await TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        SignalReviewFacade,
        { provide: GroupStore, useValue: { viewedRun: signal(null), activeRun: signal(null), setDimension: jasmine.createSpy(), setListFilter: jasmine.createSpy() } },
        { provide: TriageStore, useValue: {} },
        { provide: OccurrenceDecisionStore, useValue: occurrenceStoreMock },
        { provide: SymbolListStore, useValue: {} },
        { provide: SymbolHistoryStore, useValue: {} },
        { provide: StStore, useValue: {} },
        { provide: SignalReviewUiStore, useValue: { allExpanded: signal(false), toggleExpandAll: jasmine.createSpy(), quickChartSymbol: signal(null) } },
        { provide: OrderStagingStore, useValue: stagingStoreMock },
        { provide: SignalService, useValue: {} },
        { provide: TradingConfigService, useValue: configServiceMock },
        { provide: UiStateService, useValue: { setFullscreen: jasmine.createSpy(), fullscreen: signal(false) } },
        { provide: ScrollTargetService, useValue: {} },
        { provide: Router, useValue: routerMock },
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    });

    facade = TestBed.inject(SignalReviewFacade);
  });

  it('does nothing when no accepted decisions', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([]);
    await facade.stageAcceptedIntents();
    expect(configServiceMock.loadConfig).not.toHaveBeenCalled();
    expect(stagingStoreMock.stageIntent).not.toHaveBeenCalled();
  });

  it('stages one EquityOrderIntent per accepted decision', async () => {
    const decisions = [
      makeDecision('AAPL', SignalDirection.LONG),
      makeDecision('NVDA', SignalDirection.SHORT),
    ];
    occurrenceStoreMock.activeOrderDecisions.set(decisions);

    await facade.stageAcceptedIntents();

    expect(stagingStoreMock.stageIntent).toHaveBeenCalledTimes(2);
  });

  it('sets side to buy for LONG direction', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.side).toBe('buy');
  });

  it('sets side to sell for SHORT direction', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('NVDA', SignalDirection.SHORT),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.side).toBe('sell');
  });

  it('sets source to SIGNAL_PIPELINE', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.source).toBe(OrderSource.SIGNAL_PIPELINE);
  });

  it('sets status to STAGED', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.status).toBe(OrderIntentStatus.STAGED);
  });

  it('sets instrumentType to EQUITY', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.instrumentType).toBe(InstrumentType.EQUITY);
  });

  it('sets accountNumber from trading config', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.accountNumber).toBe('123456789');
  });

  it('sets accountNumber to empty string when no config', async () => {
    configServiceMock.loadConfig.and.returnValue(of(null));
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.accountNumber).toBe('');
  });

  it('populates signalContext with decision data', async () => {
    const decision = makeDecision('AAPL', SignalDirection.LONG, 'dec-123');
    occurrenceStoreMock.activeOrderDecisions.set([decision]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.signalContext).toEqual({
      signalType: 'DAILY_BREAKOUT',
      barDate: '2026-08-25',
      timeframe: SignalTimeframe.DAILY,
      direction: SignalDirection.LONG,
      decisionId: 'dec-123',
    });
  });

  it('attaches decision id via sourceRef', async () => {
    const decision = makeDecision('AAPL', SignalDirection.LONG, 'dec-abc');
    occurrenceStoreMock.activeOrderDecisions.set([decision]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.sourceRef).toEqual({
      type: 'occurrence_decision',
      id: 'dec-abc',
    });
  });

  it('navigates to /signal-order after staging', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    expect(routerMock.navigate).toHaveBeenCalledWith(['/signal-order']);
  });

  it('generates human-readable id with SYMBOL-SIDE-YYMMDD-DOW-HHMMPT format', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    // Format: AAPL-BUY-YYMMDD-DOW-HHMMPT
    expect(intent.id).toMatch(/^AAPL-BUY-\d{6}-[A-Z]{3}-\d{4}PT$/);
    expect(intent.refId).toBe(intent.id);
  });

  it('uses uppercase symbol in id', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('aapl', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.id.startsWith('AAPL-')).toBe(true);
  });

  it('sets default order parameters (market, gfd, regular_hours)', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.orderType).toBe('market');
    expect(intent.timeInForce).toBe('gfd');
    expect(intent.marketHours).toBe('regular_hours');
  });

  it('does not stage or navigate when loadConfig errors', async () => {
    configServiceMock.loadConfig.and.returnValue(throwError(() => new Error('Auth failed')));
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG),
    ]);

    await facade.stageAcceptedIntents();

    expect(stagingStoreMock.stageIntent).not.toHaveBeenCalled();
    expect(routerMock.navigate).not.toHaveBeenCalled();
    expect(snackBarMock.open).toHaveBeenCalled();
  });

  it('deduplicates by symbol+side — only first of same symbol+side is staged', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG, 'dec-1'),
      makeDecision('AAPL', SignalDirection.LONG, 'dec-2'), // same symbol+side, different decision
    ]);

    await facade.stageAcceptedIntents();

    expect(stagingStoreMock.stageIntent).toHaveBeenCalledTimes(1);
    const intent = stagingStoreMock.stageIntent.calls.mostRecent().args[0];
    expect(intent.sourceRef.id).toBe('dec-1');
  });

  it('stages both when same symbol but different sides', async () => {
    occurrenceStoreMock.activeOrderDecisions.set([
      makeDecision('AAPL', SignalDirection.LONG, 'dec-1'),
      makeDecision('AAPL', SignalDirection.SHORT, 'dec-2'),
    ]);

    await facade.stageAcceptedIntents();

    expect(stagingStoreMock.stageIntent).toHaveBeenCalledTimes(2);
  });
});

function signal<T>(initial: T) {
  let value = initial;
  const s: any = () => value;
  s.set = (v: T) => { value = v; };
  s.update = (fn: (v: T) => T) => { value = fn(value); };
  return s;
}
