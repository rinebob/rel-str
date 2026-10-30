/**
 * Option Group Generator Store
 *
 * Page-scoped NgRx SignalStore for the OCC group generator drawer (#1338,
 * IMPL §FE-2). Owns the whole data lifecycle: query state → availability
 * fetch → refine → pair-line emit → per-symbol persistence.
 *
 * Provided at the options-chart page level, not root — one instance per
 * page. The drawer component renders `filtered()`; the chart brush writes
 * `applyRange`; the page reads `emit()` lines into the existing
 * `loadPlotted` path.
 */
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import type { ContractAvailabilityEntry } from '@options-contract/contracts';
import { ContractAvailabilityService } from '../services/contract-availability.service';
import {
  isInvertedRange,
  refineContracts,
  toAvailabilityQuery,
  toPairLines,
  type GeneratorQueryState,
  type GeneratorRefineState,
  type StudyRange,
} from '../utils/option-group-generator.utils';
import {
  GENERATOR_SETTINGS_VERSION,
  clearGeneratorSettings,
  readGeneratorSettings,
  saveGeneratorSettings,
} from '../utils/option-generator-settings';

export type GeneratorStatus = 'idle' | 'loading' | 'error';

export interface OptionGroupGeneratorState {
  /** Normalized uppercase symbol the drawer is configured for. */
  symbol: string;
  /** Axis inputs for the next availability fetch. */
  query: GeneratorQueryState;
  /** Client-side narrowing on the fetched records. */
  refine: GeneratorRefineState;
  /** Raw response records — refine narrows these, never refetches. */
  records: ContractAvailabilityEntry[];
  status: GeneratorStatus;
  error: string | null;
  /** True when the endpoint capped the response (2000-contract limit). */
  truncated: boolean;
  /** Valid observation dates for the chart brush's snap domain. */
  corpusDates: string[];
  /** Shared open date for emitted pair lines — not persisted. */
  openDate: string | null;
  /** When on, applyRange also writes openDate = range.start. */
  useRangeAsOpenDate: boolean;
  /** Last emitted `date,id` lines (Send-to-chart handoff). */
  lastEmitted: string[];
  /** A run has completed — lets the UI distinguish "never ran" from
   *  "ran and got zero contracts" (both are status 'idle' + records []). */
  hasRun: boolean;
}

const initialState: OptionGroupGeneratorState = {
  symbol: '',
  query: { type: 'BOTH' },
  refine: {},
  records: [],
  status: 'idle',
  error: null,
  truncated: false,
  corpusDates: [],
  openDate: null,
  useRangeAsOpenDate: false,
  lastEmitted: [],
  hasRun: false,
};

export const OptionGroupGeneratorStore = signalStore(
  withState(initialState),

  withComputed(({ records, refine }) => ({
    /** Records surviving the refine axes — recomputed on either change,
     *  no fetch involved. */
    filtered: computed(() => refineContracts(records(), refine())),
  })),

  withMethods((store, svc = inject(ContractAvailabilityService)) => {
    // Sequence guard: a run's response only applies while it's the latest
    // run AND the symbol it fetched for is still current.
    let runSeq = 0;

    const persist = (): void => {
      // No symbol → no blob — mutations before setSymbol must not write a
      // junk `rs-optgen:` entry.
      if (!store.symbol()) return;
      saveGeneratorSettings(store.symbol(), {
        version: GENERATOR_SETTINGS_VERSION,
        query: store.query(),
        refine: store.refine(),
        useRangeAsOpenDate: store.useRangeAsOpenDate(),
      });
    };

    const clearResults = (): Partial<OptionGroupGeneratorState> => ({
      records: [],
      status: 'idle',
      error: null,
      truncated: false,
      corpusDates: [],
      lastEmitted: [],
      hasRun: false,
    });

    return {
      /** Point the drawer at a symbol — loads that symbol's persisted blob
       *  and drops the previous symbol's results. Bumps the run sequence so
       *  an in-flight fetch for the old symbol is discarded. */
      setSymbol(symbol: string): void {
        const sym = String(symbol || '').trim().toUpperCase();
        if (sym === store.symbol()) return;
        runSeq++;
        const saved = readGeneratorSettings(sym);
        patchState(store, {
          symbol: sym,
          query: saved.query,
          refine: saved.refine,
          useRangeAsOpenDate: saved.useRangeAsOpenDate,
          // The persisted toggle+range restore the link too — while on,
          // openDate tracks the range start.
          openDate:
            saved.useRangeAsOpenDate ? (saved.refine.aliveRange?.start ?? null) : null,
          ...clearResults(),
        });
      },

      setQuery(patch: Partial<GeneratorQueryState>): void {
        patchState(store, { query: { ...store.query(), ...patch } });
        persist();
      },

      setRefine(patch: Partial<GeneratorRefineState>): void {
        patchState(store, { refine: { ...store.refine(), ...patch } });
        persist();
      },

      /** Write/clear the alive-across-range bound. `null` clears; an
       *  inverted range is ignored rather than stored. When the toggle is
       *  on, the range start also fills the shared open date. */
      applyRange(range: StudyRange | null): void {
        const refine = { ...store.refine() };
        if (range === null) {
          delete refine.aliveRange;
          patchState(store, { refine });
          persist();
          return;
        }
        // Trimmed copy — the caller's object must not alias signal state,
        // and empty/whitespace bounds are rejected alongside inverted.
        const start = range.start.trim();
        const end = range.end.trim();
        if (!start || !end || isInvertedRange(start, end)) return;
        refine.aliveRange = { start, end };
        patchState(store, {
          refine,
          ...(store.useRangeAsOpenDate() ? { openDate: start } : {}),
        });
        persist();
      },

      setOpenDate(date: string | null): void {
        patchState(store, { openDate: date?.trim() || null });
      },

      /** Toggle the range-start→openDate link. Turning it ON with an
       *  active range backfills openDate immediately — while on, the open
       *  date tracks the range start. */
      setUseRangeAsOpenDate(on: boolean): void {
        const range = store.refine().aliveRange;
        patchState(store, {
          useRangeAsOpenDate: on,
          ...(on && range ? { openDate: range.start } : {}),
        });
        persist();
      },

      /** Fetch availability for the current query. Params persist at call
       *  time (under the captured symbol) — a fetch failure or a mid-flight
       *  symbol switch must not lose the user's axes. */
      async run(): Promise<void> {
        const symbol = store.symbol();
        if (!symbol) return;
        runSeq++;
        const seq = runSeq;
        persist();
        patchState(store, { status: 'loading', error: null });
        try {
          const res = await firstValueFrom(
            svc.queryContractAvailability$(toAvailabilityQuery(symbol, store.query())),
          );
          if (res?.ok === false) throw new Error('Availability query failed');
          if (seq !== runSeq || store.symbol() !== symbol) return;
          patchState(store, {
            records: res.contracts ?? [],
            truncated: res.truncated ?? false,
            corpusDates: res.corpusDates ?? [],
            status: 'idle',
            hasRun: true,
          });
        } catch (err) {
          if (seq !== runSeq || store.symbol() !== symbol) return;
          patchState(store, {
            ...clearResults(),
            status: 'error',
            hasRun: true,
            error: (err as Error)?.message ?? 'Availability query failed',
          });
        }
      },

      /** Reset the drawer to defaults — params, results, open date — and
       *  remove the symbol's persisted blob. Invalidates in-flight runs so
       *  a late response can't resurrect cleared results. */
      clear(): void {
        runSeq++;
        clearGeneratorSettings(store.symbol());
        patchState(store, {
          query: { type: 'BOTH' },
          refine: {},
          openDate: null,
          useRangeAsOpenDate: false,
          ...clearResults(),
        });
      },

      /** Sorted `date,id`/bare-id lines over the filtered set — the page
       *  writes these into the pairs textarea and calls `loadPlotted`. */
      emit(): string[] {
        const lines = toPairLines(store.filtered(), store.openDate() ?? undefined);
        patchState(store, { lastEmitted: lines });
        return lines;
      },
    };
  }),
);
