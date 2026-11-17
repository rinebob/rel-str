/**
 * Shared test fixtures for PortfolioDashboardStore specs.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import { RobinhoodMcpClient } from '../../core/robinhood-mcp/robinhood-mcp-client.service';
import { PositionPeakService } from './services/position-peak.service';
import {
  AccountInfo,
  PortfolioSnapshot,
  EquityPosition,
  OptionPosition,
  OptionInstrument,
  EquityQuote,
  OptionQuote,
  BrokerOrder,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

export function makeAccount(overrides: Partial<AccountInfo> = {}): AccountInfo {
  return {
    accountNumber: '123456789',
    accountName: 'Test Account',
    accountType: 'margin',
    agenticAllowed: true,
    ...overrides,
  };
}

export function makePortfolio(overrides: Partial<PortfolioSnapshot> = {}): PortfolioSnapshot {
  return {
    totalValue: 100000,
    equityValue: 80000,
    cash: 20000,
    buyingPower: 40000,
    marginExposure: null,
    ...overrides,
  };
}

export function makeEquityPosition(overrides: Partial<EquityPosition> = {}): EquityPosition {
  return {
    symbol: 'AAPL',
    quantity: 100,
    averageBuyPrice: 150,
    sharesHeldForSells: 0,
    ...overrides,
  };
}

export function makeOptionPosition(overrides: Partial<OptionPosition> = {}): OptionPosition {
  // Post-PARSE defaults (optionType/strikePrice empty — the join fills
  // them), per-share averageCost — a spec that wants joined fields must
  // say so, or a broken join could pass silently.
  return {
    instrumentId: 'inst-1',
    chainSymbol: 'AAPL',
    optionType: '',
    strikePrice: null,
    side: 'long',
    expirationDate: '2026-12-15',
    quantity: 1,
    averageCost: 5,
    multiplier: 100,
    ...overrides,
  };
}

export function makeEquityQuote(overrides: Partial<EquityQuote> = {}): EquityQuote {
  return {
    symbol: 'AAPL',
    lastTradePrice: 155,
    previousClose: 152,
    ...overrides,
  };
}

export function makeOptionInstrument(overrides: Partial<OptionInstrument> = {}): OptionInstrument {
  return {
    instrumentId: 'inst-1',
    chainId: 'chain-1',
    chainSymbol: 'AAPL',
    expirationDate: '2026-12-15',
    strikePrice: 150,
    type: 'call',
    ...overrides,
  };
}

export function makeOptionQuote(overrides: Partial<OptionQuote> = {}): OptionQuote {
  return {
    instrumentId: 'inst-1',
    lastTradePrice: 550,
    previousClose: 500,
    ...overrides,
  };
}

export function makeOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return {
    orderId: 'order-1',
    accountNumber: '123456789',
    instrumentType: 'equity',
    symbol: 'AAPL',
    side: 'buy',
    type: 'market',
    state: 'filled',
    quantity: 100,
    cumulativeQuantity: 100,
    price: 150,
    stopPrice: null,
    averageFillPrice: 150,
    createdAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

export function makeOptionOrder(overrides: Partial<BrokerOrder> = {}): BrokerOrder {
  return makeOrder({ instrumentType: 'option', ...overrides });
}

// ---------------------------------------------------------------------------
// Mock client
// ---------------------------------------------------------------------------

/** Minimal spec shape — parse is unused: executeBatch is stubbed, so the
 *  real client's parse functions never run inside store specs. */
export interface MockToolSpec {
  tool: string;
  args?: Record<string, unknown>;
}

/** Parsed page shape the positions page-specs resolve to (#1474 — the
 *  store's positions walk reads `positions`/`next` off each settled page,
 *  same as the orders walk reads `orders`/`next`). */
export function positionsPage<T>(positions: T[], next: string | null = null): { positions: T[]; next: string | null } {
  return { positions, next };
}

export type MockClient = {
  getAccounts: jasmine.Spy;
  getPortfolio: jasmine.Spy;
  getEquityPositions: jasmine.Spy;
  getOptionPositions: jasmine.Spy;
  getEquityQuotes: jasmine.Spy;
  getOptionQuotes: jasmine.Spy;
  getOptionInstruments: jasmine.Spy;
  getEquityOrders: jasmine.Spy;
  getOptionOrders: jasmine.Spy;
  executeBatch: jasmine.Spy;
  portfolioSpec: (accountNumber: string) => MockToolSpec;
  equityOrdersPageSpec: (accountNumber: string, opts?: { cursor?: string }) => MockToolSpec;
  optionOrdersPageSpec: (accountNumber: string, opts?: { cursor?: string }) => MockToolSpec;
  equityPositionsPageSpec: (accountNumber: string, opts?: { cursor?: string }) => MockToolSpec;
  optionPositionsPageSpec: (accountNumber: string, opts?: { cursor?: string; nonzero?: boolean }) => MockToolSpec;
};

export function createMockClient(): MockClient {
  return {
    getAccounts: jasmine.createSpy('getAccounts'),
    getPortfolio: jasmine.createSpy('getPortfolio'),
    getEquityPositions: jasmine.createSpy('getEquityPositions'),
    getOptionPositions: jasmine.createSpy('getOptionPositions'),
    getEquityQuotes: jasmine.createSpy('getEquityQuotes'),
    getOptionQuotes: jasmine.createSpy('getOptionQuotes'),
    // Defaulted: the quote wave always calls this when option positions
    // exist — unstubbed it'd resolve `undefined` and the instruments Map
    // build would throw. Tests override where the join matters (#1481).
    getOptionInstruments: jasmine.createSpy('getOptionInstruments').and.returnValue(Promise.resolve([])),
    getEquityOrders: jasmine.createSpy('getEquityOrders'),
    getOptionOrders: jasmine.createSpy('getOptionOrders'),
    executeBatch: jasmine.createSpy('executeBatch'),
    portfolioSpec: (accountNumber) => ({ tool: 'get_portfolio', args: { account_number: accountNumber } }),
    equityOrdersPageSpec: (accountNumber, opts) => ({ tool: 'get_equity_orders', args: { account_number: accountNumber, ...(opts?.cursor ? { cursor: opts.cursor } : {}) } }),
    optionOrdersPageSpec: (accountNumber, opts) => ({ tool: 'get_option_orders', args: { account_number: accountNumber, ...(opts?.cursor ? { cursor: opts.cursor } : {}) } }),
    equityPositionsPageSpec: (accountNumber, opts) => ({ tool: 'get_equity_positions', args: { account_number: accountNumber, ...(opts?.cursor ? { cursor: opts.cursor } : {}) } }),
    optionPositionsPageSpec: (accountNumber, opts) => ({ tool: 'get_option_positions', args: { account_number: accountNumber, ...(opts?.nonzero ? { nonzero: true } : {}), ...(opts?.cursor ? { cursor: opts.cursor } : {}) } }),
  };
}

export interface MockPeakService {
  derivePeaks: jasmine.Spy;
}

export function createMockPeakService(): MockPeakService {
  return {
    derivePeaks: jasmine.createSpy('derivePeaks').and.returnValue(Promise.resolve({})),
  };
}

export function setupStore(
  clientMock: MockClient,
  peakService: MockPeakService = createMockPeakService(),
): InstanceType<typeof PortfolioDashboardStore> {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      PortfolioDashboardStore,
      { provide: RobinhoodMcpClient, useValue: clientMock },
      { provide: PositionPeakService, useValue: peakService },
    ],
  });
  return TestBed.inject(PortfolioDashboardStore);
}

/** Resolve a spy with a value (Promise.resolve shorthand). */
export function resolve<T>(value: T): Promise<T> {
  return Promise.resolve(value);
}

/** Reject a spy with an error (Promise.reject shorthand). */
export function reject(error: string): Promise<never> {
  return Promise.reject(new Error(error));
}

/** PromiseSettledResult fixtures for stubbing executeBatch. */
export function fulfilled<T>(value: T): PromiseSettledResult<T> {
  return { status: 'fulfilled', value };
}

export function rejected(error: string): PromiseSettledResult<never> {
  return { status: 'rejected', reason: new Error(error) };
}

/** Paginated list tools answer executeBatch with page envelopes —
 *  orders {orders, next} since #1411, positions {positions, next} since
 *  #1474 — the store walks cursors per depth round. */
const PAGE_TOOLS: Record<string, 'orders' | 'positions'> = {
  get_equity_orders: 'orders',
  get_option_orders: 'orders',
  get_equity_positions: 'positions',
  get_option_positions: 'positions',
};

/** Empty settled answer for one spec — page tools get an empty envelope,
 *  everything else an empty array. For gating callFakes that resolve every
 *  spec with a blank result (`specs.map(emptySpecAnswer)`). */
export function emptySpecAnswer(spec: MockToolSpec): PromiseSettledResult<unknown> {
  const key = PAGE_TOOLS[spec.tool];
  return fulfilled(key ? { [key]: [], next: null } : []);
}

/** Stub executeBatch to answer each spec from a tool→settled-result table.
 *  A table entry may be a function of the spec for account-specific answers.
 *  Page-tool entries may stay plain arrays — they're wrapped into
 *  single-page envelopes ({items, next: null}) automatically; to answer a
 *  multi-page walk, return fulfilled({orders|positions, next}) from a
 *  function. */
export function batchAnswers(
  client: MockClient,
  table: Record<string, PromiseSettledResult<unknown> | ((spec: MockToolSpec) => PromiseSettledResult<unknown>)>,
): void {
  client.executeBatch.and.callFake((specs: MockToolSpec[]) =>
    Promise.resolve(specs.map((s) => {
      const entry = table[s.tool];
      const result = typeof entry === 'function' ? entry(s) : entry ?? rejected(`unstubbed tool ${s.tool}`);
      const key = PAGE_TOOLS[s.tool];
      if (key && result.status === 'fulfilled' && Array.isArray(result.value)) {
        return fulfilled({ [key]: result.value, next: null });
      }
      return result;
    })));
}
