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
import { pickRowsOf, toPairLines } from '../utils/contract-list-emit.util';
import {
  DEFAULT_CHUNK_SIZE,
  LIST_SESSION_VERSION,
  type ListSessionSettings,
  clearListSession,
  readListSession,
  saveListSession,
} from '../utils/contract-list-session-settings';

export type ListSessionStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ContractListSessionState {
  /** Normalized uppercase symbol this session is scoped to. */
  symbol: string;
  activeList: OptionsContractListUi | null;
  /** Selected row keys — entryDates of pick rows. */
  selection: ReadonlySet<string>;
  chunkSize: number;
  /** Index into `chunks` — clamped to the partition on every mutation. */
  chunkCursor: number;
  status: ListSessionStatus;
  error: string | null;
  /** Last emitted `date,id` lines (Send-to-chart handoff). */
  lastEmitted: string[];
}

const initialState: ContractListSessionState = {
  symbol: '',
  activeList: null,
  selection: new Set<string>(),
  chunkSize: DEFAULT_CHUNK_SIZE,
  chunkCursor: 0,
  status: 'idle',
  error: null,
  lastEmitted: [],
};

/** Sequential groups of `size` pick rows — each row is one pick day. */
const partition = <T>(rows: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
};

const clamp = (i: number, len: number): number =>
  len === 0 ? 0 : Math.min(Math.max(0, i), len - 1);

/** Default checked set on a fresh list — the first N pick days. */
const FIRST_PICKS_DEFAULT = 10;

export interface ListChunkInfo {
  /** 0-based chunk index. */
  index: number;
  /** Total chunks. */
  total: number;
  /** Pick days in the current chunk. */
  days: number;
  /** Distinct contractIds in the current chunk. */
  unique: number;
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
      };
    }),
  })),

  withMethods((store, svc = inject(ContractListService)) => {
    // Sequence guard — a load only applies while it's the latest call
    // and the symbol it ran under is still current (generator pattern).
    let loadSeq = 0;

    const persist = (): void => {
      if (!store.symbol()) return;
      saveListSession(store.symbol(), {
        version: LIST_SESSION_VERSION,
        docId: store.activeList()?.listId ?? null,
        chunkSize: store.chunkSize(),
        cursor: store.chunkCursor(),
        selectionKeys: [...store.selection()],
      });
    };

    const emptySession = (): Partial<ContractListSessionState> => ({
      activeList: null,
      selection: new Set<string>(),
      chunkCursor: 0,
      status: 'idle',
      error: null,
      lastEmitted: [],
    });

    const setSelection = (keys: Iterable<string>): void => {
      patchState(store, { selection: new Set(keys) });
      persist();
    };

    const pickDates = (): Set<string> =>
      new Set(store.pickRows().map((r) => r.entryDate));

    /** `wipePersisted` is only set on restore-initiated loads — it
     *  rewrites the stale blob (empty session, docId:null) that led to
     *  the failure so it doesn't re-fail on every reload. An explicit
     *  load leaves the blob alone: a bad `?list=` link must not erase
     *  a prior session's saved docId/selection/cursor. */
    const fail = (message: string, wipePersisted: boolean): void => {
      patchState(store, { ...emptySession(), status: 'error', error: message });
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
        selection: new Set(
          restore
            ? restore.selectionKeys.filter((k) => dateSet.has(k))
            : dates.slice(0, FIRST_PICKS_DEFAULT),
        ),
        chunkSize: size,
        chunkCursor: clamp(restore?.cursor ?? 0, chunkCount),
        status: 'ready',
        error: null,
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
        patchState(store, {
          symbol: sym,
          chunkSize: saved.chunkSize,
          ...emptySession(),
        });
        if (saved.docId) {
          void doLoadList(saved.docId, saved);
        }
      },

      /** Fetch a list doc into the session. Missing / non-success /
       *  unmetas / empty docs each land on a named error — the chart is
       *  never touched (send* is the only emit path). `restore` applies
       *  saved keys/cursor/chunkSize instead of the first-10 default. */
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
        const step = Math.max(1, Math.floor(k));
        setSelection(
          store.pickRows()
            .filter((_, i) => i % step === 0)
            .map((r) => r.entryDate),
        );
      },

      /** N unique pick days sampled without replacement — injectable rng
       *  keeps the seam deterministic in specs. */
      randomPick(n: number, rng: () => number = Math.random): void {
        const pool = store.pickRows().map((r) => r.entryDate);
        const picked: string[] = [];
        // Snapshot the bound — splice drains pool mid-loop.
        const count = Math.min(Math.max(0, Math.floor(n)), pool.length);
        for (let i = 0; i < count; i++) {
          picked.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
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

      /** Cursor step — clamps at both ends (no wrap). */
      step(dir: number): void {
        patchState(store, {
          chunkCursor: clamp(store.chunkCursor() + Math.sign(dir), store.chunks().length),
        });
        persist();
      },

      setChunk(i: number): void {
        patchState(store, { chunkCursor: clamp(Math.floor(i), store.chunks().length) });
        persist();
      },

      setChunkSize(n: number): void {
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

      /** `date,id` lines for the checked rows — the page writes these
       *  into the pairs textarea and calls the existing load path. */
      sendSelected(): string[] {
        const lines = toPairLines(store.selectedRows());
        patchState(store, { lastEmitted: lines });
        return lines;
      },

      /** `date,id` lines for the current chunk — stepper live-drive. */
      sendChunk(): string[] {
        const lines = toPairLines(store.currentChunk());
        patchState(store, { lastEmitted: lines });
        return lines;
      },

      /** Drop the session and the symbol's persisted blob. */
      clear(): void {
        loadSeq++;
        clearListSession(store.symbol());
        patchState(store, { ...emptySession(), chunkSize: DEFAULT_CHUNK_SIZE });
      },
    };
  }),
);
