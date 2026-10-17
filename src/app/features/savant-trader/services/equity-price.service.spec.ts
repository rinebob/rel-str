import { TestBed } from '@angular/core/testing';

import { EquityPriceService } from './equity-price.service';
import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';

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

  it('populates the full quote map — last/prev close/bid/ask per symbol', async () => {
    const mcp = {
      executeTool: jasmine.createSpy('executeTool').and.returnValue(Promise.resolve({
        success: true,
        parsed: { data: { results: [
          {
            quote: {
              symbol: 'AAPL',
              last_trade_price: '200.500000',
              bid_price: '200.40',
              ask_price: '200.60',
              previous_close: '198.00',
            },
            close: { price: '198.00' },
          },
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

    await service.fetchPrices(['AAPL']);

    expect(service.prices()['AAPL']).toBe(200.5);
    expect(service.quotes()['AAPL']).toEqual({
      symbol: 'AAPL',
      lastTradePrice: 200.5,
      previousClose: 198,
      bidPrice: 200.4,
      askPrice: 200.6,
    });
  });
});
