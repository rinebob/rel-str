/**
 * Shared test fixtures for PortfolioDashboardStore specs.
 */

import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';

import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import { RobinhoodMcpClient } from '../../core/robinhood-mcp/robinhood-mcp-client.service';
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

export type MockClient = {
  getAccounts: jasmine.Spy;
  getPortfolio: jasmine.Spy;
  getEquityPositions: jasmine.Spy;
  getOptionPositions: jasmine.Spy;
  getEquityQuotes: jasmine.Spy;
  getOptionQuotes: jasmine.Spy;
  getEquityOrders: jasmine.Spy;
  getOptionOrders: jasmine.Spy;
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
  };
}

export function setupStore(clientMock: MockClient): InstanceType<typeof PortfolioDashboardStore> {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      PortfolioDashboardStore,
      { provide: RobinhoodMcpClient, useValue: clientMock },
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
