import { TestBed } from '@angular/core/testing';

import { EquityPriceService } from './equity-price.service';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';

describe('EquityPriceService', () => {
  it('extracts nested quotes and suppresses duplicate symbol-set requests', async () => {
    const mcp = {
      executeTool: jasmine.createSpy('executeTool').and.returnValue(Promise.resolve({
        success: true,
        parsed: { data: { results: [
          { quote: { symbol: 'DELL', last_trade_price: '463.690000' } },
          { quote: { symbol: 'KRYS', last_trade_price: '359.970000' } },
        ] } },
      })),
    };
    TestBed.configureTestingModule({
      providers: [
        EquityPriceService,
        { provide: RobinhoodMcpObservationService, useValue: mcp },
      ],
    });
    const service = TestBed.inject(EquityPriceService);

    await service.fetchPrices(['DELL', 'KRYS']);
    await service.fetchPrices(['KRYS', 'DELL', 'DELL']);

    expect(service.prices()).toEqual({ DELL: 463.69, KRYS: 359.97 });
    expect(mcp.executeTool).toHaveBeenCalledTimes(1);
  });
});
