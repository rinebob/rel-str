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
import { unionLabels } from '../utils/chart-series.utils';
import {
  UNDERLYING_CONTEXT_SESSIONS,
  earliestPickDate,
  markerDatesOf,
} from './plotted-window.utils';
import type { OHLCDatum } from '../../shared/types/rs.interfaces';

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
  /** Chip-click pin — keeps one contract highlighted while the pointer is
   *  elsewhere (e.g. scrolled down the chips column to check entries).
   *  Session-only tracking aid; never persisted. */
  pinnedContractId: string | null;
  /** Chart view intent: the contract ID the chart should show instead of
   *  the whole plotted set. Set by any contract load (chip drill-down and
   *  the plain single-contract input take the same path); cleared by
   *  clearChartFocus() to return to the set view. */
  chartFocusContractId: string | null;
}

export const initialPlottedState: PlottedContractsState = {
  plottedContracts: {},
  plottedLoadProgress: null,
  displayWindow: 'lifetime',
  hoveredContractId: null,
  pinnedContractId: null,
  chartFocusContractId: null,
};

const LOAD_CONCURRENCY = 6;

/** State/props/methods this feature reads, cast off the loosely-typed
 *  `state`/`store` params bare withComputed/withMethods hand us. */
interface PlottedSignals {
  plottedContracts: Signal<Record<string, PlottedContract>>;
  plottedLoadProgress: Signal<{ done: number; total: number } | null>;
  displayWindow: Signal<DisplayWindow>;
  hoveredContractId: Signal<string | null>;
  pinnedContractId: Signal<string | null>;
  chartFocusContractId: Signal<string | null>;
  renderedSeries: Signal<Record<string, ParsedObservation[]>>;
  contractLength: Signal<string | null>;
  underlyingBars: Signal<OHLCDatum[]>;
  loadContract(occId: string, length?: string | null): void;
  /** Underlying-bars feature: refetches the set's context window when the
   *  last requested range no longer covers it (no-op otherwise). */
  ensureContextCoverage(): void;
}

const asPlotted = (s: unknown): PlottedSignals => s as PlottedSignals;

export function withPlottedComputed() {
  return withComputed((state) => {
    const s = asPlotted(state);
    return {
      /** Plotted contracts in insertion order (chips strip). */
      plottedList: computed((): PlottedContract[] => Object.values(s.plottedContracts())),

      /** The id the chart should emphasize — live hover wins; otherwise the
       *  click-pinned contract stays lit so it isn't lost while scrolling.
       *  Suppressed under a focused drill-down: a stale pin/hover would dim
       *  the single contract in its own view (it survives for the return
       *  to the set). */
      highlightedContractId: computed(
        (): string | null =>
          s.chartFocusContractId() == null ? s.hoveredContractId() ?? s.pinnedContractId() : null,
      ),

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
    /** The slice of loaded underlying bars that belongs on the axis —
     *  [50 sessions before the earliest pick day, last bar]. Null when no
     *  contract carries marker dates (bare-ID sets get no context prefix)
     *  or no bars are loaded. Derived from marker dates, not rendered
     *  points, so clip-to-entry can never shrink it. */
    const underlyingWindow = computed((): { from: string; to: string } | null => {
      const earliest = earliestPickDate(s.plottedContracts());
      if (earliest == null) return null;
      const barDates = s
        .underlyingBars()
        .map((b) => b.date)
        .filter((d): d is string => !!d)
        .sort();
      if (!barDates.length) return null;
      const prior = barDates.filter((d) => d < earliest);
      const from =
        prior.length > UNDERLYING_CONTEXT_SESSIONS
          ? prior[prior.length - UNDERLYING_CONTEXT_SESSIONS]
          : (prior[0] ?? barDates[0]);
      return { from, to: barDates[barDates.length - 1] };
    });
    /** Loaded bar dates inside the context window — empty when no dated
     *  contract is plotted. The focused-view axis unions these the same way
     *  the set view does, so drill-down keeps the prefix. */
    const underlyingWindowDates = computed((): string[] => {
      const win = underlyingWindow();
      if (!win) return [];
      return s
        .underlyingBars()
        .map((b) => b.date)
        .filter((d): d is string => !!d && d >= win.from && d <= win.to);
    });
    return {
      underlyingWindow,
      underlyingWindowDates,

      /** Sorted union of rendered dates, marker vertices (every pick day +
       *  expiration), and the underlying window's bar dates — the chart's
       *  category domain. The underlying contribution is what makes the
       *  underlying overlay clip-invariant: contract clipping filters
       *  rendered points but can never remove bar dates from the axis. */
      allDates: computed((): string[] => {
        const rendered = Object.values(s.renderedSeries()).map((obs) => obs.map((o) => o.date));
        const endpoints: string[] = [];
        for (const c of Object.values(s.plottedContracts())) {
          if (c.status === 'error') continue;
          const picks = markerDatesOf(c.entry).filter((d) => d <= c.parsed.expiration);
          if (!picks.length) continue;
          endpoints.push(...picks, c.parsed.expiration);
        }
        return unionLabels(...rendered, endpoints, underlyingWindowDates());
      }),
    };
  });
}

export function withPlottedContracts() {
  return withMethods((store, optionsContractService = inject(OptionsContractService)) => {
    const s = asPlotted(store);

    return {
      /** Replace the plotted set with the parsed entries — the input list is
       *  authoritative: contracts absent from it are removed, kept contracts
       *  retain their loaded data but take the new list's pick days (openDate
       *  = earliest), previously-errored entries are re-queued.
       *  Per-contract failures land as status 'error' without affecting the
       *  rest. */
      async loadPlotted(entries: PlottedEntry[]): Promise<void> {
        const next: Record<string, PlottedContract> = {};
        const toFetch: ParsedOccContractId[] = [];

        for (const e of entries) {
          const parsed = OptionsContractService.parseOccId(e.contractId);
          if (!parsed) continue;
          const id = parsed.contractID;
          const dates = markerDatesOf(e);
          const incoming = next[id];
          const prior = s.plottedContracts()[id];
          if (incoming) {
            // The same list supplied this contract twice — union within the
            // call (the parser would normally emit one entry).
            const merged = [...new Set([...markerDatesOf(incoming.entry), ...dates])].sort();
            next[id] = {
              ...incoming,
              entry: { ...incoming.entry, openDate: merged[0] ?? null, markerDates: merged },
            };
          } else if (prior && prior.status !== 'error') {
            // Kept contract — preserve the loaded record (no refetch), but the
            // new list's pick days are authoritative: dates it no longer
            // claims drop off the span marker. Errored entries re-queue.
            next[id] = {
              ...prior,
              entry: { ...prior.entry, openDate: dates[0] ?? null, markerDates: dates },
            };
          } else {
            next[id] = {
              entry: { contractId: id, openDate: dates[0] ?? null, markerDates: dates },
              parsed,
              status: 'loading',
              data: null,
              error: null,
            };
            toFetch.push(parsed);
          }
        }

        // A set load supersedes any focused single contract — otherwise the
        // stale focus keeps the chart on the old contract while the new
        // set's chips appear. Cleared unconditionally: Load always means
        // "show this set", even when every entry was already plotted. A
        // hovered contract that's no longer in the set clears too.
        const hovered = s.hoveredContractId();
        patchState(store, {
          chartFocusContractId: null,
          plottedContracts: next,
          hoveredContractId: hovered && !next[hovered] ? null : hovered,
          // A fresh set load resets tracking — a pin pointing at a contract
          // the new list doesn't carry would dim everything with no lit line.
          pinnedContractId: null,
        });

        // Dated loads prepend ~50 sessions of underlying context (see
        // underlyingWindow). Widen the bar fetch only when the last
        // requested range doesn't already cover it.
        s.ensureContextCoverage();
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
                  // A hover/pin on the now-errored contract has no series
                  // to light — and error chips can't be clicked to unpin,
                  // so the state must release it here (mirror of
                  // loadContractInternal's error release).
                  hoveredContractId:
                    s.hoveredContractId() === parsed.contractID ? null : s.hoveredContractId(),
                  pinnedContractId:
                    s.pinnedContractId() === parsed.contractID ? null : s.pinnedContractId(),
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
        const pinned = s.pinnedContractId();
        const focused = s.chartFocusContractId();
        patchState(store, {
          plottedContracts: next,
          hoveredContractId: hovered === contractId ? null : hovered,
          pinnedContractId: pinned === contractId ? null : pinned,
          chartFocusContractId: focused === contractId ? null : focused,
        });
        // Removing the focused chip returns to the set — restore the window
        // the drill-down narrowed (harmless no-op when nothing narrowed).
        s.ensureContextCoverage();
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

      /** Chip click — pin/unpin tracking. Pinning keeps the contract lit
       *  once the pointer leaves (hover still takes precedence live). */
      togglePinnedContract(contractId: string): void {
        patchState(store, {
          pinnedContractId: s.pinnedContractId() === contractId ? null : contractId,
        });
      },

      /** Single-contract drill-down — pushes the contract through the existing
       *  loadContract path so the lower panes get full data. The focus flag
       *  (set inside loadContract) tells the page to render the focused
       *  contract instead of the set. */
      focusPlotted(contractId: string): void {
        s.loadContract(contractId, s.contractLength());
      },

      /** Clear the focused-contract flag, returning the page to the
       *  plotted-set view and restoring its context window. */
      clearChartFocus(): void {
        patchState(store, { chartFocusContractId: null });
        // Returning to the set restores the wide context window when a
        // narrower or foreign-symbol range replaced the bars.
        s.ensureContextCoverage();
      },
    };
  });
}
