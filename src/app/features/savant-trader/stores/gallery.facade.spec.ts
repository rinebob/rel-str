/**
 * GalleryFacade unit tests (#754).
 *
 * Tests the page-level seam: enterGallery() orchestrates eager loading of the
 * latest completed run's signals, decisions, lists, tickets, and trading
 * config; cards/visibleCards derive from the domain stores.
 */
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { of } from 'rxjs';

import { GalleryFacade } from './gallery.facade';
import { GalleryUiStore } from './gallery-ui.store';
import { GroupStore } from './group.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { OrderTicketStore } from './order-ticket.store';
import { StStore } from './st.store';
import { TradingConfigService } from '../services/trading-config.service';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';
import { StSignalItem, StSymbolProfile } from '../services/types';

const RUN_ID = 'run-1';
const MARKET_DATE = '2026-08-25';

function makeProfile(symbol: string, extra: Partial<StSymbolProfile> = {}): StSymbolProfile {
  return { symbol, enabled: true, createdAt: '2026-01-01', ...extra };
}

function makeSignal(
  symbol: string,
  timeframe: SignalTimeframe,
  direction: SignalDirection,
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
  };
}

describe('GalleryFacade', () => {
  let facade: GalleryFacade;
  let agentStoreMock: {
    latestCompletedRun: ReturnType<typeof signal<{ id: string; marketDate: string } | null>>;
    runsReceived: ReturnType<typeof signal<boolean>>;
    loadData: jest.Mock;
  };
  let groupStoreMock: {
    activeRunId: ReturnType<typeof signal<string | null>>;
    viewedRun: ReturnType<typeof signal<{ id: string; marketDate: string } | null>>;
    signalSymbols: ReturnType<typeof signal<StSymbolProfile[]>>;
    symbolsLoading: ReturnType<typeof signal<boolean>>;
    symbolsError: ReturnType<typeof signal<string | null>>;
    setActiveRun: jest.Mock;
    loadSymbolsWithSignals: jest.Mock;
  };
  let historyStoreMock: {
    signalHistoryCache: ReturnType<typeof signal<Record<string, StSignalItem[]>>>;
    signalHistoryLoading: ReturnType<typeof signal<Record<string, boolean>>>;
  };
  let occurrenceStoreMock: { loading: ReturnType<typeof signal<boolean>>; loadRecentDecisions: jest.Mock };
  let symbolListStoreMock: {
    symbolLists: ReturnType<typeof signal<Record<string, string[]>>>;
    exclusiveListKeys: ReturnType<typeof computed<string[]>>;
    symbolListsLoading: ReturnType<typeof signal<boolean>>;
    filterOptionGroups: ReturnType<typeof signal<{ label: string; options: { value: string; label: string }[] }[]>>;
  };
  let ticketStoreMock: { loadTickets: jest.Mock };
  let configServiceMock: { loadConfig: jest.Mock };
  let uiStore: InstanceType<typeof GalleryUiStore>;

  async function flush(): Promise<void> {
    await new Promise<void>((r) => setTimeout(r, 0));
    TestBed.tick();
  }

  beforeEach(async () => {
    agentStoreMock = {
      latestCompletedRun: signal<{ id: string; marketDate: string } | null>(null),
      runsReceived: signal(false),
      loadData: jest.fn(),
    };
    groupStoreMock = {
      activeRunId: signal<string | null>(null),
      viewedRun: signal<{ id: string; marketDate: string } | null>(null),
      signalSymbols: signal<StSymbolProfile[]>([]),
      symbolsLoading: signal(false),
      symbolsError: signal<string | null>(null),
      setActiveRun: jest.fn(),
      loadSymbolsWithSignals: jest.fn(),
    };
    historyStoreMock = {
      signalHistoryCache: signal<Record<string, StSignalItem[]>>({}),
      signalHistoryLoading: signal<Record<string, boolean>>({}),
    };
    occurrenceStoreMock = { loading: signal(false), loadRecentDecisions: jest.fn() };
    symbolListStoreMock = {
      symbolLists: signal<Record<string, string[]>>({}),
      exclusiveListKeys: computed(() => ['PRIMARY']),
      symbolListsLoading: signal(false),
      filterOptionGroups: signal<{ label: string; options: { value: string; label: string }[] }[]>([]),
    };
    ticketStoreMock = { loadTickets: jest.fn() };
    configServiceMock = { loadConfig: jest.fn().mockReturnValue(of({ accountNumber: '123' })) };

    await TestBed.configureTestingModule({
      providers: [
        GalleryFacade,
        { provide: StStore, useValue: agentStoreMock },
        { provide: GroupStore, useValue: groupStoreMock },
        { provide: SymbolHistoryStore, useValue: historyStoreMock },
        { provide: OccurrenceDecisionStore, useValue: occurrenceStoreMock },
        { provide: SymbolListStore, useValue: symbolListStoreMock },
        { provide: OrderTicketStore, useValue: ticketStoreMock },
        { provide: TradingConfigService, useValue: configServiceMock },
        { provide: MatSnackBar, useValue: { open: jest.fn() } },
      ],
    });
    facade = TestBed.inject(GalleryFacade);
    uiStore = TestBed.inject(GalleryUiStore);
  });

  describe('enterGallery', () => {
    it('starts the runs stream when no run is selected yet', () => {
      facade.enterGallery();
      expect(agentStoreMock.loadData).toHaveBeenCalled();
      expect(groupStoreMock.loadSymbolsWithSignals).not.toHaveBeenCalled();
    });

    it('auto-selects the latest completed run when the stream emits', async () => {
      facade.enterGallery();
      agentStoreMock.latestCompletedRun.set({ id: RUN_ID, marketDate: MARKET_DATE });
      agentStoreMock.runsReceived.set(true);
      await flush();
      expect(groupStoreMock.setActiveRun).toHaveBeenCalledWith(RUN_ID, MARKET_DATE);
    });

    it('eagerly loads signals, decisions, tickets, and config when a run is already active', () => {
      groupStoreMock.activeRunId.set(RUN_ID);
      facade.enterGallery();
      expect(groupStoreMock.loadSymbolsWithSignals).toHaveBeenCalled();
      expect(occurrenceStoreMock.loadRecentDecisions).toHaveBeenCalled();
      expect(ticketStoreMock.loadTickets).toHaveBeenCalled();
      expect(configServiceMock.loadConfig).toHaveBeenCalled();
    });

    it('resets filter/sort state to page defaults', () => {
      uiStore.setTimeframe(SignalTimeframe.WEEKLY);
      facade.enterGallery();
      expect(uiStore.timeframe()).toBe(SignalTimeframe.ALL);
      expect(uiStore.listFilter()).toBe('ALL');
      expect(uiStore.sort()).toBe('sector');
    });
  });

  describe('cards', () => {
    beforeEach(() => {
      groupStoreMock.activeRunId.set(RUN_ID);
      groupStoreMock.signalSymbols.set([makeProfile('AAPL'), makeProfile('TSLA')]);
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [
          makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
          makeSignal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG),
        ],
        [`TSLA::${RUN_ID}`]: [
          makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.LONG),
          makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT),
        ],
      });
    });

    it('aggregates occurrences into one card per symbol+side', () => {
      expect(facade.cards().map((c) => c.key).sort()).toEqual(['AAPL:buy', 'TSLA:buy', 'TSLA:sell']);
    });

    it('visibleCards applies the direction filter', () => {
      uiStore.setDirection(SignalDirection.SHORT);
      expect(facade.visibleCards().map((c) => c.key)).toEqual(['TSLA:sell']);
    });

    it('visibleCards applies the list filter', () => {
      symbolListStoreMock.symbolLists.set({ PRIMARY: ['AAPL'] });
      uiStore.setListFilter('PRIMARY');
      expect(facade.visibleCards().map((c) => c.symbol)).toEqual(['AAPL']);
    });

    it('NO_MEMBERSHIP list filter works on cold entry without a tracked-symbols load (#754 review)', () => {
      // Untriaged = zero exclusive-list membership, derived from symbolLists
      // — no trackedSymbols() call needed.
      symbolListStoreMock.symbolLists.set({ PRIMARY: ['AAPL'], MONITOR: ['TSLA'] });
      uiStore.setListFilter('NO_MEMBERSHIP');
      expect(facade.visibleCards().map((c) => c.key).sort()).toEqual(['TSLA:buy', 'TSLA:sell']);
    });

    it('allFilteredOut is true only when cards exist but none are visible', () => {
      expect(facade.allFilteredOut()).toBe(false);
      uiStore.setListFilter('EMPTY_LIST');
      expect(facade.visibleCards()).toHaveLength(0);
      expect(facade.allFilteredOut()).toBe(true);
    });
  });

  describe('pageInitializing', () => {
    it('is true before the runs stream emits and no run is active', () => {
      expect(facade.pageInitializing()).toBe(true);
    });

    it('stays true in the window between runs emission and auto-select (#754 r2)', () => {
      // runsReceived + latestCompletedRun emitted but the constructor effect
      // hasn't fired setActiveRun yet — without the latestCompletedRun check
      // the grid would flash "No signals for this run" for that frame.
      agentStoreMock.runsReceived.set(true);
      agentStoreMock.latestCompletedRun.set({ id: RUN_ID, marketDate: MARKET_DATE });
      expect(facade.pageInitializing()).toBe(true);
    });

    it('is false once a run is active and all loads have settled', () => {
      groupStoreMock.activeRunId.set(RUN_ID);
      expect(facade.pageInitializing()).toBe(false);
    });

    it('stays true while per-symbol run history is still loading (#754 review)', () => {
      // symbolsLoading clears when the profile list lands, but cards can't
      // render until the per-symbol history fan-out resolves — the grid must
      // not flash "No signals for this run" in that window.
      groupStoreMock.activeRunId.set(RUN_ID);
      historyStoreMock.signalHistoryLoading.set({ [`AAPL::${RUN_ID}`]: true });
      expect(facade.pageInitializing()).toBe(true);

      historyStoreMock.signalHistoryLoading.set({ [`AAPL::${RUN_ID}`]: false });
      expect(facade.pageInitializing()).toBe(false);
    });

    it('ignores pending history for other runs and bare-symbol keys', () => {
      groupStoreMock.activeRunId.set(RUN_ID);
      historyStoreMock.signalHistoryLoading.set({
        'AAPL::run-other': true,
        TSLA: true,
      });
      expect(facade.pageInitializing()).toBe(false);
    });
  });

  describe('loadError', () => {
    it('passes through the group store symbols error', () => {
      expect(facade.loadError()).toBeNull();
      groupStoreMock.symbolsError.set('callable failed');
      expect(facade.loadError()).toBe('callable failed');
    });
  });
});
