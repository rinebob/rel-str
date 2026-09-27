/**
 * Unit tests for PaperTradingService — verifies httpsCallable wiring with
 * the correct callable names, request pass-through, and response mapping.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { lastValueFrom } from 'rxjs';

import { PaperTradingService } from './paper-trading.service';
import { CallableName } from '../../../core/common/constants';
import { TradeSide } from '@common';

describe('PaperTradingService', () => {
  let service: PaperTradingService;
  let mockCallable: jest.Mock;

  beforeEach(() => {
    mockCallable = jest.fn().mockResolvedValue({ data: { ok: true } });
    (httpsCallable as jest.Mock).mockReturnValue(mockCallable);

    TestBed.configureTestingModule({
      providers: [
        PaperTradingService,
        { provide: Functions, useValue: {} },
      ],
    });
    service = TestBed.inject(PaperTradingService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('paperSignalOrder$ calls the right callable and unwraps res.data', async () => {
    const req = {
      signalId: 'sig-1',
      symbol: 'QQQM',
      direction: TradeSide.SHORT,
      refId: 'r-1',
    };
    const res = await lastValueFrom(service.paperSignalOrder$(req));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.PAPER_SIGNAL_ORDER);
    expect(mockCallable).toHaveBeenCalledWith(req);
    expect(res).toEqual({ ok: true });
  });

  it('listPaperTrades$ passes filters and defaults to {}', async () => {
    await lastValueFrom(service.listPaperTrades$({ cohortId: 'c-1' }));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.LIST_PAPER_TRADES);
    expect(mockCallable).toHaveBeenCalledWith({ cohortId: 'c-1' });

    await lastValueFrom(service.listPaperTrades$());
    expect(mockCallable).toHaveBeenCalledWith({});
  });

  it('getPaperStats$ passes scope; getPaperAccount$/listExitVariants$ send {}', async () => {
    await lastValueFrom(service.getPaperStats$({ scope: 'sym-QQQM' }));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_PAPER_STATS);
    expect(mockCallable).toHaveBeenCalledWith({ scope: 'sym-QQQM' });

    await lastValueFrom(service.getPaperAccount$());
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_PAPER_ACCOUNT);
    expect(mockCallable).toHaveBeenCalledWith({});

    await lastValueFrom(service.listExitVariants$());
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.LIST_EXIT_VARIANTS);
  });

  it('propagates callable errors to the subscriber', async () => {
    mockCallable.mockRejectedValue(new Error('unauthenticated'));
    await expect(
      lastValueFrom(service.listPaperTrades$()),
    ).rejects.toThrow('unauthenticated');
  });
});
