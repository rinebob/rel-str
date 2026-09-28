/**
 * SymbolListStore
 *
 * Manages the symbol-list registry for the Savant Trader grouped review.
 * Responsibilities:
 * - Live-sync the list catalog from Firestore (`watchLists$`)
 * - Track active list filter
 * - Toggle/add/remove symbols in lists (role-routed)
 *
 * Snapshot truth (Topic #465, Thread #492): the store holds the latest
 * `watchLists$` emission in `listCatalog` and derives every consumer-facing
 * view (`symbolLists`, `byKey`, `byRole`, `untriagedSymbols`) from it.
 * Mutations only call the service — no optimistic patchState and no
 * rollback; Firestore's latency-compensated snapshot emits the write, and
 * a failed write auto-reverts on the next emission.
 */
import { computed, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  signalStore,
  withState,
  withComputed,
  withMethods,
  patchState,
} from '@ngrx/signals';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { SymbolListService } from '../services/symbol-list.service';
import { SignalService } from '../services/signal.service';
import { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import { isLiveListFilter, NO_MEMBERSHIP, type SymbolListFilter } from '../common/constants';
import type { RhSelectOption, RhSelectOptionGroup } from '../components/rh-select-menu/rh-select-menu.component';
import { SymbolListDef, SYSTEM_LIST_KEYS } from '../common/symbol-list-defs';
import { normalizeTrackedSymbols } from '../utils/utils';
import {
  symbolProfilesInitialState,
  symbolProfilesComputed,
  symbolProfilesMethods,
  type SymbolProfilesState,
} from './symbol-profiles.feature';

export interface SymbolListState extends SymbolProfilesState {
  /** Latest `watchLists$` emission — the registry source of truth. */
  listCatalog: SymbolListDef[];
  /** Loading state for symbol lists. */
  symbolListsLoading: boolean;
  /** Active list filter — 'ALL' shows everything. */
  activeListFilter: SymbolListFilter;
  /** Tracked-symbols universe — the complement base for untriaged. Lazy. */
  trackedSymbols: string[];
}

const initialState: SymbolListState = {
  listCatalog: [],
  symbolListsLoading: false,
  activeListFilter: SYSTEM_LIST_KEYS.PRIMARY,
  trackedSymbols: [],
  ...symbolProfilesInitialState,
};

export const SymbolListStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed((state) => {
    /** Catalog defs sorted by display order — label breaks order ties. */
    const catalog = computed(() =>
      [...state.listCatalog()].sort(
        (a, b) => a.order - b.order || a.label.localeCompare(b.label),
      ),
    );
    /** key → def index. */
    const byKey = computed(() => new Map(catalog().map((d) => [d.key, d])));
    /** Defs grouped by role. */
    const byRole = computed(() => ({
      exclusive: catalog().filter((d) => d.role === 'exclusive'),
      nonexclusive: catalog().filter((d) => d.role === 'nonexclusive'),
    }));
    /** Keys of exclusive-role lists — the triage bucket set. */
    const exclusiveListKeys = computed(() => byRole().exclusive.map((d) => d.key));
    /**
     * Compat record — key → symbols[] — so existing `symbolLists`
     * consumers keep working while surfaces migrate to catalog computeds.
     * Arrays are copied per emission — consumers must not mutate them.
     */
    const symbolLists = computed(() => {
      const record: Record<string, string[]> = {};
      for (const d of catalog()) record[d.key] = [...d.symbols];
      return record;
    });
    /**
     * Tracked symbols in zero EXCLUSIVE lists — the "Not triaged" view.
     * Role-aware: nonexclusive memberships (MONITOR, user lists) don't
     * count; only tradeability-bucket membership does.
     */
    const untriagedSymbols = computed(() => {
      const membership = symbolLists();
      return state.trackedSymbols().filter((s) =>
        !exclusiveListKeys().some((k) => (membership[k] ?? []).includes(s)),
      );
    });

    /**
     * Grouped list-filter options for the dropdown surfaces — 'Triage'
     * (exclusive lists in catalog order + the Not-triaged pseudo-filter)
     * then 'My lists' (nonexclusive: Monitor + user lists). Hidden defs
     * are excluded. The 'show everything' sentinel is per-surface — its
     * label differs per surface — so it lives in the flat `options` slot,
     * not in a group.
     */
    const filterOptionGroups = computed((): RhSelectOptionGroup<SymbolListFilter>[] => {
      const toOption = (d: SymbolListDef): RhSelectOption<SymbolListFilter> =>
        ({ value: d.key, label: d.label });
      const visible = catalog().filter((d) => !d.hidden);
      const triage = [
        ...visible.filter((d) => d.role === 'exclusive').map(toOption),
        { value: NO_MEMBERSHIP, label: 'Not triaged' },
      ];
      const myLists = visible.filter((d) => d.role === 'nonexclusive').map(toOption);
      return [
        { label: 'Triage', options: triage },
        ...(myLists.length
          ? [{ label: 'My lists', options: myLists } satisfies RhSelectOptionGroup<SymbolListFilter>]
          : []),
      ];
    });

    return {
      catalog,
      byKey,
      byRole,
      exclusiveListKeys,
      symbolLists,
      untriagedSymbols,
      filterOptionGroups,
      /** Compat alias for untriagedSymbols — same signal. */
      unlistedSymbols: untriagedSymbols,
      ...symbolProfilesComputed(state),
    };
  }),
  withMethods((
    state,
    listService = inject(SymbolListService),
    relStrDbV2 = inject(RelStrDbV2Service),
    snackBar = inject(MatSnackBar),
    destroyRef = inject(DestroyRef),
  ) => {
    /** Dedupes concurrent tracked-universe loads — one callable round-trip. */
    let trackedInFlight: Promise<string[]> | null = null;
    /** One live list subscription per store lifetime; resets on error so a
     *  retry call re-opens it. */
    let listsWatched = false;
    /**
     * Serializes list writes — moveToList is a read-then-batch; two rapid
     * toggles could otherwise interleave reads before the first commit and
     * leave a symbol in two exclusive lists. The queue makes each write
     * observe the previous one.
     */
    let writeQueue: Promise<void> = Promise.resolve();
    /**
     * Enqueue a mutation; failures snackbar and the next snapshot reverts.
     * Resolves the write's result (e.g. createList's generated key) —
     * undefined on failure.
     */
    function enqueueWrite<T>(run: () => Observable<T>, failMsg: string): Promise<T | undefined> {
      const result = writeQueue
        .then(() => firstValueFrom(run()))
        .catch((err: unknown): T | undefined => {
          const detail = err instanceof Error ? err.message : 'Unknown error';
          console.error(`[SymbolListStore] ${failMsg}:`, err);
          snackBar.open(`${failMsg}: ${detail}`, 'Dismiss', { duration: 5000 });
          // No rollback — the stream still holds server truth.
          return undefined;
        });
      writeQueue = result.then(() => undefined);
      return result;
    }

    return {
    /**
     * Open the live list subscription — one `watchLists$` stream for the
     * store's lifetime; each emission re-derives every consumer computed.
     * Guarded: repeated calls are no-ops; an errored stream resets the
     * guard so a later call retries.
     */
    loadSymbolLists(): void {
      if (listsWatched) return;
      listsWatched = true;
      patchState(state, { symbolListsLoading: true });

      listService.watchLists$().pipe(takeUntilDestroyed(destroyRef)).subscribe({
        next: (defs) => {
          const live = isLiveListFilter(state.activeListFilter(), (key) =>
            defs.some((d) => d.key === key),
          );
          patchState(state, {
            listCatalog: defs,
            symbolListsLoading: false,
            ...(live ? {} : { activeListFilter: 'ALL' }),
          });
        },
        error: (err: unknown) => {
          listsWatched = false;
          console.error('[SymbolListStore] Failed to load symbol lists:', err);
          patchState(state, { symbolListsLoading: false });
          snackBar.open('Failed to load symbol lists', 'Dismiss', { duration: 5000 });
        },
      });
    },

    /** Set the active list filter for the grouped review. */
    setActiveListFilter(filter: SymbolListFilter): void {
      patchState(state, { activeListFilter: filter });
    },

    /**
     * Load the tracked-symbols universe once — needed to compute the
     * "Not triaged" complement (a symbol is untriaged only if it's
     * tracked AND in zero exclusive lists). TTL-cached upstream; the list
     * doesn't change intra-session. Resolves to the loaded (or cached)
     * symbols so callers can await availability.
     */
    loadTrackedSymbols(): Promise<string[]> {
      if (state.trackedSymbols().length > 0) {
        return Promise.resolve(state.trackedSymbols());
      }
      trackedInFlight ??= new Promise<string[]>((resolve) => {
        relStrDbV2
          .getTrackedSymbols$()
          .pipe(takeUntilDestroyed(destroyRef))
          .subscribe({
            next: (companies) => {
              const symbols = normalizeTrackedSymbols(companies);
              patchState(state, { trackedSymbols: symbols });
              resolve(symbols);
            },
            error: (err: unknown) => {
              console.error('[SymbolListStore] getTrackedSymbols$ failed', err);
              trackedInFlight = null; // allow a later call to retry
              resolve([]);
            },
          });
      });
      return trackedInFlight;
    },

    /**
     * Toggle a symbol's membership in a list, routed by the list's role.
     * Exclusive → atomic `moveToList` over the exclusive key set (add to
     * target, strip from the rest; null target un-assigns). Nonexclusive →
     * membership add/remove. No optimistic update — the snapshot echoes.
     */
    toggleSymbolInList(symbol: string, listKey: string): void {
      const def = state.listCatalog().find((d) => d.key === listKey);
      if (!def) {
        // Unknown list key — refuse rather than materialize a malformed doc
        // via the exclusive path.
        console.error(`[SymbolListStore] Unknown list key: ${listKey}`);
        snackBar.open(`Unknown list: ${listKey}`, 'Dismiss', { duration: 5000 });
        return;
      }
      const inList = def.symbols.includes(symbol.toUpperCase());

      if (def.role === 'nonexclusive') {
        if (inList) this.removeSymbolFromList(symbol, listKey);
        else this.addSymbolToList(symbol, listKey);
        return;
      }

      const target = inList ? null : listKey;
      enqueueWrite(
        () => listService.moveToList(symbol, target, state.exclusiveListKeys()),
        `Failed to save ${symbol} to ${listKey}`,
      );
    },

    /** Add a symbol to a named list. */
    addSymbolToList(symbol: string, listKey: string): void {
      enqueueWrite(
        () => listService.addToList(symbol, listKey),
        `Failed to add ${symbol} to ${listKey}`,
      );
    },

    /** Remove a symbol from a named list. */
    removeSymbolFromList(symbol: string, listKey: string): void {
      enqueueWrite(
        () => listService.removeFromList(symbol, listKey),
        `Failed to remove ${symbol} from ${listKey}`,
      );
    },

    /**
     * Create a user list — generated slug key, nonexclusive role, appended
     * order. Resolves the key; the list appears on the next emission.
     */
    createList(label: string): Promise<string | undefined> {
      return enqueueWrite(() => listService.createList(label), `Failed to create list ${label}`);
    },

    /** Rename a list — label only; key is immutable. */
    renameList(key: string, label: string): Promise<void | undefined> {
      return enqueueWrite(() => listService.renameList(key, label), `Failed to rename ${key}`);
    },

    /** Delete a list — the catalog drops it on the next emission. An
     *  active filter still pointing at the deleted key resets to ALL
     *  (only when the write actually succeeded — enqueueWrite resolves
     *  the sentinel on success, undefined on failure). */
    async deleteList(key: string): Promise<void> {
      const ok = await enqueueWrite(
        () => listService.deleteList(key).pipe(map(() => true)),
        `Failed to delete ${key}`,
      );
      if (ok && state.activeListFilter() === key) {
        patchState(state, { activeListFilter: 'ALL' });
      }
    },

    /** Persist a user-list reorder (keys in desired sequence). */
    setListOrder(orderedKeys: string[]): Promise<void | undefined> {
      return enqueueWrite(() => listService.setListOrder(orderedKeys), 'Failed to reorder lists');
    },
    };
  }),

  // Symbol profiles slice — see symbol-profiles.feature.ts.
  withMethods((state, signalService = inject(SignalService)) =>
    symbolProfilesMethods(state, { signalService }),
  ),
);
