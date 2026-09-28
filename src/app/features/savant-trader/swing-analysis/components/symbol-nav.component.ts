/**
 * SymbolNavComponent — prev/next stepping through the tracked-symbols
 * universe, optionally narrowed to a Symbol List. Sequencing lives in the
 * store's symbol-nav feature slice; this component owns the bindings and
 * the symbol-picker autocomplete.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal, viewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatAutocomplete, MatAutocompleteModule, MatAutocompleteSelectedEvent } from '@angular/material/autocomplete';

import { SwingAnalysisStore } from '../swing-analysis.store';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { SymbolListActionsComponent } from '../../components/symbol-list-actions/symbol-list-actions.component';
@Component({
  selector: 'app-symbol-nav',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, MatAutocompleteModule, SymbolListActionsComponent],
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
  <!-- Permanent tracked-only picker — TICKER — Name options, matches both. -->
  <input
    class="nav-picker"
    data-testid="nav-picker"
    type="text"
    [matAutocomplete]="ac"
    [disabled]="lists.trackedSymbols().length === 0"
    [value]="pickerText()"
    (input)="onPickerInput($event)"
    (keydown.enter)="onPickerEnter($event)"
    (keydown.escape)="onPickerEscape($event)"
    (blur)="onPickerBlur($event)"
    autocomplete="off"
    spellcheck="false"
  />
  <mat-autocomplete #ac="matAutocomplete" class="nav-picker-panel" (optionSelected)="onPick($event)">
    @for (o of filteredOptions(); track o.symbol) {
      <mat-option [value]="o.symbol" [attr.data-testid]="'nav-opt-' + o.symbol">
        <span class="nav-opt-sym">{{ o.symbol }}</span>
        @if (o.name) {
          <span class="nav-picker-name">— {{ o.name }}</span>
        }
      </mat-option>
    }
  </mat-autocomplete>
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
    <option value="ALL" [attr.selected]="store.navFilter() === 'ALL' ? '' : null">
      All symbols
    </option>
    @for (group of lists.filterOptionGroups(); track group.label) {
      <optgroup [label]="group.label">
        @for (f of group.options; track f.value) {
          <option [value]="f.value" [attr.selected]="f.value === store.navFilter() ? '' : null">
            {{ f.label }}
          </option>
        }
      </optgroup>
    }
  </select>
</div>
<!-- Watchlist chip triage — file the viewed symbol while paging. -->
<app-symbol-list-actions
  data-testid="nav-list-actions"
  [symbol]="store.symbol()"
  [listCatalog]="lists.catalog()"
  (toggleList)="onToggleList($event)"
/>
  `,
  styles: [`
    .symbol-nav {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 12px;
    }
    .nav-picker {
      font-size: 1.05rem;
      font-weight: 600;
      letter-spacing: 0.05em;
      width: 110px;
      text-align: center;
      text-transform: uppercase;
      padding: 3px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: transparent;
    }
    .nav-picker:focus { outline: none; border-color: var(--mat-sys-primary, #1976d2); }
    .nav-opt-sym { font-weight: 600; flex-shrink: 0; }
    .nav-picker-name { opacity: 0.65; }
    /* Panel renders in the overlay — must pierce encapsulation. Wide
       enough for 'TICKER — Company Name'; the name ellipsizes past
       max-width rather than pushing the panel wider. */
    ::ng-deep .nav-picker-panel {
      min-width: 320px;
      max-width: 480px;
    }
    ::ng-deep .nav-picker-panel .mat-mdc-option .mdc-list-item__primary-text {
      display: flex;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;
    }
    ::ng-deep .nav-picker-panel .nav-picker-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
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

  /** null = idle (input shows the current symbol); string = user's query. */
  private readonly query = signal<string | null>(null);
  protected readonly pickerText = computed(() => this.query() ?? this.store.symbol());

  /** Tracked options filtered by the query — substring match on ticker
   *  AND the profile display name (the name SOT — US-3). */
  protected readonly filteredOptions = computed(() => {
    const q = (this.query() ?? '').trim().toLowerCase();
    const profiles = this.lists.profilesBySymbol();
    const all = this.lists.trackedSymbols().map((s) => ({
      symbol: s,
      name: profiles.get(s)?.name ?? '',
    }));
    if (!q) return all;
    return all.filter(
      (o) => o.symbol.toLowerCase().includes(q) || o.name.toLowerCase().includes(q),
    );
  });

  private readonly ac = viewChild<MatAutocomplete>('ac');

  constructor() {
    // Populate the filter select + chips — the store no-ops when the
    // list stream is already open.
    this.lists.loadSymbolLists();
    // Profile names feed the picker's display text — dedupe makes this
    // free when the page already kicked off the load.
    this.lists.loadProfiles();
  }

  onFilter(event: Event): void {
    this.store.setNavFilter((event.target as HTMLSelectElement).value);
  }

  onPickerInput(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
  }

  onPick(event: MatAutocompleteSelectedEvent): void {
    // Option values are tracked symbols by construction. The subsequent
    // blur rewrites the input to the committed symbol.
    this.commitTracked(String(event.option.value ?? ''));
    this.query.set(null);
  }

  /** Enter commits an exact tracked ticker, or the single remaining
   *  filtered option (a substring that uniquely matches a name is treated
   *  as intent); anything else reverts to the current symbol. When the
   *  panel has a keyboard-highlighted option, optionSelected owns Enter —
   *  a deliberate highlight beats the raw query text. */
  onPickerEnter(event: Event): void {
    const ac = this.ac();
    if (ac?.isOpen && ac.options.some((o) => o.active)) return;
    const q = (this.query() ?? '').trim().toUpperCase();
    if (q && this.lists.trackedSymbols().includes(q)) {
      this.commitTracked(q);
      this.revertPicker(event.target as HTMLInputElement);
      return;
    }
    const options = this.filteredOptions();
    if (options.length === 1) {
      this.commitTracked(options[0].symbol);
      this.revertPicker(event.target as HTMLInputElement);
      return;
    }
    this.revertPicker(event.target as HTMLInputElement);
  }

  onPickerEscape(event: Event): void {
    this.revertPicker(event.target as HTMLInputElement);
    (event.target as HTMLInputElement).blur();
  }

  onPickerBlur(event: Event): void {
    this.revertPicker(event.target as HTMLInputElement);
  }

  /** Commit only a tracked symbol — untracked input never navigates. */
  private commitTracked(symbol: string): void {
    const s = symbol.trim().toUpperCase();
    if (s && s !== this.store.symbol() && this.lists.trackedSymbols().includes(s)) {
      this.store.setSymbol(s);
    }
  }

  /**
   * Clear the query and write the current symbol back into the DOM —
   * the [value] binding can't do this itself because pickerText() still
   * equals the previously bound value (typing never touched it).
   */
  private revertPicker(input: HTMLInputElement): void {
    this.query.set(null);
    input.value = this.store.symbol();
  }

  /** Chip toggle → exclusive list membership, persisted by the store. */
  onToggleList(event: { symbol: string; listKey: string }): void {
    this.lists.toggleSymbolInList(event.symbol, event.listKey);
  }
}
