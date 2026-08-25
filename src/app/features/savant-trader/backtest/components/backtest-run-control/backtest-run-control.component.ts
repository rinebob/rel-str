/**
 * Backtest Run Control Component
 *
 * Filter and sort strip for the backtest run list. Reuses the compact pill
 * button pattern from the existing Savant Trader dashboard.
 */
import { Component, input, output, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import type {
  BacktestDateFilter,
  BacktestSortBy,
  BacktestSortDirection,
  BacktestStatusFilter,
} from '../../common/backtest.types';

interface StrategyOption {
  id: string;
  name: string;
}

@Component({
  selector: 'app-backtest-run-control',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, MatButtonModule, MatIconModule, MatTooltipModule, MatProgressSpinnerModule],
  templateUrl: './backtest-run-control.component.html',
  styleUrl: './backtest-run-control.component.scss',
})
export class BacktestRunControlComponent {
  readonly isLoading = input<boolean>(false);
  readonly statusFilter = input<BacktestStatusFilter>('all');
  readonly dateFilter = input<BacktestDateFilter>('all');
  readonly strategyFilter = input<string>('all');
  readonly strategyOptions = input<StrategyOption[]>([]);
  readonly symbolSearch = input<string>('');
  readonly configSearch = input<string>('');
  readonly sortBy = input<BacktestSortBy>('createdAt');
  readonly sortDirection = input<BacktestSortDirection>('desc');
  readonly includeArchived = input<boolean>(false);

  readonly newRun = output<void>();
  readonly refresh = output<void>();
  readonly statusFilterChange = output<BacktestStatusFilter>();
  readonly dateFilterChange = output<BacktestDateFilter>();
  readonly strategyFilterChange = output<string>();
  readonly symbolSearchChange = output<string>();
  readonly configSearchChange = output<string>();
  readonly sortByChange = output<BacktestSortBy>();
  readonly sortDirectionChange = output<BacktestSortDirection>();
  readonly includeArchivedChange = output<boolean>();

  readonly statusOptions: { label: string; value: BacktestStatusFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Pending', value: 'pending' },
    { label: 'Running', value: 'running' },
    { label: 'Completed', value: 'completed' },
    { label: 'Failed', value: 'failed' },
  ];

  readonly dateOptions: { label: string; value: BacktestDateFilter }[] = [
    { label: 'All', value: 'all' },
    { label: 'Today', value: 'today' },
    { label: '7 Days', value: '7d' },
    { label: '30 Days', value: '30d' },
  ];

  readonly sortOptions: { label: string; value: BacktestSortBy }[] = [
    { label: 'Created', value: 'createdAt' },
    { label: 'Status', value: 'status' },
  ];

  onStatus(value: BacktestStatusFilter): void {
    this.statusFilterChange.emit(value);
  }

  onDate(value: BacktestDateFilter): void {
    this.dateFilterChange.emit(value);
  }

  onStrategy(value: string): void {
    this.strategyFilterChange.emit(value);
  }

  onSymbolSearch(value: string): void {
    this.symbolSearchChange.emit(value);
  }

  onConfigSearch(value: string): void {
    this.configSearchChange.emit(value);
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

  toggleIncludeArchived(): void {
    this.includeArchivedChange.emit(!this.includeArchived());
  }
}
