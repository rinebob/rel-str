/**
 * Contract List Session Store
 *
 * Page-scoped NgRx SignalStore for the Selected Contract List Picker
 * (#1361, IMPL §FE-2). Owns one list session per symbol: the active list
 * doc, the checked pick rows (rowKey = entryDate — unique per row,
 * survives sorts), chunk partition + cursor, and `rs-optlist` per-symbol
 * persistence. Deliberately separate from the generator store — a
 * doc-derived lifecycle, not a query-derived one; the two share only the
 * emit-to-textarea util.
 *
 * Restore re-reads the doc rather than trusting the blob (regenerable,
 * fresher); a stale docId lands on a named error, never a silent empty.
 */
import { computed, inject } from '@angular/core';
import { signalStore, withState, withComputed, withMethods, patchState } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import type { OptionsContractListUi } from '../backtest/common/options-replay.types';
import { ContractListService } from '../services/contract-list.service';
import { daysBetween } from '../../shared/utils/date.util';
import { pickRowsOf, toPairLines } from '../utils/contract-list-emit.util';
import {
  DEFAULT_CHUNK_SIZE,
  LIST_SESSION_VERSION,
  type DowCadence,
  type ListSessionSettings,
  readListSession,
  saveListSession,
} from '../utils/contract-list-session-settings';

export type ListSessionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ContractListSessionState {
  /** Normalized uppercase symbol this session is scoped to. */
  symbol: string;
  /** The persisted blob's docId — state, not derived from `activeList`,
   *  so a pref write after a failed load can't clobber a preserved
   *  session pointer (explicit-load failures keep the blob's docId by
   *  design; only restore-failures null it via `fail(wipe=true)`). */
  docId: string | null;
  activeList: OptionsContractListUi | null;
  /** Selected row keys — entryDates of pick rows. */
  selection: ReadonlySet<string>;
  chunkSize: number;
  /** Index into `chunks` — clamped to the partition on every mutation. */
  chunkCursor: number;
  status: ListSessionStatus;
  error: string | null;
  /** Last send's `date,id` lines — observability only. Records the
   *  attempted handoff, not a committed plot: the page can still drop
   *  the load (cancelled >50 confirm, pending-confirm bail). */
  lastEmitted: string[];
  /** Checked weekdays for the DOW preset — getUTCDay values 1–5 (#1402). */
  dowDays: number[];
  /** Cadence for the DOW preset (#1402). */
  cadence: DowCadence;
}

const initialState: ContractListSessionState = {
  symbol: '',
  docId: null,
  activeList: null,
  selection: new Set<string>(),
  chunkSize: DEFAULT_CHUNK_SIZE,
  chunkCursor: 0,
  status: 'idle',
  error: null,
  lastEmitted: [],
  dowDays: [],
  cadence: 'weekly',
};

// ---- DOW/cadence date math (#1402) -------------------------------------
// entryDates are 'YYYY-MM-DD' — parse as UTC so the weekday/week-of-month
// can't shift with the viewer's timezone.

const utcMs = (entryDate: string): number =>
  Date.UTC(+entryDate.slice(0, 4), +entryDate.slice(5, 7) - 1, +entryDate.slice(8, 10));

/** getUTCDay of an entryDate — 0=Sun … 6=Sat; pick rows are trading
 *  days so only 1–5 occur in practice. */
const dowOf = (entryDate: string): number => new Date(utcMs(entryDate)).getUTCDay();

/** Week-of-month block — days 1–7 = 1, 8–14 = 2, … Same-week-of-month
 *  monthly cadence holds this index constant (#1402 decision). */
const weekOfMonth = (entryDate: string): number => Math.ceil(+entryDate.slice(8, 10) / 7);

/** Sequential groups of `size` pick rows — each row is one pick day. */
const partition = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

const clamp = (i: number, len: number): number =>
  len === 0 ? 0 : Math.min(Math.max(0, i), len - 1);

export interface ListChunkInfo {
  /** 0-based chunk index. */
  index: number;
  /** Total chunks. */
  total: number;
  /** Pick days in the current chunk. */
  days: number;
  /** Distinct contractIds in the current chunk. */
  unique: number;
  /** First/last pick dates of the current chunk — a partial last chunk
   *  reports its own last pick, not the doc's lastDate (#1402). */
  startDate: string | null;
  endDate: string | null;
}

/** Named-error validation for a list doc — every unusable shape maps to
 *  a specific message. Shared by the store's apply path and the page's
 *  pre-symbol-switch check, so the two can't drift. Does NOT check the
 *  session symbol (callers compare against their own). */
export const contractListDocError = (
  doc: OptionsContractListUi | null,
  docId: string,
): string | null => {
  if (!doc) return `Contract list "${docId}" not found`;
  if (doc.status !== 'success') {
    return `Contract list "${docId}" has status "${doc.status}"${doc.error ? `: ${doc.error}` : ''}`;
  }
  if (!doc.pickDocMeta) return `Contract list "${docId}" has no pick metadata`;
  if (pickRowsOf(doc.rows).length === 0) {
    return `Contract list "${docId}" contains no pick rows`;
  }
  return null;
};

export const ContractListSessionStore = signalStore(
  withState(initialState),

  withComputed(({ activeList, selection, chunkSize }) => ({
    pickRows: computed(() => pickRowsOf(activeList()?.rows)),
    selectedRows: computed(() =>
      pickRowsOf(activeList()?.rows).filter((r) => selection().has(r.entryDate)),
    ),
    chunks: computed(() => partition(pickRowsOf(activeList()?.rows), chunkSize())),
  })),

  // Second block so these read the first block's `selectedRows`/`chunks`
  // signals instead of re-running the same filters/partitions.
  withComputed(({ selectedRows, chunks, chunkCursor }) => ({
    /** Distinct contractIds across the selection — duplicates count once. */
    uniqueCount: computed(() => new Set(selectedRows().map((r) => r.contractId)).size),
    /** The lines `sendSelected` would emit right now — preview seam. */
    emittedLines: computed(() => toPairLines(selectedRows())),
    currentChunk: computed(
      () => chunks()[clamp(chunkCursor(), chunks().length)] ?? [],
    ),
    chunkInfo: computed((): ListChunkInfo => {
      const list = chunks();
      const cur = list[clamp(chunkCursor(), list.length)] ?? [];
      return {
        index: clamp(chunkCursor(), list.length),
        total: list.length,
        days: new Set(cur.map((r) => r.entryDate)).size,
        unique: new Set(cur.map((r) => r.contractId)).size,
        startDate: cur[0]?.entryDate ?? null,
        endDate: cur[cur.length - 1]?.entryDate ?? null,
      };
    }),
    /** Step-bound predicates — both stepper surfaces disable on these
     *  instead of re-deriving the clamp bounds in template expressions. */
    canStepPrev: computed(() => clamp(chunkCursor(), chunks().length) > 0),
    canStepNext: computed(
      () => clamp(chunkCursor(), chunks().length) < chunks().length - 1,
    ),
  })),

  // Third block so these read `currentChunk` instead of re-deriving the
  // clamp twice — the Add/Remove buttons disable on these.
  withComputed(({ currentChunk, selection }) => ({
    canAddChunk: computed(() =>
      currentChunk().some((r) => !selection().has(r.entryDate)),
    ),
    canRemoveChunk: computed(() =>
      currentChunk().some((r) => selection().has(r.entryDate)),
    ),
  })),

  withMethods((store, svc = inject(ContractListService)) => {
    // Sequence guard — a load only applies while it's the latest call
    // and the symbol it ran under is still current (generator pattern).
    let loadSeq = 0;

    const persist = (): void => {
      if (!store.symbol()) return;
      saveListSession(store.symbol(), {
        version: LIST_SESSION_VERSION,
        docId: store.docId(),
        chunkSize: store.chunkSize(),
        cursor: store.chunkCursor(),
        selectionKeys: [...store.selection()],
        dowDays: store.dowDays(),
        cadence: store.cadence(),
      });
    };

    const emptySession = (): Partial<ContractListSessionState> => ({
      activeList: null,
      selection: new Set<string>(),
      chunkCursor: 0,
      status: 'idle',
      error: null,
      lastEmitted: [],
      // dowDays/cadence deliberately absent — like chunkSize they are
      // prefs, not session data: a failed load must not uncheck the
      // user's toggles. setSymbol resets them from the saved blob.
    });

    const setSelection = (keys: Iterable<string>): void => {
      patchState(store, { selection: new Set(keys) });
      persist();
    };

    const pickDates = (): Set<string> =>
      new Set(store.pickRows().map((r) => r.entryDate));

    /** Single cursor primitive — step/jump/share the clamp + persist. */
    const moveCursorTo = (i: number): void => {
      patchState(store, { chunkCursor: clamp(Math.floor(i), store.chunks().length) });
      persist();
    };

    /** Single emit primitive — lines + lastEmitted in one patch. */
    const emitSelected = (): string[] => {
      const lines = toPairLines(store.selectedRows());
      patchState(store, { lastEmitted: lines });
      return lines;
    };

    /** `wipePersisted` is only set on restore-initiated loads — it
     *  rewrites the stale blob (empty session, docId:null) that led to
     *  the failure so it doesn't re-fail on every reload. An explicit
     *  load leaves the blob alone: a bad `?list=` link must not erase
     *  a prior session's saved docId/selection/cursor. */
    const fail = (message: string, wipePersisted: boolean): void => {
      patchState(store, {
        ...emptySession(),
        // docId survives unless this is a restore-initiated wipe — an
        // explicit failure must not sever the blob's session pointer
        // (the "explicit failure leaves the blob alone" contract only
        // works because persist() writes state.docId, not activeList).
        // selection/chunkCursor are preserved too: the next pref write
        // persists them back, so the blob keeps the whole prior session.
        // Inert while activeList is null — applyList resets both on the
        // next successful load.
        ...(wipePersisted
          ? { docId: null }
          : { selection: store.selection(), chunkCursor: store.chunkCursor() }),
        status: 'error',
        error: message,
      });
      if (wipePersisted) persist();
    };

    /** Validation shared by `loadList` (fetched) and `loadListDoc`
     *  (pre-read by the page for its symbol check) — every failure mode
     *  lands on a named error; a doc outside the session's symbol is
     *  rejected too. */
    const applyLoadedDoc = (
      doc: OptionsContractListUi | null,
      docId: string,
      restore: ListSessionSettings | undefined,
      symbol: string,
    ): void => {
      const wipe = restore != null;
      const docErr = contractListDocError(doc, docId);
      if (docErr || !doc) {
        return fail(docErr ?? `Contract list "${docId}" not found`, wipe);
      }
      if (doc.symbol.trim().toUpperCase() !== symbol) {
        return fail(`Contract list "${docId}" belongs to ${doc.symbol}, not ${symbol}`, wipe);
      }
      applyList(doc, restore, symbol);
    };

    const applyList = (
      doc: OptionsContractListUi,
      restore: ListSessionSettings | undefined,
      symbol: string,
    ): void => {
      const dates = pickRowsOf(doc.rows).map((r) => r.entryDate);
      const dateSet = new Set(dates);
      const size = restore?.chunkSize ?? store.chunkSize();
      const chunkCount = Math.ceil(dates.length / size);
      patchState(store, {
        activeList: doc,
        docId: doc.listId,
        // Fresh lists open EMPTY (#1420 UAT) — the picker is a workspace:
        // nothing is checked until the user selects, so Send can never
        // fire a payload the user didn't choose. Restored sessions keep
        // their saved selectionKeys.
        selection: new Set(
          restore ? restore.selectionKeys.filter((k) => dateSet.has(k)) : [],
        ),
        chunkSize: size,
        chunkCursor: clamp(restore?.cursor ?? 0, chunkCount),
        status: 'ready',
        error: null,
        lastEmitted: [],
      });
      if (store.symbol() === symbol) persist();
    };

    /** Fetch a list doc into the session — shared by the `loadList`
     *  method and `setSymbol`'s restore path so neither self-invokes
     *  through `this`. */
    const doLoadList = async (docId: string, restore?: ListSessionSettings): Promise<void> => {
      const symbol = store.symbol();
      loadSeq++;
      const seq = loadSeq;
      patchState(store, { status: 'loading', error: null });
      try {
        const doc = await firstValueFrom(svc.getList$(docId));
        if (seq !== loadSeq || store.symbol() !== symbol) return;
        applyLoadedDoc(doc, docId, restore, symbol);
      } catch (err) {
        if (seq !== loadSeq || store.symbol() !== symbol) return;
        fail(
          `Contract list "${docId}" failed to load: ${(err as Error)?.message ?? 'unknown error'}`,
          restore != null,
        );
      }
    };

    return {
      /** Point the session at a symbol — restores that symbol's blob:
       *  chunk prefs immediately; the list doc re-reads (fresh, and a
       *  stale docId → named error). Empty blob → empty session. */
      setSymbol(symbol: string): void {
        const sym = String(symbol || '').trim().toUpperCase();
        if (sym === store.symbol()) return;
        loadSeq++;
        const saved = readListSession(sym);
        // emptySession() first, then the saved blob's prefs — dowDays/
        // cadence aren't session data, so they come from `saved`
        // (tolerant read → defaults on a missing blob), not from the
        // empty-session patch (#1402).
        patchState(store, {
          ...emptySession(),
          symbol: sym,
          docId: saved.docId,
          chunkSize: saved.chunkSize,
          dowDays: saved.dowDays,
          cadence: saved.cadence,
        });
        if (saved.docId) {
          void doLoadList(saved.docId, saved);
        }
      },

      /** Fetch a list doc into the session by id — the fetch-by-id entry
       *  point (specs exercise doLoadList through it; production loads go
       *  through `loadListDoc` after the page's pre-read). Missing /
       *  non-success / unmetas / empty docs each land on a named error —
       *  the chart is never touched (send* is the only emit path).
       *  `restore` applies saved keys/cursor/chunkSize; a fresh load
       *  selects nothing. */
      loadList: doLoadList,

      /** Load an already-read doc (the page reads once for its symbol
       *  check — this seam avoids a second fetch). Same validation and
       *  named-error behavior as `loadList`. */
      loadListDoc(doc: OptionsContractListUi, restore?: ListSessionSettings): void {
        const symbol = store.symbol();
        loadSeq++;
        applyLoadedDoc(doc, doc.listId, restore, symbol);
      },

      /** Check/uncheck one pick row — no-selection keys are rejected. */
      toggleRow(entryDate: string, selected: boolean): void {
        if (!pickDates().has(entryDate)) return;
        const next = new Set(store.selection());
        if (selected) next.add(entryDate);
        else next.delete(entryDate);
        setSelection(next);
      },

      /** Toggle ALL pick days of a chunk AND move the cursor to it —
       *  the timeline tick's selection op (#1420): chunk-granular so
       *  every click is a visible ~N-day change, and ONE patchState +
       *  persist so the saved blob can never hold a new selection under
       *  a stale cursor. Tri-state like a group checkbox: fully selected
       *  → clear the chunk; partially/empty → fill it. Day-level
       *  granularity stays on the Rows tab. Never emits. */
      toggleChunkAt(chunkIdx: number): void {
        const list = store.chunks();
        const chunk = Number.isFinite(chunkIdx) ? list[chunkIdx] : undefined;
        if (!chunk?.length) return;
        const next = new Set(store.selection());
        const allSelected = chunk.every((r) => next.has(r.entryDate));
        for (const r of chunk) {
          if (allSelected) next.delete(r.entryDate);
          else next.add(r.entryDate);
        }
        patchState(store, {
          selection: next,
          chunkCursor: clamp(chunkIdx, list.length),
        });
        persist();
      },

      selectAll(): void {
        setSelection(pickDates());
      },

      selectNone(): void {
        setSelection(new Set<string>());
      },

      invertSelection(): void {
        const cur = store.selection();
        setSelection([...pickDates()].filter((d) => !cur.has(d)));
      },

      /** Every k-th pick day starting at the first (k>=1; stride 1 = all). */
      selectStride(k: number): void {
        if (!Number.isFinite(k)) return;
        const step = Math.max(1, Math.floor(k));
        setSelection(
          store.pickRows()
            .filter((_, i) => i % step === 0)
            .map((r) => r.entryDate),
        );
      },

      /** Select an explicit set of pick days — replay-pick sync (#1423):
       *  the dropdown's default slice becomes the picker selection.
       *  Non-pick dates are dropped, one patch + persist. */
      selectDates(dates: Iterable<string>): void {
        const valid = pickDates();
        setSelection([...dates].filter((d) => valid.has(d)));
      },

      /** N unique pick days sampled without replacement — injectable rng
       *  keeps the seam deterministic in specs. */
      randomPick(n: number, rng: () => number = Math.random): void {
        if (!Number.isFinite(n)) return;
        const pool = store.pickRows().map((r) => r.entryDate);
        const picked: string[] = [];
        // Snapshot the bound — splice drains pool mid-loop.
        const count = Math.min(Math.max(0, Math.floor(n)), pool.length);
        for (let i = 0; i < count; i++) {
          // Clamp — an injected rng() === 1 must not splice undefined.
          const i0 = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
          picked.push(pool.splice(i0, 1)[0]);
        }
        setSelection(picked);
      },

      /** Inclusive entry-date bounds. */
      selectDateRange(from: string, to: string): void {
        const lo = from <= to ? from : to;
        const hi = from <= to ? to : from;
        setSelection(
          store.pickRows()
            .filter((r) => r.entryDate >= lo && r.entryDate <= hi)
            .map((r) => r.entryDate),
        );
      },

      /** Contract-id substring filter (case-insensitive; empty = all). */
      selectContains(text: string): void {
        const needle = String(text || '').trim().toLowerCase();
        setSelection(
          store.pickRows()
            .filter((r) => r.contractId.toLowerCase().includes(needle))
            .map((r) => r.entryDate),
        );
      },

      /** DOW preset prefs — persisted, but they don't touch the
       *  selection until `applyDowPreset` runs (#1402). */
      setDowDays(days: number[]): void {
        const clean = [
          ...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 5)),
        ].sort((a, b) => a - b);
        patchState(store, { dowDays: clean });
        persist();
      },

      setCadence(c: DowCadence): void {
        patchState(store, { cadence: c });
        persist();
      },

      /** Replace the selection with pick rows matching the checked
       *  weekdays at the current cadence — same replace semantics as
       *  the other toolbar ops, so manual toggles compose on top
       *  afterwards (#1402). Cadences: weekly = every matching weekday;
       *  biweekly = alternating 7-day blocks starting at the first pick
       *  row (a Mon–Sun week when the anchor is a Monday); monthly =
       *  the same week-of-month block (ceil(day/7)). Both anchors
       *  derive from the first pick row, not the checked days, so the
       *  cadence grid is stable as toggles change. Empty weekday set
       *  is a no-op, not a wipe. */
      applyDowPreset(): void {
        const dows = new Set(store.dowDays());
        const rows = store.pickRows();
        const anchor = rows[0]?.entryDate;
        if (dows.size === 0 || !anchor) return;
        const anchorWom = weekOfMonth(anchor);
        const cadence = store.cadence();
        setSelection(
          rows
            .filter((r) => {
              if (!dows.has(dowOf(r.entryDate))) return false;
              if (cadence === 'biweekly') {
                // Anchor-relative blocks — NOT epoch weeks: an epoch-
                // anchored boundary (Thursday) splits the anchor's own
                // calendar week for multi-weekday sets (#1402 review).
                return Math.floor(daysBetween(anchor, r.entryDate) / 7) % 2 === 0;
              }
              if (cadence === 'monthly') {
                return weekOfMonth(r.entryDate) === anchorWom;
              }
              return true;
            })
            .map((r) => r.entryDate),
        );
      },

      setChunkSize(n: number): void {
        if (!Number.isFinite(n)) return;
        const size = Math.max(1, Math.floor(n));
        const count = Math.ceil(store.pickRows().length / size);
        patchState(store, {
          chunkSize: size,
          chunkCursor: clamp(store.chunkCursor(), count),
        });
        persist();
      },

      /** Check the current chunk's days into the persistent selection —
       *  accumulates, doesn't replace. */
      addChunkToSelection(): void {
        setSelection(new Set([...store.selection(), ...store.currentChunk().map((r) => r.entryDate)]));
      },

      /** Uncheck every pick day of the CURRENT chunk — the symmetric
       *  partner of addChunkToSelection (the Remove button / chunk-level
       *  clear). Days outside the chunk are untouched. Never emits. */
      removeChunkFromSelection(): void {
        const next = new Set(store.selection());
        for (const r of store.currentChunk()) next.delete(r.entryDate);
        setSelection(next);
      },

      /** `date,id` lines for the checked rows — the page writes these
       *  into the pairs textarea and calls the existing load path.
       *  #1419: the ONLY emit path is an explicit send — `selection` is
       *  the single source, so what's plotted always equals what's
       *  checked; cursor moves below never emit. */
      sendSelected(): string[] {
        return emitSelected();
      },

      /** Move the chunk cursor — navigation only, never emits and does
       *  not touch `selection` (Add chunk is the selection op; Send
       *  applies it). The #1363 move-then-emit protocol was replaced by
       *  the #1419 model: stepping in the dialog would plot behind an
       *  overlay that covers the chart. */
      step(dir: number): void {
        if (!Number.isFinite(dir)) return;
        moveCursorTo(store.chunkCursor() + Math.sign(dir));
      },

    };
  }),
);
