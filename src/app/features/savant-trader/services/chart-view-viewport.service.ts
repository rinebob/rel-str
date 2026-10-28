/**
 * Chart View Viewport Service
 *
 * List/scan source selection for the chart-view page — the lean counterpart
 * to ChartReviewViewportService: same cross-store derivation minus
 * TriageStore (chart-view has no run/review coupling, #1232/#1256).
 */
import { Injectable, inject, computed, signal } from '@angular/core';

import {
  isLiveListFilter,
  isScanSource,
  scanSourceRecipeId,
  NO_MEMBERSHIP,
  type SymbolListFilter,
} from '../common/constants';
import { SymbolListStore } from '../stores/symbol-list.store';
import { LatestRunStore } from '../stores/latest-run.store';

@Injectable({ providedIn: 'root' })
export class ChartViewViewportService {
  private readonly symbolListStore = inject(SymbolListStore);
  private readonly latestRunStore = inject(LatestRunStore);

  /** The selected source — 'ALL', a list key, NO_MEMBERSHIP, or
   *  'scan:{recipeId}'. List and scan sources are mutually exclusive by
   *  construction: this single slot is the only source state. */
  readonly activeSource = signal<SymbolListFilter>('ALL');

  /** Scan-source filter — hide rows already in the tracked universe
   *  (default on: scans exist to surface NEW symbols; OFF shows every
   *  row so tracked ones are never locked out, #1258). List sources
   *  ignore it. */
  readonly newOnly = signal(true);

  /** The live source — masks a deleted list key back to 'ALL'. Scan keys
   *  are never live-list filters and pass through untouched. */
  readonly activeList = computed<SymbolListFilter>(() => {
    const source = this.activeSource();
    if (isScanSource(source)) return source;
    return isLiveListFilter(source, (key) => this.symbolListStore.byKey().has(key))
      ? source
      : 'ALL';
  });

  /**
   * Pane symbols for the active source:
   * - 'ALL': union of every list's members
   * - NO_MEMBERSHIP: untriaged tracked symbols
   * - list key: that list's members
   * - 'scan:{id}': the cache doc's row tickers — New-only filtered to
   *   untracked symbols while the toggle is on (#1258)
   */
  readonly viewportSymbols = computed((): string[] => {
    const source = this.activeList();

    if (isScanSource(source)) {
      const recipeId = scanSourceRecipeId(source);
      const tickers = new Set(
        (recipeId ? this.latestRunStore.rowsFor(recipeId) : []).map((r) => r.ticker),
      );
      if (!this.newOnly()) return [...tickers];
      const tracked = new Set(this.symbolListStore.trackedSymbols());
      return [...tickers].filter((t) => !tracked.has(t));
    }

    if (source === 'ALL') {
      const all = new Set<string>();
      for (const members of Object.values(this.symbolListStore.symbolLists())) {
        for (const s of members) all.add(s);
      }
      return [...all];
    }

    if (source === NO_MEMBERSHIP) {
      return this.symbolListStore.untriagedSymbols();
    }

    return this.symbolListStore.symbolLists()[source] ?? [];
  });

  /** Set the active source. NO_MEMBERSHIP and scan sources (with New-only
   *  on) both need the tracked-symbols universe — load it lazily so the
   *  filter never runs against an unloaded empty set. */
  setActiveSource(source: SymbolListFilter): void {
    if (source === NO_MEMBERSHIP || (isScanSource(source) && this.newOnly())) {
      this.symbolListStore.loadTrackedSymbols();
    }
    this.activeSource.set(source);
  }

  /** Flip the scan-source New-only filter. Turning it on filters against
   *  the tracked universe — ensure it is loaded first. */
  setNewOnly(value: boolean): void {
    if (value && isScanSource(this.activeSource())) {
      this.symbolListStore.loadTrackedSymbols();
    }
    this.newOnly.set(value);
  }


}
