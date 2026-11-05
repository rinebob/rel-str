/**
 * SymbolNavComponent — prev/next stepping through the tracked-symbols
 * universe, optionally narrowed to a Symbol List. Sequencing lives in the
 * store's symbol-nav feature slice; this component owns the bindings and
 * the symbol-picker autocomplete.
 */
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';


import { SwingAnalysisStore } from '../swing-analysis.store';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { SymbolListActionsComponent } from '../../components/symbol-list-actions/symbol-list-actions.component';
@Component({
  selector: 'app-symbol-nav',
  standalone: true,
  imports: [ SymbolListActionsComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<div class="symbol-nav">
  <button class="icon-btn"
 
 data-testid="nav-prev" title="Previous symbol"
 [disabled]="!navEnabled()"
 (click)="store.prevSymbol()"
 >
    <span class="dse-icon">navigate_before</span>
  </button>
  <!-- Permanent tracked-only picker — TICKER — Name options, matches both. -->
  <div class="dse-combobox nav-picker-combo">
    <input
      class="nav-picker"
      data-testid="nav-picker"
      type="text"
      role="combobox"
      [attr.aria-expanded]="panelOpen()"
      aria-controls="nav-picker-panel"
      [attr.aria-activedescendant]="activeIndex() >= 0 ? 'nav-opt-' + filteredOptions()[activeIndex()].symbol : null"
      [disabled]="lists.trackedSymbols().length === 0"
      [value]="pickerText()"
      (input)="onPickerInput($event)"
      (keydown)="onPickerKeydown($event)"
      (blur)="onPickerBlur($event)"
      autocomplete="off"
      spellcheck="false"
    />
    @if (panelOpen() && filteredOptions().length > 0) {
      <div class="combo-panel nav-picker-panel" id="nav-picker-panel" role="listbox">
        @for (o of filteredOptions(); track o.symbol; let i = $index) {
          <div class="combo-option"
            role="option"
            [id]="'nav-opt-' + o.symbol"
            [class.active]="i === activeIndex()"
            [class.selected]="o.symbol === store.symbol()"
            [attr.aria-selected]="o.symbol === store.symbol()"
            [attr.data-testid]="'nav-opt-' + o.symbol"
            (mousedown)="onPickOption(o.symbol); $event.preventDefault()"
          >
            <span class="nav-opt-sym">{{ o.symbol }}</span>
            @if (o.name) {
              <span class="nav-picker-name">— {{ o.name }}</span>
            }
          </div>
        }
      </div>
    }
  </div>
  <button class="icon-btn"
 
 data-testid="nav-next" title="Next symbol"
 [disabled]="!navEnabled()"
 (click)="store.nextSymbol()"
 >
    <span class="dse-icon">navigate_next</span>
  </button>
  <span class="nav-position" data-testid="nav-position">{{ store.navPosition() }}</span>
  <select
    class="nav-filter"
    data-testid="nav-filter" title="Nav sequence"
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
      border: 1px solid var(--ds-border-subtle);
      border-radius: 4px;
      background: transparent;
    }
    .nav-picker:focus { outline: none; border-color: var(--mat-sys-primary); }
    .nav-picker-combo { position: relative; }
    .nav-opt-sym { font-weight: 600; flex-shrink: 0; }
    .nav-picker-name { opacity: 0.65; }
    /* Wide enough for 'TICKER — Company Name'; the name ellipsizes past
       max-width rather than pushing the panel wider. */
    .nav-picker-panel {
      min-width: 320px;
      max-width: 480px;
    }
    .nav-picker-panel .combo-option {
      display: flex;
      gap: 8px;
      white-space: nowrap;
      overflow: hidden;
    }
    .nav-picker-panel .nav-picker-name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .nav-position {
      font-size: 0.8rem;
      color: var(--ds-on-surface-variant);
      min-width: 56px;
    }
    .nav-filter {
      margin-left: 8px;
      padding: 4px 8px;
      border: 1px solid var(--ds-border-subtle);
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

  /** Combobox panel state — open while the picker is focused and has options. */
  protected readonly panelOpen = signal(false);
  /** Keyboard-highlighted option index (-1 = none). */
  protected readonly activeIndex = signal(-1);

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
    this.panelOpen.set(true);
    this.activeIndex.set(-1);
  }

  onPickOption(symbol: string): void {
    // Option values are tracked symbols by construction. The subsequent
    // blur rewrites the input to the committed symbol.
    this.commitTracked(symbol);
    this.query.set(null);
    this.panelOpen.set(false);
    this.activeIndex.set(-1);
  }

  /** Unified key handling — arrows move the highlight, Enter commits it
   *  (or the query intent), Escape reverts. A deliberate highlight beats
   *  the raw query text, matching the old autocomplete's precedence. */
  onPickerKeydown(event: Event): void {
    const key = (event as KeyboardEvent).key;
    const options = this.filteredOptions();
    if (key === 'ArrowDown' || key === 'ArrowUp') {
      event.preventDefault();
      this.panelOpen.set(true);
      const delta = key === 'ArrowDown' ? 1 : -1;
      const next = this.activeIndex() + delta;
      this.activeIndex.set(Math.max(-1, Math.min(options.length - 1, next)));
      return;
    }
    if (key === 'Escape') {
      this.revertPicker(event.target as HTMLInputElement);
      this.panelOpen.set(false);
      (event.target as HTMLInputElement).blur();
      return;
    }
    if (key !== 'Enter') return;
    if (this.panelOpen() && this.activeIndex() >= 0 && options[this.activeIndex()]) {
      this.onPickOption(options[this.activeIndex()].symbol);
      this.revertPicker(event.target as HTMLInputElement);
      return;
    }
    const q = (this.query() ?? '').trim().toUpperCase();
    if (q && this.lists.trackedSymbols().includes(q)) {
      this.commitTracked(q);
      this.revertPicker(event.target as HTMLInputElement);
      return;
    }
    if (options.length === 1) {
      this.commitTracked(options[0].symbol);
      this.revertPicker(event.target as HTMLInputElement);
      return;
    }
    this.revertPicker(event.target as HTMLInputElement);
  }

  onPickerBlur(event: Event): void {
    this.panelOpen.set(false);
    this.activeIndex.set(-1);
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
