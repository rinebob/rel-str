/**
 * ManualOrderService unit tests (#1177/#1188) — the manual-order entry
 * point: config warmup + bail, equity staging with adopt-before-duplicate,
 * the same-minute doc-id collision guard, and discard-on-close for
 * session-created STAGED tickets. Mirrors the gallery Trade flow minus
 * card/run context.
 */
import { computed, signal, Signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Subject } from 'rxjs';

import { ManualOrderService } from './manual-order.service';
import { OrderTicketStore } from '../stores/order-ticket.store';
import { EquityPriceService } from './equity-price.service';
import { TradingConfigService } from './trading-config.service';
import {
  GalleryTicketDialogData,
  ManualOrderDialogSeed,
} from '../components/gallery-ticket-dialog/gallery-ticket-dialog.component';
import {
  EquityOrderTicket,
  InstrumentType,
  OptionOrderTicket,
  OrderSource,
  OrderTicket,
  OrderTicketStatus,
  TradingConfig,
} from './order-ticket.types';
import { buildTicketId } from '../utils/signal-order-staging.util';
import { stDocId } from './order-ticket-st-mapper';

const CONFIG: TradingConfig = {
  accountNumber: 'acct-1',
  defaultDollarAmount: 250,
  updatedAt: '2026-10-21',
};

function makeManualEquity(
  symbol: string,
  status: OrderTicketStatus = OrderTicketStatus.STAGED,
  extra: Partial<EquityOrderTicket> = {},
): EquityOrderTicket {
  return {
    id: `man-${symbol}`,
    refId: 'ref-1',
    source: OrderSource.MANUAL,
    status,
    accountNumber: 'acct-1',
    side: 'buy',
    orderType: 'market',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.EQUITY,
    symbol,
    quantity: '5',
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
    ...extra,
  };
}

function makeSignalEquity(symbol: string, extra: Partial<EquityOrderTicket> = {}): EquityOrderTicket {
  return {
    ...makeManualEquity(symbol),
    id: `sig-${symbol}`,
    source: OrderSource.SIGNAL_PIPELINE,
    ...extra,
  };
}

function makeManualOption(symbol: string): OptionOrderTicket {
  return {
    id: `opt-${symbol}`,
    refId: 'ref-opt',
    source: OrderSource.MANUAL,
    status: OrderTicketStatus.STAGED,
    accountNumber: 'acct-1',
    side: 'buy',
    orderType: 'limit',
    timeInForce: 'gfd',
    marketHours: 'regular_hours',
    instrumentType: InstrumentType.OPTION,
    symbol,
    legs: [{ side: 'buy', symbol: `${symbol}260116C00200000`, optionId: 'o1', positionEffect: 'open' }],
    quantity: '1',
    createdAt: '2026-10-21T00:00:00Z',
    updatedAt: '2026-10-21T00:00:00Z',
  };
}

describe('ManualOrderService', () => {
  let service: ManualOrderService;
  let snackBarMock: { open: jest.Mock };
  let dialogMock: { open: jest.Mock };
  let afterClosed$: Subject<unknown>;
  let openedData: GalleryTicketDialogData | undefined;
  let ticketStoreMock: {
    ticketsBySymbol: ReturnType<typeof computed<Record<string, OrderTicket[]>>>;
    tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
    stageTicketAndWait: jest.Mock;
    removeTicket: jest.Mock;
    discardIfStaged: jest.Mock;
  };
  let priceServiceMock: {
    prices: ReturnType<typeof signal<Record<string, number>>>;
    fetchPrices: jest.Mock;
  };
  /** What the mocked ensureConfig resolves — null stands in for both
   *  "not configured" and "load failed" (the real service snackbars on
   *  failure itself). */
  let configResult: TradingConfig | null;
  let configServiceMock: {
    config: Signal<TradingConfig | null>;
    ensureConfig: jest.Mock;
    warmConfig: jest.Mock;
  };

  const seedTickets = (...list: OrderTicket[]) => {
    ticketStoreMock.tickets.set(Object.fromEntries(list.map((t) => [t.id, t])));
  };

  const manualSeed = (): ManualOrderDialogSeed => {
    const manual = openedData && 'manual' in openedData ? openedData.manual : undefined;
    if (!manual) throw new Error('dialog was not opened with a manual seed');
    return manual;
  };

  beforeEach(async () => {
    snackBarMock = { open: jest.fn() };
    afterClosed$ = new Subject<unknown>();
    openedData = undefined;
    dialogMock = {
      open: jest.fn((_c: unknown, cfg: { data: GalleryTicketDialogData }) => {
        openedData = cfg.data;
        return { afterClosed: () => afterClosed$.asObservable() };
      }),
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
      // Pessimistic stage: land the ticket like the real store so a later
      // tickets()[id] re-read works.
      stageTicketAndWait: jest.fn(async (t: OrderTicket) => {
        ticketStoreMock.tickets.update((m) => ({ ...m, [t.id]: t }));
        return true;
      }),
      removeTicket: jest.fn((id: string) => {
        ticketStoreMock.tickets.update((m) => {
          const next = { ...m };
          delete next[id];
          return next;
        });
      }),
      // Mirror the store's STAGED-only discard guard, dual-key probe and
      // all — the map is mixed bare/liv_-keyed, same as production.
      discardIfStaged: jest.fn((id: string) => {
        const key = ticketStoreMock.tickets()[id] ? id : stDocId(id);
        if (ticketStoreMock.tickets()[key]?.status === OrderTicketStatus.STAGED) {
          ticketStoreMock.removeTicket(key);
        }
      }),
    };
    priceServiceMock = {
      prices: signal<Record<string, number>>({}),
      fetchPrices: jest.fn().mockResolvedValue(undefined),
    };
    configResult = CONFIG;
    configServiceMock = {
      config: signal<TradingConfig | null>(CONFIG).asReadonly(),
      ensureConfig: jest.fn(async () => configResult),
      warmConfig: jest.fn(),
    };

    await TestBed.configureTestingModule({
      providers: [
        { provide: OrderTicketStore, useValue: ticketStoreMock },
        { provide: EquityPriceService, useValue: priceServiceMock },
        { provide: TradingConfigService, useValue: configServiceMock },
        { provide: MatDialog, useValue: dialogMock },
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    });
    service = TestBed.inject(ManualOrderService);
  });

  describe('open()', () => {
    it('opens the ticket dialog with a manual seed and the live config signal', async () => {
      await service.open();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      const manual = manualSeed();
      expect(typeof manual.stageEquityTicket).toBe('function');
      expect(typeof manual.onStaged).toBe('function');
      expect(openedData?.tradingConfig).toBe(service.config);
    });

    it('bails with a snackbar when no trading config exists', async () => {
      configResult = null;
      await service.open();
      expect(snackBarMock.open).toHaveBeenCalled();
      expect(dialogMock.open).not.toHaveBeenCalled();
    });

    it('is a no-op while a manual dialog is already open', async () => {
      await service.open();
      await service.open();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
      // ...and re-opens after it closes.
      afterClosed$.next(null);
      await service.open();
      expect(dialogMock.open).toHaveBeenCalledTimes(2);
    });

    it('claims the open slot before the config await — overlapping calls share one dialog', async () => {
      // Fire two opens without awaiting the first; the slot must be claimed
      // synchronously or both would pass the guard pre-await.
      const p1 = service.open();
      const p2 = service.open();
      await Promise.all([p1, p2]);
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
    });

    it('releases the open slot when config loading throws', async () => {
      configServiceMock.ensureConfig.mockRejectedValueOnce(new Error('boom'));
      await service.open();
      expect(snackBarMock.open).toHaveBeenCalledWith(
        'Failed to load trading config', 'Dismiss', { duration: 4000 },
      );
      expect(dialogMock.open).not.toHaveBeenCalled();
      // Not wedged — a subsequent open works.
      await service.open();
      expect(dialogMock.open).toHaveBeenCalledTimes(1);
    });

    it('releases the open slot when MatDialog.open throws', async () => {
      dialogMock.open.mockImplementationOnce(() => { throw new Error('no overlay'); });
      await expect(service.open()).rejects.toThrow('no overlay');
      // Slot released — a subsequent open works again (no silent wedge).
      await service.open();
      expect(dialogMock.open).toHaveBeenCalledTimes(2);
    });

    it('discards a ticket whose stage resolves after the dialog closes', async () => {
      await service.open();
      const seed = manualSeed();
      priceServiceMock.prices.set({ AAPL: 100 });
      const stageP = seed.stageEquityTicket('AAPL');
      // Cancel mid-flight — the close pass drains an empty set, then the
      // stage lands. The wrapper must discard it or it silently leaks.
      afterClosed$.next(null);
      const t = await stageP;
      expect(t).not.toBeNull();
      expect(ticketStoreMock.discardIfStaged).toHaveBeenCalledWith(t!.id);
    });
  });

  describe('stageEquityTicket()', () => {
    it('stages a MANUAL buy ticket sized from the quote and config default', async () => {
      priceServiceMock.prices.set({ AAPL: 100 });
      const r = await service.stageEquityTicket('aapl');

      expect(r?.created).toBe(true);
      const staged = ticketStoreMock.stageTicketAndWait.mock.calls[0][0] as EquityOrderTicket;
      expect(staged.source).toBe(OrderSource.MANUAL);
      expect(staged.symbol).toBe('AAPL');
      expect(staged.side).toBe('buy');
      expect(staged.quantity).toBe('3'); // round(250/100) via computePositionSize
      expect(staged.signalContext).toBeUndefined();
    });

    it('fetches the price when the quote cache is cold', async () => {
      priceServiceMock.fetchPrices.mockImplementation(async () => {
        priceServiceMock.prices.set({ TSLA: 50 });
      });
      const r = await service.stageEquityTicket('TSLA');
      expect(priceServiceMock.fetchPrices).toHaveBeenCalledWith(['TSLA']);
      expect(r?.created).toBe(true);
      expect((r!.ticket as EquityOrderTicket).quantity).toBe('5'); // round(250/50)
    });

    it('adopts an existing STAGED MANUAL equity ticket for the symbol', async () => {
      const existing = makeManualEquity('AAPL');
      seedTickets(existing);
      const r = await service.stageEquityTicket('AAPL');
      expect(r?.created).toBe(false);
      expect(r?.ticket.id).toBe(existing.id);
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('adopts a STAGED signal equity ticket — a staged ticket for the symbol is reopened, not duplicated', async () => {
      // #1189 r3: source-agnostic adoption — a signal-staged ticket in
      // the queue must not get a parallel manual duplicate.
      const existing = makeSignalEquity('AAPL');
      seedTickets(existing);
      const r = await service.stageEquityTicket('AAPL');
      expect(r?.created).toBe(false);
      expect(r?.ticket.id).toBe(existing.id);
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('stages fresh when only a manual OPTION ticket exists for the symbol', async () => {
      seedTickets(makeManualOption('AAPL'));
      priceServiceMock.prices.set({ AAPL: 100 });
      const r = await service.stageEquityTicket('AAPL');
      expect(r?.created).toBe(true);
      expect(ticketStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
    });

    it('stages a parallel ticket while a live equity order is in flight for the symbol', async () => {
      // QA #1226 — manual intent governs: adding to a position or running
      // a parallel order is legitimate; a live order must not prevent a
      // new one. Each minted ticket tracks its own broker order.
      seedTickets(makeSignalEquity('AAPL', { status: OrderTicketStatus.SUBMITTED }));
      priceServiceMock.prices.set({ AAPL: 100 });
      const r = await service.stageEquityTicket('AAPL');
      expect(r?.created).toBe(true);
      expect(ticketStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
    });

    it('stages fresh alongside a different symbol\'s STAGED manual ticket', async () => {
      seedTickets(makeManualEquity('MSFT'));
      priceServiceMock.prices.set({ AAPL: 100 });
      const r = await service.stageEquityTicket('AAPL');
      expect(r?.created).toBe(true);
    });

    it('bails instead of overwriting a same-minute ticket that left STAGED', async () => {
      // Freeze time so the spec's twin id and the service's minted id
      // share a minute — otherwise a boundary crossing flakes the check.
      jest.useFakeTimers().setSystemTime(new Date('2026-10-21T14:30:00Z'));
      try {
        // Same {SYM}-BUY-{minute} id the builder will mint — a ticket that
        // advanced past STAGED must NOT be clobbered by the create. Exits
        // via the twin probe (live orders no longer veto staging — the
        // guard is doc-clobber protection, not an order gate).
        const live = makeManualEquity('AAPL', OrderTicketStatus.SUBMITTED, {
          id: buildTicketId('AAPL', 'BUY', new Date()),
        });
        seedTickets(live);
        priceServiceMock.prices.set({ AAPL: 100 });
        const r = await service.stageEquityTicket('AAPL');
        expect(r).toBeNull();
        expect(snackBarMock.open).toHaveBeenCalled();
        expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
        expect(ticketStoreMock.tickets()[live.id]?.status).toBe(OrderTicketStatus.SUBMITTED);
      } finally {
        jest.useRealTimers();
      }
    });

    it('adopts a STAGED signal ticket even when it collides on the same-minute id', async () => {
      // The source-agnostic STAGED probe fires before the twin check —
      // any STAGED equity ticket for the symbol is reopened (#1189 r3).
      jest.useFakeTimers().setSystemTime(new Date('2026-10-21T14:30:00Z'));
      try {
        const twin = makeSignalEquity('AAPL', {
          id: buildTicketId('AAPL', 'BUY', new Date()),
        });
        seedTickets(twin);
        const r = await service.stageEquityTicket('AAPL');
        expect(r?.created).toBe(false);
        expect(r?.ticket.id).toBe(twin.id);
        expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
      } finally {
        jest.useRealTimers();
      }
    });

    it('bails on a hydrated (liv_-prefixed) twin — the map is mixed-keyed', async () => {
      // A ticket staged+submitted before reload hydrates under the liv_
      // doc id, not the bare session id — the guard must probe both
      // spellings or it still overwrites the live doc (#1188 review r2).
      jest.useFakeTimers().setSystemTime(new Date('2026-10-21T14:30:00Z'));
      try {
        const id = `liv_${buildTicketId('AAPL', 'BUY', new Date())}`;
        seedTickets(makeManualEquity('AAPL', OrderTicketStatus.SUBMITTED, { id }));
        priceServiceMock.prices.set({ AAPL: 100 });
        const r = await service.stageEquityTicket('AAPL');
        expect(r).toBeNull();
        expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
        expect(ticketStoreMock.tickets()[id]?.status).toBe(OrderTicketStatus.SUBMITTED);
      } finally {
        jest.useRealTimers();
      }
    });

    it('snackbars and stages nothing when no trading config exists', async () => {
      configResult = null;
      priceServiceMock.prices.set({ AAPL: 100 });
      const r = await service.stageEquityTicket('AAPL');
      expect(r).toBeNull();
      expect(snackBarMock.open).toHaveBeenCalled();
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('snackbars and stages nothing when no price is available', async () => {
      const r = await service.stageEquityTicket('ZZZZ');
      expect(r).toBeNull();
      expect(snackBarMock.open).toHaveBeenCalled();
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('snackbars and stages nothing for a symbol that cannot live in a doc id', async () => {
      priceServiceMock.prices.set({ 'AAPL X': 100 });
      const r = await service.stageEquityTicket('AAPL X');
      expect(r).toBeNull();
      expect(snackBarMock.open).toHaveBeenCalled();
      // Validation runs before the quote path — no fetch burned.
      expect(priceServiceMock.fetchPrices).not.toHaveBeenCalled();
      expect(ticketStoreMock.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('returns null when the pessimistic stage fails', async () => {
      priceServiceMock.prices.set({ AAPL: 100 });
      ticketStoreMock.stageTicketAndWait.mockResolvedValue(false);
      const r = await service.stageEquityTicket('AAPL');
      expect(r).toBeNull();
    });

    it('single-flights a concurrent double resolve for the same symbol', async () => {
      priceServiceMock.prices.set({ AAPL: 100 });
      let release!: () => void;
      ticketStoreMock.stageTicketAndWait.mockImplementation(
        () => new Promise<boolean>((res) => { release = () => res(true); }),
      );
      const p1 = service.stageEquityTicket('AAPL');
      const p2 = service.stageEquityTicket('AAPL');
      // Drain microtasks so p1 reaches the blocked stageTicketAndWait
      // call (release is assigned inside the mock impl).
      await new Promise<void>((r) => setTimeout(r, 0));
      release();
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(ticketStoreMock.stageTicketAndWait).toHaveBeenCalledTimes(1);
      expect(r1?.created).toBe(true);
      expect(r2).toBeNull(); // second resolve single-flighted on the busy key
    });
  });

  describe('discard-on-close', () => {
    it('discards tickets the session created and still has STAGED', async () => {
      await service.open();
      priceServiceMock.prices.set({ AAPL: 100 });
      await manualSeed().stageEquityTicket('AAPL');

      afterClosed$.next(null);
      expect(ticketStoreMock.discardIfStaged).toHaveBeenCalledTimes(1);
      expect(ticketStoreMock.removeTicket).toHaveBeenCalledTimes(1);
    });

    it('does NOT discard an adopted pre-existing ticket', async () => {
      const existing = makeManualEquity('AAPL');
      seedTickets(existing);
      await service.open();
      await manualSeed().stageEquityTicket('AAPL');

      afterClosed$.next(null);
      expect(ticketStoreMock.discardIfStaged).not.toHaveBeenCalled();
    });

    it('does NOT discard a created ticket that left STAGED (submitted)', async () => {
      await service.open();
      priceServiceMock.prices.set({ AAPL: 100 });
      await manualSeed().stageEquityTicket('AAPL');
      // Simulate the ticket advancing to SUBMITTED before close.
      const id = Object.keys(ticketStoreMock.tickets())[0];
      ticketStoreMock.tickets.update((m) => ({
        ...m,
        [id]: { ...m[id], status: OrderTicketStatus.SUBMITTED },
      }));

      afterClosed$.next(null);
      // discardIfStaged is invoked (it owns the STAGED check) but the
      // ticket survives because it is no longer staged.
      expect(ticketStoreMock.removeTicket).not.toHaveBeenCalled();
    });

    it('option-tab onStaged emits also feed the created set', async () => {
      await service.open();
      const manual = manualSeed();
      const opt = makeManualOption('TSLA');
      seedTickets(opt);
      manual.onStaged({ ticketId: opt.id, created: true });
      manual.onStaged({ ticketId: 'other', created: false });

      afterClosed$.next(null);
      expect(ticketStoreMock.discardIfStaged).toHaveBeenCalledTimes(1);
      expect(ticketStoreMock.removeTicket).toHaveBeenCalledWith(opt.id);
    });
  });
});
