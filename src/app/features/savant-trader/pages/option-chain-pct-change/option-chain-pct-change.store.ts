/**
 * Option Chain Pct Change Store
 *
 * NgRx SignalStore managing state for the option chain pct change grid.
 * Fetches N+1 chain snapshots in parallel, caches them in-memory for
 * interactive filter recompute, and derives PctChangeGrids via a
 * computed signal from the cached snapshots + current filter.
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { forkJoin, Subscription } from 'rxjs';
import { map } from 'rxjs/operators';

import { OptionsContractService } from '../../services/options-contract.service';
import { LocalBarReadService } from '../../../../core/services/local-bar-read.service';
import { PctChangeConfigService } from './services/pct-change-config.service';
import type { PctChangeConfigWithId } from './services/pct-change-config.service';
import { OptionType } from '@options-contract/contracts';
import type { HistoricalOptionContract } from '@options-contract/contracts';
import type {
  TargetType,
  PctMode,
  UserDatesMode,
  PctDirection,
} from '@shared/pct-change-config-contracts';
import {
  computePctChange,
  type PctChangeGrid,
  type PctChangeFilter,
} from './utils/pct-change.utils';
import { buildConfigId } from './utils/pct-change-config.utils';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface OptionChainPctChangeState {
  /** Input: symbol to analyze. */
  symbol: string;
  /** Input: start date (YYYY-MM-DD). */
  startDate: string;
  /** Input: target dates (YYYY-MM-DD), 1..N. */
  targetDates: string[];
  /** Input: call or put filter. */
  type: OptionType;
  /** Input: filter applied to matched contracts. */
  filter: PctChangeFilter;

  /** Config: target type selection. */
  targetType: TargetType;
  /** Config: pct-change sub-mode. */
  pctMode: PctMode;
  /** Config: pct values (list mode). */
  pctValues: number[];
  /** Config: pct step (gradation mode). */
  pctStep: number;
  /** Config: pct count (gradation mode). */
  pctCount: number;
  /** Config: pct direction (gradation mode). */
  pctDirection: PctDirection;
  /** Config: user-dates sub-mode. */
  userDatesMode: UserDatesMode;
  /** Config: interval count (user-dates interval mode). */
  intervalCount: number;
  /** Config: interval days (user-dates interval mode). */
  intervalDays: number;

  /** Saved configs loaded from Firestore. */
  savedConfigs: PctChangeConfigWithId[];
  /** Currently selected config id, or null. */
  selectedConfigId: string | null;

  /** Fetch state. */
  loading: boolean;
  error: string | null;

  /** Cached snapshots (keyed by date) — kept in-memory for filter recompute. */
  startSnapshot: HistoricalOptionContract[] | null;
  targetSnapshots: Record<string, HistoricalOptionContract[]>;

  /** Underlying close prices keyed by date (YYYY-MM-DD). */
  underlyingPrices: Record<string, number>;
}

const initialState: OptionChainPctChangeState = {
  symbol: 'QQQ',
  startDate: '2025-04-07',
  targetDates: [],
  type: OptionType.CALL,
  filter: { type: OptionType.CALL },
  targetType: 'pct-change',
  pctMode: 'list',
  pctValues: [],
  pctStep: 5,
  pctCount: 4,
  pctDirection: 'up',
  userDatesMode: 'manual',
  intervalCount: 5,
  intervalDays: 5,
  savedConfigs: [],
  selectedConfigId: null,
  loading: false,
  error: null,
  startSnapshot: null,
  targetSnapshots: {},
  underlyingPrices: {},
};

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const OptionChainPctChangeStore = signalStore(
  { providedIn: 'root' },

  withState(initialState),

  withComputed((state) => ({
    /**
     * Grids are a pure function of cached snapshots + current inputs.
     * Auto-recomputes when filters, target dates, or cached snapshots change.
     */
    grids: computed((): PctChangeGrid[] => {
      const startSnapshot = state.startSnapshot();
      const targetSnapshots = state.targetSnapshots();
      const startDate = state.startDate().trim();
      const targetDates = state.targetDates();
      const filter = state.filter();

      if (!startSnapshot) return [];

      const underlyingPrices = state.underlyingPrices();
      return targetDates.map((dt) =>
        computePctChange(
          startSnapshot,
          targetSnapshots[dt] ?? [],
          startDate,
          dt,
          filter,
          underlyingPrices[startDate] ?? null,
          underlyingPrices[dt] ?? null,
        ),
      );
    }),
  })),

  withComputed((state) => ({
    /** True when grids have been computed. */
    hasResults: computed(() => state.grids().length > 0),

    /** True when symbol, startDate, and at least one target date are set. */
    canRun: computed(() => {
      const sym = state.symbol().trim();
      const start = state.startDate().trim();
      const targets = state.targetDates();
      return sym.length > 0 && start.length > 0 && targets.length > 0;
    }),
  })),

  withMethods((store, optionsContractService = inject(OptionsContractService), barReadService = inject(LocalBarReadService), configService = inject(PctChangeConfigService)) => {
    // Track the in-flight runAnalysis subscription so we can cancel stale
    // requests when runAnalysis is called again before the previous one
    // completes, or when reset is called mid-flight.
    let runSub: Subscription | null = null;

    return {
      /** Set the symbol input. Invalidates cached snapshots. */
      setSymbol(symbol: string): void {
        patchState(store, {
          symbol: String(symbol || '').trim().toUpperCase(),
          startSnapshot: null,
          targetSnapshots: {},
        });
      },

      /** Set the start date input. Invalidates cached start snapshot. */
      setStartDate(date: string): void {
        patchState(store, {
          startDate: String(date || '').trim(),
          startSnapshot: null,
        });
      },

      /** Add a target date. No-op if already present. */
      addTargetDate(date: string): void {
        const dt = String(date || '').trim();
        if (!dt) return;
        const existing = store.targetDates();
        if (existing.includes(dt)) return;
        patchState(store, { targetDates: [...existing, dt] });
      },

      /** Remove a target date. */
      removeTargetDate(date: string): void {
        const dt = String(date || '').trim();
        patchState(store, { targetDates: store.targetDates().filter((d) => d !== dt) });
      },

      /** Set the call/put type filter. Also updates the filter.type field. */
      setType(type: OptionType): void {
        patchState(store, {
          type,
          filter: { ...store.filter(), type },
        });
      },

      /** Update filter fields (duration, strike, delta ranges). */
      setFilter(partial: Partial<Omit<PctChangeFilter, 'type'>>): void {
        patchState(store, {
          filter: { ...store.filter(), ...partial },
        });
      },

      /**
       * Run the analysis: fetch N+1 snapshots in parallel, cache them.
       * Grids auto-recompute from the cached snapshots via the computed signal.
       */
      runAnalysis(): void {
        if (!store.canRun()) {
          patchState(store, {
            error: 'symbol, startDate, and at least one target date are required',
            startSnapshot: null,
            targetSnapshots: {},
          });
          return;
        }

        const symbol = store.symbol().trim().toUpperCase();
        const startDate = store.startDate().trim();
        const targetDates = store.targetDates();

        // Cancel any in-flight run to prevent stale overwrites.
        runSub?.unsubscribe();
        runSub = null;

        patchState(store, {
          loading: true,
          error: null,
          startSnapshot: null,
          targetSnapshots: {},
          underlyingPrices: {},
        });

        // Fetch start + all targets in parallel.
        const start$ = optionsContractService.getHistoricalOptionsChain$(symbol, startDate);
        const targetReqs = targetDates.map((dt) =>
          optionsContractService.getHistoricalOptionsChain$(symbol, dt),
        );

        // Fetch underlying daily bars covering the full date range.
        const allDates = [startDate, ...targetDates].sort();
        const barFrom = allDates[0];
        const barTo = allDates[allDates.length - 1];
        const bars$ = barReadService.getDailyBarsForRange$(symbol, barFrom, barTo);

        runSub = forkJoin({
          start: start$,
          targets: forkJoin(targetReqs),
          bars: bars$,
        })
          .pipe(
            map(({ start, targets, bars }) => {
              const startSnapshot = start.data?.data ?? [];
              const targetSnapshots: Record<string, HistoricalOptionContract[]> = {};
              targetDates.forEach((dt, i) => {
                targetSnapshots[dt] = targets[i]?.data?.data ?? [];
              });

              // Extract close prices for start + target dates.
              // If the exact date isn't a trading day, use the closest prior bar.
              const underlyingPrices: Record<string, number> = {};
              const sortedBars = [...bars].sort((a, b) => a.d.localeCompare(b.d));
              for (const dt of [startDate, ...targetDates]) {
                const bar = sortedBars
                  .filter((b) => b.d <= dt)
                  .pop();
                if (bar) {
                  underlyingPrices[dt] = bar.c;
                }
              }

              return { startSnapshot, targetSnapshots, underlyingPrices };
            }),
          )
          .subscribe({
            next: ({ startSnapshot, targetSnapshots, underlyingPrices }) => {
              patchState(store, {
                loading: false,
                error: null,
                startSnapshot,
                targetSnapshots,
                underlyingPrices,
              });
              runSub = null;
            },
            error: (err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              patchState(store, {
                loading: false,
                error: `Failed to fetch chain snapshots: ${msg}`,
                startSnapshot: null,
                targetSnapshots: {},
                underlyingPrices: {},
              });
              runSub = null;
            },
          });
      },

      /** Clear all state and cancel any in-flight fetch. */
      reset(): void {
        runSub?.unsubscribe();
        runSub = null;
        patchState(store, { ...initialState });
      },

      // -----------------------------------------------------------------
      // Config state setters
      // -----------------------------------------------------------------

      /** Set the target type selection. */
      setTargetType(targetType: TargetType): void {
        patchState(store, { targetType });
      },

      /** Set the pct-change sub-mode. */
      setPctMode(mode: PctMode): void {
        patchState(store, { pctMode: mode });
      },

      /** Set pct values (list mode). */
      setPctValues(values: number[]): void {
        patchState(store, { pctValues: values });
      },

      /** Set pct gradation params (gradation mode). */
      setPctGradation(step: number, count: number, direction: PctDirection): void {
        patchState(store, { pctStep: step, pctCount: count, pctDirection: direction });
      },

      /** Set the user-dates sub-mode. */
      setUserDatesMode(mode: UserDatesMode): void {
        patchState(store, { userDatesMode: mode });
      },

      /** Set interval params (user-dates interval mode). */
      setIntervalParams(count: number, intervalDays: number): void {
        patchState(store, { intervalCount: count, intervalDays });
      },

      // -----------------------------------------------------------------
      // Saved config CRUD
      // -----------------------------------------------------------------

      /** Load all saved configs from Firestore into state. */
      loadSavedConfigs(): void {
        configService.loadConfigs().subscribe({
          next: (configs) => patchState(store, { savedConfigs: configs }),
          error: () => patchState(store, { savedConfigs: [] }),
        });
      },

      /** Select a saved config by id and populate all inputs from it. */
      selectConfig(configId: string): void {
        const cfg = store.savedConfigs().find((c) => c.id === configId);
        if (!cfg) return;
        patchState(store, {
          selectedConfigId: configId,
          symbol: cfg.symbol,
          startDate: cfg.startDate,
          type: cfg.type,
          filter: cfg.filter,
          targetType: cfg.targetType,
          targetDates: cfg.targetDates,
          pctMode: cfg.pctMode ?? 'list',
          pctValues: cfg.pctValues ?? [],
          pctStep: cfg.pctStep ?? 5,
          pctCount: cfg.pctCount ?? 4,
          pctDirection: cfg.pctDirection ?? 'up',
          userDatesMode: cfg.userDatesMode ?? 'manual',
          intervalCount: cfg.intervalCount ?? 5,
          intervalDays: cfg.intervalDays ?? 5,
          startSnapshot: null,
          targetSnapshots: {},
          underlyingPrices: {},
        });
      },

      /** Build a config doc from current state and save it via the service. */
      saveCurrentConfig(): void {
        const symbol = store.symbol().trim().toUpperCase();
        const startDate = store.startDate().trim();
        const targetDates = store.targetDates();
        const targetType = store.targetType();
        const uid = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        const id = buildConfigId(symbol, startDate, targetDates.length, targetType, uid);
        const doc: PctChangeConfigWithId = {
          id,
          symbol,
          startDate,
          type: store.type(),
          targetType,
          targetDates,
          pctMode: store.pctMode(),
          pctValues: store.pctValues(),
          pctStep: store.pctStep(),
          pctCount: store.pctCount(),
          pctDirection: store.pctDirection(),
          userDatesMode: store.userDatesMode(),
          intervalCount: store.intervalCount(),
          intervalDays: store.intervalDays(),
          filter: store.filter(),
        };
        configService.saveConfig(doc).subscribe({
          next: () => {
            const existing = store.savedConfigs().filter((c) => c.id !== id);
            patchState(store, { savedConfigs: [...existing, doc], selectedConfigId: id });
          },
          error: (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            patchState(store, { error: `Failed to save config: ${msg}` });
          },
        });
      },

      /** Delete a saved config by id via the service and remove from state. */
      deleteConfig(configId: string): void {
        configService.deleteConfig(configId).subscribe({
          next: () => {
            const remaining = store.savedConfigs().filter((c) => c.id !== configId);
            const selected = store.selectedConfigId();
            patchState(store, {
              savedConfigs: remaining,
              selectedConfigId: selected === configId ? null : selected,
            });
          },
          error: (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            patchState(store, { error: `Failed to delete config: ${msg}` });
          },
        });
      },
    };
  }),
);
