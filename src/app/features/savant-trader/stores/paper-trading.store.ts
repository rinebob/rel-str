/**
 * Signal-based store for the paper trade dashboard. Holds the account,
 * the trades list (with the active filter request), stats docs, exit
 * variants, and loading/error state. Mirrors the
 * OptionsStrategyDashboardStore pattern.
 */

import { computed, inject, DestroyRef } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { catchError, EMPTY, finalize, of, Subscription } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PaperTradingService } from '../services/paper-trading.service';
import type {
  ExitVariantConfig,
  ListPaperTradesRequest,
  PaperAccount,
  PaperStats,
  PaperTrade,
} from '@paper-trading/contracts';
import { PaperTradeStatus } from '@paper-trading/contracts';

const NO_GROUP = 'none';

/** Group trades by a key projection — multi-key projections (variantKeys)
 *  place a trade in every bucket it belongs to. */
function groupTradesBy(
  trades: PaperTrade[],
  keysOf: (t: PaperTrade) => string[],
): Map<string, PaperTrade[]> {
  const map = new Map<string, PaperTrade[]>();
  for (const t of trades) {
    for (const key of keysOf(t)) {
      const list = map.get(key) ?? [];
      list.push(t);
      map.set(key, list);
    }
  }
  return map;
}

// ── State ────────────────────────────────────────────────────────────────────

export interface PaperTradingState {
  /** Active server-side filter for the trades list. */
  tradeFilters: ListPaperTradesRequest;
  trades: PaperTrade[];
  account: PaperAccount | null;
  /** Stats docs keyed by scope for the dashboard scope selector. */
  statsByScope: Record<string, PaperStats>;
  exitVariants: ExitVariantConfig[];
  isLoadingTrades: boolean;
  isLoadingStats: boolean;
  isLoadingAccount: boolean;
  error: string | null;
}

const initialState: PaperTradingState = {
  tradeFilters: {},
  trades: [],
  account: null,
  statsByScope: {},
  exitVariants: [],
  isLoadingTrades: false,
  isLoadingStats: false,
  isLoadingAccount: false,
  error: null,
};

const AUTH_MSG = 'Authentication required to view paper trading data';
const toMessage = (err: unknown, fallback: string): string =>
  (err as { code?: string })?.code === 'unauthenticated' ? AUTH_MSG : fallback;

// ── Store ────────────────────────────────────────────────────────────────────

export const PaperTradingStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    /** True while any section is loading. */
    isLoading: computed(
      () =>
        state.isLoadingTrades() ||
        state.isLoadingStats() ||
        state.isLoadingAccount(),
    ),

    isEmpty: computed(
      () => state.trades().length === 0 && state.account() === null,
    ),

    openTrades: computed(() =>
      state.trades().filter((t) => t.status === PaperTradeStatus.OPEN),
    ),
    closedTrades: computed(() =>
      state.trades().filter((t) => t.status === PaperTradeStatus.CLOSED),
    ),
    pendingTrades: computed(() =>
      state.trades().filter((t) => t.status === PaperTradeStatus.PENDING),
    ),

    /** All stats docs, sorted by scope for the scope selector. */
    statsList: computed(() =>
      Object.values(state.statsByScope()).sort((a, b) =>
        a.scope.localeCompare(b.scope),
      ),
    ),

    /** The global rollup when present. */
    allScopeStats: computed(() => state.statsByScope()['all'] ?? null),

    /** Derived filter options from the loaded trades. */
    availableInstances: computed(() =>
      [...new Set(state.trades().map((t) => t.strategyInstanceId).filter((x): x is string => !!x))].sort(),
    ),
    availableCohorts: computed(() =>
      [...new Set(state.trades().map((t) => t.cohortId).filter((x): x is string => !!x))].sort(),
    ),
    availableSymbols: computed(() =>
      [...new Set(state.trades().map((t) => t.symbol))].sort(),
    ),
    availableExpressions: computed(() =>
      [...new Set(state.trades().map((t) => t.expression).filter((x): x is string => !!x))].sort(),
    ),
    availableVariantKeys: computed(() =>
      [...new Set(state.trades().flatMap((t) => t.variantKeys))].sort(),
    ),

    /** Client-side filtered views over the loaded trades — used by the
     *  dashboard group-by selector without refetching. */
    tradesBySource: computed(() => groupTradesBy(state.trades(), (t) => [t.source])),
    tradesByInstance: computed(() =>
      groupTradesBy(state.trades(), (t) => [t.strategyInstanceId ?? NO_GROUP]),
    ),
    tradesByCohort: computed(() =>
      groupTradesBy(state.trades(), (t) => [t.cohortId ?? NO_GROUP]),
    ),
    tradesByVariant: computed(() => groupTradesBy(state.trades(), (t) => t.variantKeys)),
    tradesBySymbol: computed(() => groupTradesBy(state.trades(), (t) => [t.symbol])),
    tradesByExpression: computed(() =>
      groupTradesBy(state.trades(), (t) => [t.expression ?? NO_GROUP]),
    ),
  })),

  withMethods(
    (
      state,
      service = inject(PaperTradingService),
      snackBar = inject(MatSnackBar),
      destroyRef = inject(DestroyRef),
    ) => {
      let tradesSub: Subscription | null = null;
      let statsSub: Subscription | null = null;
      let accountSub: Subscription | null = null;
      let variantsSub: Subscription | null = null;

      return {
        /** Load trades honoring the current filter request; cancels any
         *  in-flight fetch. */
        loadTrades(filters?: ListPaperTradesRequest): void {
          tradesSub?.unsubscribe();
          if (filters !== undefined) {
            patchState(state, { tradeFilters: filters });
          }
          patchState(state, { isLoadingTrades: true, error: null });

          tradesSub = service
            .listPaperTrades$(state.tradeFilters())
            .pipe(
              catchError((err) => {
                const msg = toMessage(err, 'Failed to load paper trades');
                patchState(state, { error: msg });
                snackBar.open(msg, 'Dismiss', { duration: 5000 });
                return of({ trades: [] });
              }),
              finalize(() => patchState(state, { isLoadingTrades: false })),
              takeUntilDestroyed(destroyRef),
            )
            .subscribe({
              next: (res) => patchState(state, { trades: res.trades }),
            });
        },

        /** Load stats — a named scope, or every doc when scope is omitted. */
        loadStats(scope?: string): void {
          statsSub?.unsubscribe();
          patchState(state, { isLoadingStats: true, error: null });

          statsSub = service
            .getPaperStats$(scope ? { scope } : {})
            .pipe(
              catchError((err) => {
                const msg = toMessage(err, 'Failed to load paper stats');
                patchState(state, { error: msg });
                snackBar.open(msg, 'Dismiss', { duration: 5000 });
                // EMPTY keeps `next` from firing — a failed enumerate-all
                // must not wholesale-replace statsByScope with {}.
                return EMPTY;
              }),
              finalize(() => patchState(state, { isLoadingStats: false })),
              takeUntilDestroyed(destroyRef),
            )
            .subscribe({
              next: (res) => {
                const incoming = Object.fromEntries(
                  res.stats.map((s) => [s.scope, s]),
                );
                // Omitted scope enumerates every stats doc — replace the
                // map wholesale so scopes deleted server-side drop out.
                // A scoped fetch is a partial read — merge it in.
                const statsByScope = scope
                  ? { ...state.statsByScope(), ...incoming }
                  : incoming;
                patchState(state, { statsByScope });
              },
            });
        },

        /** Load the caller's paper account (null when none exists). */
        loadAccount(): void {
          accountSub?.unsubscribe();
          patchState(state, { isLoadingAccount: true, error: null });

          accountSub = service
            .getPaperAccount$()
            .pipe(
              catchError((err) => {
                const msg = toMessage(err, 'Failed to load paper account');
                patchState(state, { error: msg });
                snackBar.open(msg, 'Dismiss', { duration: 5000 });
                return of({ account: null });
              }),
              finalize(() => patchState(state, { isLoadingAccount: false })),
              takeUntilDestroyed(destroyRef),
            )
            .subscribe({
              next: (res) => patchState(state, { account: res.account }),
            });
        },

        /** Load the exit-variant registry for the variant selector.
         *  Registry is static per deploy — no dedicated loading flag. */
        loadExitVariants(): void {
          variantsSub?.unsubscribe();
          variantsSub = service
            .listExitVariants$()
            .pipe(
              catchError((err) => {
                const msg = toMessage(err, 'Failed to load exit variants');
                patchState(state, { error: msg });
                snackBar.open(msg, 'Dismiss', { duration: 5000 });
                return of({ variants: [] });
              }),
              takeUntilDestroyed(destroyRef),
            )
            .subscribe({
              next: (res) => patchState(state, { exitVariants: res.variants }),
            });
        },

        /** Update the server-side trade filter and refetch. Empty object
         *  clears all filters. */
        setTradeFilters(filters: ListPaperTradesRequest): void {
          this.loadTrades(filters);
        },

        /** Load account + trades + stats in parallel. */
        loadAll(): void {
          this.loadAccount();
          this.loadTrades();
          this.loadStats();
        },
      };
    },
  ),
);
