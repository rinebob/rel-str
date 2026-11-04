/**
 * Options Replay Run Controls Component
 *
 * Filter and sort strip for the Selection Replay run list — status pills
 * (symbol-status vocabulary), template select (seeded REPLAY_TEMPLATES
 * registry), symbol search, and sort field + direction. Replay-scoped
 * port of backtest-run-control: no config search, no archive toggle, no
 * date filter. State lives in OptionsReplayStore — this component is a
 * dumb input/output seam.
 */
import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';

import { REPLAY_TEMPLATES } from '@options-replay/templates';
import type {
  ReplaySortBy,
  ReplaySortDirection,
  ReplayStatusFilter,
} from '../../common/options-replay.types';

@Component({
  selector: 'app-options-replay-run-controls',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './options-replay-run-controls.component.html',
  styleUrl: './options-replay-run-controls.component.scss',
})
export class OptionsReplayRunControlsComponent {
  readonly isLoading = input<boolean>(false);
  /** Drives the Clear pill — shown only while any filter is non-default. */
  readonly hasActiveFilters = input<boolean>(false);
  readonly statusFilter = input<ReplayStatusFilter>('all');
  readonly templateFilter = input<string>('all');
  readonly symbolSearch = input<string>('');
  readonly sortBy = input<ReplaySortBy>('createdAt');
  readonly sortDirection = input<ReplaySortDirection>('desc');

  readonly newReplay = output<void>();
  readonly statusFilterChange = output<ReplayStatusFilter>();
  readonly templateFilterChange = output<string>();
  readonly symbolSearchChange = output<string>();
  readonly sortByChange = output<ReplaySortBy>();
  readonly sortDirectionChange = output<ReplaySortDirection>();
  /** Clear-all affordance — the dashboard wires it to store.resetFilters. */
  readonly resetFilters = output<void>();

  readonly statusOptions: { label: string; value: ReplayStatusFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Pending', value: 'pending' },
    { label: 'Success', value: 'success' },
    { label: 'Failed', value: 'failed' },
  ];

  /** Template options come straight from the seeded shared registry —
   *  the same list the new-run dialog and BE validation use. */
  readonly templateOptions = REPLAY_TEMPLATES;

  readonly sortOptions: { label: string; value: ReplaySortBy }[] = [
    { label: 'Created', value: 'createdAt' },
    { label: 'Start Date', value: 'startDate' },
    { label: 'Symbol', value: 'symbol' },
  ];

  onStatus(value: ReplayStatusFilter): void {
    this.statusFilterChange.emit(value);
  }

  onTemplate(value: string): void {
    this.templateFilterChange.emit(value);
  }

  onSymbolSearch(value: string): void {
    this.symbolSearchChange.emit(value);
  }

  onSortBy(value: string): void {
    const sort = this.sortOptions.find((option) => option.value === value)?.value;
    if (sort) {
      this.sortByChange.emit(sort);
    }
  }

  toggleSortDirection(): void {
    this.sortDirectionChange.emit(this.sortDirection() === 'asc' ? 'desc' : 'asc');
  }
}
