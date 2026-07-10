/**
 * Signal Review Component
 *
 * Symbol-centric signal review UI.
 * Replaces the flat signal list with sector/industry expansion panels.
 * URL: /signal-review
 */
import {
  Component,
  ElementRef,
  inject,
  Injector,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  computed,
  effect,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';

import { RhAgentGroupStore, RhSymbolGroup, RhSymbolRow } from '../../stores/rh-agent-group.store';
import { RhAgentStore } from '../../stores/rh-agent.store';
import { GroupDimension } from '../../common/rh-agent.constants';
import { RhAgentTriageStore } from '../../stores/rh-agent-triage.store';
import { RhAgentSymbolListStore } from '../../stores/rh-agent-symbol-list.store';
import { RhAgentSymbolHistoryStore } from '../../stores/rh-agent-symbol-history.store';
import { RhReviewStatus, RhSymbolListName } from '../../common/rh-agent.constants';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { SignalReviewHeaderComponent } from '../../components/signal-review-header/signal-review-header.component';
import { GroupPanelComponent } from '../../components/group-panel/group-panel.component';
import { QuickChartsPanelComponent } from '../../components/quick-charts-panel/quick-charts-panel.component';

@Component({
  selector: 'app-signal-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    SignalReviewHeaderComponent,
    GroupPanelComponent,
    QuickChartsPanelComponent,
  ],
  templateUrl: './signal-review.component.html',
  styleUrl: './signal-review.component.scss',
  providers: [],
})
export class SignalReviewComponent implements OnInit, OnDestroy {
  readonly groupStore = inject(RhAgentGroupStore);
  readonly triageStore = inject(RhAgentTriageStore);
  readonly symbolListStore = inject(RhAgentSymbolListStore);
  readonly historyStore = inject(RhAgentSymbolHistoryStore);
  readonly uiState = inject(UiStateService);
  private readonly agentStore = inject(RhAgentStore);
  private readonly injector = inject(Injector);
  private readonly router = inject(Router);

  /** Scroll container ref for scroll-into-view on navigation. */
  private readonly groupsPanel = viewChild<ElementRef>('groupsPanel');

  /** Flat ordered list of all visible symbols across all groups. */
  readonly flatSymbols = computed(() =>
    this.groupStore.groups().flatMap(g => this.visibleRows(g).map(r => r.profile.symbol))
  );

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
    const flat = this.flatSymbols();
    if (flat.length === 0) return;
    const current = this.groupStore.quickChartSymbol();
    const idx = current ? flat.indexOf(current) : -1;
    const next = flat[Math.max(0, Math.min(flat.length - 1, idx + delta))];
    if (!next || next === current) return;
    this.groupStore.setQuickChartSymbol(next);
    const row = this.groupStore.groups().flatMap(g => g.rows).find(r => r.profile.symbol === next);
    if (row && !row.signals) {
      this.historyStore.loadSignalHistory(next);
    }
    setTimeout(() => {
      const panel = this.groupsPanel()?.nativeElement as HTMLElement | undefined;
      if (!panel) return;
      const el = panel.querySelector(`[data-symbol="${next}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  /**
   * Visible rows within a group.
   * Shows all rows when showAllSymbols is active or showFullGroup is toggled,
   * otherwise shows only symbols with an active signal.
   */
  visibleRows(group: RhSymbolGroup): RhSymbolRow[] {
    if (this.groupStore.showAllSymbols() || group.showFullGroup) return group.rows;
    return group.rows.filter((r) => r.hasSignal);
  }

  /** Initialize the page: fullscreen mode, sync market date, and load signal symbols. */
  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    const runId = this.groupStore.activeRunId();
    const marketDate = this.groupStore.activeRunMarketDate();
    if (runId && marketDate) {
      this.triageStore.setActiveRun(runId, marketDate);
      this.groupStore.loadSymbolsWithSignals();
    } else {
      // Direct page reload — activeRunId not yet set. Start runs stream and
      // auto-select the most recent run when it arrives.
      this.agentStore.loadData();
      effect(() => {
        const latest = this.agentStore.latestRun();
        if (!latest) return;
        if (this.groupStore.activeRunId()) return;
        this.groupStore.setActiveRun(latest.id, latest.marketDate ?? '');
      }, { injector: this.injector });
    }
  }

  /** Leave fullscreen mode when the page is destroyed. */
  ngOnDestroy(): void {
    this.uiState.setFullscreen(false);
  }

  /** Change the group dimension (sector, industry, or market cap). */
  onDimension(dim: GroupDimension): void {
    this.groupStore.setGroupDimension(dim);
  }

  /** Apply a list filter to the signal review. */
  onListFilter(filter: RhSymbolListName | 'ALL'): void {
    this.symbolListStore.setActiveListFilter(filter);
  }

  /** Toggle a symbol's membership in a named list. */
  onToggleList(event: { symbol: string; listName: RhSymbolListName }): void {
    this.symbolListStore.toggleSymbolInList(event.symbol, event.listName);
  }

  /** Select a symbol for the detail panel and load its signal history. */
  onSymbolClick(symbol: string): void {
    this.groupStore.selectSymbol(symbol);
  }

  /** Tracks which groups have all symbol panels expanded. */
  readonly expandedGroups = signal<Record<string, boolean>>({});

  /** True when all groups are expanded. */
  readonly allExpanded = signal(false);

  /** Expand or collapse all groups and preload history for newly visible rows. */
  toggleExpandAll(): void {
    const next = !this.allExpanded();
    this.allExpanded.set(next);
    const groups = this.groupStore.groups();
    const record: Record<string, boolean> = {};
    for (const g of groups) {
      record[g.key] = next;
      if (next) {
        const runId = this.groupStore.activeRunId();
        for (const row of g.rows) {
          if (!row.signals && runId) this.historyStore.loadSignalHistoryForRun(row.profile.symbol, runId);
        }
      }
    }
    this.expandedGroups.set(record);
  }

  /** Whether all symbol panels in a group are expanded. */
  isGroupExpanded(groupKey: string): boolean {
    return this.expandedGroups()[groupKey] ?? false;
  }

  /** Preload signal history for every row when a group is opened. */
  onGroupOpened(group: RhSymbolGroup): void {
    const runId = this.groupStore.activeRunId();
    for (const row of group.rows) {
      if (!row.signals && runId) {
        this.historyStore.loadSignalHistoryForRun(row.profile.symbol, runId);
      }
    }
  }

  /** Toggle expansion for a single group and preload history if expanding. */
  onExpandAll(event: { group: RhSymbolGroup; expand: boolean }): void {
    const current = this.expandedGroups();
    const isExpanded = current[event.group.key] ?? false;
    const nextExpand = event.expand;
    this.expandedGroups.set({ ...current, [event.group.key]: nextExpand });
    if (nextExpand && !isExpanded) {
      const runId = this.groupStore.activeRunId();
      for (const row of event.group.rows) {
        if (!row.signals && runId) {
          this.historyStore.loadSignalHistoryForRun(row.profile.symbol, runId);
        }
      }
    }
  }

  /** Set a symbol's status to REVIEW. */
  onMarkForReview(symbol: string): void {
    this.triageStore.markForReview(symbol);
  }

  /** Set a symbol's status to ACCEPT. */
  onAccept(symbol: string): void {
    this.triageStore.acceptSymbol(symbol);
  }

  /** Set a symbol's status to CONSIDER. */
  onConsider(symbol: string): void {
    this.triageStore.considerSymbol(symbol);
  }

  /** Set a symbol's status to REJECT. */
  onReject(symbol: string): void {
    this.triageStore.rejectSymbol(symbol);
  }

  /** Reset a symbol's status to PENDING. */
  onReset(symbol: string): void {
    this.triageStore.resetSymbol(symbol);
  }

  /** Toggle a symbol's membership in the PAST_SIGNALS monitor list. */
  onMonitor(symbol: string): void {
    if (this.symbolListStore.activeListFilter() === RhSymbolListName.PAST_SIGNALS) {
      this.symbolListStore.removeSymbolFromList(symbol, RhSymbolListName.PAST_SIGNALS);
    } else {
      this.symbolListStore.addSymbolToList(symbol, RhSymbolListName.PAST_SIGNALS);
    }
  }

  /** Toggle the quick-charts panel for a symbol. */
  onViewQuickCharts(symbol: string): void {
    const current = this.groupStore.quickChartSymbol();
    this.groupStore.setQuickChartSymbol(current === symbol ? null : symbol);
  }

  /** Navigate back to the RH Agent dashboard. */
  goBack(): void {
    this.router.navigate(['/rh-agent']);
  }

  /** Navigate to the review page if there are REVIEW symbols. */
  goToReview(): void {
    if (this.triageStore.reviewCount() === 0) return;
    this.router.navigate(['/chart-review']);
  }

  /** Navigate to the order page if there are ACCEPT symbols. */
  goToOrder(): void {
    if (this.triageStore.acceptedCount() === 0) return;
    this.router.navigate(['/rh-agent-order']);
  }

  /** Navigate to the triage report page. */
  goToTriageReport(): void {
    this.router.navigate(['/rh-agent-triage-report']);
  }

}
