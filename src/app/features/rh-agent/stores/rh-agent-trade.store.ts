/**
 * RH Agent Trade Store
 *
 * In-memory cache of real trades placed from accepted RH Agent occurrences.
 * Tracks active and closed trades separately from screening/triage state and
 * from the durable occurrence decisions that produced them.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { RhAgentTradeService } from '../services/rh-agent-trade.service';
import { RhAgentTrade } from '../services/rh-agent.types';
import { RhAgentTradeStatus } from '../common/rh-agent.constants';

export interface RhAgentTradeState {
  /** Trades keyed by trade id. */
  trades: Record<string, RhAgentTrade>;
  /** True while trades for the active run are loading. */
  tradesLoading: boolean;
}

const initialState: RhAgentTradeState = {
  trades: {},
  tradesLoading: false,
};

export const RhAgentTradeStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => {
    const activeTrades = computed((): RhAgentTrade[] =>
      Object.values(state.trades()).filter((t) => t.status === RhAgentTradeStatus.OPEN)
    );

    const closedTrades = computed((): RhAgentTrade[] =>
      Object.values(state.trades()).filter((t) => t.status === RhAgentTradeStatus.CLOSED)
    );

    return {
      activeTrades,
      closedTrades,
      activeSymbols: computed((): string[] =>
        Array.from(new Set(activeTrades().map((t) => t.symbol)))
      ),
      activeCount: computed((): number => activeTrades().length),
      closedCount: computed((): number => closedTrades().length),
      loading: computed((): boolean => state.tradesLoading()),
    };
  }),

  withMethods((
    state,
    tradeService = inject(RhAgentTradeService),
  ) => ({
    /** Load all trades for a specific source run. */
    loadTradesForRun(runId: string): void {
      patchState(state, { tradesLoading: true });
      tradeService.loadTradesForRun(runId).subscribe({
        next: (trades) => {
          const map: Record<string, RhAgentTrade> = {};
          for (const t of trades) {
            map[t.id] = t;
          }
          patchState(state, { trades: map, tradesLoading: false });
        },
        error: (err: unknown) => {
          console.error('[TradeStore] Failed to load trades:', err);
          patchState(state, { tradesLoading: false });
        },
      });
    },

    /** Add one or more trades to the in-memory cache. */
    addTrades(trades: RhAgentTrade[]): void {
      if (trades.length === 0) return;
      const next = { ...state.trades() };
      for (const t of trades) {
        next[t.id] = t;
      }
      patchState(state, { trades: next });
    },

    /** Drop all loaded trades. */
    clearTrades(): void {
      patchState(state, { trades: {} });
    },
  }))
);
