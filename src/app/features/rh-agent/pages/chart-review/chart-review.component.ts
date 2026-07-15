/**
 * Chart Review Component
 *
 * Master-detail interface for opportunity triage and trade execution.
 * Focuses on current signals from the latest run only.
 * URL: /chart-review
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

import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { RhAgentTriageStore } from '../../stores/rh-agent-triage.store';
import { RhAgentGroupStore } from '../../stores/rh-agent-group.store';
import { RhAgentSymbolListStore } from '../../stores/rh-agent-symbol-list.store';
import { RhReviewStatus, RhSymbolListName } from '../../common/rh-agent.constants';
import { ChartReviewViewportService } from '../../services/chart-review-viewport.service';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { todayDate } from '../../utils/rh-agent.utils';
import { SignalListComponent } from '../../components/signal-list/signal-list.component';
import { SignalDetailComponent } from '../../components/signal-detail/signal-detail.component';
import { ReviewHeaderComponent } from '../../components/review-header/review-header.component';
import { NewSymbolsDialogService } from '../../services/new-symbols-dialog.service';

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
  ],
  templateUrl: './chart-review.component.html',
  styleUrl: './chart-review.component.scss',
})
export class ChartReviewComponent implements OnInit, OnDestroy {
  readonly triageStore = inject(RhAgentTriageStore);
  readonly groupStore = inject(RhAgentGroupStore);
  readonly symbolListStore = inject(RhAgentSymbolListStore);
  readonly viewportService = inject(ChartReviewViewportService);
  readonly uiStateService = inject(UiStateService);
  private readonly router = inject(Router);
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

  /** Status of the currently selected review symbol. */
  selectedSymbolStatus = computed(() => {
    const symbol = this.selectedReviewSymbol();
    return symbol ? (this.triageStore.statuses()[symbol] ?? 'PENDING') : 'PENDING';
  });

  constructor() {
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
        getDoc(doc(this.firestore, 'rh-agent-symbols', symbol))
      ).then(snap => {
        const name: string | null = snap.exists() ? (snap.data()['name'] ?? null) : null;
        this.symbolNameCache.update(c => ({ ...c, [symbol]: name }));
      });
    });
  }

  /** Enter fullscreen and ensure symbol lists are loaded. */
  ngOnInit(): void {
    this.uiStateService.setFullscreen(true);
    this.symbolListStore.loadSymbolLists();
  }

  /** Leave fullscreen mode when the page is destroyed. */
  ngOnDestroy(): void {
    this.uiStateService.setFullscreen(false);
  }

  private currentMarketDate(): string {
    return this.groupStore.activeRunMarketDate() ?? todayDate();
  }

  // --- Review queue mode (symbols with REVIEW status from grouped review) ---

  /** Select a symbol from the review queue. */
  onReviewSymbolSelected(symbol: string): void {
    this.selectedReviewSymbol.set(symbol);
  }

  /** Accept the currently selected review symbol and advance the queue. */
  onAcceptReview(): void {
    const symbol = this.selectedReviewSymbol();
    if (!symbol) return;
    this.triageStore.setStatus(symbol, RhReviewStatus.ACCEPT, this.currentMarketDate());
    this.advanceReviewQueue(symbol);
  }

  /** Watch the currently selected review symbol and advance the queue. */
  onWatchReview(): void {
    const symbol = this.selectedReviewSymbol();
    if (!symbol) return;
    this.triageStore.watchSymbol(symbol, this.currentMarketDate());
    this.advanceReviewQueue(symbol);
  }

  /** Reject the currently selected review symbol and advance the queue. */
  onRejectReview(): void {
    const symbol = this.selectedReviewSymbol();
    if (!symbol) return;
    this.triageStore.setStatus(symbol, RhReviewStatus.REJECT, this.currentMarketDate());
    this.advanceReviewQueue(symbol);
  }

  /** Move the selection to the next symbol in the viewport after a decision. */
  private advanceReviewQueue(decidedSymbol: string): void {
    const before = this.viewportSymbols();
    const idx = before.indexOf(decidedSymbol);
    const remaining = before.filter((s: string) => s !== decidedSymbol);
    if (remaining.length === 0) { this.selectedReviewSymbol.set(null); return; }
    const nextIdx = Math.min(idx, remaining.length - 1);
    this.selectedReviewSymbol.set(remaining[nextIdx]);
  }

  /** Navigate to the standalone signal history page. */
  goToSignalHistory(): void {
    this.router.navigate(['/signal-history']);
  }

  /** Open a dialog to find symbols added to rh-agent-symbols in the last N days. */
  openNewSymbolsDialog(): void {
    this.newSymbolsDialog.open().subscribe((symbols) => {
      if (!symbols || symbols.length === 0) return;
      this.addSymbolsToReview(symbols);
    });
  }

  /** Flag a batch of found symbols for review and surface them in the left panel. */
  private addSymbolsToReview(symbols: string[]): void {
    this.triageStore.markGroupForReview(symbols);
    this.newlyAddedSymbols.update((existing) => Array.from(new Set([...existing, ...symbols])));
    if (!this.selectedReviewSymbol()) {
      this.selectedReviewSymbol.set(symbols[0]);
    }
  }

  /** Toggle the active symbol's membership in a named list. */
  onToggleList(event: { symbol: string; listName: RhSymbolListName }): void {
    this.symbolListStore.toggleSymbolInList(event.symbol, event.listName);
  }

  /** Toggle the active symbol's membership in the PAST_SIGNALS monitor list. */
  onMonitor(symbol: string): void {
    if (this.symbolListStore.activeListFilter() === RhSymbolListName.PAST_SIGNALS) {
      this.symbolListStore.removeSymbolFromList(symbol, RhSymbolListName.PAST_SIGNALS);
    } else {
      this.symbolListStore.addSymbolToList(symbol, RhSymbolListName.PAST_SIGNALS);
    }
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

  /** Navigate to the next symbol in the viewport. */
  onNextSymbol(): void {
    const symbols = this.viewportSymbols();
    const idx = this.selectedReviewSymbolIndex();
    if (idx < 0 || idx >= symbols.length - 1) return;
    this.selectedReviewSymbol.set(symbols[idx + 1]);
  }

  /** Navigate back to the signal review page. */
  goToSignalReview(): void {
    this.router.navigate(['/signal-review']);
  }

  /** Handle Enter key in the manual symbol input. */
  onManualSymbolKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (event.key === 'Enter') {
      this.loadManualSymbol(input.value);
    }
  }

  /** Handle list dropdown change — purely a viewport filter, no triage mutations. */
  onListChange(listName: string): void {
    this.viewportService.setActiveViewportList(listName);
    this.manualSymbol.set(null);
    this.selectedReviewSymbol.set(null);
  }

  /** Toggle viewport mode between 'signals' and 'browse'. */
  toggleViewportMode(): void {
    const next = this.viewportMode() === 'signals' ? 'browse' : 'signals';
    this.viewportService.setViewportMode(next);
    this.selectedReviewSymbol.set(null);
  }
}
