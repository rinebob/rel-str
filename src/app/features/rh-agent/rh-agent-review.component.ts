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

import { RhAgentTriageStore } from './rh-agent-triage.store';
import { RhReviewStatus } from './common/rh-agent.constants';
import { UiStateService } from '../../core/services/ui-state.service';
import { SignalListComponent } from './components/signal-list/signal-list.component';
import { SignalDetailComponent } from './components/signal-detail/signal-detail.component';

@Component({
  selector: 'app-rh-agent-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    SignalListComponent,
    SignalDetailComponent,
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

  constructor() {
    // Auto-select first review symbol when the queue changes and none is selected
    effect(() => {
      const symbols = this.triageStore.reviewSymbols();
      if (symbols.length === 0) return;
      if (!this.selectedReviewSymbol()) {
        this.selectedReviewSymbol.set(symbols[0]);
      }
    });
  }

  ngOnInit(): void {
    const marketDate = this.triageStore.marketDate();
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString().slice(0, 10);
    this.triageStore.loadPersistedDecisions(startDate, marketDate);
  }

  getReviewSymbolStatus(symbol: string): string {
    return this.triageStore.statuses()[symbol] ?? 'PENDING';
  }

  // --- Review queue mode (symbols with REVIEW status from grouped review) ---

  onReviewSymbolSelected(symbol: string): void {
    this.selectedReviewSymbol.set(symbol);
  }

  onAcceptReview(symbol: string): void {
    this.triageStore.setStatus(symbol, RhReviewStatus.ACCEPT);
    this.advanceReviewQueue(symbol);
  }

  onWatchReview(symbol: string): void {
    this.triageStore.watchSymbol(symbol);
    this.advanceReviewQueue(symbol);
  }

  onRejectReview(symbol: string): void {
    this.triageStore.setStatus(symbol, RhReviewStatus.REJECT);
    this.advanceReviewQueue(symbol);
  }

  private advanceReviewQueue(decidedSymbol: string): void {
    const remaining = this.triageStore.reviewSymbols().filter((s: string) => s !== decidedSymbol);
    this.selectedReviewSymbol.set(remaining.length > 0 ? remaining[0] : null);
  }

  goToRuns(): void {
    this.router.navigate(['/rh-agent']);
  }

  goToSignalHistory(): void {
    this.router.navigate(['/signal-history']);
  }

  loadManualSymbol(symbolInput: string): void {
    const symbol = symbolInput.trim().toUpperCase();
    if (!symbol) return;
    this.selectedReviewSymbol.set(null);
    this.manualSymbol.set(symbol);
  }

  goToGroupedReview(): void {
    this.router.navigate(['/rh-agent-grouped-review']);
  }

  onManualSymbolKeydown(event: KeyboardEvent, input: HTMLInputElement): void {
    if (event.key === 'Enter') {
      this.loadManualSymbol(input.value);
    }
  }
}
