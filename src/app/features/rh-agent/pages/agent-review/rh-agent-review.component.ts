/**
 * RH Agent Review Component
 *
 * Master-detail interface for opportunity triage and trade execution.
 * Focuses on current signals from the latest run only.
 * URL: /rh-agent/review
 */
import {
  Component,
  inject,
  effect,
  signal,
  computed,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';

import { RhAgentTriageStore } from '../../stores/rh-agent-triage.store';
import { RhReviewStatus } from '../../common/rh-agent.constants';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { SignalListComponent } from '../../components/signal-list/signal-list.component';
import { SignalDetailComponent } from '../../components/signal-detail/signal-detail.component';
import { ReviewHeaderComponent } from '../../components/review-header/review-header.component';

@Component({
  selector: 'app-rh-agent-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SignalListComponent,
    SignalDetailComponent,
    ReviewHeaderComponent,
  ],
  templateUrl: './rh-agent-review.component.html',
  styleUrl: './rh-agent-review.component.scss',
})
export class RhAgentReviewComponent implements OnInit {
  readonly triageStore = inject(RhAgentTriageStore);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);

  /** Manual symbol input for quick chart viewing */
  manualSymbol = signal<string | null>(null);

  /** Currently selected symbol in the review queue. */
  selectedReviewSymbol = signal<string | null>(null);

  /** Whether the review queue has symbols pending decision. */
  hasReviewSymbols = computed(() => this.triageStore.reviewSymbols().length > 0);

  /** Status of the currently selected review symbol. */
  selectedSymbolStatus = computed(() => {
    const symbol = this.selectedReviewSymbol();
    return symbol ? (this.triageStore.statuses()[symbol] ?? 'PENDING') : 'PENDING';
  });

  constructor() {
    /**
     * Auto-select the first review symbol when the queue changes and none is selected.
     */
    effect(() => {
      const symbols = this.triageStore.reviewSymbols();
      if (symbols.length === 0) return;
      if (!this.selectedReviewSymbol()) {
        this.selectedReviewSymbol.set(symbols[0]);
      }
    });
  }

  /** Load persisted decisions for the last 30 days through the active market date. */
  ngOnInit(): void {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());
    const endDate = this.triageStore.activeMarketDate() ?? todayStr;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().slice(0, 10);
    this.triageStore.loadPersistedDecisions(startDate, endDate);
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
    this.triageStore.setStatus(symbol, RhReviewStatus.ACCEPT);
    this.advanceReviewQueue(symbol);
  }

  /** Watch the currently selected review symbol and advance the queue. */
  onWatchReview(): void {
    const symbol = this.selectedReviewSymbol();
    if (!symbol) return;
    this.triageStore.watchSymbol(symbol);
    this.advanceReviewQueue(symbol);
  }

  /** Reject the currently selected review symbol and advance the queue. */
  onRejectReview(): void {
    const symbol = this.selectedReviewSymbol();
    if (!symbol) return;
    this.triageStore.setStatus(symbol, RhReviewStatus.REJECT);
    this.advanceReviewQueue(symbol);
  }

  /** Move the selection to the next review symbol after a decision. */
  private advanceReviewQueue(decidedSymbol: string): void {
    const remaining = this.triageStore.reviewSymbols().filter((s: string) => s !== decidedSymbol);
    this.selectedReviewSymbol.set(remaining.length > 0 ? remaining[0] : null);
  }

  /** Navigate to the standalone signal history page. */
  goToSignalHistory(): void {
    this.router.navigate(['/signal-history']);
  }

  /** Load an arbitrary symbol for chart review without a decision queue. */
  loadManualSymbol(symbolInput: string): void {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    this.selectedReviewSymbol.set(null);
    this.manualSymbol.set(symbol);
  }

  /** Navigate back to the grouped review page. */
  goToGroupedReview(): void {
    this.router.navigate(['/rh-agent-grouped-review']);
  }

  /** Handle Enter key in the manual symbol input. */
  onManualSymbolKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (event.key === 'Enter') {
      this.loadManualSymbol(input.value);
    }
  }
}
