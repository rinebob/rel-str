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

// ── Test setup ───────────────────────────────────────────────────────────────

describe('PaperTradingStore', () => {
  let store: InstanceType<typeof PaperTradingStore>;
  let mockService: {
    listPaperTrades$: jest.Mock;
    getPaperAccount$: jest.Mock;
    listExitVariants$: jest.Mock;
    closePaperTrade$: jest.Mock;
    cancelPaperTrade$: jest.Mock;
  };

  beforeEach(() => {
    mockService = {
      listPaperTrades$: jest.fn().mockReturnValue(of({ trades: [] })),
      getPaperAccount$: jest.fn().mockReturnValue(of({ account: ACCOUNT })),
      listExitVariants$: jest.fn().mockReturnValue(of({ variants: [] })),
      closePaperTrade$: jest.fn(),
      cancelPaperTrade$: jest.fn(),
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
    expect(mockService.listPaperTrades$).toHaveBeenCalledWith({ cohortId: 'cohort-9', expression: 'CSP', includeAutoPaper: true });
    expect(store.trades().length).toBe(2);
    expect(store.isLoadingTrades()).toBe(false);
    expect(store.tradeFilters()).toEqual({ cohortId: 'cohort-9', expression: 'CSP' });
  });

  it('setTradeFilters replaces the request and refetches', async () => {
    store.setTradeFilters({ symbol: 'AAPL' });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mockService.listPaperTrades$).toHaveBeenCalledWith({ symbol: 'AAPL', includeAutoPaper: true });
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

  // ── account / variants ────────────────────────────────────────────────────

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

  it('generic errors use the fallback message', async () => {
    mockService.getPaperAccount$.mockReturnValue(throwError(() => new Error('boom')));
    store.loadAccount();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.error()).toBe('Failed to load paper account');
    expect(store.isLoadingAccount()).toBe(false);
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

  it('loadTrades cancels an in-flight request', () => {
    const pending = new Subject<{ trades: PaperTrade[] }>();
    mockService.listPaperTrades$.mockReturnValueOnce(pending.asObservable());
    store.loadTrades({ symbol: 'AAPL' });
    expect(pending.observed).toBe(true); // store is subscribed
    // second call unsubscribes the first
    mockService.listPaperTrades$.mockReturnValue(of({ trades: [] }));
    store.loadTrades({ symbol: 'QQQM' });
    expect(pending.observed).toBe(false); // first sub was dropped
    expect(mockService.listPaperTrades$).toHaveBeenLastCalledWith({ symbol: 'QQQM', includeAutoPaper: true });
  });

  it('auto-paper stamp dims group stamped trades; unstamped bucket under "—"', async () => {
    const stamped = makeTrade({
      id: 't-auto',
      signalType: 'D_ST_TREND_RIDER_V1_LONG',
      signalStatus: 'CONFIRMED',
      sector: 'TECHNOLOGY',
      industry: 'Software - Application',
      marketCapTier: 'mega',
    });
    // Partially stamped: signalType but no sector/industry/etc.
    const partial = makeTrade({ id: 't-partial', signalType: 'D_ST_TREND_RIDER_V2_SHORT' });
    mockService.listPaperTrades$.mockReturnValue(of({ trades: [stamped, partial, makeTrade()] }));
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(store.tradesBySignalType().get('D_ST_TREND_RIDER_V1_LONG')?.map((t) => t.id)).toEqual(['t-auto']);
    expect(store.tradesBySignalType().get('D_ST_TREND_RIDER_V2_SHORT')?.map((t) => t.id)).toEqual(['t-partial']);
    expect(store.tradesBySignalType().get('—')?.map((t) => t.id)).toEqual(['t-1']);
    expect(store.tradesBySector().get('TECHNOLOGY')?.map((t) => t.id)).toEqual(['t-auto']);
    expect(store.tradesBySector().get('—')?.map((t) => t.id)).toEqual(['t-partial', 't-1']);
    expect(store.tradesByIndustry().get('Software - Application')?.map((t) => t.id)).toEqual(['t-auto']);
    expect(store.tradesByCapTier().get('mega')?.map((t) => t.id)).toEqual(['t-auto']);
    expect(store.tradesBySignalStatus().get('CONFIRMED')?.map((t) => t.id)).toEqual(['t-auto']);
    expect(store.tradesBySignalStatus().get('—')?.map((t) => t.id)).toEqual(['t-partial', 't-1']);
  });

  it('direction groups signal trades by order.side; non-signal trades bucket under "—"', async () => {
    // Direction only has meaning for signal-stamped trades — unstamped
    // (manual) trades bucket under '—' rather than by order side.
    const signalShort = makeTrade({
      id: 't-sig-short',
      signalType: 'D_ST_TREND_RIDER_V2_SHORT',
    });
    const signalLong = makeTrade({
      id: 't-sig-long',
      signalType: 'D_ST_TREND_RIDER_V1_LONG',
      order: { side: TradeSide.LONG, type: 'MARKET', quantity: 1 },
    });
    mockService.listPaperTrades$.mockReturnValue(
      of({ trades: [makeTrade(), signalShort, signalLong] }),
    );
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.tradesByDirection().get('short')?.map((t) => t.id)).toEqual(['t-sig-short']);
    expect(store.tradesByDirection().get('long')?.map((t) => t.id)).toEqual(['t-sig-long']);
    expect(store.tradesByDirection().get('—')?.map((t) => t.id)).toEqual(['t-1']);
  });

  it('loadTrades always includes auto-paper trades alongside active filters', async () => {
    mockService.listPaperTrades$.mockReturnValue(of({ trades: [] }));
    store.loadTrades();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mockService.listPaperTrades$).toHaveBeenCalledWith({ includeAutoPaper: true });

    store.loadTrades({ symbol: 'AAPL' });
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mockService.listPaperTrades$).toHaveBeenLastCalledWith({
      includeAutoPaper: true,
      symbol: 'AAPL',
    });
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

  // ── close / cancel actions (#670) ─────────────────────────────────────

  describe('close/cancel actions', () => {
    it('closeTrade invokes the service with the tradeId and reloads on success', async () => {
      mockService.closePaperTrade$.mockReturnValue(
        of({ tradeId: 't-1', exitPrice: 10, realizedPnl: 5, closedAt: NOW }),
      );
      store.closeTrade('t-1');
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockService.closePaperTrade$).toHaveBeenCalledWith('t-1');
      expect(mockService.listPaperTrades$).toHaveBeenCalled(); // refresh
      expect(mockService.getPaperAccount$).toHaveBeenCalled();
      expect(store.actingIds().has('t-1')).toBe(false);
      expect(store.error()).toBeNull();
    });

    it('marks the trade in-flight while the close is pending', async () => {
      const pending = new Subject<unknown>();
      mockService.closePaperTrade$.mockReturnValue(pending.asObservable());
      store.closeTrade('t-1');
      expect(store.actingIds().has('t-1')).toBe(true);

      pending.next({});
      pending.complete();
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(store.actingIds().has('t-1')).toBe(false);
    });

    it('ignores a second close on the same in-flight trade', async () => {
      const pending = new Subject<unknown>();
      mockService.closePaperTrade$.mockReturnValue(pending.asObservable());
      store.closeTrade('t-1');
      store.closeTrade('t-1');
      expect(mockService.closePaperTrade$).toHaveBeenCalledTimes(1);

      pending.next({});
      pending.complete();
      await new Promise<void>((r) => setTimeout(r, 0));
      // after the flag clears the action is accepted again
      mockService.closePaperTrade$.mockReturnValue(of({ tradeId: 't-1' }));
      store.closeTrade('t-1');
      expect(mockService.closePaperTrade$).toHaveBeenCalledTimes(2);
    });

    it('close failure surfaces the callable message; flag clears; no reload; row unchanged', async () => {
      const snackBar = TestBed.inject(MatSnackBar);
      const snackSpy = jest.spyOn(snackBar, 'open');
      store.loadTrades();
      await new Promise<void>((r) => setTimeout(r, 0));
      const before = store.trades();

      mockService.closePaperTrade$.mockReturnValue(
        throwError(() => new Error('closePaperTrade failed: quote unavailable')),
      );
      store.closeTrade('t-1');
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(store.error()).toBe('closePaperTrade failed: quote unavailable');
      expect(snackSpy).toHaveBeenCalledWith(
        'closePaperTrade failed: quote unavailable',
        'Dismiss',
        expect.anything(),
      );
      expect(store.actingIds().has('t-1')).toBe(false);
      // No reload — the in-memory row is exactly what the last load set.
      expect(mockService.listPaperTrades$).toHaveBeenCalledTimes(1);
      expect(store.trades()).toBe(before);
    });

    it('unauthenticated close maps to the auth message', async () => {
      mockService.closePaperTrade$.mockReturnValue(
        throwError(() => Object.assign(new Error('nope'), { code: 'unauthenticated' })),
      );
      store.closeTrade('t-1');
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(store.error()).toBe('Authentication required to view paper trading data');
    });

    it('cancelTrade invokes the service and reloads trades only — no cash moves', async () => {
      mockService.cancelPaperTrade$.mockReturnValue(of({ tradeId: 't-4' }));
      store.cancelTrade('t-4');
      await new Promise<void>((r) => setTimeout(r, 0));

      expect(mockService.cancelPaperTrade$).toHaveBeenCalledWith('t-4');
      expect(mockService.listPaperTrades$).toHaveBeenCalled();
      // PRD US2 — cancel books no cash, so the account is not refetched.
      expect(mockService.getPaperAccount$).not.toHaveBeenCalled();
      expect(store.actingIds().has('t-4')).toBe(false);
    });

    it('cancel failure surfaces the error and leaves the flag clear', async () => {
      const snackSpy = jest.spyOn(TestBed.inject(MatSnackBar), 'open');
      mockService.cancelPaperTrade$.mockReturnValue(
        throwError(() => new Error('cancelPaperTrade failed: not pending')),
      );
      store.cancelTrade('t-4');
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(store.error()).toBe('cancelPaperTrade failed: not pending');
      expect(snackSpy).toHaveBeenCalledWith(
        'cancelPaperTrade failed: not pending',
        'Dismiss',
        expect.anything(),
      );
      expect(store.actingIds().has('t-4')).toBe(false);
    });

    it('the shared in-flight set blocks close+cancel races on one trade', async () => {
      const pending = new Subject<unknown>();
      mockService.closePaperTrade$.mockReturnValue(pending.asObservable());
      store.closeTrade('t-1');
      store.cancelTrade('t-1');
      expect(mockService.cancelPaperTrade$).not.toHaveBeenCalled();
      pending.complete();
      await new Promise<void>((r) => setTimeout(r, 0));
    });

    it('actions on different tradeIds proceed concurrently', async () => {
      const pendingA = new Subject<unknown>();
      const pendingB = new Subject<unknown>();
      mockService.closePaperTrade$.mockImplementation((id: string) =>
        id === 't-1' ? pendingA.asObservable() : pendingB.asObservable(),
      );
      store.closeTrade('t-1');
      store.closeTrade('t-2');
      expect(mockService.closePaperTrade$).toHaveBeenCalledTimes(2);
      expect(store.actingIds().has('t-1')).toBe(true);
      expect(store.actingIds().has('t-2')).toBe(true);

      pendingA.complete();
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(store.actingIds().has('t-1')).toBe(false);
      expect(store.actingIds().has('t-2')).toBe(true);
      pendingB.complete();
    });

    it('a failed action can be retried on the same tradeId', async () => {
      mockService.closePaperTrade$
        .mockReturnValueOnce(throwError(() => new Error('first failed')))
        .mockReturnValueOnce(of({ tradeId: 't-1' }));
      store.closeTrade('t-1');
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(store.error()).toBe('first failed');
      expect(store.actingIds().has('t-1')).toBe(false);

      store.closeTrade('t-1');
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(mockService.closePaperTrade$).toHaveBeenCalledTimes(2);
      expect(store.error()).toBeNull();
    });

    it('a synchronous service throw clears the flag instead of leaking it', async () => {
      // defer(() => invoke()) routes the throw through catchError —
      // without it actingTradeIds would pin the id forever.
      mockService.closePaperTrade$.mockImplementation(() => {
        throw new Error('injector destroyed');
      });
      store.closeTrade('t-1');
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(store.actingIds().has('t-1')).toBe(false);
      expect(store.error()).toBe('injector destroyed');
    });
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
