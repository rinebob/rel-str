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
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatBadgeModule } from '@angular/material/badge';
import { MatChipsModule } from '@angular/material/chips';
import { Router } from '@angular/router';

import { RhAgentGroupStore, GroupDimension, RhSymbolGroup, RhSymbolRow } from './rh-agent-group.store';
import { RhAgentTriageStore } from './rh-agent-triage.store';
import { RhSymbolListName, ALL_SYMBOL_LIST_NAMES } from './common/rh-agent.constants';
import { RhAgentSignalItem } from './rh-agent.service';
import { QuickChartsComponent } from './components/quick-charts/quick-charts.component';
import { UiStateService } from '../../core/services/ui-state.service';

@Component({
  selector: 'app-rh-agent-grouped-review',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatExpansionModule,
    MatBadgeModule,
    MatChipsModule,
    QuickChartsComponent,
  ],
  templateUrl: './rh-agent-grouped-review.component.html',
  styleUrl: './rh-agent-grouped-review.component.scss',
  providers: [RhAgentGroupStore],
})
export class RhAgentGroupedReviewComponent implements OnInit, OnDestroy {
  readonly groupStore = inject(RhAgentGroupStore);
  readonly triageStore = inject(RhAgentTriageStore);
  readonly uiState = inject(UiStateService);
  private readonly router = inject(Router);

  /** Expose list name enum to the template. */
  readonly ListName = RhSymbolListName;

  /** Group dimension options for the pill toggle. */
  readonly dimensionOptions: { value: GroupDimension; label: string }[] = [
    { value: 'sector',        label: 'Sector' },
    { value: 'industry',      label: 'Industry' },
    { value: 'marketCapTier', label: 'Market Cap' },
  ];

  /** Symbol list filter options for the pill toggle. */
  readonly listFilterOptions: { value: RhSymbolListName | 'ALL'; label: string }[] = [
    { value: 'ALL',                       label: 'Active' },
    { value: RhSymbolListName.PRIMARY,    label: 'Primary' },
    { value: RhSymbolListName.SECONDARY,  label: 'Secondary' },
    { value: RhSymbolListName.NEUTRAL,    label: 'Neutral' },
    { value: RhSymbolListName.AVOID,      label: 'Avoid' },
    { value: RhSymbolListName.HIDE,       label: 'Hidden' },
  ];

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

  /** Signal count in a group (regardless of fullGroup toggle). */
  signalCount(group: RhSymbolGroup): number {
    return group.rows.filter((r) => r.hasSignal).length;
  }

  /** Most recent signals for a row — shown as inline badges in the header. */
  latestSignals(row: RhSymbolRow): RhAgentSignalItem[] {
    if (!row.signals?.length) return [];
    const latest = row.signals[0];
    if (!this.isRecentSignalDate(latest.barDate)) return [];
    return row.signals.filter((s) => s.barDate === latest.barDate);
  }

  private isRecentSignalDate(barDate: string): boolean {
    const now = new Date();
    const today = this.formatLocalDate(now);
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayStr = this.formatLocalDate(yesterday);
    return barDate === today || barDate === yesterdayStr;
  }

  private formatLocalDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  ngOnInit(): void {
    this.uiState.setFullscreen(true);
    this.groupStore.loadSymbolsWithSignals();
  }

  ngOnDestroy(): void {
    this.uiState.setFullscreen(false);
  }

  onDimension(dim: GroupDimension): void {
    this.groupStore.setGroupDimension(dim);
  }

  onListFilter(filter: RhSymbolListName | 'ALL'): void {
    this.groupStore.setActiveListFilter(filter);
  }

  isInList(symbol: string, listName: string | RhSymbolListName): boolean {
    return (this.groupStore.symbolLists()[listName] ?? []).includes(symbol.toUpperCase());
  }

  onToggleList(symbol: string, listName: string | RhSymbolListName, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.groupStore.toggleSymbolInList(symbol, listName);
  }

  onSymbolClick(row: RhSymbolRow): void {
    this.groupStore.selectSymbol(row.profile.symbol);
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

  onExpandAll(group: RhSymbolGroup, event: Event): void {
    event.stopPropagation();
    const current = this.expandedGroups();
    const isExpanded = current[group.key] ?? false;
    this.expandedGroups.set({ ...current, [group.key]: !isExpanded });
    // Also trigger signal history loading for all symbols in the group
    if (!isExpanded) {
      for (const row of group.rows) {
        if (!row.signals) {
          this.groupStore.loadSignalHistory(row.profile.symbol);
        }
      }
    }
  }

  onToggleFullGroup(groupKey: string, event: Event): void {
    event.stopPropagation();
    this.groupStore.toggleFullGroup(groupKey);
  }

  onPromote(symbol: string, event: Event): void {
    event.stopPropagation();
    this.triageStore.promoteSymbol(symbol);
  }

  onAccept(symbol: string, event: Event): void {
    event.stopPropagation();
    this.triageStore.acceptSymbol(symbol);
  }

  onConsider(symbol: string, event: Event): void {
    event.stopPropagation();
    this.triageStore.considerSymbol(symbol);
  }

  onReject(symbol: string, event: Event): void {
    event.stopPropagation();
    this.triageStore.rejectSymbol(symbol);
  }

  onReset(symbol: string, event: Event): void {
    event.stopPropagation();
    this.triageStore.resetSymbol(symbol);
  }

  onPromoteGroup(group: RhSymbolGroup, event: Event): void {
    event.stopPropagation();
    const symbols = group.rows.filter((r) => r.hasSignal).map((r) => r.profile.symbol);
    this.triageStore.setGroupStatus(symbols, 'PROMOTE');
  }

  onAcceptGroup(group: RhSymbolGroup, event: Event): void {
    event.stopPropagation();
    const symbols = group.rows.filter((r) => r.hasSignal).map((r) => r.profile.symbol);
    this.triageStore.setGroupStatus(symbols, 'ACCEPT');
  }

  onViewQuickCharts(symbol: string, event: Event): void {
    event.stopPropagation();
    const current = this.groupStore.quickChartSymbol();
    this.groupStore.setQuickChartSymbol(current === symbol ? null : symbol);
  }

  goBack(): void {
    this.router.navigate(['/rh-agent']);
  }

  goToReview(): void {
    if (this.triageStore.promotedCount() === 0) return;
    this.router.navigate(['/rh-agent-review']);
  }

  goToOrder(): void {
    if (this.triageStore.acceptedCount() === 0) return;
    this.router.navigate(['/rh-agent-order']);
  }

  goToTriageReport(): void {
    this.router.navigate(['/rh-agent-triage-report']);
  }

  /** Market cap tier display label. */
  tierLabel(tier: string | undefined): string {
    const map: Record<string, string> = {
      mega: 'MEGA', large: 'LG', mid: 'MID', small: 'SM', micro: 'µ',
    };
    return tier ? (map[tier] ?? tier.toUpperCase()) : '';
  }

  /** Direction label from signal items. */
  signalDirections(signals: RhAgentSignalItem[] | undefined): string {
    if (!signals?.length) return '';
    const dirs = [...new Set(signals.map((s) => s.direction))];
    return dirs.join('/');
  }
}
