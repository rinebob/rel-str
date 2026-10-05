/**
 * GalleryFacade unit tests (#754).
 *
 * Tests the page-level seam: enterGallery() orchestrates eager loading of the
 * latest completed run's signals, decisions, lists, tickets, and trading
 * config; cards/visibleCards derive from the domain stores. Card mutations
 * (trade/reject/paper) live on GalleryCardActionsService — see
 * gallery-card-actions.service.spec.ts.
 */
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { GalleryFacade } from './gallery.facade';
import { GalleryUiStore } from './gallery-ui.store';
import { GroupStore } from './group.store';
import { SymbolHistoryStore } from './symbol-history.store';
import { OccurrenceDecisionStore } from './occurrence-decision.store';
import { SymbolListStore } from './symbol-list.store';
import { OrderTicketStore } from './order-ticket.store';
import { StStore } from './st.store';
import { GroupDimension, ReviewDecision, SignalDirection, SignalStatus, SignalTimeframe } from '../common/constants';
import { SymbolListDef } from '../common/symbol-list-defs';
import { StOccurrenceDecision, StSignalItem, StSymbolProfile } from '../services/types';
import { EquityOrderTicket, InstrumentType, OrderSource, OrderTicket, OrderTicketStatus } from '../services/order-ticket.types';
import { buildStOccurrenceDecisionId } from '../services/firestore-helpers';
import { SUNK_GROUP_KEY } from '../utils/gallery-cards.util';

const RUN_ID = 'run-1';
const MARKET_DATE = '2026-08-25';

function makeProfile(symbol: string, extra: Partial<StSymbolProfile> = {}): StSymbolProfile {
  return { symbol, enabled: true, createdAt: '2026-01-01', ...extra };
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
): OrderTicket {
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
    activeRunMarketDate: ReturnType<typeof signal<string | null>>;
    viewedRun: ReturnType<typeof signal<{ id: string; marketDate: string } | null>>;
    signalSymbols: ReturnType<typeof signal<StSymbolProfile[]>>;
    symbolsLoading: ReturnType<typeof signal<boolean>>;
    symbolsError: ReturnType<typeof signal<string | null>>;
    isActionableRun: ReturnType<typeof signal<boolean>>;
    setActiveRun: jest.Mock;
    loadSymbolsWithSignals: jest.Mock;
  };
  let historyStoreMock: {
    signalHistoryCache: ReturnType<typeof signal<Record<string, StSignalItem[]>>>;
    signalHistoryLoading: ReturnType<typeof signal<Record<string, boolean>>>;
  };
  let occurrenceStoreMock: {
    loading: ReturnType<typeof signal<boolean>>;
    occurrenceDecisions: ReturnType<typeof signal<Record<string, StOccurrenceDecision>>>;
    loadRecentDecisions: jest.Mock;
    acceptSignals: jest.Mock;
    rejectSignals: jest.Mock;
    resetSignals: jest.Mock;
  };
  let symbolListStoreMock: {
    symbolLists: ReturnType<typeof signal<Record<string, string[]>>>;
    exclusiveListKeys: ReturnType<typeof computed<string[]>>;
    symbolListsLoading: ReturnType<typeof signal<boolean>>;
    filterOptionGroups: ReturnType<typeof signal<{ label: string; options: { value: string; label: string }[] }[]>>;
    catalog: ReturnType<typeof signal<SymbolListDef[]>>;
    toggleSymbolInList: jest.Mock;
  };
  let ticketStoreMock: {
    ticketsBySymbol: ReturnType<typeof signal<Record<string, OrderTicket[]>>>;
    tickets: ReturnType<typeof signal<Record<string, OrderTicket>>>;
    loadTickets: jest.Mock;
  };
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
      activeRunMarketDate: signal<string | null>(MARKET_DATE),
      viewedRun: signal<{ id: string; marketDate: string } | null>(null),
      signalSymbols: signal<StSymbolProfile[]>([]),
      symbolsLoading: signal(false),
      symbolsError: signal<string | null>(null),
      isActionableRun: signal(true),
      setActiveRun: jest.fn(),
      loadSymbolsWithSignals: jest.fn(),
    };
    historyStoreMock = {
      signalHistoryCache: signal<Record<string, StSignalItem[]>>({}),
      signalHistoryLoading: signal<Record<string, boolean>>({}),
    };
    occurrenceStoreMock = {
      loading: signal(false),
      occurrenceDecisions: signal<Record<string, StOccurrenceDecision>>({}),
      loadRecentDecisions: jest.fn(),
      acceptSignals: jest.fn(),
      rejectSignals: jest.fn(),
      resetSignals: jest.fn(),
    };
    symbolListStoreMock = {
      symbolLists: signal<Record<string, string[]>>({}),
      exclusiveListKeys: computed(() => ['PRIMARY']),
      symbolListsLoading: signal(false),
      filterOptionGroups: signal<{ label: string; options: { value: string; label: string }[] }[]>([]),
      catalog: signal<SymbolListDef[]>([]),
      toggleSymbolInList: jest.fn(),
    };
    ticketStoreMock = {
      ticketsBySymbol: signal<Record<string, OrderTicket[]>>({}),
      tickets: signal<Record<string, OrderTicket>>({}),
      loadTickets: jest.fn(),
    };
    await TestBed.configureTestingModule({
      providers: [
        GalleryFacade,
        { provide: StStore, useValue: agentStoreMock },
        { provide: GroupStore, useValue: groupStoreMock },
        { provide: SymbolHistoryStore, useValue: historyStoreMock },
        { provide: OccurrenceDecisionStore, useValue: occurrenceStoreMock },
        { provide: SymbolListStore, useValue: symbolListStoreMock },
        { provide: OrderTicketStore, useValue: ticketStoreMock },
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

    it('eagerly loads signals, decisions, and tickets when a run is already active', () => {
      groupStoreMock.activeRunId.set(RUN_ID);
      facade.enterGallery();
      expect(groupStoreMock.loadSymbolsWithSignals).toHaveBeenCalled();
      expect(occurrenceStoreMock.loadRecentDecisions).toHaveBeenCalled();
      expect(ticketStoreMock.loadTickets).toHaveBeenCalled();
    });

    it('resets filter/group state to page defaults', () => {
      uiStore.setTimeframe(SignalTimeframe.ALL);
      uiStore.setDirection(SignalDirection.ALL);
      uiStore.setListFilter('ALL');
      uiStore.setGroupDimension(GroupDimension.MARKET_CAP_TIER);
      facade.enterGallery();
      expect(uiStore.timeframe()).toBe(SignalTimeframe.DAILY);
      expect(uiStore.direction()).toBe(SignalDirection.LONG);
      expect(uiStore.listFilter()).toBe('PRIMARY');
      expect(uiStore.groupDimension()).toBe(GroupDimension.SECTOR);
    });
  });

  describe('cards', () => {
    beforeEach(() => {
      // Neutralize the page-entry defaults (DAILY/LONG/PRIMARY) — these tests
      // exercise aggregation/filter mechanics, not the defaults.
      uiStore.setTimeframe(SignalTimeframe.ALL);
      uiStore.setDirection(SignalDirection.ALL);
      uiStore.setListFilter('ALL');
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

  describe('groups (#783) — signal-review dimensions', () => {
    beforeEach(() => {
      uiStore.setTimeframe(SignalTimeframe.ALL);
      uiStore.setDirection(SignalDirection.ALL);
      uiStore.setListFilter('ALL');
      groupStoreMock.activeRunId.set(RUN_ID);
      groupStoreMock.signalSymbols.set([
        makeProfile('AAPL', { sector: 'Tech', marketCap: 100 }),
        makeProfile('TSLA', { sector: 'Tech', marketCap: 50 }),
      ]);
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [
          makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
          makeSignal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG),
        ],
        [`TSLA::${RUN_ID}`]: [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)],
      });
    });

    it('groups visible cards by sector alphabetically', () => {
      facade.setGroupDimension(GroupDimension.SECTOR);
      const groups = facade.groups();
      expect(groups.map((g) => g.key)).toEqual(['sector:Tech']);
      expect(groups[0].cards.map((c) => c.key).sort()).toEqual(['AAPL:buy', 'TSLA:sell']);
    });

    it('regroups when the dimension changes', () => {
      expect(uiStore.groupDimension()).toBe(GroupDimension.SECTOR);
      expect(facade.groups().map((g) => g.label)).toEqual(['Tech']);
      // No industry on the profiles → all land in (Unknown).
      facade.setGroupDimension(GroupDimension.INDUSTRY);
      expect(facade.groups().map((g) => g.label)).toEqual(['(Unknown)']);
    });

    it('groups reflect the active filter', () => {
      uiStore.setDirection(SignalDirection.SHORT);
      const groups = facade.groups();
      expect(groups).toHaveLength(1);
      expect(groups[0].cards.map((c) => c.key)).toEqual(['TSLA:sell']);
    });

    it('groups default to collapsed; setGroupExpanded expands one', () => {
      expect(facade.expandedGroups()['sector:Tech'] ?? false).toBe(false);
      facade.setGroupExpanded('sector:Tech', true);
      expect(facade.expandedGroups()['sector:Tech']).toBe(true);
    });

    it('expansion state is isolated across dimensions via prefixed keys', () => {
      // 'sector:Tech' and 'industry:Tech' are different buckets — expanding
      // one must not touch the other (the reason group keys are prefixed).
      facade.setGroupExpanded('sector:Tech', true);
      expect(facade.expandedGroups()['sector:Tech']).toBe(true);
      expect(facade.expandedGroups()['industry:Tech'] ?? false).toBe(false);
    });

    it('toggleAllGroups expands all then collapses all', () => {
      expect(facade.allGroupsExpanded()).toBe(false);
      facade.toggleAllGroups();
      expect(facade.allGroupsExpanded()).toBe(true);
      expect(facade.expandedGroups()['sector:Tech']).toBe(true);
      facade.toggleAllGroups();
      expect(facade.allGroupsExpanded()).toBe(false);
    });
  });

  describe('action status + sunk model (#755)', () => {
    function makeReject(symbol: string, timeframe: SignalTimeframe, signalType = 'RS_RISE'): StOccurrenceDecision {
      return {
        id: buildStOccurrenceDecisionId(RUN_ID, symbol, timeframe, signalType),
        runId: RUN_ID,
        marketDate: MARKET_DATE,
        symbol,
        timeframe,
        direction: SignalDirection.LONG,
        signalType,
        barDate: MARKET_DATE,
        decisionType: ReviewDecision.REJECT,
        decidedAt: '2026-08-26T00:00:00Z',
        isCurrentInLatestRun: true,
      };
    }

    beforeEach(() => {
      uiStore.setTimeframe(SignalTimeframe.ALL);
      uiStore.setDirection(SignalDirection.ALL);
      uiStore.setListFilter('ALL');
      groupStoreMock.activeRunId.set(RUN_ID);
      groupStoreMock.signalSymbols.set([
        makeProfile('AAPL', { sector: 'Tech', marketCap: 100 }),
        makeProfile('TSLA', { sector: 'Tech', marketCap: 50 }),
      ]);
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)],
        [`TSLA::${RUN_ID}`]: [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)],
      });
    });

    it('a watched symbol sinks both its cards to a pinned Sunk group', () => {
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG)],
        [`TSLA::${RUN_ID}`]: [
          makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.LONG),
          makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT),
        ],
      });
      symbolListStoreMock.symbolLists.set({ MONITOR: ['TSLA'] });

      const groups = facade.groups();
      expect(groups.map((g) => g.key)).toEqual(['sector:Tech', SUNK_GROUP_KEY]);
      expect(groups[0].cards.map((c) => c.key)).toEqual(['AAPL:buy']);
      expect(groups[1].cards.map((c) => c.key).sort()).toEqual(['TSLA:buy', 'TSLA:sell']);
      expect(groups[1].cards[0].status).toBe('watched');
    });

    it('a filled ticket sinks its card; a resting ticket stays in its group', () => {
      ticketStoreMock.ticketsBySymbol.set({
        AAPL: [makeTicket('AAPL', 'buy', OrderTicketStatus.FILLED)],
        TSLA: [makeTicket('TSLA', 'sell', OrderTicketStatus.RESTING)],
      });

      const groups = facade.groups();
      expect(groups.map((g) => g.key)).toEqual(['sector:Tech', SUNK_GROUP_KEY]);
      expect(groups[0].cards.map((c) => `${c.key}:${c.status}`)).toEqual(['TSLA:sell:resting']);
      expect(groups[1].cards.map((c) => `${c.key}:${c.status}`)).toEqual(['AAPL:buy:settled']);
    });

    it('sunk cards order by action time desc', () => {
      ticketStoreMock.ticketsBySymbol.set({
        AAPL: [makeTicket('AAPL', 'buy', OrderTicketStatus.FILLED, { updatedAt: '2026-08-20T00:00:00Z' })],
        TSLA: [makeTicket('TSLA', 'sell', OrderTicketStatus.FAILED, { updatedAt: '2026-08-27T00:00:00Z' })],
      });
      const sunk = facade.groups().find((g) => g.key === SUNK_GROUP_KEY)!;
      expect(sunk.cards.map((c) => c.key)).toEqual(['TSLA:sell', 'AAPL:buy']);
    });

    it('no Sunk group renders when nothing is actioned', () => {
      expect(facade.groups().map((g) => g.key)).toEqual(['sector:Tech']);
    });

    it('rejected occurrences trim; a fully-rejected card keeps its occurrences and sinks', () => {
      historyStoreMock.signalHistoryCache.set({
        [`AAPL::${RUN_ID}`]: [
          makeSignal('AAPL', SignalTimeframe.DAILY, SignalDirection.LONG),
          { ...makeSignal('AAPL', SignalTimeframe.WEEKLY, SignalDirection.LONG), signalType: 'RS_WEEKLY' },
        ],
        [`TSLA::${RUN_ID}`]: [makeSignal('TSLA', SignalTimeframe.DAILY, SignalDirection.SHORT)],
      });
      const d1 = makeReject('AAPL', SignalTimeframe.DAILY);
      const d2 = makeReject('TSLA', SignalTimeframe.DAILY);
      occurrenceStoreMock.occurrenceDecisions.set({ [d1.id]: d1, [d2.id]: d2 });

      const groups = facade.groups();
      expect(groups.map((g) => g.key)).toEqual(['sector:Tech', SUNK_GROUP_KEY]);
      // Partial reject — the surviving occurrence keeps the card in its group.
      const aapl = groups[0].cards.find((c) => c.symbol === 'AAPL')!;
      expect(aapl.occurrences.map((o) => o.signalType)).toEqual(['RS_WEEKLY']);
      // Full reject — the card sinks with its occurrences intact so the
      // decision stays reachable (reset/un-reject on-page).
      const tsla = groups[1].cards.find((c) => c.symbol === 'TSLA')!;
      expect(tsla.status).toBe('rejected');
      expect(tsla.occurrences).toHaveLength(1);
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
