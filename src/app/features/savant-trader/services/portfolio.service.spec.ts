import { TestBed } from '@angular/core/testing';

import { PortfolioService } from './portfolio.service';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';

describe('PortfolioService', () => {
  let service: PortfolioService;
  let mcp: { executeTool: jasmine.Spy };

  beforeEach(() => {
    mcp = { executeTool: jasmine.createSpy('executeTool') };
    TestBed.configureTestingModule({
      providers: [
        PortfolioService,
        { provide: RobinhoodMcpObservationService, useValue: mcp },
      ],
    });
    service = TestBed.inject(PortfolioService);
  });

  it('returns one canonical account snapshot from portfolio and positions', async () => {
    mcp.executeTool.and.callFake((tool: string) => Promise.resolve(tool === 'get_portfolio'
      ? {
          success: true,
          parsed: {
            data: {
              total_value: '24964.02642795',
              equity_value: '163.80642795',
              cash: '24800.22',
              buying_power: { buying_power: '24800.2200' },
            },
          },
        }
      : {
          success: true,
          parsed: {
            data: {
              positions: [
                { symbol: 'SNDK', quantity: '0.049734', average_buy_price: '2010.700000', type: 'long' },
                { symbol: 'BTSG', quantity: '1.484780', average_buy_price: '67.350000', type: 'long' },
              ],
            },
          },
        }));

    const snapshot = await service.getSnapshot('agentic-account', 100);

    expect(snapshot).toEqual({
      accountValue: 24964.02642795,
      exposure: 163.80642795,
      cash: 24800.22,
      positionCount: 2,
      units: 1.64,
    });
    expect(mcp.executeTool).toHaveBeenCalledWith('get_portfolio', { args: { account_number: 'agentic-account' } });
    expect(mcp.executeTool).toHaveBeenCalledWith('get_equity_positions', { args: { account_number: 'agentic-account' } });
  });

  it('requests portfolio and positions concurrently', async () => {
    const resolvers: Array<(value: unknown) => void> = [];
    mcp.executeTool.and.callFake(() => new Promise((resolve) => resolvers.push(resolve)));

    const result = service.getSnapshot('agentic-account', 100);

    expect(mcp.executeTool).toHaveBeenCalledTimes(2);
    resolvers[0]({ success: true, parsed: { data: { total_value: '100', equity_value: '0', cash: '100' } } });
    resolvers[1]({ success: true, parsed: { data: { positions: [] } } });
    await result;
  });
});
