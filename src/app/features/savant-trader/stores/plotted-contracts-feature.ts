import { withMethods, withComputed, patchState } from '@ngrx/signals';
import { computed, inject, Signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { OptionsContractService } from '../services/options-contract.service';
import type {
  ParsedOccContractId,
  PartnerHistoricalOptionsContractV2Response,
  PlottedEntry,
} from '@options-contract/contracts';
import { type ParsedObservation, parseObservations } from '../utils/contract-observation.utils';

export type DisplayWindow = 'position' | 'lifetime';
export type PlottedStatus = 'loading' | 'loaded' | 'error';

/** One plotted contract: its (openDate, contractId) entry plus fetch state. */
export interface PlottedContract {
  entry: PlottedEntry;
  parsed: ParsedOccContractId;
  status: PlottedStatus;
  data: PartnerHistoricalOptionsContractV2Response | null;
  error: string | null;
}

export interface PlottedContractsState {
  plottedContracts: Record<string, PlottedContract>;
  plottedLoadProgress: { done: number; total: number } | null;
  displayWindow: DisplayWindow;
  hoveredContractId: string | null;
}

export const initialPlottedState: PlottedContractsState = {
  plottedContracts: {},
  plottedLoadProgress: null,
  displayWindow: 'position',
  hoveredContractId: null,
};

const LOAD_CONCURRENCY = 6;

/** State/props/methods this feature reads, cast off the loosely-typed
 *  `state`/`store` params bare withComputed/withMethods hand us. */
interface PlottedSignals {
  plottedContracts: Signal<Record<string, PlottedContract>>;
  plottedLoadProgress: Signal<{ done: number; total: number } | null>;
  displayWindow: Signal<DisplayWindow>;
  hoveredContractId: Signal<string | null>;
  renderedSeries: Signal<Record<string, ParsedObservation[]>>;
  contractLength: Signal<string | null>;
  loadContract(occId: string, length?: string | null): void;
}

const asPlotted = (s: unknown): PlottedSignals => s as PlottedSignals;

export function withPlottedComputed() {
  return withComputed((state) => {
    const s = asPlotted(state);
    return {
      /** Plotted contracts in insertion order (chips strip). */
      plottedList: computed((): PlottedContract[] => Object.values(s.plottedContracts())),

      /** Multi mode = two or more plottable contracts (loading counts — the
       *  mode shouldn't flicker while fetches are in flight). */
      isMultiMode: computed(
        () => Object.values(s.plottedContracts()).filter((c) => c.status !== 'error').length >= 2,
      ),

      /** Observations per contract after the display-window clip. Position mode
       *  drops observations before each contract's openDate; contracts without
       *  an open date render in full. Render-time clip — full series stays
       *  in state for single-contract drill-down. */
      renderedSeries: computed((): Record<string, ParsedObservation[]> => {
        const win = s.displayWindow();
        const out: Record<string, ParsedObservation[]> = {};
        for (const [id, c] of Object.entries(s.plottedContracts())) {
          if (c.status !== 'loaded' || !c.data?.series) continue;
          let obs = parseObservations(c.data.series);
          if (win === 'position' && c.entry.openDate) {
            obs = obs.filter((o) => o.date >= c.entry.openDate!);
          }
          out[id] = obs;
        }
        return out;
      }),
    };
  });
}

/** Must be composed AFTER withPlottedComputed — it reads renderedSeries,
 *  which only exists once that feature has run. */
export function withAllDatesComputed() {
  return withComputed((state) => {
    const s = asPlotted(state);
    return {
      /** Sorted union of rendered dates plus marker endpoints (open date or
       *  first observation, and expiration) so the markers are never clipped. */
      allDates: computed((): string[] => {
        const dates = new Set<string>();
        for (const obs of Object.values(s.renderedSeries())) {
          for (const o of obs) dates.add(o.date);
        }
        for (const c of Object.values(s.plottedContracts())) {
          if (c.status !== 'loaded') continue;
          const markerStart = c.entry.openDate ?? c.data?.startDate;
          if (markerStart) dates.add(markerStart);
          dates.add(c.parsed.expiration);
        }
        return [...dates].sort();
      }),
    };
  });
}

export function withPlottedContracts() {
  return withMethods((store, optionsContractService = inject(OptionsContractService)) => {
    const s = asPlotted(store);
    return {
      /** Fetch every unique entry into the plotted set with bounded concurrency.
       *  Already-plotted contracts are not refetched; their openDate merges to
       *  the earliest supplied. Per-contract failures land as status 'error'
       *  without affecting the rest. */
      async loadPlotted(entries: PlottedEntry[]): Promise<void> {
        const additions: Record<string, PlottedContract> = {};
        const toFetch: ParsedOccContractId[] = [];

        for (const e of entries) {
          const parsed = OptionsContractService.parseOccId(e.contractId);
          if (!parsed) continue;
          const existing = s.plottedContracts()[parsed.contractID] ?? additions[parsed.contractID];
          // Entries that failed last time are re-queued rather than skipped;
          // anything already loading/loaded just merges the earliest openDate.
          if (existing && existing.status !== 'error') {
            if (e.openDate && (!existing.entry.openDate || e.openDate < existing.entry.openDate)) {
              additions[parsed.contractID] = {
                ...existing,
                entry: { ...existing.entry, openDate: e.openDate },
              };
            }
            continue;
          }
          additions[parsed.contractID] = {
            entry: { contractId: parsed.contractID, openDate: e.openDate },
            parsed,
            status: 'loading',
            data: null,
            error: null,
          };
          toFetch.push(parsed);
        }

        if (Object.keys(additions).length) {
          patchState(store, { plottedContracts: { ...s.plottedContracts(), ...additions } });
        }
        if (!toFetch.length) return;

        patchState(store, { plottedLoadProgress: { done: 0, total: toFetch.length } });
        let done = 0;
        const length = s.contractLength() ?? undefined;
        const queue = [...toFetch];
        const worker = async (): Promise<void> => {
          for (let parsed = queue.shift(); parsed; parsed = queue.shift()) {
            try {
              const data = await firstValueFrom(
                optionsContractService.getHistoricalOptionsContract$(
                  parsed.symbol,
                  parsed.contractID,
                  length,
                ),
              );
              // Re-read after the await: a removePlotted/clearPlotted during
              // flight means this entry is gone — don't resurrect it. Merging
              // onto the fresh record also preserves an openDate merged by a
              // concurrent loadPlotted.
              const current = s.plottedContracts()[parsed.contractID];
              if (current?.status === 'loading') {
                patchState(store, {
                  plottedContracts: {
                    ...s.plottedContracts(),
                    [parsed.contractID]: { ...current, status: 'loaded', data },
                  },
                });
              }
            } catch (err) {
              const current = s.plottedContracts()[parsed.contractID];
              if (current?.status === 'loading') {
                patchState(store, {
                  plottedContracts: {
                    ...s.plottedContracts(),
                    [parsed.contractID]: {
                      ...current,
                      status: 'error',
                      error: (err as Error)?.message ?? 'Failed to load contract',
                    },
                  },
                });
              }
            }
            done++;
            // Only advance progress while a batch is still tracking — a
            // clearPlotted mid-flight already nulled it.
            if (s.plottedLoadProgress()) {
              patchState(store, {
                plottedLoadProgress: done === toFetch.length ? null : { done, total: toFetch.length },
              });
            }
          }
        };
        await Promise.all(
          Array.from({ length: Math.min(LOAD_CONCURRENCY, queue.length) }, () => worker()),
        );
      },

      removePlotted(contractId: string): void {
        const next = { ...s.plottedContracts() };
        delete next[contractId];
        const hovered = s.hoveredContractId();
        patchState(store, {
          plottedContracts: next,
          hoveredContractId: hovered === contractId ? null : hovered,
        });
      },

      clearPlotted(): void {
        patchState(store, { ...initialPlottedState });
      },

      setDisplayWindow(win: DisplayWindow): void {
        patchState(store, { displayWindow: win });
      },

      setHoveredContract(contractId: string | null): void {
        patchState(store, { hoveredContractId: contractId });
      },

      /** Single-contract drill-down — pushes the contract through the existing
       *  loadContract path so the lower panes get full data. */
      focusPlotted(contractId: string): void {
        s.loadContract(contractId, s.contractLength());
      },
    };
  });
}
