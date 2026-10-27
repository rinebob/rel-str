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
  NO_MEMBERSHIP,
  type SymbolListFilter,
} from '../common/constants';
import { SymbolListStore } from '../stores/symbol-list.store';

@Injectable({ providedIn: 'root' })
export class ChartViewViewportService {
  private readonly symbolListStore = inject(SymbolListStore);

  /** The selected source — 'ALL', a list key, NO_MEMBERSHIP, or
   *  'scan:{recipeId}'. List and scan sources are mutually exclusive by
   *  construction: this single slot is the only source state. */
  readonly activeSource = signal<SymbolListFilter>('ALL');

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
   * - 'scan:{id}': the cache doc's rows — Phase 2 (#1258); empty until the
   *   LatestRunStore lands
   */
  readonly viewportSymbols = computed((): string[] => {
    const source = this.activeList();

    if (isScanSource(source)) return [];

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

  /** Set the active source. "Not triaged" needs the tracked-symbols
   *  universe — load it lazily, same as the review page. */
  setActiveSource(source: SymbolListFilter): void {
    if (source === NO_MEMBERSHIP) {
      this.symbolListStore.loadTrackedSymbols();
    }
    this.activeSource.set(source);
  }
}
