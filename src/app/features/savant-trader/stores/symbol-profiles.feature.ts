/**
 * Symbol-profiles feature slice for SymbolListStore — the canonical
 * client-side index of StSymbolProfile docs (company name, sector,
 * industry, exchange, cap, ratios) keyed by symbol.
 *
 * One bulk `getAllSymbols()` fetch, session-cached, feeds every surface
 * that needs company metadata (swing-analysis header strip, nav
 * autocomplete display names). `profile.name` is the SOT for display
 * names — the partner callable's `Company.company` field is not used
 * for display.
 *
 * The store spreads `symbolProfilesInitialState` into `withState`,
 * `symbolProfilesComputed(state)` into a `withComputed`, and
 * `symbolProfilesMethods(store, deps)` into a `withMethods` — appended
 * after the main blocks.
 */
import { computed } from '@angular/core';
import { patchState, WritableStateSource } from '@ngrx/signals';
import { firstValueFrom } from 'rxjs';

import type { SignalService } from '../services/signal.service';
import type { StSymbolProfile } from '../services/types';
import type { SymbolListState } from './symbol-list.store';

/** State fragment this slice contributes to SymbolListState. */
export interface SymbolProfilesState {
  /** All enabled symbol profiles — loaded once per session. */
  profiles: StSymbolProfile[];
  /** In-flight flag for the initial profiles fetch. */
  profilesLoading: boolean;
  /**
   * True once the initial fetch resolved — distinguishes "loaded and
   * empty" from "never fetched" so an empty result doesn't refire the
   * query on every call. Failure leaves this false → calls retry.
   */
  profilesLoaded: boolean;
}

/** Spread into the store's `withState` initial object. */
export const symbolProfilesInitialState: SymbolProfilesState = {
  profiles: [],
  profilesLoading: false,
  profilesLoaded: false,
};

/** Computeds to spread into a `withComputed` block. */
export function symbolProfilesComputed(state: { profiles(): StSymbolProfile[] }) {
  return {
    /** Symbol → profile index — uppercased keys. */
    profilesBySymbol: computed(() => {
      const map = new Map<string, StSymbolProfile>();
      for (const p of state.profiles()) {
        map.set(p.symbol.toUpperCase(), p);
      }
      return map;
    }),
  };
}

export interface SymbolProfilesDeps {
  signalService: SignalService;
}

/** Methods to spread into the store's `withMethods` block. */
export function symbolProfilesMethods(
  store: WritableStateSource<SymbolListState> & {
    profiles(): StSymbolProfile[];
    profilesLoaded(): boolean;
  },
  deps: SymbolProfilesDeps,
) {
  let inFlight: Promise<StSymbolProfile[]> | null = null;

  return {
    /**
     * Load all enabled symbol profiles once per session — guarded and
     * deduped behind a single in-flight promise. Resolves to the loaded
     * (or cached) profiles; resolves [] on failure (auxiliary data — the
     * header strip degrades to dashes rather than blocking).
     */
    loadProfiles(): Promise<StSymbolProfile[]> {
      if (store.profilesLoaded()) {
        return Promise.resolve(store.profiles());
      }
      inFlight ??= (async () => {
        patchState(store, { profilesLoading: true });
        try {
          const profiles = await firstValueFrom(deps.signalService.getAllSymbols());
          patchState(store, { profiles, profilesLoaded: true });
          return profiles;
        } catch (err) {
          console.error('[SymbolListStore] getAllSymbols failed', err);
          return [];
        } finally {
          patchState(store, { profilesLoading: false });
          inFlight = null;
        }
      })();
      return inFlight;
    },
  };
}
