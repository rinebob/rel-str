/**
 * Option Chain Store
 *
 * NgRx SignalStore for the option-chain page. Owns the fetch pipeline:
 * resolve the displayed session (latest completed, or a manual date),
 * fetch that session's chain snapshot, walk back for the prior-session
 * comparison snapshot, and pull underlying bars for the header closes.
 * Grid/cell building and filters live in later tasks.
 */
import { inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { computed } from '@angular/core';
import { Subscription, map } from 'rxjs';

import { OptionsContractService } from '../../services/options-contract.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import type {
  GetHistoricalOptionsChainResponse,
  HistoricalOptionContract,
} from '@options-contract/contracts';
import type { OhlcBar } from '../../../../core/models/market-data.types';
import {
  invalidIsoDateMessage,
  isValidIsoDate,
  previousWeekday,
  resolveSession$,
  resolveSessionDate,
  SessionFetchError,
} from './utils/session-resolution.utils';
import { chainContracts } from '../../utils/contract-observation.utils';

/** Days of bar history fetched before resolvedDate so both closes resolve. */
const BAR_LOOKBACK_DAYS = 14;

interface ChainFetchResult {
  contracts: HistoricalOptionContract[];
  source: string | null;
}

export interface OptionChainState {
  /** Normalized input symbol (uppercased on set). */
  symbol: string;
  /** Manual YYYY-MM-DD override; empty = auto-resolve latest session. */
  dateInput: string;
  /** Session date the loaded chain belongs to. */
  resolvedDate: string | null;
  /** Prior-session date used for change comparisons. */
  priorDate: string | null;
  /** Snapshot source label ('gcs' | upstream) for the header. */
  source: string | null;
  sessionContracts: HistoricalOptionContract[];
  priorContracts: HistoricalOptionContract[];
  loading: boolean;
  error: string | null;
  /** Prior-session fetch failure — comparison degrades to n/a, session data stays. */
  priorError: string | null;
  /** Resolution exhausted its walk-back cap (or manual date returned empty). */
  resolvedNoData: boolean;
  underlyingBars: OhlcBar[];
  underlyingLoading: boolean;
}

const initialState: OptionChainState = {
  symbol: 'QQQ',
  dateInput: '',
  resolvedDate: null,
  priorDate: null,
  source: null,
  sessionContracts: [],
  priorContracts: [],
  loading: false,
  error: null,
  priorError: null,
  resolvedNoData: false,
  underlyingBars: [],
  underlyingLoading: false,
};

function daysBefore(dateStr: string, days: number): string {
  const d = new Date(Date.parse(dateStr));
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export const OptionChainStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /** Underlying bars at or before the resolved session date, ascending. */
    sessionBars: computed((): OhlcBar[] => {
      const date = state.resolvedDate();
      if (!date) return [];
      return state
        .underlyingBars()
        .filter((b) => b.d <= date)
        .sort((a, b) => a.d.localeCompare(b.d));
    }),
  })),

  withComputed((state) => ({
    /** Underlying close on the resolved session date (or latest bar before it). */
    sessionClose: computed((): number | null => {
      const bars = state.sessionBars();
      return bars.length ? bars[bars.length - 1].c : null;
    }),

    /** Underlying close on the session before the session bar — the bar
     *  immediately preceding sessionClose, so a missing bar on resolvedDate
     *  doesn't slide the pair two sessions back. */
    priorClose: computed((): number | null => {
      const bars = state.sessionBars();
      return bars.length > 1 ? bars[bars.length - 2].c : null;
    }),
  })),

  withMethods(
    (
      store,
      optionsContractService = inject(OptionsContractService),
      barReadService = inject(LocalBarReadService),
    ) => {
      let chainSub: Subscription | null = null;
      let priorSub: Subscription | null = null;
      let barsSub: Subscription | null = null;

      function cancelInFlight(): void {
        chainSub?.unsubscribe();
        priorSub?.unsubscribe();
        barsSub?.unsubscribe();
      }

      /** Clear every loaded slice — used by setSymbol/setDateInput/loadChain
       *  so no stale data (or stuck loading flag) survives a new request. */
      function resetChainState(): Partial<OptionChainState> {
        return {
          resolvedDate: null,
          priorDate: null,
          source: null,
          sessionContracts: [],
          priorContracts: [],
          error: null,
          priorError: null,
          resolvedNoData: false,
          underlyingBars: [],
          underlyingLoading: false,
        };
      }

      function fetchChain$(date: string) {
        return optionsContractService
          .getHistoricalOptionsChain$(store.symbol(), date)
          .pipe(
            map(
              (res: GetHistoricalOptionsChainResponse): ChainFetchResult => ({
                contracts: chainContracts(res),
                source: res.source ?? null,
              }),
            ),
          );
      }

      const hasContracts = (r: ChainFetchResult) => r.contracts.length > 0;

      function errMsg(err: unknown): string {
        return err instanceof Error ? err.message : String(err);
      }

      /** Error label naming the date whose fetch actually failed —
       *  SessionFetchError carries it; fall back to the walk's start. */
      function fetchErrMsg(err: unknown, fallbackDate: string): string {
        const date = err instanceof SessionFetchError ? err.date : fallbackDate;
        return `${date}: ${errMsg(err)}`;
      }

      function fetchUnderlyingBars(resolvedDate: string): void {
        patchState(store, { underlyingLoading: true });
        barsSub = barReadService
          .getDailyBarsForRange$(
            store.symbol(),
            daysBefore(resolvedDate, BAR_LOOKBACK_DAYS),
            resolvedDate,
          )
          .subscribe({
            next: (bars) =>
              patchState(store, { underlyingBars: bars, underlyingLoading: false }),
            error: () =>
              patchState(store, { underlyingBars: [], underlyingLoading: false }),
          });
      }

      function fetchPriorSession(resolvedDate: string): void {
        const start = previousWeekday(resolvedDate);
        priorSub = resolveSession$(start, fetchChain$, hasContracts).subscribe({
          next: (prior) =>
            patchState(store, {
              priorDate: prior?.date ?? null,
              priorContracts: prior?.data.contracts ?? [],
            }),
          error: (err) =>
            patchState(store, {
              priorError: fetchErrMsg(err, start),
            }),
        });
      }

      /**
       * Load the chain for the resolved (or manually picked) session plus
       * its prior-session comparison snapshot. `now` is injectable for tests.
       */
      function loadChain(now: Date = new Date()): void {
        cancelInFlight();
        const sym = store.symbol();
        if (!sym) {
          patchState(store, { error: 'Symbol is required' });
          return;
        }

        const manual = store.dateInput();
        if (manual && !isValidIsoDate(manual)) {
          patchState(store, { error: invalidIsoDateMessage(manual) });
          return;
        }

        const startDate = manual || resolveSessionDate(now);
        patchState(store, { loading: true, ...resetChainState() });

        // Manual mode fetches the picked date directly — no walk-back on the
        // selected session (the user asked for that date; empty is the truth).
        // The prior session still resolves via walk-back.
        const session$ = manual
          ? fetchChain$(manual).pipe(map((data) => ({ date: manual, data })))
          : resolveSession$(startDate, fetchChain$, hasContracts);

        chainSub = session$.subscribe({
          next: (session) => {
            if (!session) {
              patchState(store, {
                loading: false,
                resolvedNoData: true,
              });
              return;
            }
            patchState(store, {
              // Session landed — drop the spinner now; the prior-session
              // snapshot streams in behind it and only fills the chg column.
              loading: false,
              resolvedDate: session.date,
              sessionContracts: session.data.contracts,
              source: session.data.source,
              resolvedNoData: session.data.contracts.length === 0,
              // Pin the input to the resolved session so the date control
              // displays what's actually on screen (US-2 "Today" semantics).
              ...(!manual ? { dateInput: session.date } : {}),
            });
            fetchUnderlyingBars(session.date);
            fetchPriorSession(session.date);
          },
          error: (err) =>
            patchState(store, {
              loading: false,
              error: fetchErrMsg(err, startDate),
            }),
        });
      }

      return {
        setSymbol(symbol: string): void {
          const sym = String(symbol || '').trim().toUpperCase();
          if (sym === store.symbol()) return;
          cancelInFlight();
          patchState(store, { symbol: sym, ...resetChainState() });
        },

        setDateInput(date: string): void {
          const dt = String(date ?? '').trim();
          if (dt === store.dateInput()) return;
          cancelInFlight();
          patchState(store, { dateInput: dt, ...resetChainState() });
        },

        loadChain,

        /** Clear the manual date and re-resolve the latest session. */
        loadToday(): void {
          cancelInFlight();
          patchState(store, { dateInput: '' });
          loadChain();
        },
      };
    },
  ),
);
