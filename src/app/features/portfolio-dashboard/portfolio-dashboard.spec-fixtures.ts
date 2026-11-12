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
  return {
    instrumentId: 'inst-1',
    chainSymbol: 'AAPL',
    optionType: 'call',
    strikePrice: 150,
    expirationDate: '2026-12-15',
    quantity: 1,
    averageCost: 500,
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

export type MockClient = {
  getAccounts: jasmine.Spy;
  getPortfolio: jasmine.Spy;
  getEquityPositions: jasmine.Spy;
  getOptionPositions: jasmine.Spy;
  getEquityQuotes: jasmine.Spy;
  getOptionQuotes: jasmine.Spy;
  getEquityOrders: jasmine.Spy;
  getOptionOrders: jasmine.Spy;
  executeBatch: jasmine.Spy;
  portfolioSpec: (accountNumber: string) => MockToolSpec;
  equityPositionsSpec: (accountNumber: string) => MockToolSpec;
  optionPositionsSpec: (accountNumber: string, nonzero?: boolean) => MockToolSpec;
  equityOrdersSpec: (accountNumber: string) => MockToolSpec;
  optionOrdersSpec: (accountNumber: string) => MockToolSpec;
  equityOrdersPageSpec: (accountNumber: string, opts?: { cursor?: string }) => MockToolSpec;
  optionOrdersPageSpec: (accountNumber: string, opts?: { cursor?: string }) => MockToolSpec;
};

export function createMockClient(): MockClient {
  return {
    getAccounts: jasmine.createSpy('getAccounts'),
    getPortfolio: jasmine.createSpy('getPortfolio'),
    getEquityPositions: jasmine.createSpy('getEquityPositions'),
    getOptionPositions: jasmine.createSpy('getOptionPositions'),
    getEquityQuotes: jasmine.createSpy('getEquityQuotes'),
    getOptionQuotes: jasmine.createSpy('getOptionQuotes'),
    getEquityOrders: jasmine.createSpy('getEquityOrders'),
    getOptionOrders: jasmine.createSpy('getOptionOrders'),
    executeBatch: jasmine.createSpy('executeBatch'),
    portfolioSpec: (accountNumber) => ({ tool: 'get_portfolio', args: { account_number: accountNumber } }),
    equityPositionsSpec: (accountNumber) => ({ tool: 'get_equity_positions', args: { account_number: accountNumber } }),
    optionPositionsSpec: (accountNumber, nonzero) => ({ tool: 'get_option_positions', args: { account_number: accountNumber, ...(nonzero ? { nonzero: true } : {}) } }),
    equityOrdersSpec: (accountNumber) => ({ tool: 'get_equity_orders', args: { account_number: accountNumber } }),
    optionOrdersSpec: (accountNumber) => ({ tool: 'get_option_orders', args: { account_number: accountNumber } }),
    equityOrdersPageSpec: (accountNumber, opts) => ({ tool: 'get_equity_orders', args: { account_number: accountNumber, ...(opts?.cursor ? { cursor: opts.cursor } : {}) } }),
    optionOrdersPageSpec: (accountNumber, opts) => ({ tool: 'get_option_orders', args: { account_number: accountNumber, ...(opts?.cursor ? { cursor: opts.cursor } : {}) } }),
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

/** Order-list tools answer executeBatch with page envelopes ({orders, next})
 *  since #1411 — the store walks cursors per depth round. */
const ORDERS_PAGE_TOOLS = new Set(['get_equity_orders', 'get_option_orders']);

/** Empty settled answer for one spec — orders tools get a page envelope,
 *  everything else an empty array. For gating callFakes that resolve every
 *  spec with a blank result (`specs.map(emptySpecAnswer)`). */
export function emptySpecAnswer(spec: MockToolSpec): PromiseSettledResult<unknown> {
  return fulfilled(ORDERS_PAGE_TOOLS.has(spec.tool) ? { orders: [], next: null } : []);
}

/** Stub executeBatch to answer each spec from a tool→settled-result table.
 *  A table entry may be a function of the spec for account-specific answers.
 *  Orders-tool entries may stay plain BrokerOrder[] — they're wrapped into
 *  single-page envelopes ({orders, next: null}) automatically; to answer a
 *  multi-page walk, return fulfilled({orders, next}) from a function. */
export function batchAnswers(
  client: MockClient,
  table: Record<string, PromiseSettledResult<unknown> | ((spec: MockToolSpec) => PromiseSettledResult<unknown>)>,
): void {
  client.executeBatch.and.callFake((specs: MockToolSpec[]) =>
    Promise.resolve(specs.map((s) => {
      const entry = table[s.tool];
      const result = typeof entry === 'function' ? entry(s) : entry ?? rejected(`unstubbed tool ${s.tool}`);
      if (ORDERS_PAGE_TOOLS.has(s.tool) && result.status === 'fulfilled' && Array.isArray(result.value)) {
        return fulfilled({ orders: result.value, next: null });
      }
      return result;
    })));
}
