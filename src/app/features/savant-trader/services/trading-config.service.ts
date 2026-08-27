/**
 * Savant Trader Trading Config Service
 *
 * Reads and writes the user's trading configuration (account number preference)
 * at savant-trader/data/trading-config. Also fetches the list of agentic-allowed
 * accounts from the Robinhood MCP.
 *
 * Ref: IMPL-savant-trader-order-placement-fe.md §7 (Account number preference)
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { Collection } from '../../../core/common/constants';
import { requireUserId } from './firestore-helpers';
import { RobinhoodMcpObservationService } from './robinhood-mcp-observation.service';
import { TradingConfig, AccountInfo } from './order-intent.types';

@Injectable({ providedIn: 'root' })
export class TradingConfigService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);
  private readonly mcpService = inject(RobinhoodMcpObservationService);

  /** Load the user's trading config, or null if not yet configured. */
  loadConfig(): Observable<TradingConfig | null> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_TRADING_CONFIG, userId);
        const snap = await getDoc(docRef);
        if (!snap.exists()) return null;
        const data = snap.data() as {
          accountNumber?: string;
          updatedAt?: string;
          defaultDollarAmount?: number;
          maxUnits?: number;
          maxAllocationPercent?: number;
        };
        if (!data.accountNumber) return null;
        return {
          accountNumber: data.accountNumber,
          defaultDollarAmount: data.defaultDollarAmount,
          maxUnits: data.maxUnits,
          maxAllocationPercent: data.maxAllocationPercent,
          updatedAt: data.updatedAt ?? new Date().toISOString(),
        };
      })),
      map((config) => config ?? null)
    );
  }

  /** Save the user's trading config. */
  saveConfig(config: Partial<TradingConfig> & { accountNumber: string }): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, Collection.ST_TRADING_CONFIG, userId);
        const nowIso = new Date().toISOString();
        const payload: Record<string, unknown> = {
          userId,
          accountNumber: config.accountNumber,
          updatedAt: nowIso,
        };
        if (config.defaultDollarAmount !== undefined) payload.defaultDollarAmount = config.defaultDollarAmount;
        if (config.maxUnits !== undefined) payload.maxUnits = config.maxUnits;
        if (config.maxAllocationPercent !== undefined) payload.maxAllocationPercent = config.maxAllocationPercent;
        await setDoc(docRef, payload, { merge: true });
      })),
      map(() => undefined)
    );
  }

  /** Fetch agentic-allowed accounts from the Robinhood MCP. */
  async getAccounts(): Promise<AccountInfo[]> {
    const result = await this.mcpService.executeTool('get_accounts', {});
    if (!result.success) {
      throw new Error(result.error);
    }
    const accounts = this.extractAccounts(result.parsed);
    return accounts
      .filter((a) => a['agentic_allowed'] === true)
      .map((a) => ({
        accountNumber: a['account_number'] as string,
        accountType: a['type'] as string,
        agenticAllowed: a['agentic_allowed'] as boolean,
      }));
  }

  /** Extract the accounts array from the MCP response, handling multiple shapes. */
  private extractAccounts(parsed: unknown): Array<Record<string, unknown>> {
    if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
    if (parsed === null || typeof parsed !== 'object') return [];
    const record = parsed as Record<string, unknown>;
    // Shape: { data: { accounts: [...] } }
    const data = record['data'];
    if (data !== null && typeof data === 'object' && Array.isArray((data as Record<string, unknown>)['accounts'])) {
      return (data as Record<string, unknown>)['accounts'] as Array<Record<string, unknown>>;
    }
    // Shape: { accounts: [...] }
    if (Array.isArray(record['accounts'])) {
      return record['accounts'] as Array<Record<string, unknown>>;
    }
    return [];
  }
}
