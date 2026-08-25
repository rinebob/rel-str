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

import { RhSymbolListName, ViewportMode } from '../common/constants';
import { RhAgentTriageStore } from '../stores/rh-agent-triage.store';
import { RhAgentSymbolListStore } from '../stores/rh-agent-symbol-list.store';

@Injectable({ providedIn: 'root' })
export class ChartReviewViewportService {
  private readonly triageStore = inject(RhAgentTriageStore);
  private readonly symbolListStore = inject(RhAgentSymbolListStore);

  /** Current viewport mode (delegates to store state). */
  readonly viewportMode = computed(() => this.triageStore.viewportMode());

  /** Current active list filter (delegates to store state). */
  readonly activeViewportList = computed(() => this.triageStore.activeViewportList());

  /**
   * Viewport symbols for the chart-review sidebar.
   * - signals + list: intersection of reviewSymbols and list
   * - signals + no list: all reviewSymbols
   * - browse + list: all symbols in the list
   * - browse + no list: all reviewSymbols (fallback)
   */
  readonly viewportSymbols = computed((): string[] => {
    const mode = this.triageStore.viewportMode();
    const listName = this.triageStore.activeViewportList();
    const reviewSymbols = this.triageStore.reviewSymbols();

    if (listName === RhSymbolListName.NONE) {
      return reviewSymbols;
    }

    const listSymbols = this.symbolListStore.symbolLists()[listName] ?? [];

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
  setActiveViewportList(listName: string): void {
    this.triageStore.setActiveViewportList(listName);
  }
}
