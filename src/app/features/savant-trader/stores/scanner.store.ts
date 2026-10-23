/**
 * ScannerStore — RH Scanner page state (#1098/#1139).
 *
 * Owns the run lifecycle: recipe selection → runScan (discovery compare)
 * or evaluateTracked (two-eval prune compare) → auto-persist the
 * CurationProposal → history. Superseded-run cancellation via a run
 * token — a second run started while the first is in flight drops the
 * first's results when it lands.
 *
 * compareDiscovery/comparePrune are pure (#1138); this store only
 * orchestrates the async boundary and holds the results.
 */
import { computed, inject } from '@angular/core';
import {
  patchState,
  signalStore,
  withComputed,
  withMethods,
  withState,
} from '@ngrx/signals';

import { ToolExecutionErrorCategory } from '@robinhood-mcp/contracts';
import type {
  PreviewScanResult,
  ScanResultRow,
} from '@robinhood-mcp/contracts';
import { RobinhoodMcpError } from '../../../core/robinhood-mcp/types/robinhood-mcp.types';
import { isScanTruncated } from '@st/scanner';
import type { CurationProposal, ScanRecipe } from '@st/scanner';

import { ScannerService, type StoredProposal } from '../services/scanner.service';
import { SymbolListStore } from './symbol-list.store';
import {
  SCANNER_RECIPES,
  type ScannerRecipe,
} from '../scanner/scanner-recipes';
import {
  mergeLookup,
  normScanSymbol,
  parseScanRows,
  type ScanRow,
} from '../utils/scanner-rows.util';
import { compareDiscovery, comparePrune } from '../utils/scanner-compare.util';
import type { CompareResult } from '../utils/scanner-compare.util';

/** Chunk progress for the two-eval prune — null when not evaluating. */
export interface EvalProgress {
  done: number;
  total: number;
}

export interface ScannerError {
  message: string;
  /** RobinhoodMcpError category — AUTH means the page should prompt re-auth. */
  category: ToolExecutionErrorCategory | null;
}

/** Per-recipe run state for the auto-run overview (#1183) — the entry
 *  shape of the store's recipe-keyed runs map (added in #1198) and the
 *  `run` input of the per-recipe table component (#1197). Each entry
 *  tracks its own lifecycle so a failure or in-flight refresh never
 *  disturbs the other recipes. */
export interface RecipeRunState {
  status: 'idle' | 'loading' | 'success' | 'error';
  /** Raw wire result — the table derives rows/lookup itself. */
  result: PreviewScanResult | null;
  ranAt: string | null;
  errorKind: 'auth' | 'other' | null;
}

export interface ScannerState {
  recipes: readonly ScannerRecipe[];
  activeRecipeId: string | null;
  running: boolean;
  rows: ScanRow[];
  compare: CompareResult | null;
  /** Wire truth for the status line — discovery: total_items (survives
   *  the 200-row cap); prune: matched rows. Null before a run lands. */
  matchedCount: number | null;
  /** Which run produced the current compare — the status line reads
   *  "shown of matched" for discovery but "evaluated · matched" for
   *  prune (prune display rows are coverage∪matched — they outnumber
   *  the matched count, so "shown of matched" would print N > M). */
  runKind: 'scan' | 'eval' | null;
  /** Effective display_name → wire-key map for the current run —
   *  presence-verified [echo, static, raw] per mergeLookup. Null →
   *  the page falls back to the recipe's static map. */
  columnLookup: ReadonlyMap<string, string> | null;
  /** Auto-run overview (#1183) — one entry per catalog recipe, `idle`
   *  until runAllRecipes / refreshRecipe launches it (#1198). */
  runs: Record<string, RecipeRunState>;
  /** Recipe ids with a staggered launch armed but not yet fired —
   *  keeps `runsLoading` true through the wave's gaps between slots. */
  armedLaunches: string[];
  proposals: StoredProposal[];
  proposalsLoading: boolean;
  proposalOpen: StoredProposal | null;
  evaluating: EvalProgress | null;
  error: ScannerError | null;
}

const idleRun = (): RecipeRunState => ({
  status: 'idle',
  result: null,
  ranAt: null,
  errorKind: null,
});

const initialState: ScannerState = {
  recipes: SCANNER_RECIPES,
  activeRecipeId: SCANNER_RECIPES[0]?.id ?? null,
  running: false,
  runs: Object.fromEntries(SCANNER_RECIPES.map((r) => [r.id, idleRun()])),
  armedLaunches: [],
  rows: [],
  compare: null,
  matchedCount: null,
  runKind: null,
  columnLookup: null,
  proposals: [],
  proposalsLoading: false,
  proposalOpen: null,
  evaluating: null,
  error: null,
};

// category is RH-side only: RobinhoodMcpError carries it; Firebase-side
// failures (requireUserId, Firestore denies) stay category:null — a
// Firebase auth lapse must not trigger the page's RH re-auth prompt.
const toError = (e: unknown): ScannerError =>
  e instanceof RobinhoodMcpError
    ? { message: e.message, category: e.category ?? null }
    : { message: e instanceof Error ? e.message : String(e), category: null };

const toProposal = (
  recipe: ScanRecipe,
  universeSize: number,
  matchedCount: number,
  compare: CompareResult,
): CurationProposal => ({
  recipeId: recipe.id,
  ranAt: new Date().toISOString(),
  universeSize,
  matchedCount,
  truncated: compare.truncated,
  ...compare.buckets,
  ...(Object.keys(compare.dropDetail).length > 0
    ? { dropDetail: compare.dropDetail }
    : {}),
});

export const ScannerStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),

  withComputed((state) => ({
    activeRecipe: computed(
      () => state.recipes().find((r) => r.id === state.activeRecipeId()) ?? null,
    ),
    busy: computed(() => state.running() || state.evaluating() !== null),
    /** Whether the AUTH-category error should prompt RH re-auth. */
    requiresReauth: computed(
      () => state.error()?.category === ToolExecutionErrorCategory.AUTH,
    ),
    /** Prune is offered only for recipes that declare it (quality set). */
    canEvaluateTracked: computed(() => {
      const r = state.recipes().find((x) => x.id === state.activeRecipeId());
      return !!r?.supportsPrune && typeof r.noDataPred === 'function';
    }),
    /** Any recipe run carrying an auth-shaped error — auth failures are
     *  session-global, so one is enough to warrant the reauth surface. */
    authFailed: computed(() =>
      Object.values(state.runs()).some((r) => r.errorKind === 'auth'),
    ),
    /** True while any recipe is armed or in flight — the page's Run all
     *  button gates on it. Armed-but-unfired slots count so the gate
     *  can't flicker open in the gaps between staggered launches. */
    runsLoading: computed(
      () =>
        state.armedLaunches().length > 0 ||
        Object.values(state.runs()).some((r) => r.status === 'loading'),
    ),
  })),

  withMethods(
    (
      state,
      service = inject(ScannerService),
      symbolLists = inject(SymbolListStore),
    ) => {
      /** Superseded-run tokens — `runSeq` bumps on every run of ANY type
       *  so a stale completion can't clobber newer results; the per-type
       *  seqs keep a late same-type run from clearing the newer run's
       *  busy flag. Runs are NOT busy-guarded — a second click
       *  supersedes, which is the point of the token. */
      let runSeq = 0;
      let scanSeq = 0;
      let evalSeq = 0;
      let proposalSeq = 0;
      /** Per-recipe launch tokens for the auto-run map — a stale
       *  completion from an overlapping runAll/refresh cycle can't
       *  clobber a newer launch for that recipe (last-write-wins by
       *  launch order, not network order). */
      const recipeSeqs = new Map<string, number>();
      /** Armed stagger slots, by recipe — a runAll re-entry clears the
       *  whole wave, and launchRecipe consumes the recipe's own slot so
       *  a refresh during the stagger can't double-fire it. */
      const pendingLaunches = new Map<string, ReturnType<typeof setTimeout>>();

      const patch = (partial: Partial<ScannerState>) =>
        patchState(state, partial);

      const patchRun = (id: string, entry: RecipeRunState) =>
        patch({ runs: { ...state.runs(), [id]: entry } });

      /** Launch one recipe: consume its armed slot if any (a refresh
       *  during the stagger can't then double-fire it), flip the entry
       *  to loading (prior result retained — the table keeps stale rows
       *  visible mid-refresh), fire previewScanRaw, patch success/error
       *  on settle. */
      const launchRecipe = (recipe: ScannerRecipe): void => {
        const armed = pendingLaunches.get(recipe.id);
        if (armed !== undefined) {
          // clearTimeout on an already-firing timer is a no-op — the
          // delete matters either way.
          clearTimeout(armed);
          pendingLaunches.delete(recipe.id);
        }
        const seq = (recipeSeqs.get(recipe.id) ?? 0) + 1;
        recipeSeqs.set(recipe.id, seq);
        const prev = state.runs()[recipe.id] ?? idleRun();
        patch({
          armedLaunches: state.armedLaunches().filter((id) => id !== recipe.id),
          runs: { ...state.runs(), [recipe.id]: { ...prev, status: 'loading', errorKind: null } },
        });
        service.previewScanRaw(recipe).then(
          (result) => {
            if (recipeSeqs.get(recipe.id) !== seq) return;
            patchRun(recipe.id, {
              status: 'success',
              result,
              ranAt: new Date().toISOString(),
              errorKind: null,
            });
          },
          (e: unknown) => {
            if (recipeSeqs.get(recipe.id) !== seq) return;
            // Category is RH-side only (see toError) — any non-AUTH
            // failure is 'other'.
            patchRun(recipe.id, {
              ...prev,
              status: 'error',
              errorKind:
                toError(e).category === ToolExecutionErrorCategory.AUTH
                  ? 'auth'
                  : 'other',
            });
          },
        );
      };

      async function persist(
        recipe: ScanRecipe,
        universeSize: number,
        matchedCount: number,
        compare: CompareResult,
        token: number,
      ): Promise<void> {
        // Defensive — unreachable today (both callers re-check the token
        // synchronously before invoking persist), kept so a future
        // await inserted ahead of this call can't ghost-write.
        if (token !== runSeq) return; // superseded — no ghost-write
        const proposal = toProposal(recipe, universeSize, matchedCount, compare);
        try {
          const id = await service.saveProposal(proposal);
          // Superseded mid-save: the doc is already written (can't be
          // unwritten) but it doesn't enter local history.
          if (token !== runSeq) return;
          patch({
            proposals: [{ id, proposal }, ...state.proposals()],
          });
        } catch (e) {
          // The compare already landed — surface the save failure
          // without re-reporting the run itself as failed.
          if (token !== runSeq) return;
          const err = toError(e);
          patch({ error: { ...err, message: `proposal save failed — ${err.message}` } });
        }
      }

      return {
        selectRecipe(id: string): void {
          if (id === state.activeRecipeId()) return; // same recipe — no reset
          if (state.recipes().some((r) => r.id === id)) {
            // Bump runSeq so an in-flight run under the old recipe is
            // dropped when it lands — its results would render under
            // the new selection otherwise. proposalSeq too so a pending
            // getProposal can't resurrect the cleared open proposal.
            runSeq++;
            proposalSeq++;
            // Fresh selection — drop the previous recipe's results so a
            // stale compare/error can't render under the new pick. The
            // busy flags clear immediately: any in-flight run is already
            // superseded, so its spinner shouldn't survive the switch
            // (its finally re-clears harmlessly when it settles).
            patch({
              activeRecipeId: id,
              rows: [],
              compare: null,
              matchedCount: null,
              runKind: null,
              columnLookup: null,
              proposalOpen: null,
              error: null,
              running: false,
              evaluating: null,
            });
          }
        },

        /** Discovery run — previewScan → compareDiscovery → persist. */
        async runScan(): Promise<void> {
          const recipe = state.activeRecipe();
          if (!recipe) return;
          const seq = ++scanSeq;
          const token = ++runSeq;
          // proposalSeq: a pending getProposal must not re-open over
          // this run; evaluating: a superseded in-flight eval shouldn't
          // leave stale progress rendered under the new run.
          proposalSeq++;
          patch({ running: true, evaluating: null, error: null, proposalOpen: null });
          try {
            const [result, tracked] = await Promise.all([
              service.runScan(recipe),
              symbolLists.loadTrackedSymbols(),
            ]);
            if (token !== runSeq) return;
            // loadTrackedSymbols resolves [] on failure — without a
            // universe every row becomes an addCandidate and the
            // persisted proposal would carry universeSize:0.
            if (tracked.length === 0) {
              throw new Error('tracked universe is empty');
            }
            const preview = { results: result.rows, total_items: result.totalItems };
            const rows = parseScanRows(preview);
            const compare = compareDiscovery(
              rows,
              new Set(tracked),
              isScanTruncated(preview),
            );
            patch({
              rows: compare.rows,
              compare,
              matchedCount: result.totalItems,
              runKind: 'scan',
              columnLookup: mergeLookup(recipe, result.filtersApplied, rows),
            });
            // matchedCount = wire totalItems, not parsed rows.length —
            // under truncation the wire count is the truthful one.
            await persist(recipe, tracked.length, result.totalItems, compare, token);
          } catch (e) {
            if (token !== runSeq) return;
            patch({ error: toError(e) });
          } finally {
            if (seq === scanSeq) patch({ running: false });
          }
        },

        /**
         * Prune run — two-eval coverage+filtered per #1138 semantics,
         * comparePrune, persist. Only for `supportsPrune` recipes.
         * `truncated` is false by construction: a ≤150-symbol scope
         * returns ≤150 rows, well under the 200-row cap.
         */
        async evaluateTracked(): Promise<void> {
          const recipe = state.activeRecipe();
          if (!recipe?.supportsPrune || typeof recipe.noDataPred !== 'function') return;
          const seq = ++evalSeq;
          const token = ++runSeq;
          proposalSeq++;
          patch({ running: false, evaluating: { done: 0, total: 0 }, error: null, proposalOpen: null });
          try {
            const tracked = await symbolLists.loadTrackedSymbols();
            if (tracked.length === 0) throw new Error('tracked universe is empty');
            const evals = await service.evaluateTracked(
              recipe,
              tracked,
              (done, total) => {
                if (token === runSeq) patch({ evaluating: { done, total } });
              },
            );
            if (token !== runSeq) return;
            const toRows = (rows: ScanResultRow[]) =>
              parseScanRows({ results: rows, total_items: rows.length });
            const coverageRows = toRows(evals.coverage.rows);
            const matchedRows = toRows(evals.matched.rows);
            // Presence-verified over the union — the same map feeds the
            // table AND noDataPred, so display and bucketing can't split
            // under canonicalization drift.
            const lookup = mergeLookup(recipe, evals.matched.filtersApplied, [
              ...coverageRows,
              ...matchedRows,
            ]);
            const compare = comparePrune({
              coverage: coverageRows,
              matched: matchedRows,
              tracked,
              unevaluated: [...evals.coverage.unevaluated, ...evals.matched.unevaluated],
              noDataPred: recipe.noDataPred,
              columnLookup: lookup,
              truncated: false,
            });
            // Count unique matched symbols, not raw wire rows — a
            // case-variant dup ('aapl'/'AAPL') would otherwise print
            // 'N evaluated · M matched' with M > N.
            const matchedCount = new Set(
              matchedRows.map((r) => normScanSymbol(r.symbol)),
            ).size;
            patch({
              rows: compare.rows,
              compare,
              matchedCount,
              runKind: 'eval',
              columnLookup: lookup,
            });
            await persist(recipe, tracked.length, matchedCount, compare, token);
          } catch (e) {
            if (token !== runSeq) return;
            patch({ error: toError(e) });
          } finally {
            if (seq === evalSeq) patch({ evaluating: null });
          }
        },

        /**
         * Auto-run overview (#1183) — launch every catalog recipe
         * ~1s apart (i * 1000ms). Calls overlap; the stagger spaces
         * starts only. Failures stay per-recipe in the runs map — the
         * page silently skips error entries and reads authFailed for
         * the reauth surface.
         */
        runAllRecipes(): void {
          // Re-entry (page remount mid-stagger, interval ticking while a
          // wave is still queued) cancels un-launched slots — already
          // in-flight recipes are re-launched by the new wave, pending
          // ones aren't double-fired.
          for (const t of pendingLaunches.values()) clearTimeout(t);
          pendingLaunches.clear();
          const armed: string[] = [];
          state.recipes().forEach((recipe, i) => {
            armed.push(recipe.id);
            const h = setTimeout(() => {
              // Ownership check — a queued-but-unfired callback must not
              // fire after its slot was consumed (refresh) or replaced
              // (re-entry): input tasks can interpose ahead of queued
              // timer callbacks, so the Map entry is the truth.
              if (pendingLaunches.get(recipe.id) === h) launchRecipe(recipe);
            }, i * 1000);
            pendingLaunches.set(recipe.id, h);
          });
          patch({ armedLaunches: armed });
        },

        /** Re-fire one recipe immediately — the per-table refresh. */
        refreshRecipe(id: string): void {
          const recipe = state.recipes().find((r) => r.id === id);
          if (recipe) launchRecipe(recipe);
        },

        /** Load proposal history (newest first). */
        async loadProposals(): Promise<void> {
          patch({ proposalsLoading: true, error: null });
          try {
            // Merge by id — a proposal prepended by a run's persist()
            // while this fetch was in flight may not be in the fresh
            // snapshot (addDoc hadn't committed); a bare replace would
            // silently drop it until the next load. Local entries not
            // in the snapshot are newer, so they keep the front spots.
            const fetched = await service.listProposals();
            const ids = new Set(fetched.map((p) => p.id));
            patch({
              proposals: [
                ...state.proposals().filter((p) => !ids.has(p.id)),
                ...fetched,
              ],
            });
          } catch (e) {
            patch({ error: toError(e) });
          } finally {
            patch({ proposalsLoading: false });
          }
        },

        /** Open a persisted proposal into the compare panel —
         *  seq-guarded so overlapping opens resolve last-write-wins
         *  by call order, not network order. */
        async openProposal(id: string): Promise<void> {
          const seq = ++proposalSeq;
          const cached = state.proposals().find((p) => p.id === id);
          if (cached) {
            patch({ proposalOpen: cached, error: null });
            return;
          }
          try {
            const got = await service.getProposal(id);
            if (seq !== proposalSeq) return;
            if (got) {
              patch({ proposalOpen: got, error: null });
            } else {
              patch({ error: { message: 'proposal not found', category: null } });
            }
          } catch (e) {
            if (seq !== proposalSeq) return;
            patch({ error: toError(e) });
          }
        },

        closeProposal(): void {
          proposalSeq++; // an in-flight getProposal must not resurrect it
          patch({ proposalOpen: null });
        },

        clearError(): void {
          patch({ error: null });
        },
      };
    },
  ),
);
