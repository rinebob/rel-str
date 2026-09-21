/**
 * SavedSetsComponent — the collapsed "Saved Sets" browser.
 *
 * Lazy-loads every st-swing-sets doc on first expand (whole-collection
 * read — deliberately not wired into page init), offers a symbol filter
 * and checkbox multi-select, then loads the checked docs into N config
 * slots via store.loadSwingSetsIntoSlots. Nothing is re-saved — the docs
 * are already persisted snapshots.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import { SwingAnalysisStore } from '../swing-analysis.store';

const ALL = 'ALL';

@Component({
  selector: 'app-saved-sets',
  standalone: true,
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<details class="saved-sets-section" data-testid="saved-sets-section" (toggle)="onToggle($event)">
  <summary class="saved-sets-header">
    <span class="config-section-label">Saved Sets</span>
    <span class="saved-sets-hint">load N saved configs into N slots</span>
  </summary>
  <div class="saved-sets-body">
    @if (savedSetsLoading()) {
      <div class="saved-sets-loading" data-testid="saved-sets-loading">Loading saved sets…</div>
    }
    <div class="saved-sets-controls">
      <select
        class="saved-sets-filter"
        data-testid="saved-sets-filter"
        [value]="filterSymbol()"
        (change)="onFilter($event)"
      >
        <option [value]="allValue">All symbols</option>
        @for (s of symbols(); track s) {
          <option [value]="s">{{ s }}</option>
        }
      </select>
      <button
        mat-raised-button
        color="primary"
        data-testid="load-sets-btn"
        [disabled]="!canLoad()"
        (click)="onLoad()"
      >
        Load {{ checkedDocs().length }} selected
      </button>
    </div>
    <ul class="set-list" data-testid="saved-sets-list">
      @for (d of filteredDocs(); track d.id) {
        <li class="set-row" data-testid="saved-set-row">
          <label>
            <input
              type="checkbox"
              data-testid="saved-set-checkbox"
              [checked]="checked().has(d.id)"
              (change)="onCheck(d.id, $event)"
            />
            <span class="set-symbol">{{ d.symbol }}</span>
            <span class="set-params">{{ d.paramsId }}</span>
            <span class="set-date">{{ d.savedAt?.slice(0, 10) }}</span>
          </label>
        </li>
      } @empty {
        @if (!savedSetsLoading()) {
          <li class="set-empty" data-testid="saved-sets-empty">No saved sets</li>
        }
      }
    </ul>
  </div>
</details>
  `,
  styles: [`
    .saved-sets-section {
      display: block;
      border: 1px solid #ddd;
      border-radius: 4px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .saved-sets-header {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 8px 12px;
      background: #f5f5f5;
      cursor: pointer;
      user-select: none;
    }
    .config-section-label {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .saved-sets-hint {
      font-size: 0.75rem;
      color: #888;
    }
    .saved-sets-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .saved-sets-loading {
      font-size: 0.85rem;
      color: #555;
    }
    .saved-sets-controls {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .saved-sets-filter {
      padding: 4px 6px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-size: 0.85rem;
      max-width: 220px;
    }
    .set-list {
      margin: 0;
      padding: 0 0 0 4px;
      list-style: none;
      font-size: 0.85rem;
      max-height: 220px;
      overflow-y: auto;
    }
    .set-row label {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 2px 0;
      cursor: pointer;
    }
    .set-symbol {
      font-weight: 600;
      min-width: 56px;
    }
    .set-params {
      color: #444;
      font-family: monospace;
      font-size: 0.78rem;
    }
    .set-date {
      margin-left: auto;
      color: #888;
      font-size: 0.78rem;
    }
    .set-empty {
      color: #888;
      padding: 4px 0;
    }
  `],
})
export class SavedSetsComponent {
  readonly store = inject(SwingAnalysisStore);

  readonly savedSets = this.store.savedSets;
  readonly savedSetsLoading = this.store.savedSetsLoading;
  readonly allValue = ALL;

  /** Symbol filter — 'ALL' shows every doc. */
  readonly filterSymbol = signal(ALL);
  /** Checked doc ids — the multi-select. */
  readonly checked = signal<ReadonlySet<string>>(new Set());

  /** Distinct symbols across saved docs, sorted — the filter options. */
  readonly symbols = computed(() =>
    [...new Set(this.savedSets().map((d) => d.symbol))].sort(),
  );

  /** Docs matching the filter, newest savedAt first. */
  readonly filteredDocs = computed(() => {
    const f = this.filterSymbol();
    return this.savedSets()
      .filter((d) => f === ALL || d.symbol === f)
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  /** The checked docs — newest-first like the visible list, so the
   *  loaded slot order matches what the user saw. Checks survive filter
   *  changes (a doc outside the filter stays selected). */
  readonly checkedDocs = computed(() => {
    const ids = this.checked();
    return this.savedSets()
      .filter((d) => ids.has(d.id))
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  });

  /** Load enabled with ≥1 checked doc, all sharing one symbol — mirrors
   *  the store's same-symbol guard. */
  readonly canLoad = computed(() => {
    const docs = this.checkedDocs();
    return docs.length > 0 && new Set(docs.map((d) => d.symbol)).size === 1;
  });

  onToggle(event: Event): void {
    const open = (event.target as HTMLDetailsElement).open;
    // Load only when there's nothing to show — a failed load (or a
    // genuinely empty collection) retries on the next expand.
    if (open && !this.savedSetsLoading() && this.savedSets().length === 0) {
      this.store.loadSwingSets();
    }
  }

  onFilter(event: Event): void {
    this.filterSymbol.set((event.target as HTMLSelectElement).value);
  }

  onCheck(id: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    const next = new Set(this.checked());
    if (on) next.add(id);
    else next.delete(id);
    this.checked.set(next);
  }

  onLoad(): void {
    this.store.loadSwingSetsIntoSlots(this.checkedDocs());
  }
}
