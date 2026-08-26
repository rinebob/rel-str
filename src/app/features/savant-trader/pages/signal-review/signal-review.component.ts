/**
 * Signal Review Component
 *
 * Symbol-centric signal review UI.
 * Replaces the flat signal list with sector/industry expansion panels.
 * URL: /signal-review
 */
import {
  Component,
  inject,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { GroupDimension, SymbolListName } from '../../common/constants';
import { SymbolGroup } from '../../stores/group.store';
import { SignalReviewFacade } from '../../stores/signal-review.facade';
import { SignalReviewHeaderComponent } from '../../components/signal-review-header/signal-review-header.component';
import { GroupPanelComponent } from '../../components/group-panel/group-panel.component';
import { QuickChartsPanelComponent } from '../../components/quick-charts-panel/quick-charts-panel.component';
import { RunMetricsStripComponent } from '../../components/run-metrics-strip/run-metrics-strip.component';

@Component({
  selector: 'app-signal-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    SignalReviewHeaderComponent,
    GroupPanelComponent,
    QuickChartsPanelComponent,
    RunMetricsStripComponent,
  ],
  templateUrl: './signal-review.component.html',
  styleUrl: './signal-review.component.scss',
})
export class SignalReviewComponent implements OnInit, OnDestroy {
  readonly facade = inject(SignalReviewFacade);

  /** Move the quick-chart selection to the previous visible symbol. */
  navigatePrev(): void {
    this._navigateBy(-1);
  }

  /** Move the quick-chart selection to the next visible symbol. */
  navigateNext(): void {
    this._navigateBy(1);
  }

  /** Navigate the quick-chart selection by a signed offset and scroll the row into view. */
  private _navigateBy(delta: -1 | 1): void {
    const flat = this.facade.flatSymbols();
    if (flat.length === 0) return;
    const current = this.facade.quickChartSymbol();
    const idx = current ? flat.indexOf(current) : -1;
    const next = flat[Math.max(0, Math.min(flat.length - 1, idx + delta))];
    if (!next || next === current) return;
    this.facade.setQuickChartSymbol(next);
    this.facade.scrollToSymbol(next);
  }

  /** Initialize the page through the facade. */
  ngOnInit(): void {
    this.facade.enterPage();
  }

  /** Leave fullscreen mode when the page is destroyed. */
  ngOnDestroy(): void {
    this.facade.leavePage();
  }

  /** Change the group dimension (sector, industry, or market cap). */
  onDimension(dim: string): void {
    this.facade.setGroupDimension(dim as GroupDimension);
  }

  /** Apply a list filter to the signal review. */
  onListFilter(filter: string): void {
    this.facade.setActiveListFilter(filter as SymbolListName | 'ALL');
  }

  /** Toggle a symbol's membership in a named list. */
  onToggleList(event: { symbol: string; listName: SymbolListName }): void {
    this.facade.toggleSymbolInList(event.symbol, event.listName);
  }

  /** Select a symbol for the detail panel and load its signal history. */
  onSymbolClick(symbol: string): void {
    this.facade.selectSymbol(symbol);
  }

  /** Expand or collapse all groups and preload history for newly visible rows. */
  toggleExpandAll(): void {
    this.facade.toggleExpandAll();
  }

  /** Expand/collapse a group and preload history when expanding. */
  onGroupExpandChanged(event: { group: SymbolGroup; expand: boolean }): void {
    this.facade.groupExpandChanged(event.group, event.expand);
  }

  /** Set a symbol's status to REVIEW. */
  onMarkForReview(symbol: string): void {
    this.facade.markForReview(symbol);
  }

  /** Set a symbol's status to ACCEPT. */
  onAccept(symbol: string): void {
    this.facade.acceptSymbol(symbol);
  }

  /** Set a symbol's status to CONSIDER. */
  onConsider(symbol: string): void {
    this.facade.considerSymbol(symbol);
  }

  /** Set a symbol's status to REJECT. */
  onReject(symbol: string): void {
    this.facade.rejectSymbol(symbol);
  }

  /** Reset a symbol's status to PENDING. */
  onReset(symbol: string): void {
    this.facade.resetSymbol(symbol);
  }

  /** Clear all review flags from the queue. */
  onClearReviewFlags(): void {
    this.facade.clearReviewFlags();
  }

  /** Toggle a symbol's membership in the PAST_SIGNALS monitor list. */
  onMonitor(symbol: string): void {
    this.facade.toggleMonitor(symbol);
  }

  /** Toggle the quick-charts panel for a symbol. */
  onViewQuickCharts(symbol: string): void {
    this.facade.toggleQuickChart(symbol);
  }

  /** Navigate back to the Savant Trader dashboard. */
  goBack(): void {
    this.facade.goBack();
  }

  /** Navigate to the review page if there are REVIEW symbols. */
  goToReview(): void {
    this.facade.goToReview();
  }

  /** Stage all accepted occurrence decisions as order intents, then navigate. */
  stageAcceptedIntents(): void {
    this.facade.stageAcceptedIntents();
  }

  /** Navigate to the triage report page. */
  goToTriageReport(): void {
    this.facade.goToTriageReport();
  }
}
