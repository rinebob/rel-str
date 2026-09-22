/**
 * SavedSetsComponent — the collapsed "Saved Sets" browser.
 *
 * Symbol-first: the picker comes from the tracked-symbols universe and
 * expanding the panel fetches only the selected symbol's swing sets
 * (a few docs — the whole-collection read was too heavy to load up
 * front). Checkbox multi-select loads the checked docs into N config
 * slots via store.loadSwingSetsIntoSlots. Nothing is re-saved — the
 * docs are already persisted snapshots.
 */
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import { SwingAnalysisStore } from '../swing-analysis.store';

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
        data-testid="saved-sets-symbol"
        (change)="onSymbolChange($event)"
      >
        <!-- [attr.selected] per-option instead of [value] on the select —
             the SelectControlValueAccessor path can hit setAttribute on a
             null option while options are still materializing. -->
        @for (s of symbolOptions(); track s) {
          <option [value]="s" [attr.selected]="s === effectiveSymbol() ? '' : null">{{ s }}</option>
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
      @for (d of sortedDocs(); track d.id) {
        <li class="set-row" data-testid="saved-set-row">
          <label>
            <input
              type="checkbox"
              data-testid="saved-set-checkbox"
              [checked]="effectiveChecked().has(d.id)"
              (change)="onCheck(d.id, $event)"
            />
            <span class="set-symbol">{{ d.symbol }}</span>
            <span class="set-params">{{ d.paramsId }}</span>
            <span class="set-date">{{ d.savedAt.slice(0, 10) }}</span>
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

  /** The symbol whose sets are being browsed — defaults to the page's
   *  current symbol when the panel first opens. */
  readonly selectedSymbol = signal('');
  /** Checked doc ids — the user's explicit multi-select. */
  readonly checked = signal<ReadonlySet<string>>(new Set());
  /** Docs the user explicitly UNchecked — overrides the auto-check so a
   *  live-slot row can be opted out of the next Load. */
  private readonly unchecked = signal<ReadonlySet<string>>(new Set());
  /** Open state of the <details> panel — drives whether a symbol change refetches. */
  private readonly panelOpen = signal(false);
  /** The symbol the loaded savedSets docs were fetched for — detects staleness. */
  private readonly browsedSymbol = signal('');
  /** Last page symbol the panel reacted to — the effect's change detector. */
  private readonly lastPageSymbol = signal('');

  constructor() {
    // Follow the page's symbol: nav (or any other path) moving the chart
    // resyncs the picker, drops stale checks, and refetches that symbol's
    // sets while the panel is open.
    effect(() => {
      const sym = this.store.symbol();
      if (sym === this.lastPageSymbol()) return;
      this.lastPageSymbol.set(sym);
      if (!sym) return;
      this.selectedSymbol.set('');
      this.checked.set(new Set());
      this.unchecked.set(new Set());
      // Refetch only when the loaded docs are for a different symbol —
      // onToggle may have already fetched this one while the page's
      // symbol assignment was still settling.
      if (this.panelOpen() && this.browsedSymbol() !== sym) {
        this.browsedSymbol.set(sym);
        this.store.loadSwingSets(sym);
      }
    });
  }

  /** Effective checked ids: explicit checks ∪ docs whose paramsId matches
   *  a live config slot for the current symbol (so the default 10/3 slots
   *  and any loaded N-set rows show checked), minus explicit unchecks. */
  readonly effectiveChecked = computed<ReadonlySet<string>>(() => {
    const ids = new Set(this.checked());
    const slots = new Set(this.store.paramsIds());
    const sym = this.store.symbol();
    for (const d of this.savedSets()) {
      if (d.symbol === sym && slots.has(d.paramsId)) ids.add(d.id);
    }
    for (const id of this.unchecked()) ids.delete(id);
    return ids;
  });

  /** The symbol whose sets are shown — explicit selection or the page's
   *  current symbol. */
  readonly effectiveSymbol = computed(
    () => this.selectedSymbol() || this.store.symbol(),
  );

  /** Picker options — the tracked-symbols universe (nav-populated); falls
   *  back to the current symbol when that list hasn't loaded. The current
   *  symbol is always present. */
  readonly symbolOptions = computed(() => {
    const cur = this.store.symbol();
    const tracked = this.store.trackedSymbols();
    const list = tracked.length ? tracked : cur ? [cur] : [];
    return cur && !list.includes(cur) ? [cur, ...list] : list;
  });

  /** Docs for the selected symbol, newest savedAt first. */
  readonly sortedDocs = computed(() =>
    [...this.savedSets()].sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
  );

  /** The checked docs — newest-first like the visible list, so the
   *  loaded slot order matches what the user saw. Checks survive filter
   *  changes (a doc outside the filter stays selected). */
  readonly checkedDocs = computed(() => {
    const ids = this.effectiveChecked();
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
    this.panelOpen.set(open);
    if (!open) return;
    // Populate the symbol picker — no-op once trackedSymbols is loaded.
    this.store.loadTrackedSymbols();
    const sym = this.selectedSymbol() || this.store.symbol();
    // Load when there's nothing to show (a failed load or genuinely
    // empty result retries on the next expand) or when the loaded docs
    // are stale — nav moved the symbol while the panel was closed.
    const stale = this.browsedSymbol() !== sym;
    if (sym && !this.savedSetsLoading() && (this.savedSets().length === 0 || stale)) {
      this.browsedSymbol.set(sym);
      this.store.loadSwingSets(sym);
    }
  }

  /** Symbol switch — refetch that symbol's sets and drop stale checks. */
  onSymbolChange(event: Event): void {
    const sym = (event.target as HTMLSelectElement).value;
    this.selectedSymbol.set(sym);
    this.checked.set(new Set());
    this.unchecked.set(new Set());
    this.browsedSymbol.set(sym);
    this.store.loadSwingSets(sym);
  }

  onCheck(id: string, event: Event): void {
    const on = (event.target as HTMLInputElement).checked;
    const next = new Set(this.checked());
    const un = new Set(this.unchecked());
    if (on) {
      next.add(id);
      un.delete(id);
    } else {
      next.delete(id);
      un.add(id); // may be an auto-checked live-slot doc — remember the opt-out
    }
    this.checked.set(next);
    this.unchecked.set(un);
  }

  onLoad(): void {
    this.store.loadSwingSetsIntoSlots(this.checkedDocs());
  }
}
