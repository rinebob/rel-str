/**
 * RH Agent Grouped Review Component
 *
 * Symbol-centric grouped review UI.
 * Replaces the flat signal list with sector/industry expansion panels.
 * URL: /rh-agent-grouped-review
 */
import {
  Component,
  inject,
  OnInit,
  ChangeDetectionStrategy,
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
import { RhAgentSignalItem } from './rh-agent.service';

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
  ],
  templateUrl: './rh-agent-grouped-review.component.html',
  styleUrl: './rh-agent-grouped-review.component.scss',
  providers: [RhAgentGroupStore],
})
export class RhAgentGroupedReviewComponent implements OnInit {
  readonly groupStore = inject(RhAgentGroupStore);
  private readonly router = inject(Router);

  /** Group dimension options for the pill toggle. */
  readonly dimensionOptions: { value: GroupDimension; label: string }[] = [
    { value: 'sector',        label: 'Sector' },
    { value: 'industry',      label: 'Industry' },
    { value: 'marketCapTier', label: 'Market Cap' },
  ];

  /** Visible rows within a group — respects fullGroup toggle. */
  visibleRows(group: RhSymbolGroup): RhSymbolRow[] {
    if (group.showFullGroup) return group.rows;
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
    return row.signals.filter((s) => s.barDate === latest.barDate);
  }

  ngOnInit(): void {
    this.groupStore.loadSymbolsWithSignals();
    this.groupStore.loadSignalCounts();
  }

  onTimeframe(tf: 'W' | 'D'): void {
    this.groupStore.setTimeframe(tf);
  }

  onDimension(dim: GroupDimension): void {
    this.groupStore.setGroupDimension(dim);
  }

  onSymbolClick(row: RhSymbolRow): void {
    this.groupStore.selectSymbol(row.profile.symbol);
  }

  onToggleFullGroup(groupKey: string, event: Event): void {
    event.stopPropagation();
    this.groupStore.toggleFullGroup(groupKey);
  }

  onPromote(symbol: string, event: Event): void {
    event.stopPropagation();
    this.groupStore.promoteSymbol(symbol);
  }

  onAccept(symbol: string, event: Event): void {
    event.stopPropagation();
    this.groupStore.acceptSymbol(symbol);
  }

  onConsider(symbol: string, event: Event): void {
    event.stopPropagation();
    this.groupStore.considerSymbol(symbol);
  }

  onReject(symbol: string, event: Event): void {
    event.stopPropagation();
    this.groupStore.rejectSymbol(symbol);
  }

  goBack(): void {
    this.router.navigate(['/rh-agent']);
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
