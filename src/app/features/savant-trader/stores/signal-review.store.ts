/**
 * @topic #553 — Paper Trading | @task #1653 | @task #1654
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
import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import { SignalReviewService } from '../services/signal-review.service';
import { signalPickFromReviewOccurrence } from '@paper-trading/contracts';
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

  /** Per-row toggle in-flight flags, keyed by occurrenceId — the checkbox
   *  disables while its mint/delete is on the wire. */
  togglePending: Record<string, true>;
  /** Per-row failure messages, keyed by occurrenceId — mint `error` and
   *  delete `failed` reasons land here, legible instead of silent. */
  rowErrors: Record<string, string>;
  /** Confirmed toggle outcomes, keyed by occurrenceId — applied to every
   *  arriving bundle so a refetch that read the ledger before a mint/delete
   *  committed can't resurrect the pre-toggle row (the select×toggle
   *  interleave). This pane is the sole mutator of these rows, so the
   *  overlay is the freshest truth the session holds. */
  confirmedPatches: Record<string, Partial<SignalReviewOccurrence>>;
  /** Session's freshest open stamp per symbol — written on every bundle
   *  read and merged into queue rows whenever they (re)arrive, so a queue
   *  response carrying a pre-open stamp can't resurrect the dot. */
  symbolOpenedAt: Record<string, string>;
  /** Stale-response guard for loadQueue — a queue response dispatched
   *  before a bundle open must not overwrite the openedAt propagation
   *  (the dot would reappear on the just-opened symbol). */
  queueSeq: number;
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
  togglePending: {},
  rowErrors: {},
  confirmedPatches: {},
  symbolOpenedAt: {},
  queueSeq: 0,
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
    /** First "old" row's index = the count of new rows. Occurrences arrive
     *  newest-first; a row is new while `signalBarDate > previousOpenedAt`
     *  (same-day is NOT new — the bare date sorts before the ISO stamp).
     *  `null` stamp → every row new → index = length (no divider below). */
    dividerIndex: computed(() => {
      const b = store.bundle();
      if (!b || b.previousOpenedAt === null) return b?.occurrences.length ?? 0;
      const prev = b.previousOpenedAt;
      const idx = b.occurrences.findIndex((o) => o.signalBarDate <= prev);
      return idx === -1 ? b.occurrences.length : idx;
    }),
  })),
  withMethods((store, service = inject(SignalReviewService)) => ({
    /** Fetch the symbol queue. Safe to re-fire on Refresh — it replaces
     *  the row set wholesale. The seq guard keeps a slow earlier fetch
     *  from clobbering a newer one (or a propagated open stamp). */
    async loadQueue(): Promise<void> {
      const seq = store.queueSeq() + 1;
      patchState(store, { queueSeq: seq, queueLoading: true, queueError: null });
      try {
        const res = await firstValueFrom(service.getSignalReviewQueue$());
        if (store.queueSeq() !== seq) return; // stale — a newer fetch owns the rows
        patchState(store, {
          // Keep the session's freshest lastOpenedAt per row — a queue
          // response dispatched before a bundle open can carry the
          // pre-open stamp; merging preserves the propagated openedAt so
          // the dot can't resurrect on the just-opened symbol.
          queueRows: res.rows.map((r) => {
            const opened = store.symbolOpenedAt()[r.symbol];
            return opened && (!r.lastOpenedAt || opened > r.lastOpenedAt)
              ? { ...r, lastOpenedAt: opened }
              : r;
          }),
          queueLoading: false,
        });
      } catch (err) {
        if (store.queueSeq() !== seq) return;
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
            // Keyed by the RESPONSE's symbol — a wrong-payload response
            // can't launder another symbol's rows under this selection.
            symbol: res.symbol,
            previousOpenedAt: res.previousOpenedAt,
            openedAt: res.openedAt,
            // Confirmed toggle outcomes override the join — a bundle read
            // that predates the commit must not resurrect the old row.
            occurrences: res.occurrences.map((o) => ({
              ...o,
              ...store.confirmedPatches()[o.occurrenceId],
            })),
          },
          bundleLoading: false,
          // The read just stamped lastOpenedAt server-side — reflect it so
          // the new-signal dot clears without a queue refetch. The
          // symbolOpenedAt map holds it for rows that haven't arrived yet.
          symbolOpenedAt: { ...store.symbolOpenedAt(), [symbol]: res.openedAt },
          queueRows: store.queueRows().map((r) =>
            r.symbol === symbol ? { ...r, lastOpenedAt: res.openedAt } : r),
          // A fresh join means fresh row state — this symbol's stale
          // per-row errors (e.g. a transient mint failure) don't carry
          // across the re-open.
          rowErrors: Object.fromEntries(
            Object.entries(store.rowErrors())
              .filter(([k]) => !k.startsWith(`${symbol}_`))),
        });
      } catch (err) {
        if (store.bundleSeq() !== seq) return;
        // The kept bundle stays keyed to its own symbol — last-good for a
        // same-symbol re-open, never displayed under a different one.
        patchState(store, { bundleLoading: false, bundleError: errMessage(err) });
      }
    },

    /** Flip one row's ledger membership — confirmed, not optimistic.
     *  The row is looked up in the live bundle at dispatch (a stale emit
     *  can't mint against state the pane no longer holds), and a second
     *  tap while pending is ignored. Unchecked → mint via
     *  generatePaperSignalTrades; checked → delete via deletePaperTrades.
     *  Only the row patches — the bundle's previousOpenedAt stamp is the
     *  session's divider anchor and never refetches per toggle. */
    async toggle(occurrenceId: string): Promise<void> {
      const b = store.bundle();
      const row = b?.occurrences.find((o) => o.occurrenceId === occurrenceId);
      if (!row || store.togglePending()[occurrenceId]) return;

      const setPending = (on: boolean) =>
        patchState(store, {
          togglePending: on
            ? { ...store.togglePending(), [occurrenceId]: true }
            : Object.fromEntries(
                Object.entries(store.togglePending()).filter(([k]) => k !== occurrenceId)),
        });
      const setRowError = (msg: string | null) =>
        patchState(store, {
          rowErrors: msg === null
            ? Object.fromEntries(
                Object.entries(store.rowErrors()).filter(([k]) => k !== occurrenceId))
            : { ...store.rowErrors(), [occurrenceId]: msg },
        });
      const patchRow = (patch: Partial<SignalReviewOccurrence>) =>
        patchState(store, {
          // The outcome is confirmed server truth — record it in the
          // session overlay so a bundle refetch that read the ledger
          // before the commit can't resurrect the pre-toggle row.
          confirmedPatches: {
            ...store.confirmedPatches(),
            [occurrenceId]: patch,
          },
          bundle: {
            ...store.bundle()!,
            occurrences: store.bundle()!.occurrences.map((o) =>
              o.occurrenceId === occurrenceId ? { ...o, ...patch } : o),
          },
        });

      setPending(true);
      setRowError(null); // retry clears the prior failure
      try {
        if (!row.checked) {
          const res = await firstValueFrom(service.generatePaperSignalTrades$({
            items: [signalPickFromReviewOccurrence(row)],
          }));
          const r = res.results[0];
          if (r && r.status !== 'error' && r.tradeId) {
            // tradeStatus stays undefined — MintResult carries no status
            // field, and a deduped join could be any lifecycle state.
            patchRow({ checked: true, tradeId: r.tradeId });
          } else {
            setRowError(r?.error ?? (r ? 'mint result missing tradeId' : 'mint returned no result'));
          }
        } else {
          if (!row.tradeId) {
            setRowError('row is checked but carries no tradeId — cannot delete');
            return;
          }
          const tradeId = row.tradeId;
          const res = await firstValueFrom(service.deletePaperTrades$({ tradeIds: [tradeId] }));
          const refusal = res.failed.find((f) => f.tradeId === tradeId);
          if (res.deleted.includes(tradeId) || res.notFound.includes(tradeId)) {
            patchRow({ checked: false, tradeId: undefined, tradeStatus: undefined });
          } else {
            setRowError(refusal?.error ?? 'delete reported no outcome');
          }
        }
      } catch (err) {
        setRowError(errMessage(err));
      } finally {
        setPending(false);
      }
    },
  })),
);
