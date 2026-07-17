import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable, catchError, defer, map, of } from 'rxjs';

const TRADE_BRIDGE_URL = 'http://127.0.0.1:3001/trade';
const TRADE_BRIDGE_TOKEN_HEADER = 'X-Trade-Bridge-Token';
const TRADE_BRIDGE_TOKEN_STORAGE_KEY = 'rhAgentTradeBridgeToken';
const TRADE_BRIDGE_TOKEN_PROMPT = 'Enter the session token shown in the trade bridge terminal:';

export const TRADE_BRIDGE_SESSION_STORAGE = new InjectionToken<Storage>('TRADE_BRIDGE_SESSION_STORAGE', {
  providedIn: 'root',
  factory: () => window.sessionStorage,
});

export const TRADE_BRIDGE_PROMPT = new InjectionToken<(message: string) => string | null>('TRADE_BRIDGE_PROMPT', {
  providedIn: 'root',
  factory: () => window.prompt.bind(window),
});

export interface TradeBridgeTrade {
  symbol: string;
  side: 'buy' | 'sell';
  amount: number;
  orderType: 'market' | 'limit';
  limitPrice?: number;
}

export interface TradeBridgeResult {
  trade: { symbol: string };
  parsed: {
    confirmed: boolean;
    orderId?: string;
    state?: string;
    error?: string;
  };
}

export interface TradeBridgeResponse {
  success: boolean;
  count: number;
  requestedCount: number;
  results: TradeBridgeResult[];
}

export interface TradeBridgeTransportError {
  kind: 'cancelled' | 'unauthorized' | 'request';
  message: string;
  status?: number;
}

export type TradeBridgeClientResult =
  | { ok: true; response: TradeBridgeResponse }
  | { ok: false; error: TradeBridgeTransportError };

@Injectable({ providedIn: 'root' })
export class TradeBridgeClientService {
  private readonly http = inject(HttpClient);
  private readonly storage = inject(TRADE_BRIDGE_SESSION_STORAGE);
  private readonly prompt = inject(TRADE_BRIDGE_PROMPT);

  executeTrades(trades: TradeBridgeTrade[]): Observable<TradeBridgeClientResult> {
    return defer(() => {
      const token = this.acquireToken();
      if (!token) {
        return of({
          ok: false as const,
          error: { kind: 'cancelled' as const, message: 'Trade bridge token entry was cancelled' },
        });
      }

      return this.http.post<TradeBridgeResponse>(
        TRADE_BRIDGE_URL,
        { trades },
        { headers: { [TRADE_BRIDGE_TOKEN_HEADER]: token } }
      ).pipe(map((response) => ({ ok: true as const, response })));
    }).pipe(
      catchError((error: unknown) => of({
        ok: false as const,
        error: this.toTransportError(error),
      }))
    );
  }

  private acquireToken(): string | null {
    const storedToken = this.storage.getItem(TRADE_BRIDGE_TOKEN_STORAGE_KEY);
    if (storedToken) return storedToken;

    const enteredToken = this.prompt(TRADE_BRIDGE_TOKEN_PROMPT)?.trim();
    if (!enteredToken) return null;
    this.storage.setItem(TRADE_BRIDGE_TOKEN_STORAGE_KEY, enteredToken);
    return enteredToken;
  }

  private toTransportError(error: unknown): TradeBridgeTransportError {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      try {
        this.storage.removeItem(TRADE_BRIDGE_TOKEN_STORAGE_KEY);
      } catch (storageError: unknown) {
        return this.toClientFailure(storageError, error.status);
      }
      return {
        kind: 'unauthorized',
        status: error.status,
        message: 'Trade bridge token expired. Retry and enter the token shown by the bridge.',
      };
    }

    if (error instanceof HttpErrorResponse) {
      const responseMessage = this.isErrorResponse(error.error) ? error.error.error : undefined;
      return {
        kind: 'request',
        status: error.status || undefined,
        message: responseMessage ?? error.message ?? 'Trade bridge request failed',
      };
    }

    return this.toClientFailure(error);
  }

  private toClientFailure(error: unknown, status?: number): TradeBridgeTransportError {
    const details = error instanceof Error && error.message ? error.message : 'Browser token storage or prompt failed';
    return {
      kind: 'request',
      status,
      message: `Trade bridge client failed: ${details}`,
    };
  }

  private isErrorResponse(value: unknown): value is { error: string } {
    return typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string';
  }
}
