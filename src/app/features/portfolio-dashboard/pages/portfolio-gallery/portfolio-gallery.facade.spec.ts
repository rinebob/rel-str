/**
 * Specs for PortfolioGalleryFacade (#926/#950).
 *
 * The facade is the page-level composition seam: it joins
 * PortfolioDashboardStore (positions+PnL, quotes, orders, summary) with
 * SymbolListStore profiles/lists, allocation attributions + buckets, and
 * PortfolioGalleryUiStore facets into PositionCard view-models. Domain
 * stores are signal stubs; the UI store is real.
 */
import { computed, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { of } from 'rxjs';

import { PortfolioGalleryFacade } from './portfolio-gallery.facade';
import { PortfolioGalleryUiStore } from './portfolio-gallery-ui.store';
import { PortfolioDashboardStore } from '../../portfolio-dashboard.store';
import { SymbolListStore } from '../../../savant-trader/stores/symbol-list.store';
import { GalleryCardChartStore } from '../../../savant-trader/stores/gallery-card-chart.store';
import { PositionAttributionService } from '../../position-attribution.service';
import { AllocationBucketService } from '../../allocation-bucket.service';
import { AccountState, EquityPositionWithPnL, SectionData } from '../../portfolio-dashboard.types';
import { createAccountState } from '../../portfolio-dashboard.helpers';
import {
  makeAccount,
  makeEquityPosition,
  makeEquityQuote,
  makeOrder,
  makePortfolio,
} from '../../portfolio-dashboard.spec-fixtures';
import type { StSymbolProfile } from '../../../savant-trader/services/types';
import type { AllocationBucket, PositionAttribution } from '@portfolio-allocation/contracts';
import { BucketStatus } from '@portfolio-allocation/contracts';
import { SignalTimeframe } from '../../../savant-trader/common/constants';
import { PositionGroupDimension } from './utils/position-cards.util';
import {
  EquityQuote,
  BrokerOrder,
} from '../../../../core/robinhood-mcp/types/robinhood-mcp.types';

const AGENTIC = '677616245';

function dataSectionFor<T>(data: T | null): SectionData<T> {
  return { data, loading: false, error: null };
}

function makeBucket(overrides: Partial<AllocationBucket> = {}): AllocationBucket {
  return {
    id: `${AGENTIC}_growth`,
    userId: 'u',
    accountNumber: AGENTIC,
    name: 'Growth',
    targetPct: 50,
    status: BucketStatus.ACTIVE,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeAttribution(overrides: Partial<PositionAttribution> = {}): PositionAttribution {
  const bucketId = overrides.bucketId ?? `${AGENTIC}_growth`;
  return {
    id: `${AGENTIC}_AAPL`,
    userId: 'u',
    accountNumber: AGENTIC,
    instrumentId: 'AAPL',
    bucketId,
    history: [{ fromBucketId: null, toBucketId: bucketId, at: '2026-01-01T00:00:00Z' }],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function withPnl(overrides: Partial<EquityPositionWithPnL> = {}): EquityPositionWithPnL {
  return {
    ...makeEquityPosition(),
    currentPrice: 155,
    pnl: 500,
    pnlPercent: 3.33,
    closed: false,
    entryDate: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function profile(symbol: string, extra: Partial<StSymbolProfile> = {}): StSymbolProfile {
  return { symbol, enabled: true, createdAt: '2026-01-01', name: `${symbol} Co`, ...extra };
}

function account(overrides: {
  accountNumber?: string;
  agenticAllowed?: boolean;
  positions?: ReturnType<typeof withPnl>[] | null;
  quotes?: Map<string, EquityQuote> | null;
  orders?: BrokerOrder[] | null;
  portfolio?: ReturnType<typeof makePortfolio> | null;
} = {}): AccountState {
  const a = createAccountState(makeAccount({
    accountNumber: overrides.accountNumber ?? AGENTIC,
    agenticAllowed: overrides.agenticAllowed ?? true,
  }));
  return {
    ...a,
    portfolio: dataSectionFor(overrides.portfolio === undefined ? makePortfolio() : overrides.portfolio),
    equityPositions: dataSectionFor(overrides.positions === undefined ? [] : overrides.positions),
    equityQuotes: dataSectionFor(overrides.quotes === undefined ? null : overrides.quotes),
    equityOrders: dataSectionFor(overrides.orders === undefined ? null : overrides.orders),
  };
}

interface StoreMocks {
  accounts: ReturnType<typeof signal<AccountState[]>>;
  selectedAccountIndex: ReturnType<typeof signal<number>>;
  globalLoading: ReturnType<typeof signal<boolean>>;
  loadError: ReturnType<typeof signal<string | null>>;
  refresh: jest.Mock;
  selectAccount: jest.Mock;
  profilesBySymbol: ReturnType<typeof signal<Map<string, StSymbolProfile>>>;
  profilesLoaded: ReturnType<typeof signal<boolean>>;
  loadProfiles: jest.Mock;
  loadSymbolLists: jest.Mock;
  symbolLists: ReturnType<typeof signal<Record<string, string[]>>>;
  clearCache: jest.Mock;
  prefetch: jest.Mock;
  watchAttributions: jest.Mock;
  watchBuckets: jest.Mock;
}

function setup(overrides: {
  accounts?: AccountState[];
  selectedIndex?: number;
  attributions?: PositionAttribution[];
  buckets?: AllocationBucket[];
} = {}): { facade: PortfolioGalleryFacade; mocks: StoreMocks; ui: InstanceType<typeof PortfolioGalleryUiStore> } {
  const accounts = signal<AccountState[]>(overrides.accounts ?? [account()]);
  const selectedAccountIndex = signal(overrides.selectedIndex ?? 0);
  const mocks: StoreMocks = {
    accounts,
    selectedAccountIndex,
    globalLoading: signal(false),
    loadError: signal<string | null>(null),
    refresh: jest.fn(),
    selectAccount: jest.fn((i: number) => selectedAccountIndex.set(i)),
    profilesBySymbol: signal(new Map<string, StSymbolProfile>()),
    profilesLoaded: signal(true),
    loadProfiles: jest.fn(),
    loadSymbolLists: jest.fn(),
    symbolLists: signal<Record<string, string[]>>({}),
    clearCache: jest.fn(),
    prefetch: jest.fn(),
    watchAttributions: jest.fn(() => of(overrides.attributions ?? [])),
    watchBuckets: jest.fn(() => of(overrides.buckets ?? [])),
  };

  const dashboardStub = {
    accounts,
    selectedAccountIndex,
    selectedAccount: computed(() => accounts()[selectedAccountIndex()] ?? null),
    equityPositionsWithPnL: computed(
      () => (accounts()[selectedAccountIndex()]?.equityPositions.data ?? []) as EquityPositionWithPnL[],
    ),
    openOrders: computed(() => accounts()[selectedAccountIndex()]?.equityOrders.data ?? []),
    globalLoading: mocks.globalLoading,
    loadError: mocks.loadError,
    refresh: mocks.refresh,
    selectAccount: mocks.selectAccount,
  };

  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      PortfolioGalleryFacade,
      PortfolioGalleryUiStore,
      { provide: PortfolioDashboardStore, useValue: dashboardStub },
      {
        provide: SymbolListStore,
        useValue: {
          profilesBySymbol: mocks.profilesBySymbol,
          profilesLoaded: mocks.profilesLoaded,
          loadProfiles: mocks.loadProfiles,
          loadSymbolLists: mocks.loadSymbolLists,
          symbolLists: mocks.symbolLists,
          exclusiveListKeys: computed(() => ['PRIMARY']),
          filterOptionGroups: signal([]),
        },
      },
      { provide: GalleryCardChartStore, useValue: { clearCache: mocks.clearCache, prefetch: mocks.prefetch } },
      { provide: PositionAttributionService, useValue: { watchAttributions$: mocks.watchAttributions } },
      { provide: AllocationBucketService, useValue: { watchBuckets$: mocks.watchBuckets } },
    ],
  });
  const facade = TestBed.inject(PortfolioGalleryFacade);
  const ui = TestBed.inject(PortfolioGalleryUiStore);
  ui.resetForPage();
  return { facade, mocks, ui };
}

describe('PortfolioGalleryFacade', () => {
  describe('agentic account gating', () => {
    it('agenticAccounts filters on agenticAllowed', () => {
      const { facade } = setup({
        accounts: [account({ agenticAllowed: false }), account({ accountNumber: 'X', agenticAllowed: true })],
      });
      expect(facade.agenticAccounts().map((a) => a.accountNumber)).toEqual(['X']);
    });

    it('noAgenticAccount is true when accounts loaded without an agentic account', () => {
      const { facade } = setup({ accounts: [account({ agenticAllowed: false })] });
      expect(facade.noAgenticAccount()).toBe(true);
    });

    it('noAgenticAccount is false while the account load is in flight', () => {
      const { facade, mocks } = setup({ accounts: [] });
      mocks.globalLoading.set(true);
      expect(facade.noAgenticAccount()).toBe(false);
    });

    it('noAgenticAccount is true when the load completes with zero accounts', () => {
      const { facade } = setup({ accounts: [] });
      expect(facade.noAgenticAccount()).toBe(true);
    });

    it('noAgenticAccount stays false while loadError is showing', () => {
      const { facade, mocks } = setup({ accounts: [account({ agenticAllowed: false })] });
      mocks.loadError.set('refresh failed');
      expect(facade.noAgenticAccount()).toBe(false);
    });

    it('account() gates on agenticAllowed — a selected manual account produces no cards', () => {
      const { facade } = setup({
        accounts: [
          account({ accountNumber: 'M', agenticAllowed: false, positions: [withPnl({ symbol: 'AAPL' })] }),
          account({ accountNumber: 'X', agenticAllowed: true }),
        ],
        selectedIndex: 0,
      });
      expect(facade.account()).toBeNull();
      expect(facade.cards()).toEqual([]);
    });

    it('enterPage selects the first agentic account when the selection is not agentic', () => {
      const { facade, mocks } = setup({
        accounts: [account({ agenticAllowed: false }), account({ accountNumber: 'X', agenticAllowed: true })],
        selectedIndex: 0,
      });
      facade.enterPage();
      expect(mocks.selectAccount).toHaveBeenCalledWith(1);
    });
  });

  describe('cards', () => {
    it('builds one card per live equity position', () => {
      const { facade } = setup({
        accounts: [account({ positions: [withPnl({ symbol: 'AAPL' }), withPnl({ symbol: 'MSFT' })] })],
      });
      expect(facade.cards().map((c) => c.symbol)).toEqual(['AAPL', 'MSFT']);
    });

    it('joins bucket names through attributions → buckets', async () => {
      const { facade } = setup({
        accounts: [account({ positions: [withPnl({ symbol: 'AAPL' })] })],
        buckets: [makeBucket()],
        attributions: [makeAttribution()],
      });
      await new Promise<void>((r) => setTimeout(r, 0));
      TestBed.tick();
      expect(facade.cards()[0].bucketName).toBe('Growth');
    });

    it('reports bucketName null on a dangling attribution (bucket deleted)', async () => {
      const { facade } = setup({
        accounts: [account({ positions: [withPnl({ symbol: 'AAPL' })] })],
        buckets: [],
        attributions: [makeAttribution({ bucketId: 'gone' })],
      });
      await new Promise<void>((r) => setTimeout(r, 0));
      TestBed.tick();
      expect(facade.cards()[0].bucketName).toBeNull();
    });
  });

  describe('filtering and flat ordering', () => {
    it('flatCards applies side/list filters then sorts by market cap', async () => {
      const { facade, ui, mocks } = setup({
        accounts: [account({
          positions: [withPnl({ symbol: 'SMALL', quantity: 1000 }), withPnl({ symbol: 'BIG', quantity: 1 })],
        })],
      });
      mocks.profilesBySymbol.set(new Map([
        ['SMALL', profile('SMALL', { marketCap: 1e9 })],
        ['BIG', profile('BIG', { marketCap: 3e12 })],
      ]));
      ui.setSide('long');
      expect(facade.flatCards().map((c) => c.symbol)).toEqual(['BIG', 'SMALL']);
    });

    it('allFilteredOut distinguishes filtered-empty from empty', async () => {
      const { facade, ui } = setup({
        accounts: [account({ positions: [withPnl({ symbol: 'MSFT', quantity: -5 })] })],
      });
      ui.setSide('long');
      expect(facade.allFilteredOut()).toBe(true);
      ui.setSide('all');
      expect(facade.allFilteredOut()).toBe(false);
    });
  });

  describe('summary strip', () => {
    it('exposes account snapshot values + unprotected count', () => {
      const stop = makeOrder({ side: 'sell', type: 'stop_market', state: 'confirmed', stopPrice: 145 });
      const { facade } = setup({
        accounts: [account({
          positions: [withPnl({ symbol: 'AAPL' }), withPnl({ symbol: 'MSFT' })],
          orders: [stop],
          quotes: new Map([['AAPL', makeEquityQuote()]]),
          portfolio: makePortfolio({ totalValue: 100000, cash: 20000, buyingPower: 40000 }),
        })],
      });
      const s = facade.summary();
      expect(s.totalValue).toBe(100000);
      expect(s.cash).toBe(20000);
      expect(s.buyingPower).toBe(40000);
      expect(s.unprotectedCount).toBe(1); // MSFT unprotected; AAPL has the stop
    });

    it('dayPnl signs contributions by side — a rising day helps longs, hurts shorts', () => {
      const quotes = new Map([
        // last 155 vs previousClose 150 → +5 per-share day change
        ['AAPL', makeEquityQuote({ lastTradePrice: 155, previousClose: 150 })],
        ['TSLA', makeEquityQuote({ lastTradePrice: 155, previousClose: 150 })],
      ]);
      const { facade } = setup({
        accounts: [account({
          positions: [
            withPnl({ symbol: 'AAPL', quantity: 10, currentPrice: 155 }),
            withPnl({ symbol: 'TSLA', quantity: -4, currentPrice: 155 }),
          ],
          quotes,
        })],
      });
      // long: +5 × 10 = +50; short: +5 × −4 = −20 → 30
      expect(facade.summary().dayPnl).toBe(30);
    });

    it('dayPnl is null when no card has a usable previous close', () => {
      const { facade } = setup({
        accounts: [account({ positions: [withPnl({ symbol: 'AAPL' })], quotes: null })],
      });
      expect(facade.summary().dayPnl).toBeNull();
    });
  });

  describe('states', () => {
    it('initialLoading while the first load runs', () => {
      const { facade, mocks } = setup({ accounts: [] });
      mocks.globalLoading.set(true);
      expect(facade.initialLoading()).toBe(true);
      mocks.globalLoading.set(false);
      expect(facade.initialLoading()).toBe(false);
    });

    it('surfaces loadError from the dashboard store', () => {
      const { facade, mocks } = setup();
      mocks.loadError.set('refresh failed');
      expect(facade.loadError()).toBe('refresh failed');
    });

    it('partialErrors labels each failed slice without blanking the page', () => {
      const { facade } = setup({
        accounts: [{
          ...account({ positions: [withPnl({ symbol: 'AAPL' })] }),
          equityQuotes: { data: null, loading: false, error: 'quote timeout' },
          equityOrders: { data: null, loading: false, error: 'orders 500' },
        }],
      });
      expect(facade.partialErrors()).toEqual(['Quotes: quote timeout', 'Orders: orders 500']);
      expect(facade.cards().length).toBe(1); // degraded, not blanked
    });
  });

  describe('enterPage / refresh', () => {
    it('enterPage resets UI, loads profiles, clears chart cache, refreshes', () => {
      const { facade, mocks, ui } = setup();
      ui.setSide('short');
      facade.enterPage();
      expect(ui.side()).toBe('all');
      expect(mocks.loadProfiles).toHaveBeenCalled();
      expect(mocks.loadSymbolLists).toHaveBeenCalled();
      expect(mocks.clearCache).toHaveBeenCalled();
      expect(mocks.refresh).toHaveBeenCalled();
    });

    it('refresh clears the chart cache and delegates to the dashboard', () => {
      const { facade, mocks } = setup();
      facade.refresh();
      expect(mocks.clearCache).toHaveBeenCalled();
      expect(mocks.refresh).toHaveBeenCalled();
    });
  });

  describe('attribution watchers', () => {
    it('resubscribes only on a real account switch, not on every account patch', async () => {
      const { facade, mocks } = setup({
        accounts: [account({ positions: [withPnl({ symbol: 'AAPL' })] })],
      });
      await new Promise<void>((r) => setTimeout(r, 0));
      TestBed.tick();
      expect(mocks.watchAttributions).toHaveBeenCalledTimes(1);
      expect(mocks.watchBuckets).toHaveBeenCalledTimes(1);

      // A dashboard patch rebuilds the AccountState object — the primitive
      // accountNumber key must not retrigger the Firestore subscriptions.
      const rebuilt = account({ positions: [withPnl({ symbol: 'AAPL' }), withPnl({ symbol: 'MSFT' })] });
      mocks.accounts.set([rebuilt]);
      await new Promise<void>((r) => setTimeout(r, 0));
      TestBed.tick();
      expect(mocks.watchAttributions).toHaveBeenCalledTimes(1);
      expect(mocks.watchBuckets).toHaveBeenCalledTimes(1);
      expect(facade.cards().length).toBe(2);
    });
  });

  describe('header bindings', () => {
    it('mirrors UI-store facets and the list dropdown groups', () => {
      const { facade, ui } = setup();
      ui.setChartTimeframe(SignalTimeframe.WEEKLY);
      ui.setGroupDimension(PositionGroupDimension.BUCKET);
      expect(facade.chartTimeframe()).toBe(SignalTimeframe.WEEKLY);
      expect(facade.groupDimension()).toBe(PositionGroupDimension.BUCKET);
      expect(facade.filterOptionGroups()).toEqual([]);
    });
  });
});
