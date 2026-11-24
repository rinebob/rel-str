/**
 * Unit tests for SignalReviewService — verifies httpsCallable wiring with
 * the correct callable names, request pass-through, and response mapping.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));

import { TestBed } from '@angular/core/testing';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { lastValueFrom } from 'rxjs';

import { SignalReviewService } from './signal-review.service';
import { CallableName } from '../../../core/common/constants';

describe('SignalReviewService', () => {
  let service: SignalReviewService;
  let mockCallable: jest.Mock;

  beforeEach(() => {
    mockCallable = jest.fn().mockResolvedValue({ data: { ok: true } });
    (httpsCallable as jest.Mock).mockReturnValue(mockCallable);

    TestBed.configureTestingModule({
      providers: [
        SignalReviewService,
        { provide: Functions, useValue: {} },
      ],
    });
    service = TestBed.inject(SignalReviewService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('getSignalReviewQueue$ sends {} to the queue callable', async () => {
    const res = await lastValueFrom(service.getSignalReviewQueue$());
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_SIGNAL_REVIEW_QUEUE);
    expect(mockCallable).toHaveBeenCalledWith({});
    expect(res).toEqual({ ok: true });
  });

  it('getSignalReviewBundle$ passes the symbol verbatim', async () => {
    await lastValueFrom(service.getSignalReviewBundle$('AAPL'));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GET_SIGNAL_REVIEW_BUNDLE);
    expect(mockCallable).toHaveBeenCalledWith({ symbol: 'AAPL' });
  });

  it('generatePaperSignalTrades$ passes the picks verbatim', async () => {
    const req = { items: [{ symbol: 'AAPL', signalBarDate: '2026-11-14', signalType: 'D_ST_TREND_RIDER_V2_LONG' }] };
    const res = await lastValueFrom(service.generatePaperSignalTrades$(req));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.GENERATE_PAPER_SIGNAL_TRADES);
    expect(mockCallable).toHaveBeenCalledWith(req);
    expect(res).toEqual({ ok: true });
  });

  it('deletePaperTrades$ passes the trade ids verbatim', async () => {
    const req = { tradeIds: ['pt-1', 'pt-2'] };
    await lastValueFrom(service.deletePaperTrades$(req));
    expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), CallableName.DELETE_PAPER_TRADES);
    expect(mockCallable).toHaveBeenCalledWith(req);
  });

  it('callable-name parity — enum literals match the index.ts export names', () => {
    expect(CallableName.GET_SIGNAL_REVIEW_QUEUE).toBe('getSignalReviewQueue');
    expect(CallableName.GET_SIGNAL_REVIEW_BUNDLE).toBe('getSignalReviewBundle');
    expect(CallableName.GENERATE_PAPER_SIGNAL_TRADES).toBe('generatePaperSignalTrades');
    expect(CallableName.DELETE_PAPER_TRADES).toBe('deletePaperTrades');
  });
});
