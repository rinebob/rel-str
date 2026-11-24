/**
 * @topic #553 — Paper Trading | @task #1653
 *
 * Signal-review store — the /signals/symbol-review pane's session state.
 * Holds the symbol queue (one row per symbol with an un-groomed signal,
 * joined with the pane-open stamp for the new-signal dot) and the selected
 * symbol's occurrence bundle.
 *
 * `selectSymbol` re-fires the bundle callable every call — the read itself
 * stamps `lastOpenedAt[symbol]` server-side, so re-selecting a symbol is a
 * deliberate "re-open" that advances the divider. The monotonic `bundleSeq`
 * discards stale responses: a slow fetch for a symbol the user has already
 * navigated away from can never overwrite the current selection's pane.
 *
 * The bundle is one keyed record, not parallel fields: `bundle.symbol`
 * names the symbol that produced the data, so a failed cross-symbol select
 * can never render the previous symbol's occurrences under the new one's
 * header (review M1). The success path also propagates `openedAt` into the
 * queue row — the read just stamped it server-side, so the dot clears
 * without a queue refetch (review M2).
 */
import { inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { computed } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { SignalReviewService } from '../services/signal-review.service';
import type {
  SignalReviewOccurrence,
  SignalReviewQueueRow,
} from '@paper-trading/contracts';

/** One symbol's loaded occurrence bundle — `symbol` keys the record so a
 *  kept bundle can never be displayed under a different selection. */
export interface SignalReviewBundle {
  symbol: string;
  /** `null` on first open → every occurrence is "new". */
  previousOpenedAt: string | null;
  /** The stamp written by this bundle read. */
  openedAt: string;
  /** Newest barDate first. */
  occurrences: SignalReviewOccurrence[];
}

interface SignalReviewState {
  /** The symbol queue — sorted by lastDailySignalDate desc server-side. */
  queueRows: SignalReviewQueueRow[];
  queueLoading: boolean;
  queueError: string | null;

  /** The selected symbol + its occurrence bundle (symbol-keyed — the pane
   *  renders it only while bundle.symbol === selectedSymbol). */
  selectedSymbol: string | null;
  bundle: SignalReviewBundle | null;
  bundleLoading: boolean;
  bundleError: string | null;
  /** Stale-response guard — bumped per bundle fetch; only the newest owns
   *  the slot. */
  bundleSeq: number;
}

const initialState: SignalReviewState = {
  queueRows: [],
  queueLoading: false,
  queueError: null,
  selectedSymbol: null,
  bundle: null,
  bundleLoading: false,
  bundleError: null,
  bundleSeq: 0,
};

const errMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

export const SignalReviewStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((store) => ({
    /** The picker row set — queue rows annotated with the new-signal dot
     *  flag (`lastDailySignalDate > lastOpenedAt`, date-granular: a signal
     *  bar-dated the same day as the last open does not flag — the ISO
     *  stamp sorts after the bare date). */
    pickerRows: computed(() =>
      store.queueRows().map((row) => ({
        ...row,
        hasNewSignal: !!row.lastDailySignalDate
          && (!row.lastOpenedAt || row.lastDailySignalDate > row.lastOpenedAt),
      }))),
  })),
  withMethods((store, service = inject(SignalReviewService)) => ({
    /** Fetch the symbol queue. Safe to re-fire on Refresh — it replaces
     *  the row set wholesale. */
    async loadQueue(): Promise<void> {
      patchState(store, { queueLoading: true, queueError: null });
      try {
        const res = await firstValueFrom(service.getSignalReviewQueue$());
        patchState(store, { queueRows: res.rows, queueLoading: false });
      } catch (err) {
        // Prior rows stay put — the pane keeps its last-good queue under
        // the error banner rather than blanking on a transient failure.
        patchState(store, { queueLoading: false, queueError: errMessage(err) });
      }
    },

    /** Select a symbol and fetch its occurrence bundle. Always re-fires —
     *  the read stamps lastOpenedAt, so re-selecting advances the divider. */
    async selectSymbol(symbol: string): Promise<void> {
      const seq = store.bundleSeq() + 1;
      patchState(store, {
        bundleSeq: seq,
        selectedSymbol: symbol,
        bundleLoading: true,
        bundleError: null,
      });
      try {
        const res = await firstValueFrom(service.getSignalReviewBundle$(symbol));
        if (store.bundleSeq() !== seq) return; // stale — a newer select owns the slot
        patchState(store, {
          bundle: {
            symbol,
            previousOpenedAt: res.previousOpenedAt,
            openedAt: res.openedAt,
            occurrences: res.occurrences,
          },
          bundleLoading: false,
          // The read just stamped lastOpenedAt server-side — reflect it so
          // the new-signal dot clears without a queue refetch.
          queueRows: store.queueRows().map((r) =>
            r.symbol === symbol ? { ...r, lastOpenedAt: res.openedAt } : r),
        });
      } catch (err) {
        if (store.bundleSeq() !== seq) return;
        // The kept bundle stays keyed to its own symbol — last-good for a
        // same-symbol re-open, never displayed under a different one.
        patchState(store, { bundleLoading: false, bundleError: errMessage(err) });
      }
    },
  })),
);
