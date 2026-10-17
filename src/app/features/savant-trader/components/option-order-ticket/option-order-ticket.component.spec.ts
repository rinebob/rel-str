import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideZonelessChangeDetection, computed, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { OptionOrderTicketComponent } from './option-order-ticket.component';
import { RobinhoodMcpClient } from '../../../../core/robinhood-mcp/robinhood-mcp-client.service';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { PortfolioService, AccountSnapshot } from '../../services/portfolio.service';
import { AllocationStore } from '../../../portfolio-dashboard/allocation.store';
import {
  InstrumentType,
  OptionOrderTicket,
  OrderSource,
  OrderTicket,
  OrderTicketPatch,
  OrderTicketStatus,
  TradingConfig,
} from '../../services/order-ticket.types';
import { StOccurrenceDecision, StSignalItem } from '../../services/types';
import { ReviewDecision, SignalDirection, SignalTimeframe } from '../../common/constants';
import { buildStOccurrenceDecisionId } from '../../services/firestore-helpers';
import { BucketStatus } from '@portfolio-allocation/contracts';
import type { AccountAllocation } from '../../../portfolio-dashboard/allocation.types';
import type { AllocationBucket } from '@portfolio-allocation/contracts';
import type {
  OptionChain,
  OptionInstrument,
  OptionInstrumentFilters,
  OptionQuote,
} from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';

const RUN_ID = 'run-1';
const SYMBOL = 'QQQ';
const EXP = '2026-10-16';
const STRIKE = 500;
const OPT_ID = 'opt-uuid-1';

const config: TradingConfig = {
  accountNumber: 'agentic-account',
  defaultDollarAmount: 100,
  updatedAt: '2026-10-13T12:00:00Z',
};

function sigItem(overrides: Partial<StSignalItem> = {}): StSignalItem {
  return {
    id: '2026-10-10',
    symbol: SYMBOL,
    barDate: '2026-10-10',
    marketDate: '2026-10-13',
    runId: RUN_ID,
    timeframe: SignalTimeframe.DAILY,
    direction: SignalDirection.LONG,
    signalType: 'D_ZONE_V1_UPTICK',
    status: 'pending' as StSignalItem['status'],
    indicators: {},
    closePrice: 480,
    ...overrides,
  };
}

function decisionId(s: StSignalItem): string {
  return buildStOccurrenceDecisionId(RUN_ID, s.symbol, s.timeframe, s.signalType);
}

function rejectDecision(s: StSignalItem): StOccurrenceDecision {
  return {
    id: decisionId(s),
    runId: RUN_ID,
    marketDate: s.marketDate,
    symbol: s.symbol,
    timeframe: s.timeframe,
    direction: s.direction,
    signalType: s.signalType,
    barDate: s.barDate,
    decisionType: ReviewDecision.REJECT,
    decidedAt: '2026-10-13T12:00:00Z',
    isCurrentInLatestRun: true,
  };
}

function chains(): OptionChain[] {
  return [
    { chainId: 'chain-1', symbol: SYMBOL, expirationDates: [EXP, '2026-11-20'] },
  ];
}

function instrument(overrides: Partial<OptionInstrument> = {}): OptionInstrument {
  return {
    instrumentId: OPT_ID,
    chainId: 'chain-1',
    chainSymbol: SYMBOL,
    expirationDate: EXP,
    strikePrice: STRIKE,
    type: 'call',
    ...overrides,
  };
}

function snapshot(cash: number): AccountSnapshot {
  return { accountValue: 10000, exposure: 5000, cash, positionCount: 1, units: 5, positions: [] };
}

describe('OptionOrderTicketComponent', () => {
  let fixture: ComponentFixture<OptionOrderTicketComponent>;
  let component: OptionOrderTicketComponent;

  let mcp: {
    getOptionChains: jest.Mock<Promise<OptionChain[]>, [string]>;
    getOptionInstruments: jest.Mock<Promise<OptionInstrument[]>, [OptionInstrumentFilters]>;
    getOptionQuotes: jest.Mock<Promise<Map<string, OptionQuote>>, [string[]]>;
  };
  let tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
  let ticketsBySymbol: ReturnType<typeof computed<Record<string, OrderTicket[]>>>;
  let store: {
    tickets: typeof tickets;
    ticketsBySymbol: typeof ticketsBySymbol;
    stageTicketAndWait: jest.Mock<Promise<boolean>, [OrderTicket]>;
    updateTicket: jest.Mock<void, [string, OrderTicketPatch]>;
    submitTicket: jest.Mock<void, [string]>;
  };
  let portfolio: { getSnapshot: jest.Mock<Promise<AccountSnapshot | null>, [string, number]> };
  let dialog: { open: jest.Mock };
  let snackBar: { open: jest.Mock };
  let allocStore: {
    byAccount: ReturnType<typeof signal<Record<string, AccountAllocation>>>;
    ensureAccount: jest.Mock;
  };
  let stagedEvents: Array<{ ticketId: string; created: boolean }>;

  const flush = () => new Promise<void>((r) => setTimeout(r, 0));

  async function render(opts: {
    signals?: StSignalItem[];
    decisions?: Record<string, StOccurrenceDecision>;
    tradingConfig?: TradingConfig | null;
  } = {}): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OptionOrderTicketComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: RobinhoodMcpClient, useValue: mcp },
        { provide: OrderTicketStore, useValue: store },
        { provide: PortfolioService, useValue: portfolio },
        { provide: AllocationStore, useValue: allocStore },
        { provide: MatDialog, useValue: dialog },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OptionOrderTicketComponent);
    component = fixture.componentInstance;
    stagedEvents = [];
    component.staged.subscribe((e) => stagedEvents.push(e));
    fixture.componentRef.setInput('symbol', SYMBOL);
    fixture.componentRef.setInput('runId', RUN_ID);
    fixture.componentRef.setInput('signals', opts.signals ?? [sigItem()]);
    fixture.componentRef.setInput('tradingConfig', opts.tradingConfig === undefined ? config : opts.tradingConfig);
    fixture.componentRef.setInput('decisions', opts.decisions ?? {});
    fixture.detectChanges();
    await flush();
  }

  /** Drive the full select path: expiration → strike → resolved + staged. */
  async function resolveViaSelects(
    exp = EXP,
    strike = STRIKE,
    type: 'call' | 'put' = 'call',
  ): Promise<void> {
    component.selectedExpiration.set(exp);
    fixture.detectChanges();
    await flush();
    component.selectedStrike.set(strike);
    component.contractType.set(type);
    fixture.detectChanges();
    await flush();
  }

  beforeEach(() => {
    tickets = signal<Record<string, OrderTicket>>({});
    mcp = {
      getOptionChains: jest.fn(async (_s: string) => chains()),
      getOptionInstruments: jest.fn(async (_f: OptionInstrumentFilters) => [instrument()]),
      getOptionQuotes: jest.fn(async (ids: string[]) =>
        new Map(ids.map((id) => [id, { instrumentId: id, lastTradePrice: 3.5, previousClose: 3.2 }])),
      ),
    };
    // Derived exactly like the real store — specs write to `tickets`
    // only, so the two views can never disagree (#964 review).
    ticketsBySymbol = computed(() => {
      const grouped: Record<string, OrderTicket[]> = {};
      for (const t of Object.values(tickets())) {
        (grouped[t.symbol] ??= []).push(t);
      }
      return grouped;
    });
    store = {
      tickets,
      ticketsBySymbol,
      stageTicketAndWait: jest.fn(async (t: OrderTicket) => {
        tickets.update((m) => ({ ...m, [t.id]: t }));
        return true;
      }),
      updateTicket: jest.fn((id: string, partial: OrderTicketPatch) => {
        // Mirror mergeTicketPartial — undefined deletes the key, matching
        // the service's deleteField() semantics.
        tickets.update((m) => {
          if (!m[id]) return m;
          const merged = { ...m[id] } as Record<string, unknown>;
          for (const [k, v] of Object.entries(partial)) {
            if (v === undefined) delete merged[k];
            else merged[k] = v;
          }
          return { ...m, [id]: merged as unknown as OrderTicket };
        });
      }),
      submitTicket: jest.fn(),
    };
    portfolio = { getSnapshot: jest.fn(async (_a: string, _d: number) => snapshot(10000)) };
    dialog = { open: jest.fn(() => ({ afterClosed: () => of(true) })) };
    snackBar = { open: jest.fn() };
    allocStore = {
      byAccount: signal<Record<string, AccountAllocation>>({}),
      ensureAccount: jest.fn(async () => undefined),
    };
  });

  describe('chain + instrument loading', () => {
    it('loads expirations on init', async () => {
      await render();
      expect(mcp.getOptionChains).toHaveBeenCalledWith(SYMBOL);
      expect(component.expirations()).toEqual([EXP, '2026-11-20']);
    });

    it('disables the strike select until an expiration is picked', async () => {
      await render();
      fixture.detectChanges();
      const select = fixture.nativeElement.querySelector('[data-testid="strike-select"]');
      expect(select.disabled).toBe(true);
    });

    it('enables the strike select once an expiration is picked', async () => {
      await render();
      component.selectedExpiration.set(EXP);
      fixture.detectChanges();
      await flush();
      fixture.detectChanges();
      const select = fixture.nativeElement.querySelector('[data-testid="strike-select"]');
      expect(select.disabled).toBe(false);
    });

    it('populates strikes after an expiration pick', async () => {
      mcp.getOptionInstruments.mockResolvedValue([
        instrument({ strikePrice: 500, type: 'call' }),
        instrument({ strikePrice: 500, type: 'put', instrumentId: 'opt-uuid-2' }),
        instrument({ strikePrice: 505, type: 'call', instrumentId: 'opt-uuid-3' }),
      ]);
      await render();
      component.selectedExpiration.set(EXP);
      fixture.detectChanges();
      await flush();

      expect(component.strikes()).toEqual([500, 505]);
    });

    it('narrows the strike list to the selected contract type', async () => {
      mcp.getOptionInstruments.mockResolvedValue([
        instrument({ strikePrice: 500, type: 'call' }),
        instrument({ strikePrice: 495, type: 'put', instrumentId: 'opt-uuid-2' }),
      ]);
      await render();
      component.selectedExpiration.set(EXP);
      fixture.detectChanges();
      await flush();

      expect(component.strikes()).toEqual([500]);
      component.contractType.set('put');
      fixture.detectChanges();
      expect(component.strikes()).toEqual([495]);
    });

    it('shows an inline chain error with retry', async () => {
      mcp.getOptionChains.mockRejectedValueOnce(new Error('boom'));
      await render();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="chains-error"]')).toBeTruthy();

      mcp.getOptionChains.mockResolvedValue(chains());
      component.retryChains();
      await flush();
      fixture.detectChanges();
      expect(component.expirations()).toEqual([EXP, '2026-11-20']);
      expect(fixture.nativeElement.querySelector('[data-testid="chains-error"]')).toBeFalsy();
    });
  });

  describe('contract resolution + staging', () => {
    it('resolves selects → quote → stages the ticket once', async () => {
      await render();
      await resolveViaSelects();

      // Narrow instrument fetch carries the full triplet.
      const narrow = mcp.getOptionInstruments.mock.calls.find(
        ([arg]) => (arg as { strikePrice?: number }).strikePrice === STRIKE,
      );
      expect(narrow?.[0]).toEqual({
        chainSymbol: SYMBOL,
        expirationDates: [EXP],
        strikePrice: STRIKE,
        type: 'call',
      });
      expect(mcp.getOptionQuotes).toHaveBeenCalledWith([OPT_ID]);

      expect(store.stageTicketAndWait).toHaveBeenCalledTimes(1);
      const stagedTicket = store.stageTicketAndWait.mock.calls[0][0] as OptionOrderTicket;
      expect(stagedTicket.instrumentType).toBe(InstrumentType.OPTION);
      expect(stagedTicket.symbol).toBe(SYMBOL);
      expect(stagedTicket.legs).toEqual([
        { side: 'buy', symbol: 'QQQ261016C00500000', optionId: OPT_ID, positionEffect: 'open' },
      ]);
      expect(stagedTicket.signalContext?.decisionIds).toEqual([decisionId(sigItem())]);
      expect(component.ticket()?.id).toBe(stagedTicket.id);
      expect(stagedEvents).toEqual([{ ticketId: stagedTicket.id, created: true }]);
    });

    it('re-legs the same ticket on contract change — refId preserved, no second stage', async () => {
      await render();
      await resolveViaSelects();
      const first = component.ticket()!;
      const refId = first.refId;

      mcp.getOptionInstruments.mockResolvedValue([instrument({ strikePrice: 505, instrumentId: 'opt-uuid-9' })]);
      await resolveViaSelects(EXP, 505, 'call');

      expect(store.stageTicketAndWait).toHaveBeenCalledTimes(1);
      expect(store.updateTicket).toHaveBeenCalledWith(
        first.id,
        expect.objectContaining({
          legs: [{ side: 'buy', symbol: 'QQQ261016C00505000', optionId: 'opt-uuid-9', positionEffect: 'open' }],
        }),
      );
      expect(component.ticket()?.refId).toBe(refId);
      expect(stagedEvents).toHaveLength(1);
    });

    it('surfaces an unresolved error when the contract is not tradable', async () => {
      await render();
      mcp.getOptionInstruments.mockResolvedValue([]);
      await resolveViaSelects();

      expect(component.resolveError()).toBeTruthy();
      expect(component.resolvedContract()).toBeNull();
      expect(store.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('still stages when the quote fetch fails (mark null)', async () => {
      mcp.getOptionQuotes.mockRejectedValue(new Error('no quote'));
      await render();
      await resolveViaSelects();

      expect(store.stageTicketAndWait).toHaveBeenCalledTimes(1);
      expect(component.resolvedContract()?.mark).toBeNull();
    });

    it('defaults the limit price to the resolved mark', async () => {
      await render();
      await resolveViaSelects();
      expect(component.limitPrice()).toBe('3.50');
    });

    it('re-fills an auto-filled price when the contract changes', async () => {
      await render();
      await resolveViaSelects();
      expect(component.limitPrice()).toBe('3.50');

      mcp.getOptionInstruments.mockResolvedValue([
        instrument({ strikePrice: 505, instrumentId: 'opt-uuid-9' }),
      ]);
      mcp.getOptionQuotes.mockResolvedValue(
        new Map([['opt-uuid-9', { instrumentId: 'opt-uuid-9', lastTradePrice: 4.25, previousClose: 4 }]]),
      );
      await resolveViaSelects(EXP, 505, 'call');

      expect(component.limitPrice()).toBe('4.25');
    });

    it('keeps a user-typed price across a contract change', async () => {
      await render();
      await resolveViaSelects();
      component.onLimitPriceInput({ target: { value: '9.99' } } as unknown as Event);

      mcp.getOptionInstruments.mockResolvedValue([
        instrument({ strikePrice: 505, instrumentId: 'opt-uuid-9' }),
      ]);
      mcp.getOptionQuotes.mockResolvedValue(
        new Map([['opt-uuid-9', { instrumentId: 'opt-uuid-9', lastTradePrice: 4.25, previousClose: 4 }]]),
      );
      await resolveViaSelects(EXP, 505, 'call');

      expect(component.limitPrice()).toBe('9.99');
    });

    it('clears a stale auto-fill when the new contract has no quote', async () => {
      await render();
      await resolveViaSelects();
      expect(component.limitPrice()).toBe('3.50');

      mcp.getOptionInstruments.mockResolvedValue([
        instrument({ strikePrice: 505, instrumentId: 'opt-uuid-9' }),
      ]);
      mcp.getOptionQuotes.mockRejectedValue(new Error('no quote'));
      await resolveViaSelects(EXP, 505, 'call');

      expect(component.limitPrice()).toBe('');
    });

    it('clears an auto-filled price when the triplet goes incomplete', async () => {
      await render();
      await resolveViaSelects();
      expect(component.limitPrice()).toBe('3.50');

      component.selectedStrike.set(null);
      fixture.detectChanges();
      await flush();

      expect(component.limitPrice()).toBe('');
    });

    it('a late quote for a superseded contract does not fill the price', async () => {
      let release!: (q: Map<string, OptionQuote>) => void;
      const deferred = new Promise<Map<string, OptionQuote>>((r) => (release = r));
      await render();
      mcp.getOptionQuotes.mockReturnValue(deferred);

      component.selectedExpiration.set(EXP);
      fixture.detectChanges();
      await flush();
      component.selectedStrike.set(STRIKE);
      component.contractType.set('call');
      fixture.detectChanges();
      await flush();

      // Contract change while the first quote is still in flight.
      mcp.getOptionInstruments.mockResolvedValue([
        instrument({ strikePrice: 505, instrumentId: 'opt-uuid-9' }),
      ]);
      mcp.getOptionQuotes.mockResolvedValue(
        new Map([['opt-uuid-9', { instrumentId: 'opt-uuid-9', lastTradePrice: 4.25, previousClose: 4 }]]),
      );
      component.selectedStrike.set(505);
      fixture.detectChanges();
      await flush();

      // The stale quote now lands — the seq guard must drop it.
      release(
        new Map([[OPT_ID, { instrumentId: OPT_ID, lastTradePrice: 3.5, previousClose: 3.2 }]]),
      );
      await flush();

      expect(component.resolvedContract()?.optionId).toBe('opt-uuid-9');
      expect(component.limitPrice()).toBe('4.25');
    });
  });

  describe('contract identity block', () => {
    const text = (testid: string) =>
      (fixture.nativeElement as HTMLElement)
        .querySelector(`[data-testid="${testid}"]`)
        ?.textContent?.trim();

    it('builds the summary line live from the selects — placeholders until picked', async () => {
      await render();
      expect(text('contract-line')).toBe('— QQQ — CALL');

      component.selectedExpiration.set(EXP);
      fixture.detectChanges();
      expect(text('contract-line')).toBe(`${EXP} QQQ — CALL`);

      component.selectedStrike.set(STRIKE);
      component.contractType.set('put');
      fixture.detectChanges();
      expect(text('contract-line')).toBe(`${EXP} QQQ 500 PUT`);
    });

    it('shows the OCC id once the triplet is complete — before resolution lands', async () => {
      await render();
      expect(fixture.nativeElement.querySelector('[data-testid="occ-id"]')).toBeNull();

      component.selectedExpiration.set(EXP);
      component.selectedStrike.set(STRIKE);
      fixture.detectChanges();
      await flush();

      expect(text('occ-id')).toBe('OCC QQQ261016C00500000');
    });

    it('shows the RH instrument id and quote line after resolution', async () => {
      mcp.getOptionQuotes.mockResolvedValue(
        new Map([[OPT_ID, {
          instrumentId: OPT_ID,
          lastTradePrice: 3.5,
          previousClose: 3.2,
          bidPrice: 3.4,
          askPrice: 3.6,
        }]]),
      );
      await render();
      await resolveViaSelects();
      fixture.detectChanges();

      expect(text('rh-id')).toBe(`RH ${OPT_ID}`);
      const quote = text('contract-quote');
      expect(quote).toContain('Mark $3.50');
      expect(quote).toContain('Bid $3.40');
      expect(quote).toContain('Ask $3.60');
      expect(quote).toContain('Prev $3.20');
    });

    it('keeps the RH id but drops the quote line when the quote fetch fails', async () => {
      mcp.getOptionQuotes.mockRejectedValue(new Error('no quote'));
      await render();
      await resolveViaSelects();
      fixture.detectChanges();

      expect(text('rh-id')).toBe(`RH ${OPT_ID}`);
      expect(fixture.nativeElement.querySelector('[data-testid="contract-quote"]')).toBeNull();
    });
  });

  describe('paste path', () => {
    it('converges on the same resolution as the selects', async () => {
      await render();
      component.pasteText.set('QQQ   261016C00500000');
      component.onImportPaste();
      fixture.detectChanges();
      await flush();
      await flush();

      expect(component.pasteError()).toBeNull();
      expect(component.selectedExpiration()).toBe(EXP);
      expect(component.selectedStrike()).toBe(STRIKE);
      expect(store.stageTicketAndWait).toHaveBeenCalledTimes(1);
      const stagedTicket = store.stageTicketAndWait.mock.calls[0][0] as OptionOrderTicket;
      expect(stagedTicket.legs[0].optionId).toBe(OPT_ID);
    });

    it('rejects garbage with an inline error', async () => {
      await render();
      component.pasteText.set('not-a-contract');
      component.onImportPaste();
      fixture.detectChanges();

      expect(component.pasteError()).toBe('Not a valid OCC contract id');
      expect(mcp.getOptionInstruments).not.toHaveBeenCalled();
    });

    it('rejects a contract for a different underlying', async () => {
      await render();
      component.pasteText.set('AAPL   261016C00500000');
      component.onImportPaste();
      fixture.detectChanges();

      expect(component.pasteError()).toContain('AAPL');
      expect(component.pasteError()).toContain(SYMBOL);
    });
  });

  describe('staging guard', () => {
    function existingOptionTicket(status: OrderTicketStatus): OptionOrderTicket {
      return {
        id: 'existing-opt',
        refId: 'ref-existing',
        source: OrderSource.SIGNAL_PIPELINE,
        status,
        accountNumber: 'agentic-account',
        side: 'buy',
        orderType: 'limit',
        timeInForce: 'gfd',
        marketHours: 'regular_hours',
        instrumentType: InstrumentType.OPTION,
        symbol: SYMBOL,
        legs: [{ side: 'buy', symbol: 'QQQ261016C00480000', optionId: 'opt-old', positionEffect: 'open' }],
        quantity: '1',
        signalContext: {
          signalType: 'D_ZONE_V1_UPTICK',
          barDate: '2026-10-10',
          timeframe: SignalTimeframe.DAILY,
          direction: 'LONG',
          decisionId: decisionId(sigItem()),
          decisionIds: [decisionId(sigItem())],
        },
        createdAt: '2026-10-13T12:00:00Z',
        updatedAt: '2026-10-13T12:00:00Z',
      };
    }

    it('adopts a STAGED card ticket — binds, re-legs, no new stage', async () => {
      const existing = existingOptionTicket(OrderTicketStatus.STAGED);
      tickets.set({ [existing.id]: existing });

      await render();
      await resolveViaSelects();

      expect(store.stageTicketAndWait).not.toHaveBeenCalled();
      expect(component.ticket()?.id).toBe('existing-opt');
      expect(store.updateTicket).toHaveBeenCalledWith(
        'existing-opt',
        expect.objectContaining({ legs: [expect.objectContaining({ optionId: OPT_ID })] }),
      );
      expect(stagedEvents).toEqual([{ ticketId: 'existing-opt', created: false }]);
    });

    it('blocks staging when the card already has a live option ticket', async () => {
      const live = existingOptionTicket(OrderTicketStatus.SUBMITTED);
      tickets.set({ [live.id]: live });

      await render();
      await resolveViaSelects();

      expect(store.stageTicketAndWait).not.toHaveBeenCalled();
      expect(component.ticketId()).toBeNull();
      expect(snackBar.open).toHaveBeenCalledWith(
        expect.stringContaining('live option order'),
        'Dismiss',
        expect.anything(),
      );
      // The reason also persists inline — the snackbar is transient.
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="stage-error"]')?.textContent)
        .toContain('live option order');
      expect(component.canSubmit()).toBe(false);
    });

    it('adopting clears a stale submit error from the STAGED ticket', async () => {
      const existing = {
        ...existingOptionTicket(OrderTicketStatus.STAGED),
        error: { message: 'broker rejected', retryable: true },
      };
      tickets.set({ [existing.id]: existing });

      await render();
      await resolveViaSelects();

      // objectContaining({error: undefined}) also passes when the key is
      // absent — assert the key is present to prove the patch clears it.
      const patch = store.updateTicket.mock.calls[0][1] as Record<string, unknown>;
      expect('error' in patch).toBe(true);
      expect(patch.error).toBeUndefined();
    });

    it('serializes concurrent resolutions — one stage, winner re-legs', async () => {
      let releaseStage!: () => void;
      store.stageTicketAndWait.mockImplementationOnce(
        (t: OrderTicket) =>
          new Promise<boolean>((res) => {
            releaseStage = () => {
              tickets.update((m) => ({ ...m, [t.id]: t }));
              res(true);
            };
          }),
      );
      mcp.getOptionInstruments.mockImplementation(async (filters: OptionInstrumentFilters) => {
        if (filters.strikePrice === 505) return [instrument({ strikePrice: 505, instrumentId: 'opt-uuid-9' })];
        return [instrument()];
      });

      await render();
      component.selectedExpiration.set(EXP);
      fixture.detectChanges();
      await flush();
      component.selectedStrike.set(STRIKE);
      fixture.detectChanges();
      await flush(); // resolution 1 is now inside stageTicketAndWait (held)

      // Resolution 2 while the first stage is in flight — must not double-stage.
      component.selectedStrike.set(505);
      fixture.detectChanges();
      await flush();
      releaseStage();
      await flush();
      await flush();

      expect(store.stageTicketAndWait).toHaveBeenCalledTimes(1);
      const bound = component.ticket();
      expect(bound).toBeTruthy();
      // The lock released the second resolution into the adopt path —
      // A's frame was stale at stage-land so its emit was suppressed;
      // B's adopt re-legs and still reports created:true (the ticket was
      // created by this session — the host must discard it on close).
      expect(store.updateTicket).toHaveBeenCalledWith(
        bound!.id,
        expect.objectContaining({ legs: [expect.objectContaining({ optionId: 'opt-uuid-9' })] }),
      );
      // Two emits for the same id: the stale stage frame reports its
      // created ticket for discard tracking, then the winner's adopt
      // reports it again — the host dedupes by id (#964 review).
      expect(stagedEvents).toEqual([
        { ticketId: bound!.id, created: true },
        { ticketId: bound!.id, created: true },
      ]);
    });

    it('ignores terminal tickets — a FAILED card ticket does not block staging', async () => {
      const dead = existingOptionTicket(OrderTicketStatus.FAILED);
      tickets.set({ [dead.id]: dead });

      await render();
      await resolveViaSelects();
      expect(store.stageTicketAndWait).toHaveBeenCalledTimes(1);
    });

    it('blocks staging when every occurrence is REJECTed — reason persists inline', async () => {
      const rejected = sigItem();
      await render({
        signals: [rejected],
        decisions: { [decisionId(rejected)]: rejectDecision(rejected) },
      });
      await resolveViaSelects();

      expect(store.stageTicketAndWait).not.toHaveBeenCalled();
      expect(component.ticketId()).toBeNull();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="stage-error"]')?.textContent)
        .toContain('rejected');
      expect(component.canSubmit()).toBe(false);
    });

    it('retries staging when the REJECT is lifted while the block is showing', async () => {
      const rejected = sigItem();
      await render({
        signals: [rejected],
        decisions: { [decisionId(rejected)]: rejectDecision(rejected) },
      });
      await resolveViaSelects();
      expect(store.stageTicketAndWait).not.toHaveBeenCalled();
      expect(component.stageError()).toContain('rejected');

      // Un-reject — the retry effect re-runs the guard and stages.
      fixture.componentRef.setInput('decisions', {});
      fixture.detectChanges();
      await flush();
      await flush();

      expect(store.stageTicketAndWait).toHaveBeenCalledTimes(1);
      expect(component.stageError()).toBeNull();
    });

    it('clears a stale stage error when the triplet goes incomplete', async () => {
      const live = existingOptionTicket(OrderTicketStatus.SUBMITTED);
      tickets.set({ [live.id]: live });
      await render();
      await resolveViaSelects();
      expect(component.stageError()).toBeTruthy();

      component.selectedStrike.set(null);
      fixture.detectChanges();

      expect(component.stageError()).toBeNull();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="stage-error"]')).toBeFalsy();
    });

    it('hydrates the bucket pick from an adopted ticket', async () => {
      const existing = { ...existingOptionTicket(OrderTicketStatus.STAGED), bucketId: 'bucket-9' };
      tickets.set({ [existing.id]: existing });

      await render();
      await resolveViaSelects();

      expect(component.selectedBucketId()).toBe('bucket-9');
    });

    it('filters REJECTed occurrences out of decisionIds before building', async () => {
      const accepted = sigItem();
      const rejected = sigItem({ signalType: 'D_ZONE_V1_PULLBACK', id: '2026-10-09', barDate: '2026-10-09' });
      const decisions = { [decisionId(rejected)]: rejectDecision(rejected) };

      await render({ signals: [accepted, rejected], decisions });
      await resolveViaSelects();

      const stagedTicket = store.stageTicketAndWait.mock.calls[0][0] as OptionOrderTicket;
      expect(stagedTicket.signalContext?.decisionIds).toEqual([decisionId(accepted)]);
      expect(stagedTicket.signalContext?.decisionIds).not.toContain(decisionId(rejected));
    });
  });

  describe('submit gating', () => {
    it('stays disabled until a contract resolves', async () => {
      await render();
      component.quantity.set('2');
      component.limitPrice.set('3.50');
      fixture.detectChanges();
      expect(component.canSubmit()).toBe(false);
    });

    it('requires a positive integer quantity', async () => {
      await render();
      await resolveViaSelects();
      component.quantity.set('');
      fixture.detectChanges();
      expect(component.canSubmit()).toBe(false);

      component.quantity.set('abc');
      fixture.detectChanges();
      expect(component.canSubmit()).toBe(false);
    });

    it('defaults quantity to 1 — a resolved contract with a mark submits with no qty click', async () => {
      await render();
      await resolveViaSelects(); // mark 3.50 auto-fills limit price; qty default '1'
      fixture.detectChanges();
      expect(component.quantity()).toBe('1');
      expect(component.canSubmit()).toBe(true);
    });

    it('requires a limit price on limit orders', async () => {
      await render();
      await resolveViaSelects();
      component.quantity.set('2');
      component.limitPrice.set('');
      fixture.detectChanges();
      expect(component.canSubmit()).toBe(false);
    });

    it('allows a market order without a price and forces gfd', async () => {
      await render();
      await resolveViaSelects();
      component.setOrderType('market');
      component.timeInForce.set('gtc'); // user can't pin gtc on market
      component.quantity.set('2');
      fixture.detectChanges();

      expect(component.effectiveTimeInForce()).toBe('gfd');
      expect(component.canSubmit()).toBe(true);
    });

    it('blocks when the premium exceeds the cash cap', async () => {
      portfolio.getSnapshot.mockResolvedValue(snapshot(1000)); // cap: 25% → 250
      await render();
      await resolveViaSelects();
      component.quantity.set('2'); // 2 × 3.50 × 100 = 700 > 250
      component.limitPrice.set('3.50');
      fixture.detectChanges();

      expect(component.fatfingerExceeded()).toBe(true);
      expect(component.canSubmit()).toBe(false);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="fatfinger-block"]')).toBeTruthy();
    });

    it('passes when the premium is within the cap', async () => {
      portfolio.getSnapshot.mockResolvedValue(snapshot(10000)); // cap: 2500
      await render();
      await resolveViaSelects();
      component.quantity.set('2'); // 700 ≤ 2500
      component.limitPrice.set('3.50');
      fixture.detectChanges();
      expect(component.canSubmit()).toBe(true);
    });

    it('disables submit while a re-resolution is in flight', async () => {
      await render();
      await resolveViaSelects();
      component.quantity.set('2');
      component.limitPrice.set('3.50');
      fixture.detectChanges();
      expect(component.canSubmit()).toBe(true);

      // A contract change kicks off resolution B — until it lands, the
      // on-screen contract (A) is stale and submit must stay off so the
      // confirm dialog can't be opened for a leg about to be replaced.
      let releaseB!: (v: OptionInstrument[]) => void;
      mcp.getOptionInstruments.mockImplementation((f: OptionInstrumentFilters) =>
        f.strikePrice === 505
          ? new Promise<OptionInstrument[]>((r) => { releaseB = r; })
          : Promise.resolve([instrument()]),
      );
      component.selectedStrike.set(505);
      fixture.detectChanges();
      await flush();

      expect(component.resolving()).toBe(true);
      expect(component.canSubmit()).toBe(false);

      releaseB([instrument({ strikePrice: 505, instrumentId: 'opt-uuid-9' })]);
      await flush();
      await flush();
      fixture.detectChanges();
      expect(component.resolving()).toBe(false);
      expect(component.canSubmit()).toBe(true);
    });

    it('clears the resolved contract when the triplet goes incomplete', async () => {
      await render();
      await resolveViaSelects();
      expect(component.resolvedContract()).not.toBeNull();

      component.selectedStrike.set(null);
      fixture.detectChanges();

      expect(component.resolvedContract()).toBeNull();
      expect(component.canSubmit()).toBe(false);
    });



    it('abandons a lock-waiting resolution once the triplet clears', async () => {
      let releaseStage!: () => void;
      store.stageTicketAndWait.mockImplementationOnce(
        (t: OrderTicket) =>
          new Promise<boolean>((res) => {
            releaseStage = () => {
              tickets.update((m) => ({ ...m, [t.id]: t }));
              res(true);
            };
          }),
      );
      await render();
      component.selectedExpiration.set(EXP);
      fixture.detectChanges();
      await flush();
      component.selectedStrike.set(STRIKE);
      fixture.detectChanges();
      await flush(); // A staged and bound? no — A is inside stageTicketAndWait (held)

      // Strike change → resolution B parks on the staging lock.
      component.selectedStrike.set(505);
      fixture.detectChanges();
      await flush();

      // Deselect before A's stage completes — B is now stale and must
      // not re-leg A's ticket when the lock releases.
      component.selectedStrike.set(null);
      fixture.detectChanges();
      releaseStage();
      await flush();
      await flush();

      expect(store.stageTicketAndWait).toHaveBeenCalledTimes(1);
      expect(store.updateTicket).not.toHaveBeenCalled();
      // A's stage committed before the deselect — the ticket stays
      // unbound (no ghost bind), but the emit still fires: the host's
      // discard-on-close needs the id or the STAGED doc orphans (#964).
      expect(component.ticketId()).toBeNull();
      expect(stagedEvents).toEqual([
        { ticketId: expect.any(String) as string, created: true },
      ]);
    });

    it('does not land a ghost contract when the triplet clears mid-resolution', async () => {
      let releaseInstr!: (v: OptionInstrument[]) => void;
      mcp.getOptionInstruments.mockImplementation((f: OptionInstrumentFilters) =>
        f.strikePrice != null
          ? new Promise<OptionInstrument[]>((r) => { releaseInstr = r; })
          : Promise.resolve([instrument()]),
      );
      await render();
      component.selectedExpiration.set(EXP);
      fixture.detectChanges();
      await flush();
      component.selectedStrike.set(STRIKE);
      fixture.detectChanges();
      await flush(); // narrow resolution in flight (held)

      component.selectedStrike.set(null);
      fixture.detectChanges();
      expect(component.resolvedContract()).toBeNull();

      // The stale completion must not resurrect the contract or stage.
      releaseInstr([instrument()]);
      await flush();
      await flush();

      expect(component.resolvedContract()).toBeNull();
      expect(component.resolving()).toBe(false);
      expect(store.stageTicketAndWait).not.toHaveBeenCalled();
    });

    it('hides the limit-price row on market orders', async () => {
      await render();
      await resolveViaSelects();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="limit-price-input"]')).toBeTruthy();

      component.setOrderType('market');
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('[data-testid="limit-price-input"]')).toBeFalsy();
    });
  });

  describe('submit', () => {
    async function stageAndFill(): Promise<OptionOrderTicket> {
      await resolveViaSelects();
      component.quantity.set('2');
      component.limitPrice.set('3.50');
      component.selectedBucketId.set('bucket-1');
      fixture.detectChanges();
      return component.ticket()!;
    }

    it('persists the form fields, confirms, then submits the stored ticket', async () => {
      await render();
      const t = await stageAndFill();
      await component.onSubmit();
      await flush();

      expect(store.updateTicket).toHaveBeenCalledWith(
        t.id,
        expect.objectContaining({
          quantity: '2',
          price: '3.50',
          orderType: 'limit',
          timeInForce: 'gfd',
          bucketId: 'bucket-1',
        }),
      );
      expect(dialog.open).toHaveBeenCalled();
      const dialogData = dialog.open.mock.calls[0][1].data;
      expect(dialogData.ticket.quantity).toBe('2');
      expect(dialogData.ticket.price).toBe('3.50');
      expect(store.submitTicket).toHaveBeenCalledWith(t.id);
    });

    it('does not submit when the confirm dialog is cancelled', async () => {
      dialog.open.mockReturnValue({ afterClosed: () => of(false) });
      await render();
      await stageAndFill();
      await component.onSubmit();
      await flush();
      expect(store.submitTicket).not.toHaveBeenCalled();
    });

    it('does not submit when the stored legs changed under the confirm dialog', async () => {
      await render();
      const t = await stageAndFill();
      // Simulate a late write re-legging the ticket while the dialog is
      // open — the confirmed snapshot must not ship a different contract.
      dialog.open.mockImplementation(() => {
        const current = tickets()[t.id] as OptionOrderTicket;
        tickets.update((m) => ({
          ...m,
          [t.id]: {
            ...current,
            legs: [{ side: 'buy', symbol: 'QQQ261016C00505000', optionId: 'opt-other', positionEffect: 'open' }],
          },
        }));
        return { afterClosed: () => of(true) };
      });

      await component.onSubmit();
      await flush();

      expect(store.submitTicket).not.toHaveBeenCalled();
      expect(snackBar.open).toHaveBeenCalledWith(
        expect.stringContaining('re-confirm'),
        'Dismiss',
        expect.anything(),
      );
    });

    it('omits price and pins gfd on market orders', async () => {
      await render();
      const t = await stageAndFill();
      component.setOrderType('market');
      fixture.detectChanges();
      await component.onSubmit();
      await flush();

      const partial = store.updateTicket.mock.calls.at(-1)![1] as Partial<OptionOrderTicket>;
      expect(partial.orderType).toBe('market');
      expect(partial.timeInForce).toBe('gfd');
      expect(partial.price).toBeUndefined();
      expect('price' in partial).toBe(true); // cleared, not stale
      expect(store.submitTicket).toHaveBeenCalledWith(t.id);
    });
  });

  describe('defaults', () => {
    it('defaults to put on a SHORT card', async () => {
      await render({ signals: [sigItem({ direction: SignalDirection.SHORT })] });
      expect(component.contractType()).toBe('put');
    });

    it('fetches the account snapshot once for the fatfinger cap', async () => {
      await render();
      expect(portfolio.getSnapshot).toHaveBeenCalledTimes(1);
      expect(portfolio.getSnapshot).toHaveBeenCalledWith('agentic-account', 100);
      expect(component.availableCash()).toBe(10000);
    });

    it('does not land a stale cash snapshot after an account switch', async () => {
      let releaseA!: (v: AccountSnapshot) => void;
      portfolio.getSnapshot.mockImplementation((acct: string) =>
        acct === 'acct-a'
          ? new Promise<AccountSnapshot>((r) => { releaseA = r; })
          : Promise.resolve(snapshot(777)),
      );
      await render({ tradingConfig: { ...config, accountNumber: 'acct-a' } });

      // Switch accounts — B resolves immediately while A is still held.
      fixture.componentRef.setInput('tradingConfig', { ...config, accountNumber: 'acct-b' });
      fixture.detectChanges();
      await flush();
      expect(component.availableCash()).toBe(777);

      // A's late landing must not overwrite B's cash.
      releaseA(snapshot(999));
      await flush();
      expect(component.availableCash()).toBe(777);
    });
  });

  describe('bucket picker', () => {
    it('lists ACTIVE buckets on the trading account', async () => {
      const bucket = (name: string): AllocationBucket => ({
        id: `agentic-account_${name}`, userId: 'u', accountNumber: 'agentic-account',
        name, targetPct: 25, status: BucketStatus.ACTIVE, createdAt: 'x', updatedAt: 'x',
      });
      allocStore.byAccount.set({
        'agentic-account': {
          snapshot: null, positions: [], fills: [],
          buckets: [bucket('Growth'), bucket('Income')],
          attributions: [], asOf: null, loading: false, error: null,
        },
      });
      await render();
      fixture.detectChanges();
      const options = fixture.nativeElement.querySelectorAll('[data-testid="bucket-select"] option');
      expect(options.length).toBe(3); // Unassigned + 2 buckets
      expect(allocStore.ensureAccount).toHaveBeenCalledWith('agentic-account');
    });
  });
});
