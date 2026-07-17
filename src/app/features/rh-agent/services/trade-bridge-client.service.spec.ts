import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import {
  TRADE_BRIDGE_PROMPT,
  TRADE_BRIDGE_SESSION_STORAGE,
  TradeBridgeClientResult,
  TradeBridgeClientService,
  TradeBridgeResponse,
  TradeBridgeTrade,
} from './trade-bridge-client.service';

const TOKEN = 'test-session-token';
const STORAGE_KEY = 'rhAgentTradeBridgeToken';
const URL = 'http://127.0.0.1:3001/trade';
const TRADE: TradeBridgeTrade = {
  symbol: 'AAPL',
  side: 'buy',
  amount: 10,
  orderType: 'market',
};
const RESPONSE: TradeBridgeResponse = {
  success: true,
  count: 1,
  requestedCount: 1,
  results: [{
    trade: { symbol: 'AAPL' },
    parsed: { confirmed: true, orderId: 'fake-order', state: 'queued' },
  }],
};

describe('TradeBridgeClientService', () => {
  let service: TradeBridgeClientService;
  let http: HttpTestingController;
  let storage: Storage;
  let prompt: jasmine.Spy<(message: string) => string | null>;

  beforeEach(() => {
    storage = {
      length: 0,
      clear: jasmine.createSpy('clear'),
      getItem: jasmine.createSpy('getItem'),
      key: jasmine.createSpy('key'),
      removeItem: jasmine.createSpy('removeItem'),
      setItem: jasmine.createSpy('setItem'),
    };
    prompt = jasmine.createSpy('prompt');

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: TRADE_BRIDGE_SESSION_STORAGE, useValue: storage },
        { provide: TRADE_BRIDGE_PROMPT, useValue: prompt },
      ],
    });
    service = TestBed.inject(TradeBridgeClientService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
  });

  it('reuses the stored token without prompting', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(TOKEN);
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne(URL);
    expect(prompt).not.toHaveBeenCalled();
    expect(request.request.headers.get('X-Trade-Bridge-Token')).toBe(TOKEN);
    request.flush(RESPONSE);
    expect(result).toEqual({ ok: true, response: RESPONSE });
  });

  it('returns a typed cancellation result without sending a request', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(null);
    prompt.and.returnValue(null);
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    http.expectNone(URL);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'cancelled', message: 'Trade bridge token entry was cancelled' },
    });
  });

  it('trims and stores a prompted token and sends the required request headers', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(null);
    prompt.and.returnValue(`  ${TOKEN}  `);

    service.executeTrades([TRADE]).subscribe();

    const request = http.expectOne(URL);
    expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEY, TOKEN);
    expect(request.request.method).toBe('POST');
    expect(request.request.headers.get('X-Trade-Bridge-Token')).toBe(TOKEN);
    expect(request.request.body).toEqual({ trades: [TRADE] });
    request.flush(RESPONSE);
  });

  it('clears a stale token and returns a typed unauthorized result on 401', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(TOKEN);
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne(URL);
    request.flush({ error: 'Invalid trade bridge token' }, { status: 401, statusText: 'Unauthorized' });

    expect(storage.removeItem).toHaveBeenCalledWith(STORAGE_KEY);
    expect(result).toEqual({
      ok: false,
      error: {
        kind: 'unauthorized',
        status: 401,
        message: 'Trade bridge token expired. Retry and enter the token shown by the bridge.',
      },
    });
  });

  it('returns a typed request failure when reading session storage throws', () => {
    (storage.getItem as jasmine.Spy).and.throwError(new Error('getItem blocked'));
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    http.expectNone(URL);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', status: undefined, message: 'Trade bridge client failed: getItem blocked' },
    });
  });

  it('returns a typed request failure when the token prompt throws', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(null);
    prompt.and.throwError(new Error('prompt blocked'));
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    http.expectNone(URL);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', status: undefined, message: 'Trade bridge client failed: prompt blocked' },
    });
  });

  it('returns a typed request failure when storing a prompted token throws', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(null);
    prompt.and.returnValue(TOKEN);
    (storage.setItem as jasmine.Spy).and.throwError(new Error('setItem blocked'));
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    http.expectNone(URL);
    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', status: undefined, message: 'Trade bridge client failed: setItem blocked' },
    });
  });

  it('returns a typed request failure when clearing a stale token throws', () => {
    (storage.getItem as jasmine.Spy).and.returnValue(TOKEN);
    (storage.removeItem as jasmine.Spy).and.throwError(new Error('removeItem blocked'));
    let result: TradeBridgeClientResult | undefined;

    service.executeTrades([TRADE]).subscribe((value) => {
      result = value;
    });

    const request = http.expectOne(URL);
    request.flush({ error: 'Invalid trade bridge token' }, { status: 401, statusText: 'Unauthorized' });

    expect(result).toEqual({
      ok: false,
      error: { kind: 'request', status: 401, message: 'Trade bridge client failed: removeItem blocked' },
    });
  });
});
