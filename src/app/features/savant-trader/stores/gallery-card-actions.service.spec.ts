/**
 * GalleryCardActionsService unit tests (#755).
 *
 * Card mutations extracted from GalleryFacade: Trade stages a quantity
 * ticket (pessimistically — `stageTicketAndWait`), Reject writes durable
 * REJECTs against the card's FULL unfiltered occurrence set and removes its
 * staged tickets, Paper routes through `sendTicketToPaper`, and
 * `busyCardKeys`/`isActionableRun` guard re-entry.
 */
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { GalleryCardActionsService } from './gallery-card-actions.service';
import { GroupStore } from './group.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { OrderTicketStore } from './order-ticket.store';
import { EquityPriceService } from '../services/equity-price.service';
import { TradingConfigService } from '../services/trading-config.service';
import { ReviewDecision, SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';
import { StOccurrenceDecision, StSignalItem, StSymbolProfile } from '../services/types';
import {
  EquityOrderTicket,
  InstrumentType,
  OrderSource,
  OrderTicket,
  OrderTicketStatus,
} from '../services/order-ticket.types';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';
import { GalleryCard } from '../utils/gallery-cards.util';

const RUN_ID = 'run-1';
const MARKET_DATE = '2026-08-25';

function makeProfile(symbol: string): StSymbolProfile {
  return { symbol, enabled: true, createdAt: '2026-01-01' };
}

function makeSignal(
  symbol: string,
  timeframe: SignalTimeframe,
  direction: SignalDirection,
  extra: Partial<StSignalItem> = {},
): StSignalItem {
  return {
    id: MARKET_DATE,
    symbol,
    barDate: MARKET_DATE,
    marketDate: MARKET_DATE,
    runId: RUN_ID,
    timeframe,
    direction,
    signalType: 'RS_RISE',
    status: SignalStatus.INTERIM,
    indicators: {},
    ...extra,
  };
}

function makeTicket(
  symbol: string,
  side: 'buy' | 'sell',
  status: OrderTicketStatus,
  extra: Partial<EquityOrderTicket> = {},
): EquityOrderTicket {
  return {
    id: `t-${symbol}-${side}`,
    refId: 'ref-1',
    source: OrderSource.SIGNAL_PIPELINE,
    status,
    accountNumber: 'acct-1',
    side,
    orderType: 'limit',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol,
    signalContext: {
      signalType: 'RS_RISE',
      barDate: MARKET_DATE,
      timeframe: 'D',
      direction: side === 'buy' ? 'LONG' : 'SHORT',
      decisionId: buildStOccurrenceDecisionId(RUN_ID, symbol, 'D', 'RS_RISE'),
    },
    createdAt: '2026-08-25T00:00:00Z',
    updatedAt: '2026-08-26T00:00:00Z',
    ...extra,
  } as EquityOrderTicket;
}

function makeCard(
  symbol: string,
  side: 'buy' | 'sell',
  signals: StSignalItem[],
  status: GalleryCard['status'] = 'pending',
  extra: Partial<GalleryCard> = {},
): GalleryCard {
  return {
    key: `${symbol}:${side}`,
    symbol,
    side,
    direction: side === 'buy' ? SignalDirection.LONG : SignalDirection.SHORT,
    profile: makeProfile(symbol),
    occurrences: signals,
    status,
    allRejected: false,
    actionedAt: '',
    ...extra,
  };
}

describe('GalleryCardActionsService', () => {
  let actions: GalleryCardActionsService;
  let snackBarMock: { open: jest.Mock };
  let groupStoreMock: {
    activeRunId: ReturnType<typeof signal<string | null>>;
    activeRunMarketDate: ReturnType<typeof signal<string | null>>;
    isActionableRun: ReturnType<typeof signal<boolean>>;
  };
  let historyStoreMock: {
    signalHistoryCache: ReturnType<typeof signal<Record<string, StSignalItem[]>>>;
  };
  let occurrenceStoreMock: {
    occurrenceDecisions: ReturnType<typeof signal<Record<string, StOccurrenceDecision>>>;
    acceptSignals: jest.Mock;
    rejectSignals: jest.Mock;
    resetSignals: jest.Mock;
  };
  let symbolListStoreMock: {
    symbolLists: ReturnType<typeof signal<Record<string, string[]>>>;
  };
  let ticketStoreMock: {
    ticketsBySymbol: ReturnType<typeof signal<Record<string, OrderTicket[]>>>;
    tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
    stageTicketAndWait: jest.Mock;
    sendTicketToPaper: jest.Mock;
    removeTicket: jest.Mock;
    updateTicket: jest.Mock;
  };
  let priceServiceMock: {
    prices: ReturnType<typeof signal<Record<string, number>>>;
    fetchPrices: jest.Mock;
  };
  let configServiceMock: { loadConfig: jest.Mock };

  beforeEach(async () => {
    snackBarMock = { open: jest.fn() };
    groupStoreMock = {
      activeRunId: signal<string | null>(RUN_ID),
      activeRunMarketDate: signal<string | null>(MARKET_DATE),
      isActionableRun: signal(true),
    };
    historyStoreMock = {
      signalHistoryCache: signal<Record<string, StSignalItem[]>>({
        [`AAPL::${RUN_ID}`]: [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)],
        [`TSLA::${RUN_ID}`]: [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)],
      }),
    };
    occurrenceStoreMock = {
      occurrenceDecisions: signal<Record<string, StOccurrenceDecision>>({}),
      acceptSignals: jest.fn(),
      rejectSignals: jest.fn(),
      resetSignals: jest.fn(),
    };
    symbolListStoreMock = {
      symbolLists: signal<Record<string, string[]>>({}),
    };
    ticketStoreMock = {
      ticketsBySymbol: signal<Record<string, OrderTicket[]>>({}),
      tickets: signal<Record<string, OrderTicket>>({}),
      // Pessimistic stage: the service awaits the write, so the mock must
      // actually land the ticket in the store maps (a later tickets()[id]
      // re-read depends on it).
      stageTicketAndWait: jest.fn(async (t: EquityOrderTicket) => {
        ticketStoreMock.tickets.update((m) => ({ ...m, [t.id]: t }));
        ticketStoreMock.ticketsBySymbol.update((m) => ({
          ...m,
          [t.symbol]: [...(m[t.symbol] ?? []), t],
        }));
        return true;
      }),
      sendTicketToPaper: jest.fn().mockResolvedValue({ cohortId: 'c1', expressionTradeIds: [] }),
      removeTicket: jest.fn(),
      updateTicket: jest.fn(),
    };
    priceServiceMock = {
      prices: signal<Record<string, number>>({}),
      fetchPrices: jest.fn().mockResolvedValue(undefined),
    };
    configServiceMock = { loadConfig: jest.fn().mockReturnValue(of({ accountNumber: '123' })) };

    await TestBed.configureTestingModule({
      providers: [
        { provide: GroupStore, useValue: groupStoreMock },
        { provide: SymbolHistoryStore, useValue: historyStoreMock },
        { provide: OccurrenceDecisionStore, useValue: occurrenceStoreMock },
        { provide: SymbolListStore, useValue: symbolListStoreMock },
        { provide: OrderTicketStore, useValue: ticketStoreMock },
        { provide: EquityPriceService, useValue: priceServiceMock },
        { provide: TradingConfigService, useValue: configServiceMock },
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    });
    actions = TestBed.inject(GalleryCardActionsService);
  });

  const tslaSell = () =>
    makeCard('TSLA', 'sell', [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)]);
  const aaplBuy = () =>
    makeCard('AAPL', 'buy', [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)]);

  it('reject writes durable REJECTs for the card occurrences and removes its side\'s staged tickets', () => {
    const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED);
    ticketStoreMock.ticketsBySymbol.set({ TSLA: [staged] });

    actions.rejectCard(tslaSell());

    const [signals, runId, marketDate] = occurrenceStoreMock.rejectSignals.mock.calls[0];
    expect(runId).toBe(RUN_ID);
    expect(marketDate).toBe(MARKET_DATE);
    expect(signals.map((s: StSignalItem) => s.symbol)).toEqual(['TSLA']);
    expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(staged.id);
  });

  it('reject toggles off: an active reject resets the card back to pending', () => {
    const signal = makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT);
    const reject: StOccurrenceDecision = {
      id: buildStOccurrenceDecisionId(RUN_ID, 'TSLA', 'D', 'RS_RISE'),
      runId: RUN_ID,
      marketDate: MARKET_DATE,
      symbol: 'TSLA',
      timeframe: SignalTimeframe.DAILY,
      direction: SignalDirection.SHORT,
      signalType: 'RS_RISE',
      barDate: MARKET_DATE,
      decisionType: ReviewDecision.REJECT,
      decidedAt: '2026-08-26T00:00:00Z',
      isCurrentInLatestRun: true,
    };
    occurrenceStoreMock.occurrenceDecisions.set({ [reject.id]: reject });

    actions.rejectCard(makeCard('TSLA', 'sell', [signal], 'rejected'));

    expect(occurrenceStoreMock.resetSignals).toHaveBeenCalledWith([signal], RUN_ID);
    expect(occurrenceStoreMock.rejectSignals).not.toHaveBeenCalled();
  });

  it('trade stages a quantity ticket sized on the signal close — no decision writes (#759)', async () => {
    historyStoreMock.signalHistoryCache.set({
      [`AAPL::${RUN_ID}`]: [
        makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
      ],
    });
    const card = makeCard('AAPL', 'buy', [
      makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
    ]);

    const result = await actions.tradeCard(card);

    expect(result?.created).toBe(true);
    expect(occurrenceStoreMock.acceptSignals).not.toHaveBeenCalled();
    expect(ticketStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
    const staged = ticketStoreMock.stageTicketAndWait.mock.calls[0][0] as EquityOrderTicket;
    expect(result?.ticket).toBe(staged);
    expect(staged.side).toBe('buy');
    expect(staged.symbol).toBe('AAPL');
    expect(staged.status).toBe(OrderTicketStatus.STAGED);
    expect(staged.quantity).toBe('2'); // $100 default ÷ $50 close
    expect(staged.dollarAmount).toBeUndefined();
    expect(staged.signalContext?.decisionId).toBe(
      buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'D', 'RS_RISE'),
    );
  });

  it('trade falls back to a live quote when the signal has no close price', async () => {
    priceServiceMock.prices.set({ TSLA: 25 });

    const result = await actions.tradeCard(tslaSell());

    expect(priceServiceMock.fetchPrices).toHaveBeenCalledWith(['TSLA']);
    const staged = result?.ticket as EquityOrderTicket;
    expect(staged.quantity).toBe('4'); // $100 ÷ $25 live quote
  });

  it('trade reopens an existing staged ticket instead of duplicating (#759)', async () => {
    const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED);
    ticketStoreMock.ticketsBySymbol.set({ TSLA: [staged] });

    const result = await actions.tradeCard(tslaSell());

    expect(result).toEqual({ ticket: staged, created: false });
    expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
  });

  it('trade does not stage when no price is available', async () => {
    const result = await actions.tradeCard(tslaSell());

    expect(result).toBeNull();
    expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
  });

  it('paper stages the card ticket and sends it through sendTicketToPaper', async () => {
    historyStoreMock.signalHistoryCache.set({
      [`AAPL::${RUN_ID}`]: [
        makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
      ],
    });
    const card = makeCard('AAPL', 'buy', [
      makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
    ]);

    await actions.paperCard(card);

    const staged = ticketStoreMock.stageTicketAndWait.mock.calls[0][0] as EquityOrderTicket;
    // SUBMITTING → callable → PAPER/STAGED-revert lives inside
    // sendTicketToPaper (#755 extraction) — asserted at the store seam.
    expect(ticketStoreMock.sendTicketToPaper).toHaveBeenCalledWith(
      expect.objectContaining({ id: staged.id, quantity: '2' }), 2,
    );
  });

  it('paper reuses the card\'s existing staged ticket', async () => {
    const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED, { quantity: '4' });
    ticketStoreMock.ticketsBySymbol.set({ TSLA: [staged] });
    ticketStoreMock.tickets.set({ [staged.id]: staged });

    await actions.paperCard(tslaSell());

    expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    expect(ticketStoreMock.sendTicketToPaper).toHaveBeenCalledWith(
      expect.objectContaining({ id: staged.id }), 4,
    );
  });

  it('paper surfaces the failure when the paper send rejects (ticket existed — kept)', async () => {
    const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED, { quantity: '4' });
    ticketStoreMock.ticketsBySymbol.set({ TSLA: [staged] });
    ticketStoreMock.tickets.set({ [staged.id]: staged });
    ticketStoreMock.sendTicketToPaper.mockRejectedValue(new Error('boom'));

    await actions.paperCard(tslaSell());

    expect(snackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('paper send failed'), 'Dismiss', { duration: 5000 },
    );
    // Pre-existing ticket is kept — only a ticket this click created is discarded.
    expect(ticketStoreMock.removeTicket).not.toHaveBeenCalled();
  });

  it('discardStagedTicket removes a still-staged ticket but keeps a submitted one', () => {
    const staged = makeTicket('AAPL', 'buy', OrderTicketStatus.STAGED);
    const submitted = makeTicket('TSLA', 'sell', OrderTicketStatus.SUBMITTED);
    ticketStoreMock.tickets.set({ [staged.id]: staged, [submitted.id]: submitted });

    actions.discardStagedTicket(staged.id);
    actions.discardStagedTicket(submitted.id);

    expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(staged.id);
    expect(ticketStoreMock.removeTicket).toHaveBeenCalledTimes(1);
  });

  it('no-ops every mutation when the viewed run is not actionable', async () => {
    groupStoreMock.isActionableRun.set(false);

    actions.rejectCard(tslaSell());
    const trade = await actions.tradeCard(aaplBuy());
    await actions.paperCard(aaplBuy());

    expect(occurrenceStoreMock.rejectSignals).not.toHaveBeenCalled();
    expect(occurrenceStoreMock.resetSignals).not.toHaveBeenCalled();
    expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    expect(ticketStoreMock.sendTicketToPaper).not.toHaveBeenCalled();
    expect(trade).toBeNull();
  });

  describe('#755 review fixes', () => {
    it('reject acts on the card\'s FULL occurrence set, not the timeframe-trimmed card list', () => {
      const daily = makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG);
      const weekly = { ...makeSignal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG), signalType: 'RS_WEEKLY' };
      historyStoreMock.signalHistoryCache.set({ [`AAPL::${RUN_ID}`]: [daily, weekly] });
      // The Daily page filter trims the card to the daily occurrence —
      // rejecting must still cover the weekly leg.
      const card = makeCard('AAPL', 'buy', [daily]);

      actions.rejectCard(card);

      const signals = occurrenceStoreMock.rejectSignals.mock.calls[0][0] as StSignalItem[];
      expect(signals.map((s) => s.timeframe).sort()).toEqual([
        SignalTimeframe.DAILY,
        SignalTimeframe.WEEKLY,
      ]);
    });

    it('restore also resets the full occurrence set', () => {
      const daily = makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG);
      const weekly = { ...makeSignal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG), signalType: 'RS_WEEKLY' };
      historyStoreMock.signalHistoryCache.set({ [`AAPL::${RUN_ID}`]: [daily, weekly] });
      const card = makeCard('AAPL', 'buy', [daily], 'rejected');

      actions.rejectCard(card);

      const signals = occurrenceStoreMock.resetSignals.mock.calls[0][0] as StSignalItem[];
      expect(signals).toHaveLength(2);
    });

    it('sunk cards cannot be traded or papered — only restored', async () => {
      const rejected = makeCard('AAPL', 'buy', [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)], 'rejected');
      const settled = makeCard('TSLA', 'sell', [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)], 'settled');

      expect(await actions.tradeCard(rejected)).toBeNull();
      expect(await actions.tradeCard(settled)).toBeNull();
      await actions.paperCard(rejected);
      await actions.paperCard(settled);

      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(ticketStoreMock.sendTicketToPaper).not.toHaveBeenCalled();
    });

    it('a second tradeCard while staging cannot double-stage (#755 review)', async () => {
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 })],
      });
      const card = makeCard('AAPL', 'buy', [
        makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
      ]);
      let releaseStage!: (t: OrderTicket) => void;
      ticketStoreMock.stageTicketAndWait.mockImplementationOnce(
        (t: OrderTicket) => new Promise<OrderTicket>((r) => { releaseStage = () => r(t); }),
      );

      const first = actions.tradeCard(card);
      // Macrotask flush lets the first call's config await reach the
      // deferred stage persist — busy stays held until it resolves.
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(actions.busyCardKeys().has('AAPL:buy')).toBe(true);
      const second = await actions.tradeCard(card);
      expect(second).toBeNull();

      releaseStage(ticketStoreMock.stageTicketAndWait.mock.calls[0][0]);
      await first;
      expect(ticketStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
    });

    it('a second paperCard during the send cannot double-send (#755 review)', async () => {
      const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED, { quantity: '4' });
      ticketStoreMock.ticketsBySymbol.set({ TSLA: [staged] });
      ticketStoreMock.tickets.set({ [staged.id]: staged });
      let release!: (v: unknown) => void;
      ticketStoreMock.sendTicketToPaper.mockImplementationOnce(
        () => new Promise((r) => { release = r; }),
      );

      const first = actions.paperCard(tslaSell());
      await new Promise<void>((r) => setTimeout(r, 0)); // first reaches the send await
      await actions.paperCard(tslaSell()); // second — busy-guarded

      expect(ticketStoreMock.sendTicketToPaper).toHaveBeenCalledTimes(1);
      release({});
      await first;
    });

    it('paper persists the staged ticket BEFORE the paper callable runs (#755 review)', async () => {
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 })],
      });
      const card = makeCard('AAPL', 'buy', [
        makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
      ]);

      await actions.paperCard(card);

      const stageOrder = ticketStoreMock.stageTicketAndWait.mock.invocationCallOrder[0];
      const sendOrder = ticketStoreMock.sendTicketToPaper.mock.invocationCallOrder[0];
      expect(stageOrder).toBeLessThan(sendOrder);
    });

    it('a failed paper send discards the ticket the click itself created', async () => {
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 })],
      });
      const card = makeCard('AAPL', 'buy', [
        makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
      ]);
      ticketStoreMock.sendTicketToPaper.mockRejectedValue(new Error('boom'));

      await actions.paperCard(card);

      const staged = ticketStoreMock.stageTicketAndWait.mock.calls[0][0] as OrderTicket;
      expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(staged.id);
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('paper send failed'), 'Dismiss', { duration: 5000 },
      );
    });
  });

  describe('#755 review round 2', () => {
    const rejectDecision = (signal: StSignalItem): StOccurrenceDecision => ({
      id: buildStOccurrenceDecisionId(RUN_ID, signal.symbol, signal.timeframe, signal.signalType),
      runId: RUN_ID,
      marketDate: MARKET_DATE,
      symbol: signal.symbol,
      timeframe: signal.timeframe,
      direction: signal.direction,
      signalType: signal.signalType,
      barDate: MARKET_DATE,
      decisionType: ReviewDecision.REJECT,
      decidedAt: '2026-08-26T00:00:00Z',
      isCurrentInLatestRun: true,
    });

    it('a watched card whose occurrences are all REJECTed cannot trade — the REJECTs stay reachable via Restore', async () => {
      const signal = makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 });
      historyStoreMock.signalHistoryCache.set({ [`AAPL::${RUN_ID}`]: [signal] });
      const dec = rejectDecision(signal);
      occurrenceStoreMock.occurrenceDecisions.set({ [dec.id]: dec });
      // Monitor wins status precedence — the card renders 'watched' but
      // every occurrence is rejected.
      const card = makeCard('AAPL', 'buy', [signal], 'watched', { allRejected: true });

      expect(await actions.tradeCard(card)).toBeNull();
      await actions.paperCard(card);
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();

      // Reject button reads Restore for this card — resets the REJECTs.
      actions.rejectCard(card);
      expect(occurrenceStoreMock.resetSignals).toHaveBeenCalledWith([signal], RUN_ID);
      expect(occurrenceStoreMock.rejectSignals).not.toHaveBeenCalled();
    });

    it('staging excludes REJECTed occurrences from the ticket decisionIds — removal can never un-reject them', async () => {
      const kept = makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 });
      const rejected = { ...makeSignal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG), signalType: 'RS_WEEKLY' };
      historyStoreMock.signalHistoryCache.set({ [`AAPL::${RUN_ID}`]: [kept, rejected] });
      const dec = rejectDecision(rejected);
      occurrenceStoreMock.occurrenceDecisions.set({ [dec.id]: dec });
      const card = makeCard('AAPL', 'buy', [kept, rejected]);

      const result = await actions.tradeCard(card);

      const staged = ticketStoreMock.stageTicketAndWait.mock.calls[0][0] as EquityOrderTicket;
      expect(result?.ticket).toBe(staged);
      expect(staged.signalContext?.decisionIds).toEqual([
        buildStOccurrenceDecisionId(RUN_ID, 'AAPL', SignalTimeframe.DAILY, 'RS_RISE'),
      ]);
    });

    it('an all-rejected card stages nothing — snackbar, no ticket', async () => {
      const signal = makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT, { closePrice: 50 });
      historyStoreMock.signalHistoryCache.set({ [`TSLA::${RUN_ID}`]: [signal] });
      const dec = rejectDecision(signal);
      occurrenceStoreMock.occurrenceDecisions.set({ [dec.id]: dec });
      const card = makeCard('TSLA', 'sell', [signal]);

      // canTradeCard only blocks when the flag says allRejected — the
      // stage path itself also refuses when nothing survives the filter.
      const result = await actions.tradeCard(card);

      expect(result).toBeNull();
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('all occurrences rejected'), 'Dismiss', { duration: 4000 },
      );
    });

    it('reject removes only THIS run\'s staged ticket — a same-side ticket from another run survives', () => {
      const signal = makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT);
      const mine = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED);
      const otherRun = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED, {
        id: 't-TSLA-sell-other',
        signalContext: {
          signalType: 'RS_RISE',
          barDate: MARKET_DATE,
          timeframe: 'D',
          direction: 'SHORT',
          decisionId: buildStOccurrenceDecisionId('run-other', 'TSLA', 'D', 'RS_RISE'),
        },
      });
      ticketStoreMock.ticketsBySymbol.set({ TSLA: [mine, otherRun] });

      actions.rejectCard(makeCard('TSLA', 'sell', [signal]));

      expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(mine.id);
      expect(ticketStoreMock.removeTicket).toHaveBeenCalledTimes(1);
    });

    it('two rapid trade clicks on an existing ticket open one dialog — busy covers the reopen path', async () => {
      const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED);
      ticketStoreMock.ticketsBySymbol.set({ TSLA: [staged] });
      ticketStoreMock.tickets.set({ [staged.id]: staged });

      // Same-tick double-click: the first call registers busy synchronously
      // before its reopen-check resolves, so the second sees the busy key.
      const first = actions.tradeCard(tslaSell());
      const second = actions.tradeCard(tslaSell());

      expect(await second).toBeNull();
      expect(await first).toEqual({ ticket: staged, created: false });
    });
  });

  describe('#755 review round 3', () => {
    it('warmConfig does NOT release a busy key held by an in-flight action', async () => {
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 })],
      });
      const card = makeCard('AAPL', 'buy', [
        makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
      ]);
      let releaseStage!: (t: OrderTicket) => void;
      ticketStoreMock.stageTicketAndWait.mockImplementationOnce(
        (t: OrderTicket) => new Promise<OrderTicket>((r) => { releaseStage = () => r(t); }),
      );

      const first = actions.tradeCard(card);
      await new Promise<void>((r) => setTimeout(r, 0)); // first reaches the stage await
      expect(actions.busyCardKeys().has('AAPL:buy')).toBe(true);

      // Navigating away and back calls warmConfig — it must not clear the
      // key the in-flight action still holds.
      actions.warmConfig();
      expect(actions.busyCardKeys().has('AAPL:buy')).toBe(true);
      expect(await actions.tradeCard(card)).toBeNull();

      releaseStage(ticketStoreMock.stageTicketAndWait.mock.calls[0][0]);
      await first;
      expect(actions.busyCardKeys().has('AAPL:buy')).toBe(false);
    });

    it('trade bails when the card snapshot is stale — a matching non-STAGED ticket exists (#755 review r3)', async () => {
      // Rendered card has no ticket, but another surface submitted one
      // for this run+side between render and click.
      const submitted = makeTicket('TSLA', 'sell', OrderTicketStatus.SUBMITTED);
      ticketStoreMock.ticketsBySymbol.set({ TSLA: [submitted] });
      ticketStoreMock.tickets.set({ [submitted.id]: submitted });
      priceServiceMock.prices.set({ TSLA: 25 });

      const result = await actions.tradeCard(tslaSell());

      expect(result).toBeNull();
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('paper bails on the same stale-snapshot guard — no stage, no send', async () => {
      const submitted = makeTicket('TSLA', 'sell', OrderTicketStatus.SUBMITTED);
      ticketStoreMock.ticketsBySymbol.set({ TSLA: [submitted] });
      ticketStoreMock.tickets.set({ [submitted.id]: submitted });

      await actions.paperCard(tslaSell());

      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(ticketStoreMock.sendTicketToPaper).not.toHaveBeenCalled();
    });

    it('the store\'s eligibility guard surfaces an actionable snackbar, not internal wording', async () => {
      const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED, { quantity: '4' });
      ticketStoreMock.ticketsBySymbol.set({ TSLA: [staged] });
      ticketStoreMock.tickets.set({ [staged.id]: staged });
      ticketStoreMock.sendTicketToPaper.mockRejectedValue(
        new Error('ticket t-TSLA-sell is no longer paper-eligible'),
      );

      await actions.paperCard(tslaSell());

      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('ticket changed before send'), 'Dismiss', { duration: 5000 },
      );
    });
  });
});
