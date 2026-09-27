/**
 * AllocationDataService — MCP assembly (Blueprint #582 / task #586).
 * RobinhoodMcpClient is stubbed; asserts the wrapper contract: all
 * accounts surfaced, positions priced via quotes, fills expanded across
 * both order families with equity-position context for sell→close
 * inference.
 */

import { TestBed } from '@angular/core/testing';
import { AllocationDataService } from './allocation-data.service';
import { RobinhoodMcpClient } from '../../core/robinhood-mcp/robinhood-mcp-client.service';
import type {
  BrokerOrder,
  EquityPosition,
  OptionPosition,
} from '../../core/robinhood-mcp/types/robinhood-mcp.types';

const ACCT = '5AC12345';

const mcpStub = {
  getAccounts: jest.fn(),
  getPortfolio: jest.fn(),
  getEquityPositions: jest.fn(),
  getOptionPositions: jest.fn(),
  getEquityQuotes: jest.fn(),
  getOptionQuotes: jest.fn(),
  getEquityOrders: jest.fn(),
  getOptionOrders: jest.fn(),
};

const equity: EquityPosition = {
  symbol: 'AAPL', quantity: 10, averageBuyPrice: 150, sharesHeldForSells: 10,
};
const option: OptionPosition = {
  instrumentId: 'uuid-put', chainSymbol: 'AAPL', optionType: 'put',
  strikePrice: 140, expirationDate: '2026-10-16', quantity: -1, averageCost: 3.0,
};
const equityOrder: BrokerOrder = {
  orderId: 'eq-1', accountNumber: ACCT, instrumentType: 'equity', symbol: 'AAPL',
  side: 'sell', type: 'market', state: 'filled', quantity: 5, cumulativeQuantity: 5,
  price: null, stopPrice: null, averageFillPrice: 160, createdAt: '2026-09-20T14:00:00Z',
};
const optionOrder: BrokerOrder = {
  orderId: 'ord-9', accountNumber: ACCT, instrumentType: 'option', symbol: 'AAPL',
  side: 'buy', type: 'limit', state: 'filled', quantity: 1, cumulativeQuantity: 1,
  price: 1.0, stopPrice: null, averageFillPrice: 0.95, createdAt: '2026-09-21T15:00:00Z',
  legs: [
    { side: 'buy', optionId: 'uuid-long', quantity: 1, positionEffect: 'open' },
    { side: 'sell', optionId: 'uuid-short', quantity: 1, positionEffect: 'open' },
  ],
};

describe('AllocationDataService', () => {
  let service: AllocationDataService;

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        AllocationDataService,
        { provide: RobinhoodMcpClient, useValue: mcpStub },
      ],
    });
    service = TestBed.inject(AllocationDataService);
  });

  it('listAccounts returns every account incl. non-agentic, flag intact', async () => {
    mcpStub.getAccounts.mockResolvedValue([
      { accountNumber: 'A1', accountName: 'Main', accountType: 'margin', agenticAllowed: true },
      { accountNumber: 'A2', accountName: 'IRA', accountType: 'cash', agenticAllowed: false },
    ]);
    const accounts = await service.listAccounts();
    expect(accounts.map((a) => a.accountNumber)).toEqual(['A1', 'A2']);
    expect(accounts[1].agenticAllowed).toBe(false);
  });

  it('getSnapshot passes through broker-reported cash', async () => {
    mcpStub.getPortfolio.mockResolvedValue({
      totalValue: 100000, equityValue: 60000, cash: 40000,
      buyingPower: 40000, marginExposure: null,
    });
    const snap = await service.getSnapshot(ACCT);
    expect(snap.cash).toBe(40000);
  });

  it('getPositions merges equity + option positions priced via both quote maps', async () => {
    mcpStub.getEquityPositions.mockResolvedValue([equity]);
    mcpStub.getOptionPositions.mockResolvedValue([option]);
    mcpStub.getEquityQuotes.mockResolvedValue(
      new Map([['AAPL', { symbol: 'AAPL', lastTradePrice: 160, previousClose: 158 }]]));
    mcpStub.getOptionQuotes.mockResolvedValue(
      new Map([['uuid-put', { instrumentId: 'uuid-put', lastTradePrice: 2.5, previousClose: 2.4 }]]));

    const positions = await service.getPositions(ACCT);

    expect(mcpStub.getEquityQuotes).toHaveBeenCalledWith(['AAPL']);
    expect(mcpStub.getOptionQuotes).toHaveBeenCalledWith(['uuid-put']);
    expect(positions).toEqual([
      { instrumentId: 'AAPL', quantity: 10, marketValue: 1600, costBasis: 1500 },
      { instrumentId: 'uuid-put', quantity: -1, marketValue: -250, costBasis: -300 },
    ]);
  });

  it('getFills expands option legs and infers equity sell→close from positions', async () => {
    mcpStub.getEquityOrders.mockResolvedValue([equityOrder]);
    mcpStub.getOptionOrders.mockResolvedValue([optionOrder]);
    mcpStub.getEquityPositions.mockResolvedValue([equity]); // 10 held, sell 5 → close

    const fills = await service.getFills(ACCT);

    expect(fills).toEqual([
      { instrumentId: 'AAPL', side: 'sell', positionEffect: 'close', quantity: 5, price: 160, multiplier: 1, filledAt: '2026-09-20T14:00:00Z' },
      { instrumentId: 'uuid-long', side: 'buy', positionEffect: 'open', quantity: 1, price: 0.95, multiplier: 100, filledAt: '2026-09-21T15:00:00Z' },
      { instrumentId: 'uuid-short', side: 'sell', positionEffect: 'open', quantity: 1, price: 0.95, multiplier: 100, filledAt: '2026-09-21T15:00:00Z' },
    ]);
  });

  it('getFills treats an equity sell with no position as unflagged (no phantom close)', async () => {
    mcpStub.getEquityOrders.mockResolvedValue([equityOrder]);
    mcpStub.getOptionOrders.mockResolvedValue([]);
    mcpStub.getEquityPositions.mockResolvedValue([]);

    const fills = await service.getFills(ACCT);
    expect(fills[0].positionEffect).toBeUndefined();
  });
});
