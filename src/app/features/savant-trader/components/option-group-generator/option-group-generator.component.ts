/**
 * Option Group Generator Drawer
 *
 * Right sidenav of the options-chart page (#1339, IMPL §FE-3). Drives the
 * page-scoped OptionGroupGeneratorStore end to end: axis inputs → Run →
 * availability preview → refine → Send-to-chart pair lines.
 *
 * The store is provided by the page so the drawer's form state survives
 * collapse/reopen and the page can read emitted lines + symbol state.
 */
import { Component, inject, computed, signal, output, effect, untracked, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';


import { MatIconModule } from '@angular/material/icon';

import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OptionGroupGeneratorStore } from '../../stores/option-group-generator.store';
import {
  toPairLines,
  type GeneratorOptionType,
  type GeneratorQueryState,
  type GeneratorRefineState,
} from '../../utils/option-group-generator.utils';

/** Empty input → no bound (the axis stays unconstrained). */
function numOrUndef(value: string | number | null): number | undefined {
  if (value === null || value === '') return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** Split a free-text expiry list on commas/whitespace into a date array. */
function parseExpiryList(text: string): string[] {
  return text.split(/[\s,;]+/).filter((d) => d !== '');
}

@Component({
  selector: 'app-option-group-generator',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatProgressSpinnerModule],
  templateUrl: './option-group-generator.component.html',
  styleUrl: './option-group-generator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class OptionGroupGeneratorComponent {
  readonly store = inject(OptionGroupGeneratorStore);

  /** One shared options instance — fields commit on blur so a mid-keystroke
   *  parse (e.g. '472.') can't rebind a truncated value into the input, and
   *  a per-binding literal would allocate + fire NgModel.ngOnChanges every
   *  CD pass. */
  readonly blurOpts = { updateOn: 'blur' } as const;

  /** Emitted pair lines — the page writes them into the pairs input and
   *  routes through the existing loadPlotted path. */
  readonly send = output<string[]>();
  /** Asks the page to close the drawer. */
  readonly close = output<void>();

  /** Free-text expiry lists live in local signals (typing commas must not
   *  reformat mid-keystroke); the blur commit writes the parsed list to the
   *  store so it persists. Re-seeded when the symbol (and therefore the
   *  persisted blob) swaps. */
  readonly queryExpiryText = signal('');
  readonly refineExpiryText = signal('');

  constructor() {
    effect(() => {
      // Keyed on symbol only — reading query/refine untracked keeps a
      // keystroke-triggered setQuery from re-seeding (clobbering) the text.
      this.store.symbol();
      untracked(() => this.reseedExpiryText());
    });
  }

  private reseedExpiryText(): void {
    this.queryExpiryText.set((this.store.query().expirations ?? []).join(', '));
    this.refineExpiryText.set((this.store.refine().expirations ?? []).join(', '));
  }

  /** Distinct empty states — never-ran vs ran-empty vs refined-to-zero. */
  readonly emptyMessage = computed(() => {
    if (!this.store.hasRun()) return 'Set axes and press Run to preview contracts.';
    if (this.store.records().length === 0)
      return 'Query returned no contracts — widen the query axes.';
    if (this.store.filtered().length === 0)
      return `All ${this.store.records().length} contracts filtered out — loosen refine bounds.`;
    return null;
  });

  /** Query and refine take the same axes — the scope selects the write. */
  onAxisNum(
    scope: 'query' | 'refine',
    field: 'strikeGte' | 'strikeLte' | 'strikeStep',
    value: string | number | null,
  ): void {
    const patch = { [field]: numOrUndef(value) };
    if (scope === 'query') this.store.setQuery(patch as Partial<GeneratorQueryState>);
    else this.store.setRefine(patch as Partial<GeneratorRefineState>);
  }

  onAxisDate(
    scope: 'query' | 'refine',
    field: 'expirationGte' | 'expirationLte' | 'firstObservedGte' | 'firstObservedLte',
    value: string,
  ): void {
    const patch = { [field]: value || undefined };
    if (scope === 'query') this.store.setQuery(patch as Partial<GeneratorQueryState>);
    else this.store.setRefine(patch as Partial<GeneratorRefineState>);
  }

  onAxisExpiries(scope: 'query' | 'refine', text: string): void {
    (scope === 'query' ? this.queryExpiryText : this.refineExpiryText).set(text);
    const patch = { expirations: parseExpiryList(text) };
    if (scope === 'query') this.store.setQuery(patch);
    else this.store.setRefine(patch);
  }

  onQueryType(value: GeneratorOptionType): void {
    this.store.setQuery({ type: value });
  }

  /** Refine type is optional — 'ALL' clears the bound. */
  onRefineType(value: 'ALL' | 'call' | 'put'): void {
    this.store.setRefine({ type: value === 'ALL' ? undefined : value });
  }

  onOpenDateChange(value: string): void {
    this.store.setOpenDate(value || null);
  }

  onRun(): void {
    void this.store.run();
  }

  /** Clear resets the stored expirations — the local text mirrors it
   *  (setSymbol covers the other external reset path via the effect). */
  onClear(): void {
    this.store.clear();
    this.reseedExpiryText();
  }

  /** Exact lines Send will emit — same derivation as `store.emit()` minus
   *  the `lastEmitted` side effect; memoized so the preview stays stable. */
  readonly sendLines = computed(() =>
    toPairLines(this.store.filtered(), this.store.openDate() ?? undefined),
  );
  readonly showLines = signal(false);

  onCopyLines(): void {
    void navigator.clipboard?.writeText(this.sendLines().join('\n'));
  }

  onSend(): void {
    const lines = this.store.emit();
    if (lines.length > 0) this.send.emit(lines);
  }
}
