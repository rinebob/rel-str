import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { PortfolioService } from './portfolio.service';
import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { RobinhoodMcpClient } from '../../../core/robinhood-mcp/robinhood-mcp-client.service';

describe('PortfolioService', () => {
  let service: PortfolioService;
  let mcp: { executeTool: jasmine.Spy };
  let rhClient: { getEquityPositionsRaw: jasmine.Spy };

  beforeEach(() => {
    mcp = { executeTool: jasmine.createSpy('executeTool') };
    rhClient = { getEquityPositionsRaw: jasmine.createSpy('getEquityPositionsRaw') };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        PortfolioService,
        { provide: RobinhoodMcpObservationService, useValue: mcp },
        { provide: RobinhoodMcpClient, useValue: rhClient },
      ],
    });
    service = TestBed.inject(PortfolioService);
  });

  it('returns one canonical account snapshot from portfolio and positions', async () => {
    mcp.executeTool.and.callFake(() => Promise.resolve({
      success: true,
      parsed: {
        data: {
          total_value: '24964.02642795',
          equity_value: '163.80642795',
          cash: '24800.22',
          buying_power: { buying_power: '24800.2200' },
        },
      },
    }));
    rhClient.getEquityPositionsRaw.and.returnValue(Promise.resolve([
      { symbol: 'SNDK', quantity: '0.049734', average_buy_price: '2010.700000', type: 'long' },
      { symbol: 'BTSG', quantity: '1.484780', average_buy_price: '67.350000', type: 'long' },
    ]));

    const snapshot = await service.getSnapshot('agentic-account', 100);

    expect(snapshot).toEqual({
      accountValue: 24964.02642795,
      exposure: 163.80642795,
      cash: 24800.22,
      positionCount: 2,
      units: 1.64,
      positions: [
        { symbol: 'SNDK', quantity: '0.049734', averageBuyPrice: '2010.700000', sharesHeldForSells: '0' },
        { symbol: 'BTSG', quantity: '1.484780', averageBuyPrice: '67.350000', sharesHeldForSells: '0' },
      ],
    });
    expect(mcp.executeTool).toHaveBeenCalledWith('get_portfolio', { args: { account_number: 'agentic-account' } });
    // Positions now walk pages through the client (#1474) — a page-1-only
    // fetch would drop positions past the first page on a large account.
    expect(rhClient.getEquityPositionsRaw).toHaveBeenCalledWith('agentic-account');
  });

  it('requests portfolio and positions concurrently', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mcp.executeTool.and.callFake(() => new Promise((resolve) => resolvers.push(resolve)));
    rhClient.getEquityPositionsRaw.and.callFake(() => new Promise((resolve) => resolvers.push(resolve)));

    const result = service.getSnapshot('agentic-account', 100);

    expect(mcp.executeTool).toHaveBeenCalledTimes(1);
    expect(rhClient.getEquityPositionsRaw).toHaveBeenCalledTimes(1);
    resolvers[0]({ success: true, parsed: { data: { total_value: '100', equity_value: '0', cash: '100' } } });
    resolvers[1]([]);
    await result;
  });

  it('returns null when the positions walk rejects (#1474 — no silent empty)', async () => {
    mcp.executeTool.and.callFake(() => Promise.resolve({
      success: true,
      parsed: { data: { total_value: '100', equity_value: '0', cash: '100' } },
    }));
    rhClient.getEquityPositionsRaw.and.returnValue(Promise.reject(new Error('positions down')));
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const snapshot = await service.getSnapshot('agentic-account', 100);
      expect(snapshot).toBeNull();
      expect(err).toHaveBeenCalled();
    } finally {
      err.mockRestore();
    }
  });
});
