/**
 * SymbolNavComponent — prev/next stepping through the tracked-symbols
 * universe, optionally narrowed to a Symbol List (watchlist). All
 * sequencing lives in the store's symbol-nav feature slice; this is the
 * thin binding layer.
 */
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { SwingAnalysisStore } from '../swing-analysis.store';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { SymbolListActionsComponent } from '../../components/symbol-list-actions/symbol-list-actions.component';
import { SymbolListName, SYMBOL_LIST_FILTER_OPTIONS } from '../../common/constants';
import type { NavFilter } from '../symbol-nav.feature';

@Component({
  selector: 'app-symbol-nav',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, SymbolListActionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="symbol-nav">
  <button
    mat-icon-button
    data-testid="nav-prev"
    matTooltip="Previous symbol"
    [disabled]="!navEnabled()"
    (click)="store.prevSymbol()"
  >
    <mat-icon>navigate_before</mat-icon>
  </button>
  <span class="nav-symbol" data-testid="nav-symbol">{{ store.symbol() }}</span>
  <button
    mat-icon-button
    data-testid="nav-next"
    matTooltip="Next symbol"
    [disabled]="!navEnabled()"
    (click)="store.nextSymbol()"
  >
    <mat-icon>navigate_next</mat-icon>
  </button>
  <span class="nav-position" data-testid="nav-position">{{ store.navPosition() }}</span>
  <select
    class="nav-filter"
    data-testid="nav-filter"
    matTooltip="Nav sequence"
    (change)="onFilter($event)"
  >
    <!-- [attr.selected] per-option — see saved-sets.component for why not
         [value] on the select. -->
    @for (f of filterOptions; track f.value) {
      <option [value]="f.value" [attr.selected]="f.value === store.navFilter() ? '' : null">
        {{ f.label }}
      </option>
    }
  </select>
</div>
<!-- Watchlist chip triage — file the viewed symbol while paging. -->
<app-symbol-list-actions
  data-testid="nav-list-actions"
  [symbol]="store.symbol()"
  [symbolLists]="lists.symbolLists()"
  (toggleList)="onToggleList($event)"
  (monitor)="onMonitor($event)"
/>
  `,
  styles: [`
    .symbol-nav {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
    }
    .nav-symbol {
      font-size: 1.15rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      min-width: 70px;
      text-align: center;
    }
    .nav-position {
      font-size: 0.8rem;
      color: #666;
      min-width: 56px;
    }
    .nav-filter {
      margin-left: 8px;
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 0.85rem;
    }
  `],
})
export class SymbolNavComponent {
  readonly store = inject(SwingAnalysisStore);
  readonly lists = inject(SymbolListStore);

  readonly navEnabled = this.store.navEnabled;

  constructor() {
    // Populate the filter select + chips — skip when already warm.
    if (Object.keys(this.lists.symbolLists()).length === 0) {
      this.lists.loadSymbolLists();
    }
  }

  /** 'All symbols' plus the canonical shared list-filter options. */
  readonly filterOptions = [
    { value: 'ALL', label: 'All symbols' },
    ...SYMBOL_LIST_FILTER_OPTIONS,
  ] as const;

  onFilter(event: Event): void {
    this.store.setNavFilter((event.target as HTMLSelectElement).value as NavFilter);
  }

  /** Chip toggle → exclusive list membership, persisted by the store. */
  onToggleList(event: { symbol: string; listName: SymbolListName }): void {
    this.lists.toggleSymbolInList(event.symbol, event.listName);
  }

  /** Monitor chip → membership-driven MONITOR toggle (mirrors chart-review). */
  onMonitor(symbol: string): void {
    this.lists.toggleMonitor(symbol);
  }
}
