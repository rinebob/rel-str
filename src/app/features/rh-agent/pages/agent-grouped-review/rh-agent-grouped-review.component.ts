/**
 * RH Agent Grouped Review Component
 *
 * Symbol-centric grouped review UI.
 * Replaces the flat signal list with sector/industry expansion panels.
 * URL: /rh-agent-grouped-review
 */
import {
  Component,
  ElementRef,
  inject,
  OnInit,
  OnDestroy,
  ChangeDetectionStrategy,
  computed,
  signal,
  viewChild,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { Router } from '@angular/router';

import { RhAgentGroupStore, RhSymbolGroup, RhSymbolRow } from '../../stores/rh-agent-group.store';
import { GroupDimension } from '../../common/rh-agent.constants';
import { RhAgentTriageStore } from '../../stores/rh-agent-triage.store';
import { RhAgentSymbolListStore } from '../../stores/rh-agent-symbol-list.store';
import { RhReviewStatus, RhSymbolListName } from '../../common/rh-agent.constants';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { GroupedReviewHeaderComponent } from '../../components/grouped-review-header/grouped-review-header.component';
import { GroupPanelComponent } from '../../components/group-panel/group-panel.component';
import { QuickChartsPanelComponent } from '../../components/quick-charts-panel/quick-charts-panel.component';

@Component({
  selector: 'app-rh-agent-grouped-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    GroupedReviewHeaderComponent,
    GroupPanelComponent,
    QuickChartsPanelComponent,
  ],
  templateUrl: './rh-agent-grouped-review.component.html',
  styleUrl: './rh-agent-grouped-review.component.scss',
  providers: [RhAgentGroupStore, RhAgentSymbolListStore],
})
export class RhAgentGroupedReviewComponent implements OnInit, OnDestroy {
  readonly groupStore = inject(RhAgentGroupStore);
  readonly triageStore = inject(RhAgentTriageStore);
  readonly symbolListStore = inject(RhAgentSymbolListStore);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);

  /** Scroll container ref for scroll-into-view on navigation. */
  private readonly groupsPanel = viewChild<ElementRef>('groupsPanel');

  /** Flat ordered list of all visible symbols across all groups. */
  readonly flatSymbols = computed(() =>
    this.groupStore.groups().flatMap(g => this.visibleRows(g).map(r => r.profile.symbol))
  );

  navigatePrev(): void {
    this._navigateBy(-1);
  }

  navigateNext(): void {
    this._navigateBy(1);
  }

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
      this.groupStore.loadSignalHistory(next);
    }
    setTimeout(() => {
      const panel = this.groupsPanel()?.nativeElement as HTMLElement | undefined;
      if (!panel) return;
      const el = panel.querySelector(`[data-symbol="${next}"]`) as HTMLElement | null;
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 50);
  }

  /** Visible rows within a group — shows all when showAllSymbols is active or showFullGroup is toggled. */
  visibleRows(group: RhSymbolGroup): RhSymbolRow[] {
    if (this.groupStore.showAllSymbols() || group.showFullGroup) return group.rows;
    return group.rows.filter((r) => r.hasSignal);
  }

  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    this.triageStore.setMarketDate(this.groupStore.marketDate());
    this.groupStore.loadSymbolsWithSignals();
  }

  ngOnDestroy(): void {
    this.uiState.setFullscreen(false);
  }

  onDimension(dim: GroupDimension): void {
    this.groupStore.setGroupDimension(dim);
  }

  onListFilter(filter: RhSymbolListName | 'ALL'): void {
    this.symbolListStore.setActiveListFilter(filter);
  }

  onToggleList(event: { symbol: string; listName: RhSymbolListName }): void {
    this.symbolListStore.toggleSymbolInList(event.symbol, event.listName);
  }

  onSymbolClick(symbol: string): void {
    this.groupStore.selectSymbol(symbol);
  }

  /** Tracks which groups have all symbol panels expanded. */
  readonly expandedGroups = signal<Record<string, boolean>>({});

  /** True when all groups are expanded. */
  readonly allExpanded = signal(false);

  toggleExpandAll(): void {
    const next = !this.allExpanded();
    this.allExpanded.set(next);
    const groups = this.groupStore.groups();
    const record: Record<string, boolean> = {};
    for (const g of groups) {
      record[g.key] = next;
      if (next) {
        for (const row of g.rows) {
          if (!row.signals) this.groupStore.loadSignalHistory(row.profile.symbol);
        }
      }
    }
    this.expandedGroups.set(record);
  }

  /** Whether all symbol panels in a group are expanded. */
  isGroupExpanded(groupKey: string): boolean {
    return this.expandedGroups()[groupKey] ?? false;
  }

  onGroupOpened(group: RhSymbolGroup): void {
    for (const row of group.rows) {
      if (!row.signals) {
        this.groupStore.loadSignalHistory(row.profile.symbol);
      }
    }
  }

  onExpandAll(event: { group: RhSymbolGroup; expand: boolean }): void {
    const current = this.expandedGroups();
    const isExpanded = current[event.group.key] ?? false;
    const nextExpand = event.expand;
    this.expandedGroups.set({ ...current, [event.group.key]: nextExpand });
    if (nextExpand && !isExpanded) {
      for (const row of event.group.rows) {
        if (!row.signals) {
          this.groupStore.loadSignalHistory(row.profile.symbol);
        }
      }
    }
  }

  onMarkForReview(symbol: string): void {
    this.triageStore.markForReview(symbol);
  }

  onAccept(symbol: string): void {
    this.triageStore.acceptSymbol(symbol);
  }

  onConsider(symbol: string): void {
    this.triageStore.considerSymbol(symbol);
  }

  onReject(symbol: string): void {
    this.triageStore.rejectSymbol(symbol);
  }

  onReset(symbol: string): void {
    this.triageStore.resetSymbol(symbol);
  }

  onMonitor(symbol: string): void {
    if (this.symbolListStore.activeListFilter() === RhSymbolListName.PAST_SIGNALS) {
      this.symbolListStore.removeSymbolFromList(symbol, RhSymbolListName.PAST_SIGNALS);
    } else {
      this.symbolListStore.addSymbolToList(symbol, RhSymbolListName.PAST_SIGNALS);
    }
  }

  onViewQuickCharts(symbol: string): void {
    const current = this.groupStore.quickChartSymbol();
    this.groupStore.setQuickChartSymbol(current === symbol ? null : symbol);
  }

  goBack(): void {
    this.router.navigate(['/rh-agent']);
  }

  goToReview(): void {
    if (this.triageStore.reviewCount() === 0) return;
    this.router.navigate(['/rh-agent-review']);
  }

  goToOrder(): void {
    if (this.triageStore.acceptedCount() === 0) return;
    this.router.navigate(['/rh-agent-order']);
  }

  goToTriageReport(): void {
    this.router.navigate(['/rh-agent-triage-report']);
  }

}
