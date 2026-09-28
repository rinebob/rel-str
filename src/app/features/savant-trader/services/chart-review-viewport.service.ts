/**
 * Chart Review Viewport Service
 *
 * Composes the triage store's review flags and viewport state with the
 * symbol list store to produce the final `viewportSymbols` list.
 *
 * This service exists to decouple the two stores — the triage store owns
 * pure state (reviewFlags, viewportMode, activeViewportList) while this
 * service handles the cross-store derivation.
 */
import { Injectable, inject, computed } from '@angular/core';

import { isLiveListFilter, NO_MEMBERSHIP, ViewportMode, type SymbolListFilter } from '../common/constants';
import { TriageStore } from '../stores/triage.store';
import { SymbolListStore } from '../stores/symbol-list.store';

@Injectable({ providedIn: 'root' })
export class ChartReviewViewportService {
  private readonly triageStore = inject(TriageStore);
  private readonly symbolListStore = inject(SymbolListStore);

  /** Current viewport mode (delegates to store state). */
  readonly viewportMode = computed(() => this.triageStore.viewportMode());

  /** Current viewport filter, falling back to show-all when its list was deleted. */
  readonly activeViewportList = computed(() => {
    const filter = this.triageStore.activeViewportList();
    return isLiveListFilter(filter, (key) => this.symbolListStore.byKey().has(key))
      ? filter
      : 'ALL';
  });

  /**
   * Viewport symbols for the chart-review sidebar.
   * - signals + list: intersection of reviewSymbols and list
   * - signals + no list: all reviewSymbols
   * - browse + list: all symbols in the list
   * - browse + no list: all reviewSymbols (fallback)
   */
  readonly viewportSymbols = computed((): string[] => {
    const mode = this.triageStore.viewportMode();
    // activeViewportList already masks a deleted-list key to 'ALL'.
    const filter = this.activeViewportList();
    const reviewSymbols = this.triageStore.reviewSymbols();

    if (filter === 'ALL') {
      return reviewSymbols;
    }

    if (filter === NO_MEMBERSHIP) {
      if (mode === 'signals') {
        // Role-driven untriaged set — same source as the browse branch.
        const untriaged = new Set(this.symbolListStore.untriagedSymbols());
        return reviewSymbols.filter((s) => untriaged.has(s));
      }
      // browse — the full untriaged tracked universe.
      return this.symbolListStore.untriagedSymbols();
    }

    const listSymbols = this.symbolListStore.symbolLists()[filter] ?? [];

    if (mode === 'signals') {
      const listSet = new Set(listSymbols);
      return reviewSymbols.filter((s) => listSet.has(s));
    }

    // mode === 'browse' — show all symbols in the list
    return listSymbols;
  });

  /** Set the viewport mode. */
  setViewportMode(mode: ViewportMode): void {
    this.triageStore.setViewportMode(mode);
  }

  /** Set the active list filter. */
  setActiveViewportList(filter: SymbolListFilter): void {
    // "Not triaged" needs the tracked-symbols universe — load it lazily.
    if (filter === NO_MEMBERSHIP) {
      this.symbolListStore.loadTrackedSymbols();
    }
    this.triageStore.setActiveViewportList(filter);
  }
}
