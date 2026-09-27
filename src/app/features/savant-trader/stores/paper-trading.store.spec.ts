/**
 * Unit tests for PaperTradingStore — state transitions, filtered
 * selectors, loading/error states. Service calls are mocked via TestBed.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));

import { TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of, Subject, throwError } from 'rxjs';

import { PaperTradingStore } from './paper-trading.store';
import { PaperTradingService } from '../services/paper-trading.service';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
} from '@paper-trading/contracts';
import type {
  PaperAccount,
  PaperStats,
  PaperTrade,
} from '@paper-trading/contracts';
import { TradeSide } from '@common';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = '2026-09-26T12:00:00.000Z';

function makeTrade(overrides: Partial<PaperTrade> = {}): PaperTrade {
  return {
    kind: PaperTradingKind.TRADE,
    id: 't-1',
    status: PaperTradeStatus.OPEN,
    source: PaperTradeSource.STRATEGY,
    symbol: 'QQQM',
    expression: 'CSP',
    governingVariant: 'trailing-20',
    order: { side: TradeSide.SHORT, type: 'LIMIT', quantity: 1 },
    fills: [],
    legs: [],
    marks: {},
    variantRuns: [],
    variantKeys: ['trailing-20'],
    realizedPnl: 0,
    unrealizedPnl: -25,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

const SIGNAL_TRADE = makeTrade({
  id: 't-2',
  source: PaperTradeSource.SIGNAL,
  expression: 'LC',
  cohortId: 'cohort-9',
  signalId: 'sig-9',
  symbol: 'AAPL',
  variantKeys: ['trailing-20', 'time-9d'],
});
const CLOSED_TRADE = makeTrade({
  id: 't-3',
  status: PaperTradeStatus.CLOSED,
  realizedPnl: 150,
  unrealizedPnl: 0,
  strategyInstanceId: 'inst-1',
});
const PENDING_TRADE = makeTrade({
  id: 't-4',
  status: PaperTradeStatus.PENDING,
  cohortId: 'cohort-9',
});

const SIGNAL_REQ = {
  signalId: 'sig-9',
  symbol: 'AAPL',
  direction: TradeSide.SHORT,
  refId: 'r-1',
};

const ACCOUNT: PaperAccount = {
  kind: PaperTradingKind.ACCOUNT,
  id: 'acct-u1',
  userId: 'u1',
  cash: 99_500,
  equity: 99_500,
  realizedPnl: 150,
  openTradeCount: 2,
  createdAt: NOW,
  updatedAt: NOW,
};

function makeStats(scope: string): PaperStats {
  return {
    kind: PaperTradingKind.STATS,
    id: `stats-${scope}`,
    scope,
    openTradeCount: 1,
    closedTradeCount: 0,
    totalPremiumCollected: 100,
    totalRealizedPnl: 0,
    totalUnrealizedPnl: -25,
    assignedCount: 0,
    expiredWorthlessCount: 0,
    equityCurve: [{ date: '2026-09-26', cumulativePnl: -25 }],
    maxDrawdown: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

// ── Test setup ───────────────────────────────────────────────────────────────

describe('PaperTradingStore', () => {
  let store: InstanceType<typeof PaperTradingStore>;
  let mockService: {
    listPaperTrades$: jest.Mock;
    getPaperStats$: jest.Mock;
    getPaperAccount$: jest.Mock;
    listExitVariants$: jest.Mock;
    paperSignalOrder$: jest.Mock;
  };

  beforeEach(() => {
    mockService = {
      listPaperTrades$: jest.fn().mockReturnValue(of({ trades: [] })),
      getPaperStats$: jest.fn().mockReturnValue(of({ stats: [] })),
      getPaperAccount$: jest.fn().mockReturnValue(of({ account: ACCOUNT })),
      listExitVariants$: jest.fn().mockReturnValue(of({ variants: [] })),
      paperSignalOrder$: jest.fn().mockReturnValue(
        of({ cohortId: 'cohort-9', equityTradeId: 'eq-1', expressionTradeIds: ['t-2', 't-4'] }),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        provideNoopAnimations(),
        { provide: PaperTradingService, useValue: mockService },
      ],
    });
    store = TestBed.inject(PaperTradingStore);
  });

  // ── trades ──────────────────────────────────────────────────────────────

  it('loadTrades fetches with the active filter request', async () => {
    mockService.listPaperTrades$.mockReturnValue(of({ trades: [makeTrade(), SIGNAL_TRADE] }));
    store.loadTrades({ cohortId: 'cohort-9', expression: 'CSP' });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mockService.listPaperTrades$).toHaveBeenCalledWith({ cohortId: 'cohort-9', expression: 'CSP' });
    expect(store.trades().length).toBe(2);
    expect(store.isLoadingTrades()).toBe(false);
    expect(store.tradeFilters()).toEqual({ cohortId: 'cohort-9', expression: 'CSP' });
  });

  it('setTradeFilters replaces the request and refetches', async () => {
    store.setTradeFilters({ symbol: 'AAPL' });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mockService.listPaperTrades$).toHaveBeenCalledWith({ symbol: 'AAPL' });
  });

  it('open/closed/pending selectors split by status', async () => {
    mockService.listPaperTrades$.mockReturnValue(
      of({ trades: [makeTrade(), SIGNAL_TRADE, CLOSED_TRADE, PENDING_TRADE] }),
    );
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.openTrades().map((t) => t.id)).toEqual(['t-1', 't-2']);
    expect(store.closedTrades().map((t) => t.id)).toEqual(['t-3']);
    expect(store.pendingTrades().map((t) => t.id)).toEqual(['t-4']);
  });

  it('group-by selectors partition by variant, symbol, and expression', async () => {
    mockService.listPaperTrades$.mockReturnValue(
      of({ trades: [makeTrade(), SIGNAL_TRADE, CLOSED_TRADE] }),
    );
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(store.tradesBySymbol().get('AAPL')?.map((t) => t.id)).toEqual(['t-2']);
    expect(store.tradesBySymbol().get('QQQM')?.length).toBe(2);
    expect(store.tradesByVariant().get('time-9d')?.map((t) => t.id)).toEqual(['t-2']);
    expect(store.tradesByVariant().get('trailing-20')?.length).toBe(3);
    expect(store.tradesByExpression().get('LC')?.map((t) => t.id)).toEqual(['t-2']);
    expect(store.tradesBySource().get('signal')?.map((t) => t.id)).toEqual(['t-2']);
    expect(store.tradesByCohort().get('cohort-9')?.map((t) => t.id)).toEqual(['t-2']);
    expect(store.tradesByInstance().get('inst-1')?.map((t) => t.id)).toEqual(['t-3']);
    expect(store.availableCohorts()).toEqual(['cohort-9']);
    expect(store.availableInstances()).toEqual(['inst-1']);
    expect(store.availableVariantKeys()).toEqual(['time-9d', 'trailing-20']);
  });

  // ── stats / account / variants ──────────────────────────────────────────

  it('loadStats indexes docs by scope; omitted scope enumerates all', async () => {
    mockService.getPaperStats$.mockReturnValue(of({ stats: [makeStats('all'), makeStats('sym-QQQM')] }));
    store.loadStats();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mockService.getPaperStats$).toHaveBeenCalledWith({});
    expect(store.allScopeStats()?.scope).toBe('all');
    expect(store.statsByScope()['sym-QQQM'].openTradeCount).toBe(1);
    expect(store.statsList().map((s) => s.scope)).toEqual(['all', 'sym-QQQM']);
  });

  it('loadStats with a scope forwards it', async () => {
    mockService.getPaperStats$.mockReturnValue(of({ stats: [makeStats('sym-QQQM')] }));
    store.loadStats('sym-QQQM');
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mockService.getPaperStats$).toHaveBeenCalledWith({ scope: 'sym-QQQM' });
  });

  it('loadAccount stores the account; missing account → null', async () => {
    store.loadAccount();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.account()?.cash).toBe(99_500);

    mockService.getPaperAccount$.mockReturnValue(of({ account: null }));
    store.loadAccount();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.account()).toBeNull();
  });

  it('loadExitVariants stores the registry list', async () => {
    mockService.listExitVariants$.mockReturnValue(of({
      variants: [{ key: 'trailing-20', label: 'Trailing 20%', params: { type: 'trailing-stop', pct: 20 } }],
    }));
    store.loadExitVariants();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.exitVariants().map((v) => v.key)).toEqual(['trailing-20']);
  });

  // ── paper order ─────────────────────────────────────────────────────────

  it('acceptAsPaper resolves the response and surfaces the cohort', async () => {
    const snackBar = TestBed.inject(MatSnackBar);
    const snackSpy = jest.spyOn(snackBar, 'open');
    const res = await store.acceptAsPaper(SIGNAL_REQ);
    expect(res?.cohortId).toBe('cohort-9');
    expect(res?.expressionTradeIds).toEqual(['t-2', 't-4']);
    expect(mockService.paperSignalOrder$).toHaveBeenCalledWith(SIGNAL_REQ);
    expect(snackSpy).toHaveBeenCalledWith(expect.stringContaining('cohort-9'), 'Dismiss', expect.anything());
    expect(store.isSubmittingOrder()).toBe(false);
  });

  // ── errors ──────────────────────────────────────────────────────────────

  it('unauthenticated errors surface the auth message', async () => {
    const snackBar = TestBed.inject(MatSnackBar);
    const snackSpy = jest.spyOn(snackBar, 'open');
    mockService.listPaperTrades$.mockReturnValue(
      throwError(() => Object.assign(new Error('nope'), { code: 'unauthenticated' })),
    );
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.error()).toBe('Authentication required to view paper trading data');
    expect(store.isLoadingTrades()).toBe(false);
    expect(snackSpy).toHaveBeenCalled();
    expect(store.trades()).toEqual([]);
  });

  it('generic errors use the fallback message; acceptAsPaper resolves null', async () => {
    mockService.getPaperStats$.mockReturnValue(throwError(() => new Error('boom')));
    store.loadStats();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.error()).toBe('Failed to load paper stats');
    expect(store.isLoadingStats()).toBe(false);

    mockService.paperSignalOrder$.mockReturnValue(throwError(() => new Error('boom')));
    const res = await store.acceptAsPaper(SIGNAL_REQ);
    expect(res).toBeNull();
  });

  it('error clears on the next successful load', async () => {
    mockService.listPaperTrades$.mockReturnValueOnce(throwError(() => new Error('boom')));
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.error()).toBe('Failed to load paper trades');

    mockService.listPaperTrades$.mockReturnValue(of({ trades: [makeTrade()] }));
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.error()).toBeNull();
    expect(store.trades().length).toBe(1);
  });

  it('enumerating stats replaces the map — deleted scopes drop out', async () => {
    mockService.getPaperStats$.mockReturnValue(of({ stats: [makeStats('all'), makeStats('sym-QQQM')] }));
    store.loadStats();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.statsList().length).toBe(2);

    // Scoped fetch merges — existing scopes survive.
    mockService.getPaperStats$.mockReturnValue(of({ stats: [makeStats('inst-1')] }));
    store.loadStats('inst-1');
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.statsList().map((s) => s.scope)).toEqual(['all', 'inst-1', 'sym-QQQM']);

    // Enumerate-all now returns fewer docs — sym-QQQM drops out.
    mockService.getPaperStats$.mockReturnValue(of({ stats: [makeStats('all'), makeStats('inst-1')] }));
    store.loadStats();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.statsList().map((s) => s.scope)).toEqual(['all', 'inst-1']);
  });

  it('a failed enumerate-all does NOT wipe cached stats docs', async () => {
    mockService.getPaperStats$.mockReturnValue(of({ stats: [makeStats('all'), makeStats('sym-QQQM')] }));
    store.loadStats();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.statsList().length).toBe(2);

    mockService.getPaperStats$.mockReturnValue(throwError(() => new Error('boom')));
    store.loadStats();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.error()).toBe('Failed to load paper stats');
    expect(store.statsList().length).toBe(2); // map preserved
  });

  it('loadTrades cancels an in-flight request', () => {
    const pending = new Subject<{ trades: PaperTrade[] }>();
    mockService.listPaperTrades$.mockReturnValueOnce(pending.asObservable());
    store.loadTrades({ symbol: 'AAPL' });
    expect(pending.observed).toBe(true); // store is subscribed
    // second call unsubscribes the first
    mockService.listPaperTrades$.mockReturnValue(of({ trades: [] }));
    store.loadTrades({ symbol: 'QQQM' });
    expect(pending.observed).toBe(false); // first sub was dropped
    expect(mockService.listPaperTrades$).toHaveBeenLastCalledWith({ symbol: 'QQQM' });
  });

  it('ungrouped fields bucket under "none"', async () => {
    mockService.listPaperTrades$.mockReturnValue(
      of({ trades: [makeTrade({ cohortId: undefined, strategyInstanceId: undefined, expression: undefined })] }),
    );
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.tradesByCohort().get('none')?.map((t) => t.id)).toEqual(['t-1']);
    expect(store.tradesByInstance().get('none')?.map((t) => t.id)).toEqual(['t-1']);
    expect(store.tradesByExpression().get('none')?.map((t) => t.id)).toEqual(['t-1']);
  });

  it('loadExitVariants error patches error state', async () => {
    mockService.listExitVariants$.mockReturnValue(throwError(() => new Error('boom')));
    store.loadExitVariants();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.error()).toBe('Failed to load exit variants');
    expect(store.exitVariants()).toEqual([]);
  });

  it('isEmpty and isLoading compose correctly', async () => {
    expect(store.isEmpty()).toBe(true);
    mockService.listPaperTrades$.mockReturnValue(of({ trades: [makeTrade()] }));
    mockService.getPaperAccount$.mockReturnValue(of({ account: ACCOUNT }));
    store.loadAll();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.isLoading()).toBe(false);
    expect(store.isEmpty()).toBe(false);
  });
});
