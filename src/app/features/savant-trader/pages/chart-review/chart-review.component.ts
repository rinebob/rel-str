/**
 * Chart Review Component
 *
 * Master-detail interface for opportunity triage and trade execution.
 * Focuses on current signals from the latest run only.
 * URL: /signals/charts
 */
import {
  Component,
  inject,
  effect,
  signal,
  computed,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { AppRoutes } from '../../../../core/common/interfaces';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { Collection } from '../../../../core/common/constants';
import { TriageStore } from '../../stores/triage.store';
import { GroupStore } from '../../stores/group.store';
import { StStore } from '../../stores/st.store';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { NO_MEMBERSHIP, type SymbolListFilter } from '../../common/constants';
import { ChartReviewViewportService } from '../../services/chart-review-viewport.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { SignalListComponent } from '../../components/signal-list/signal-list.component';
import { SignalDetailComponent } from '../../components/signal-detail/signal-detail.component';
import { ReviewHeaderComponent } from '../../components/review-header/review-header.component';
import { RunMetricsStripComponent } from '../../components/run-metrics-strip/run-metrics-strip.component';
import { NewSymbolsDialogService } from '../../services/new-symbols-dialog.service';
import { SignalReviewFacade } from '../../stores/signal-review.facade';
import { OrderTicketStore } from '../../stores/order-ticket.store';

@Component({
  selector: 'app-chart-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatTooltipModule,
    SignalListComponent,
    SignalDetailComponent,
    ReviewHeaderComponent,
    RunMetricsStripComponent,
  ],
  templateUrl: './chart-review.component.html',
  styleUrl: './chart-review.component.scss',
})
export class ChartReviewComponent implements OnInit, OnDestroy {
  readonly triageStore = inject(TriageStore);
  readonly groupStore = inject(GroupStore);
  readonly symbolListStore = inject(SymbolListStore);
  private readonly agentStore = inject(StStore);
  private readonly ticketStore = inject(OrderTicketStore);
  readonly viewportService = inject(ChartReviewViewportService);
  readonly uiStateService = inject(UiStateService);
  private readonly router = inject(Router);
  readonly reviewFacade = inject(SignalReviewFacade);
  private readonly newSymbolsDialog = inject(NewSymbolsDialogService);
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);

  /** Manual symbol input for quick chart viewing */
  manualSymbol = signal<string | null>(null);

  /** Currently selected symbol in the review queue. */
  selectedReviewSymbol = signal<string | null>(null);

  /** Symbols added to the review queue via the new-symbols dialog this session. */
  newlyAddedSymbols = signal<string[]>([]);

  /** Delegate viewport state from the viewport service. */
  readonly viewportSymbols = this.viewportService.viewportSymbols;
  readonly viewportMode = this.viewportService.viewportMode;
  readonly activeReviewList = this.viewportService.activeViewportList;

  /** Index of the currently selected symbol within the viewport. */
  selectedReviewSymbolIndex = computed(() => {
    const symbol = this.selectedReviewSymbol();
    if (!symbol) return -1;
    return this.viewportSymbols().indexOf(symbol);
  });

  /** Total number of symbols in the viewport. */
  reviewSymbolCount = computed(() => this.viewportSymbols().length);

  /** Cache of symbol -> company name fetched from Firestore. */
  private symbolNameCache = signal<Record<string, string | null>>({});

  /** Company name for the currently active symbol. */
  selectedSymbolName = computed(() => {
    const symbol = this.selectedReviewSymbol() ?? this.manualSymbol();
    if (!symbol) return null;
    const profile = this.groupStore.signalSymbols().find(p => p.symbol === symbol)
      ?? this.groupStore.allSymbols().find(p => p.symbol === symbol);
    if (profile?.name) return profile.name;
    const cache = this.symbolNameCache();
    return cache[symbol] ?? null;
  });

  /** Expose the actionable-run predicate from the group store for the template. */
  readonly isActionableRun = this.groupStore.isActionableRun;

  constructor() {
    /**
     * Establish run context on direct entry (#1017 QA) — this page never
     * bootstrapped a run before because its buttons had no real action;
     * Trade needs isActionableRun, and tradeSymbol needs the run's
     * signals loaded (setActiveRun fans them out). Same pattern as
     * GalleryFacade/SignalReviewFacade.
     */
    effect(() => {
      const latest = this.agentStore.latestCompletedRun();
      if (!latest) return;
      if (this.groupStore.activeRunId()) return;
      this.groupStore.setActiveRun(latest.id, latest.marketDate ?? '');
    });

    /**
     * Auto-select the first review symbol when the queue changes and none is selected.
     * Skip when a manual symbol is active so the chart stays on the manual symbol.
     */
    effect(() => {
      const symbols = this.viewportSymbols();
      if (symbols.length === 0) return;
      if (!this.selectedReviewSymbol() && !this.manualSymbol()) {
        this.selectedReviewSymbol.set(symbols[0]);
      }
    });

    /**
     * Fetch company name from Firestore when the active symbol changes and
     * isn't already in the group store or name cache.
     */
    effect(() => {
      const symbol = this.selectedReviewSymbol() ?? this.manualSymbol();
      if (!symbol) return;
      const inGroupStore = this.groupStore.signalSymbols().find(p => p.symbol === symbol)
        ?? this.groupStore.allSymbols().find(p => p.symbol === symbol);
      if (inGroupStore?.name) return;
      const cache = this.symbolNameCache();
      if (symbol in cache) return;
      this.symbolNameCache.update(c => ({ ...c, [symbol]: null }));
      runInInjectionContext(this.injector, () =>
        getDoc(doc(this.firestore, Collection.ST_SYMBOLS, symbol))
      ).then(snap => {
        const name: string | null = snap.exists() ? (snap.data()['name'] ?? null) : null;
        this.symbolNameCache.update(c => ({ ...c, [symbol]: name }));
      });
    });
  }

  /** Ensure symbol lists, the runs stream, and the ticket store are
   *  loaded — without tickets hydrated, tradeSymbol's adopt/block
   *  probes see an empty map and mint duplicate staged tickets (#1017
   *  QA). */
  ngOnInit(): void {
    this.symbolListStore.loadSymbolLists();
    this.agentStore.loadData();
    this.ticketStore.loadTickets();
  }

  /** Leave fullscreen mode when the page is destroyed. */
  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  // --- Viewport selection (#1016 — was the REVIEW-flag queue; browse shows
  //     list members now that flags are session-local) ---

  /** Select a symbol from the review queue. */
  onReviewSymbolSelected(symbol: string): void {
    this.selectedReviewSymbol.set(symbol);
  }

  /** Trade the currently selected symbol (#1017 — replaced the ACR
   *  cluster): stage its signal-sourced ticket when run signals exist,
   *  else open the seeded manual dialog. */
  onTradeReview(): void {
    if (!this.isActionableRun()) return;
    const symbol = this.selectedReviewSymbol();
    if (!symbol) return;
    void this.reviewFacade.tradeSymbol(symbol);
  }

  /** Move the selection to the next symbol in the viewport — used when a
   *  list-membership toggle drops the selected symbol out of the filter. */
  private advanceReviewQueue(removedSymbol: string): void {
    const before = this.viewportSymbols();
    const idx = before.indexOf(removedSymbol);
    const remaining = before.filter((s: string) => s !== removedSymbol);
    if (remaining.length === 0) { this.selectedReviewSymbol.set(null); return; }
    const nextIdx = Math.min(idx, remaining.length - 1);
    this.selectedReviewSymbol.set(remaining[nextIdx]);
  }

  /** Navigate to the standalone signal history page. */
  goToSignalHistory(): void {
    this.router.navigate(['/' + AppRoutes.SIGNAL_HISTORY]);
  }

  /** Open a dialog to find symbols added to savant-trader/data/symbols in the last N days. */
  openNewSymbolsDialog(): void {
    this.newSymbolsDialog.open().subscribe((symbols) => {
      if (!symbols || symbols.length === 0) return;
      this.addSymbolsToReview(symbols);
    });
  }

  /** Flag a batch of found symbols for review and surface them in the left panel.
   *  #1016 — unreachable; the new-symbols button is disabled. */
  private addSymbolsToReview(symbols: string[]): void {
    if (!this.isActionableRun()) return;
    this.triageStore.markGroupForReview(symbols);
    this.newlyAddedSymbols.update((existing) => Array.from(new Set([...existing, ...symbols])));
    if (!this.selectedReviewSymbol()) {
      this.selectedReviewSymbol.set(symbols[0]);
    }
  }

  /** Toggle the active symbol's membership in a named list. */
  onToggleList(event: { symbol: string; listKey: string }): void {
    const willLeave = this.willLeaveActiveList(event.symbol, event.listKey);
    this.symbolListStore.toggleSymbolInList(event.symbol, event.listKey);
    // When the write drops the selected symbol out of the filtered viewport,
    // advance to the next symbol NOW — otherwise the index dangles at -1
    // and nav dies.
    if (willLeave && event.symbol === this.selectedReviewSymbol()) {
      this.advanceReviewQueue(event.symbol);
    }
  }

  /**
   * Whether toggling `listKey` removes `symbol` from the active viewport list.
   * Predicts post-write membership so the queue can advance before the
   * Firestore snapshot arrives:
   * - exclusive chip: strips the symbol from every other exclusive list, so
   *   it leaves iff the active filter is itself an exclusive list (a move or
   *   an un-assign — filing into the active list can't happen when the
   *   symbol is already in the viewport)
   * - nonexclusive chip: membership changes only in `listKey` — leaves only
   *   when toggling OFF the list currently being viewed
   * - NO_MEMBERSHIP view: gaining an exclusive membership makes it triaged
   */
  private willLeaveActiveList(symbol: string, listKey: string): boolean {
    const filter = this.activeReviewList();
    if (filter === 'ALL') return false;
    const def = this.symbolListStore.byKey().get(listKey);
    if (!def) return false;
    if (filter === NO_MEMBERSHIP) {
      return def.role === 'exclusive' && !def.symbols.includes(symbol.toUpperCase());
    }
    if (def.role === 'exclusive') {
      return this.symbolListStore.byKey().get(filter)?.role === 'exclusive';
    }
    return filter === listKey && def.symbols.includes(symbol.toUpperCase());
  }

  /** Load an arbitrary symbol for chart review without a decision queue. */
  loadManualSymbol(symbolInput: string): void {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    this.selectedReviewSymbol.set(null);
    this.manualSymbol.set(symbol);
  }

  /** Navigate to the previous symbol in the viewport. */
  onPrevSymbol(): void {
    const idx = this.selectedReviewSymbolIndex();
    if (idx <= 0) return;
    this.selectedReviewSymbol.set(this.viewportSymbols()[idx - 1]);
  }

  /** Navigate to the next symbol in the viewport; no selection starts at the first. */
  onNextSymbol(): void {
    const symbols = this.viewportSymbols();
    const idx = this.selectedReviewSymbolIndex();
    if (idx >= symbols.length - 1) return;
    this.selectedReviewSymbol.set(symbols[idx + 1]);
  }

  /** Navigate back to the signal review page. */
  goToSignalReview(): void {
    this.router.navigate(['/' + AppRoutes.SIGNAL_REVIEW]);
  }

  /** Navigate to signal order. */
  goToSignalOrder(): void {
    this.reviewFacade.goToSignalOrder();
  }

  /** Handle Enter key in the manual symbol input. */
  onManualSymbolKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (event.key === 'Enter') {
      this.loadManualSymbol(input.value);
    }
  }

  /** Handle list dropdown change — purely a viewport filter, no triage mutations. */
  onListChange(filter: SymbolListFilter): void {
    this.viewportService.setActiveViewportList(filter);
    this.manualSymbol.set(null);
    this.selectedReviewSymbol.set(null);
  }

  /** Toggle viewport mode between 'signals' and 'browse'.
   *  #1016 — unreachable; the mode toggle is disabled ('browse' is pinned). */
  toggleViewportMode(): void {
    const next = this.viewportMode() === 'signals' ? 'browse' : 'signals';
    this.viewportService.setViewportMode(next);
    this.selectedReviewSymbol.set(null);
  }
}
