/**
 * Savant Trader Trading Config Service
 *
 * Reads and writes the user's trading configuration (account number preference)
 * at st-config/{uid} (was savant-trader/data/trading-config — re-pointed in
 * #1014). Also fetches the list of agentic-allowed
 * accounts from the Robinhood MCP.
 *
 * Ref: IMPL-savant-trader-order-placement-fe.md §7 (Account number preference)
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext, signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  doc,
  getDoc,
  setDoc,
} from '@angular/fire/firestore';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, firstValueFrom, from } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { stConfigDocPath } from '@st/collections';
import { requireUserId } from './firestore-helpers';
import { RobinhoodMcpObservationService } from '../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { TradingConfig, AccountInfo } from './order-ticket.types';

@Injectable({ providedIn: 'root' })
export class TradingConfigService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);
  private readonly mcpService = inject(RobinhoodMcpObservationService);
  private readonly snackBar = inject(MatSnackBar);

  /** Cached trading config — shared by every order-staging surface (the
   *  gallery card actions and the manual order dialog, #1177) so they all
   *  warm + read one copy instead of re-fetching per call site. `_loaded`
   *  caches the null case too — a user with no saved config shouldn't pay
   *  a Firestore read on every ensureConfig call. */
  private readonly _config = signal<TradingConfig | null>(null);
  private _loaded = false;
  /** Bumped by saveConfig — a load that started before a save must not
   *  commit the pre-save doc over it. */
  private _gen = 0;
  readonly config = this._config.asReadonly();

  /** Load the user's trading config, or null if not yet configured. */
  loadConfig(): Observable<TradingConfig | null> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, stConfigDocPath(userId));
        const snap = await getDoc(docRef);
        if (!snap.exists()) return null;
        const data = snap.data() as {
          accountNumber?: string;
          updatedAt?: string;
          defaultDollarAmount?: number;
          maxUnits?: number;
          maxAllocationPercent?: number;
          optionMaxPremiumCashPercent?: number;
        };
        if (!data.accountNumber) return null;
        return {
          accountNumber: data.accountNumber,
          defaultDollarAmount: data.defaultDollarAmount,
          maxUnits: data.maxUnits,
          maxAllocationPercent: data.maxAllocationPercent,
          optionMaxPremiumCashPercent: data.optionMaxPremiumCashPercent,
          updatedAt: data.updatedAt ?? new Date().toISOString(),
        };
      })),
      map((config) => config ?? null)
    );
  }

  /** Warm the config cache in the background (called on page/dialog open
   *  so the first stage sees a live signal). Failures surface a snackbar
   *  but never throw — staging callers re-check via ensureConfig. */
  warmConfig(): void {
    const gen = this._gen;
    this.loadConfig().subscribe({
      next: (config) => {
        if (gen !== this._gen) return; // a save landed mid-load — don't write stale
        this._config.set(config);
        this._loaded = true;
      },
      error: (err: unknown) => {
        this.snackBar.open('Failed to load trading config', 'Dismiss', { duration: 5000 });
        console.error('[TradingConfigService] config load failed:', err);
      },
    });
  }

  /** Return the cached config, loading it once if needed. Snackbars and
   *  returns null on load failure so callers can bail without
   *  double-reporting — check the return, don't snackbar again. */
  async ensureConfig(): Promise<TradingConfig | null> {
    if (this._loaded) return this._config();
    const gen = this._gen;
    try {
      const config = await firstValueFrom(this.loadConfig());
      // A save landed mid-load — the read is stale; refetch the fresh doc.
      if (gen !== this._gen) return this.ensureConfig();
      this._config.set(config);
      this._loaded = true;
      return config;
    } catch (err) {
      this.snackBar.open('Failed to load trading config', 'Dismiss', { duration: 4000 });
      console.error('[TradingConfigService] config load failed:', err);
      return null;
    }
  }

  /** Save the user's trading config. */
  saveConfig(config: Partial<TradingConfig> & { accountNumber: string }): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) => runInInjectionContext(this.injector, async () => {
        const docRef = doc(this.firestore, stConfigDocPath(userId));
        const nowIso = new Date().toISOString();
        const payload: Record<string, unknown> = {
          userId,
          accountNumber: config.accountNumber,
          updatedAt: nowIso,
        };
        if (config.defaultDollarAmount !== undefined) payload.defaultDollarAmount = config.defaultDollarAmount;
        if (config.maxUnits !== undefined) payload.maxUnits = config.maxUnits;
        if (config.maxAllocationPercent !== undefined) payload.maxAllocationPercent = config.maxAllocationPercent;
        if (config.optionMaxPremiumCashPercent !== undefined) payload.optionMaxPremiumCashPercent = config.optionMaxPremiumCashPercent;
        await setDoc(docRef, payload, { merge: true });
        // A successful save may have introduced an accountNumber — bust
        // the cache so the next ensureConfig sees the fresh doc, and
        // invalidate any load already in flight.
        this._gen++;
        this._loaded = false;
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
