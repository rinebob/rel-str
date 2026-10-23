/**
 * GalleryCardActionsService unit tests (#755).
 *
 * Card mutations extracted from GalleryFacade: Trade stages a quantity
 * ticket (pessimistically — `stageTicketAndWait`), Reject parks the card
 * in Actioned for the session (ephemeral `rejectedCards` map — no
 * writes; #1017) and removes its staged tickets, Paper routes through
 * `sendTicketToPaper`, and `busyCardKeys`/`isActionableRun` guard
 * re-entry.
 */
import { computed, signal, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { GalleryCardActionsService } from './gallery-card-actions.service';
import { GroupStore } from './group.store';

import { OrderTicketStore } from './order-ticket.store';
import { EquityPriceService } from '../services/equity-price.service';
import { TradingConfigService } from '../services/trading-config.service';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';
import { StSignalItem, StSymbolProfile } from '../services/types';
import {
  EquityOrderTicket,
  InstrumentType,
  OptionOrderTicket,
  OrderSource,
  OrderTicket,
  OrderTicketStatus,
  TradingConfig,
} from '../services/order-ticket.types';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';
import { stDocId } from '../services/order-ticket-st-mapper';

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

function makeOptionTicket(
  symbol: string,
  status: OrderTicketStatus,
  direction: 'LONG' | 'SHORT' = 'LONG',
): OptionOrderTicket {
  return {
    id: `opt-${symbol}`,
    refId: 'ref-opt',
    source: OrderSource.SIGNAL_PIPELINE,
    status,
    accountNumber: 'acct-1',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.OPTION,
    symbol,
    legs: [{ side: 'buy', symbol: `${symbol}260116C00200000`, optionId: 'opt-1', positionEffect: 'open' }],
    quantity: '1',
    price: '1.25',
    signalContext: {
      signalType: 'RS_RISE',
      barDate: MARKET_DATE,
      timeframe: 'D',
      direction,
      decisionId: buildStOccurrenceDecisionId(RUN_ID, symbol, 'D', 'RS_RISE'),
    },
    createdAt: '2026-08-25T00:00:00Z',
    updatedAt: '2026-08-26T00:00:00Z',
  };
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
    allOccurrences: signals,
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
  let ticketStoreMock: {
    ticketsBySymbol: ReturnType<typeof computed<Record<string, OrderTicket[]>>>;
    tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
    stageTicketAndWait: jest.Mock;
    sendTicketToPaper: jest.Mock;
    removeTicket: jest.Mock;
    discardIfStaged: jest.Mock;
    updateTicket: jest.Mock;
    updateTicketAndWait: jest.Mock;
  };
  let priceServiceMock: {
    prices: ReturnType<typeof signal<Record<string, number>>>;
    fetchPrices: jest.Mock;
  };
  let configServiceMock: {
    config: Signal<TradingConfig | null>;
    ensureConfig: jest.Mock;
    warmConfig: jest.Mock;
  };

  /** Write tickets into the store map — ticketsBySymbol derives from
   *  it exactly like the real store, so the two views can't drift. */
  const seedTickets = (...list: OrderTicket[]) => {
    ticketStoreMock.tickets.set(Object.fromEntries(list.map((t) => [t.id, t])));
  };

  beforeEach(async () => {
    snackBarMock = { open: jest.fn() };
    groupStoreMock = {
      activeRunId: signal<string | null>(RUN_ID),
      activeRunMarketDate: signal<string | null>(MARKET_DATE),
      isActionableRun: signal(true),
    };
    ticketStoreMock = {
      ticketsBySymbol: computed((): Record<string, OrderTicket[]> => {
        const grouped: Record<string, OrderTicket[]> = {};
        for (const t of Object.values(ticketStoreMock.tickets())) {
          (grouped[t.symbol] ??= []).push(t);
        }
        return grouped;
      }),
      tickets: signal<Record<string, OrderTicket>>({}),
      // Pessimistic stage: the service awaits the write, so the mock must
      // actually land the ticket in the store maps (a later tickets()[id]
      // re-read depends on it).
      stageTicketAndWait: jest.fn(async (t: EquityOrderTicket) => {
        ticketStoreMock.tickets.update((m) => ({ ...m, [t.id]: t }));
        return true;
      }),
      sendTicketToPaper: jest.fn().mockResolvedValue({ cohortId: 'c1', expressionTradeIds: [] }),
      removeTicket: jest.fn((id: string) => {
        ticketStoreMock.tickets.update((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        });
      }),
      // Mirror the store's STAGED-only discard guard, dual-key probe and
      // all — the map is mixed bare/liv_-keyed, same as production (#1177).
      discardIfStaged: jest.fn((id: string) => {
        const key = ticketStoreMock.tickets()[id] ? id : stDocId(id);
        if (ticketStoreMock.tickets()[key]?.status === OrderTicketStatus.STAGED) {
          ticketStoreMock.removeTicket(key);
        }
      }),
      updateTicket: jest.fn(),
      updateTicketAndWait: jest.fn().mockResolvedValue(true),
    };
    priceServiceMock = {
      prices: signal<Record<string, number>>({}),
      fetchPrices: jest.fn().mockResolvedValue(undefined),
    };
    configServiceMock = {
      config: signal<TradingConfig | null>(null).asReadonly(),
      ensureConfig: jest.fn(async () => ({ accountNumber: '123' }) as TradingConfig),
      warmConfig: jest.fn(),
    };

    await TestBed.configureTestingModule({
      providers: [
        { provide: GroupStore, useValue: groupStoreMock },
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

  it('reject marks the card session-rejected and removes its side\'s staged tickets', () => {
    const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED);
    seedTickets(staged);

    actions.rejectCard(tslaSell());

    expect(actions.rejectedCards().has('TSLA:sell')).toBe(true);
    expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(staged.id);
  });

  it('reject toggles off: restoring a rejected card returns it to the actionable set', () => {
    const signal = makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT);

    actions.rejectCard(makeCard('TSLA', 'sell', [signal], 'rejected'));

    expect(actions.rejectedCards().has('TSLA:sell')).toBe(false);
  });

  it('session rejects are run-scoped — a card rejected under one run does not sink the same card under the next run (#1017 r1)', () => {
    actions.rejectCard(tslaSell());
    expect(actions.rejectedCards().has('TSLA:sell')).toBe(true);

    groupStoreMock.activeRunId.set('run-next');
    expect(actions.rejectedCards().has('TSLA:sell')).toBe(false);

    groupStoreMock.activeRunId.set(RUN_ID);
    expect(actions.rejectedCards().has('TSLA:sell')).toBe(true);
  });

  it('trade stages a quantity ticket sized on the signal close — no decision writes (#759)', async () => {
    const card = makeCard('AAPL', 'buy', [
      makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
    ]);

    const result = await actions.tradeCard(card);

    expect(result?.created).toBe(true);
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
    seedTickets(staged);

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
    seedTickets(staged);

    await actions.paperCard(tslaSell());

    expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    expect(ticketStoreMock.sendTicketToPaper).toHaveBeenCalledWith(
      expect.objectContaining({ id: staged.id }), 4,
    );
  });

  it('paper surfaces the failure when the paper send rejects (ticket existed — kept)', async () => {
    const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED, { quantity: '4' });
    seedTickets(staged);
    ticketStoreMock.sendTicketToPaper.mockRejectedValue(new Error('boom'));

    await actions.paperCard(tslaSell());

    expect(snackBarMock.open).toHaveBeenCalledWith(
      expect.stringContaining('paper send failed'), 'Dismiss', { duration: 5000 },
    );
    // Pre-existing ticket is kept — only a ticket this click created is discarded.
    expect(ticketStoreMock.removeTicket).not.toHaveBeenCalled();
  });

  it('delegates config warmup and the staged-discard guard to the canonical services (#1177)', () => {
    actions.warmConfig();
    expect(configServiceMock.warmConfig).toHaveBeenCalled();

    actions.discardStagedTicket('any-id');
    expect(ticketStoreMock.discardIfStaged).toHaveBeenCalledWith('any-id');
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
    await actions.requeueCard(makeCard('MSFT', 'buy', [makeSignal('MSFT', SignalTimeframe.DAILY, SignalDirection.LONG)], 'failed'));

    expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    expect(ticketStoreMock.sendTicketToPaper).not.toHaveBeenCalled();
    expect(ticketStoreMock.updateTicketAndWait).not.toHaveBeenCalled();
    expect(trade).toBeNull();
  });

  describe('#755 review fixes', () => {
    it('reject removes staged tickets matched on the card\'s FULL occurrence set — a hidden leg\'s ticket is still removed', () => {
      const daily = makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG);
      const weekly = { ...makeSignal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG), signalType: 'RS_WEEKLY' };
      // The Daily page filter trims `occurrences` to the daily leg; the
      // staged ticket's provenance is the hidden WEEKLY leg — it must
      // still be found via allOccurrences and removed (#819 r2).
      const card = makeCard('AAPL', 'buy', [daily], 'pending', { allOccurrences: [daily, weekly] });
      const weeklyTicket = makeTicket('AAPL', 'buy', OrderTicketStatus.STAGED, {
        signalContext: {
          signalType: 'RS_WEEKLY',
          barDate: MARKET_DATE,
          timeframe: 'W',
          direction: 'LONG',
          decisionId: buildStOccurrenceDecisionId(RUN_ID, 'AAPL', 'W', 'RS_WEEKLY'),
        },
      });
      seedTickets(weeklyTicket);

      actions.rejectCard(card);

      expect(actions.rejectedCards().has('AAPL:buy')).toBe(true);
      expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(weeklyTicket.id);
    });

    it('actioned cards cannot be traded or papered directly — they exit first', async () => {
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
      seedTickets(staged);
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
      const card = makeCard('AAPL', 'buy', [
        makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
      ]);

      await actions.paperCard(card);

      const stageOrder = ticketStoreMock.stageTicketAndWait.mock.invocationCallOrder[0];
      const sendOrder = ticketStoreMock.sendTicketToPaper.mock.invocationCallOrder[0];
      expect(stageOrder).toBeLessThan(sendOrder);
    });

    it('a failed paper send discards the ticket the click itself created', async () => {
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

  describe('actioned-section exits', () => {
    it('requeue regenerates the failed ticket to STAGED with a fresh refId', async () => {
      const failed = makeTicket('TSLA', 'sell', OrderTicketStatus.FAILED);
      seedTickets(failed);

      await actions.requeueCard(
        makeCard('TSLA', 'sell', [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)], 'failed'),
      );

      expect(ticketStoreMock.updateTicketAndWait).toHaveBeenCalledTimes(1);
      const [id, patch] = ticketStoreMock.updateTicketAndWait.mock.calls[0];
      expect(id).toBe(failed.id);
      expect(patch.status).toBe(OrderTicketStatus.STAGED);
      expect(patch.refId).toBeTruthy();
      expect(patch.refId).not.toBe('ref-1'); // fresh — the terminal order burned it
      expect(patch.result).toBeUndefined();
      expect(patch.error).toBeUndefined();
      expect(patch.terminalAt).toBeUndefined();
    });

    it('requeue no-ops when the card has no terminal ticket or is not failed', async () => {
      await actions.requeueCard(
        makeCard('TSLA', 'sell', [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)], 'failed'),
      ); // no ticket seeded
      await actions.requeueCard(tslaSell()); // pending card

      expect(ticketStoreMock.updateTicketAndWait).not.toHaveBeenCalled();
    });

    it('a failed card can be rejected — sinks for the session, but the failed ticket stays', () => {
      seedTickets(makeTicket('TSLA', 'sell', OrderTicketStatus.FAILED));

      actions.rejectCard(
        makeCard('TSLA', 'sell', [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)], 'failed'),
      );

      expect(actions.rejectedCards().has('TSLA:sell')).toBe(true);
      expect(ticketStoreMock.removeTicket).not.toHaveBeenCalled(); // only STAGED tickets are removed
    });
  });

  describe('#755 review round 2', () => {
    it('a rejected card cannot trade — Restore returns it to actionable', async () => {
      const signal = makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 });
      actions.rejectCard(makeCard('AAPL', 'buy', [signal]));
      const card = makeCard('AAPL', 'buy', [signal], 'rejected', { allRejected: true });

      expect(await actions.tradeCard(card)).toBeNull();
      await actions.paperCard(card);
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();

      // Reject button reads Restore for this card — clears the session reject.
      actions.rejectCard(card);
      expect(actions.rejectedCards().has('AAPL:buy')).toBe(false);
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
      seedTickets(mine, otherRun);

      actions.rejectCard(makeCard('TSLA', 'sell', [signal]));

      expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(mine.id);
      expect(ticketStoreMock.removeTicket).toHaveBeenCalledTimes(1);
    });

    it('two rapid trade clicks on an existing ticket open one dialog — busy covers the reopen path', async () => {
      const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED);
      seedTickets(staged);

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
      seedTickets(submitted);
      priceServiceMock.prices.set({ TSLA: 25 });

      const result = await actions.tradeCard(tslaSell());

      expect(result).toBeNull();
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('paper bails on the same stale-snapshot guard — no stage, no send', async () => {
      const submitted = makeTicket('TSLA', 'sell', OrderTicketStatus.SUBMITTED);
      seedTickets(submitted);

      await actions.paperCard(tslaSell());

      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      expect(ticketStoreMock.sendTicketToPaper).not.toHaveBeenCalled();
    });

    it('the store\'s eligibility guard surfaces an actionable snackbar, not internal wording', async () => {
      const staged = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED, { quantity: '4' });
      seedTickets(staged);
      ticketStoreMock.sendTicketToPaper.mockRejectedValue(
        new Error('ticket t-TSLA-sell is no longer paper-eligible'),
      );

      await actions.paperCard(tslaSell());

      expect(snackBarMock.open).toHaveBeenCalledWith(
        expect.stringContaining('ticket changed before send'), 'Dismiss', { duration: 5000 },
      );
    });
  });

  describe('#964 option tickets', () => {
    it('trade stages a fresh equity ticket when only a STAGED OPTION ticket exists — the option ticket is not the stock-tab reopen', async () => {
      const card = makeCard('AAPL', 'buy', [
        makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG, { closePrice: 50 }),
      ]);
      seedTickets(makeOptionTicket('AAPL', OrderTicketStatus.STAGED));

      const result = await actions.tradeCard(card);

      expect(result?.created).toBe(true);
      expect(result?.ticket.instrumentType).toBe(InstrumentType.EQUITY);
      expect(ticketStoreMock.stageTicketAndWait).toHaveBeenCalled();
    });

    it('paper ignores a STAGED OPTION ticket — it can never be paper-sent and must not masquerade as the equity ticket', async () => {
      const card = makeCard('TSLA', 'sell', [
        makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT, { closePrice: 40 }),
      ]);
      seedTickets(makeOptionTicket('TSLA', OrderTicketStatus.STAGED, 'SHORT'));

      await actions.paperCard(card);

      // A fresh equity ticket staged + sent, not the option ticket adopted.
      expect(ticketStoreMock.stageTicketAndWait).toHaveBeenCalled();
      expect(ticketStoreMock.sendTicketToPaper).toHaveBeenCalled();
      const sent = ticketStoreMock.sendTicketToPaper.mock.calls[0][0] as OrderTicket;
      expect(sent.instrumentType).toBe(InstrumentType.EQUITY);
    });

    it('reject removes the card\'s STAGED option ticket alongside the equity one', () => {
      const stagedEq = makeTicket('TSLA', 'sell', OrderTicketStatus.STAGED);
      const stagedOpt = makeOptionTicket('TSLA', OrderTicketStatus.STAGED, 'SHORT');
      seedTickets(stagedEq, stagedOpt);

      actions.rejectCard(tslaSell());

      expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(stagedEq.id);
      expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(stagedOpt.id);
    });

    it('exposes the live run id for the option-tab seed', () => {
      expect(actions.activeRunId()).toBe(RUN_ID);
    });
  });
});
