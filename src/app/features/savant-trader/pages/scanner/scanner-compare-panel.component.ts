/**
 * @topic #1098 — RH Scanner | @task #1141
 *
 * Compare panel — Add/Drop/Dead/No-data (+Unevaluated) bucket expandos
 * with counts and symbol chips that emit a row-focus request to the
 * page. Dumb component: the same shape renders the live compare
 * (CompareResult → buckets/unevaluated/dropDetail) AND a reopened
 * persisted proposal (CurationProposal — readOnly, no unevaluated).
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/** Normalized bucket payload — live CompareResult and persisted
 *  CurationProposal both map onto this (proposal: unevaluated absent,
 *  dropDetail optional). */
export interface ComparePanelData {
  addCandidates: readonly string[];
  dropCandidates: readonly string[];
  deadSymbols: readonly string[];
  noDataSymbols: readonly string[];
  /** Live compare only — tracked symbols whose screen verdict is
   *  unknown (rejected chunk); proposals don't persist it. */
  unevaluated?: readonly string[];
  dropDetail?: Record<string, Record<string, string>>;
}

interface BucketSection {
  key: string;
  label: string;
  symbols: readonly string[];
}

@Component({
  selector: 'app-scanner-compare-panel',
  standalone: true,
  imports: [CommonModule, MatButtonModule, MatIconModule],
  templateUrl: './scanner-compare-panel.component.html',
  styleUrl: './scanner-compare-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerComparePanelComponent {
  /** Buckets to render — null hides the panel. */
  readonly data = input.required<ComparePanelData | null>();
  /** Reopened-proposal mode: header banner + close button, chips still
   *  emit focus (the page focuses only symbols present in the table). */
  readonly readOnly = input(false);
  /** Optional heading + meta line (proposal detail: the page passes
   *  the recipe title and 'universe N · M matched · capped'). */
  readonly title = input<string | null>(null);
  readonly meta = input<string | null>(null);

  /** Symbol chip clicked — the page decides whether a row exists. */
  readonly focusSymbol = output<string>();
  /** Read-only close — the page clears the opened proposal. */
  readonly closed = output<void>();

  /** Per-instance id prefix — the page renders live + proposal panels
   *  simultaneously, so expando ids need a unique scope or
   *  aria-controls collides across instances. */
  protected readonly uid = `panel-${ScannerComparePanelComponent.nextId++}`;
  private static nextId = 0;

  private readonly expanded = signal<ReadonlySet<string>>(new Set());

  /** One section per non-empty bucket — an all-clear run renders the
   *  empty message instead of four zero-count expandos. Symbols are
   *  deduped — the engine never emits dups, but a hand-edited proposal
   *  doc could and `track sym` would NG0955. */
  protected readonly sections = computed<BucketSection[]>(() => {
    const d = this.data();
    if (!d) return [];
    const uniq = (s: readonly string[]) => [...new Set(s)];
    const out: BucketSection[] = [
      { key: 'add', label: 'Add', symbols: uniq(d.addCandidates) },
      { key: 'drop', label: 'Drop', symbols: uniq(d.dropCandidates) },
      { key: 'dead', label: 'Dead', symbols: uniq(d.deadSymbols) },
      { key: 'nodata', label: 'No-data', symbols: uniq(d.noDataSymbols) },
    ].filter((s) => s.symbols.length > 0);
    if (d.unevaluated?.length) {
      out.push({
        key: 'uneval',
        label: 'Unevaluated',
        symbols: uniq(d.unevaluated),
      });
    }
    return out;
  });

  protected readonly empty = computed(
    () => this.data() !== null && this.sections().length === 0,
  );

  protected isExpanded(key: string): boolean {
    return this.expanded().has(key);
  }

  protected toggle(key: string): void {
    const next = new Set(this.expanded());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.expanded.set(next);
  }

  /** Chip tooltip — drop candidates show the coverage values that
   *  failed them (proposal.dropDetail / compare.dropDetail). hasOwn —
   *  a ticker named 'constructor' would otherwise prototype-match. */
  protected chipTitle(sym: string): string {
    const dd = this.data()?.dropDetail;
    const detail = dd && Object.hasOwn(dd, sym) ? dd[sym] : undefined;
    if (!detail) return sym;
    const pairs = Object.entries(detail)
      .map(([k, v]) => `${k}: ${v === '' ? '—' : v}`)
      .join(' · ');
    return `${sym} — ${pairs}`;
  }
}
