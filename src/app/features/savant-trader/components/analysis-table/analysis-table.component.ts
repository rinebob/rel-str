/**
 * Analysis Table (Thread #1059, task #1083) — generic manifest-driven
 * trade-row grid for the trading/analysis workbench. Columns come from
 * the ANALYSIS_COLUMNS manifest intersected with the loaded CSV's
 * headers; each column renders by its manifest kind, sorts through the
 * #1067 chain pattern (click cycles asc → desc → removed, shift+click
 * adds a key, aria-sort + Enter/Space), and filters through the
 * SliceFilter contract (enum/string → 'in' pickers, number → 'range',
 * date → 'dateRange'). Open/provisional rows are marked; the
 * include-open toggle + count + chips live in the toolbar so downstream
 * stats share the same closed-cohort default.
 *
 * Input-driven (no store dependency) so the grid can be reused on
 * trading/paper later.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';

import {
  ANALYSIS_COLUMNS,
  type AnalysisColumnDef,
  type SliceFilter,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';
import {
  distinctRowValues,
  type AnalysisSort,
} from '../../utils/analysis-rows.util';

export interface AnalysisSortToggle {
  column: keyof TradeAnalysisRow & string;
  additive: boolean;
}

@Component({
  selector: 'app-analysis-table',
  standalone: true,
  imports: [
    FormsModule,
    MatCheckboxModule,
    MatIconModule,
    MatMenuModule,
    MatSelectModule,
  ],
  templateUrl: './analysis-table.component.html',
  styleUrl: './analysis-table.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisTableComponent {
  /** Rows to render — already filtered + sorted by the caller. */
  rows = input.required<TradeAnalysisRow[]>();
  /** The visible universe before user filters (quarantined set) —
   *  denominator for the row count + source of 'in'-picker options. */
  universeRows = input.required<TradeAnalysisRow[]>();
  /** CSV header names actually present in the loaded dataset. */
  columns = input.required<string[]>();
  sorts = input.required<AnalysisSort[]>();
  filters = input.required<SliceFilter[]>();
  includeOpenRows = input(false);
  /** Rows the closed-cohort quarantine is hiding — toggle badge. */
  hiddenRowCount = input(0);

  sortToggled = output<AnalysisSortToggle>();
  filtersChanged = output<SliceFilter[]>();
  includeOpenRowsChanged = output<boolean>();

  // ── columns ──────────────────────────────────────────────────────────

  /** Manifest defs for the columns the CSV actually carries. */
  protected readonly columnDefs = computed(() => {
    const present = new Set(this.columns());
    return ANALYSIS_COLUMNS.filter((c) => present.has(c.key));
  });

  /** Keys hidden via the column picker — seeded from defaultVisible. */
  private readonly hidden = signal<Set<string>>(
    new Set(
      ANALYSIS_COLUMNS.filter((c) => !c.defaultVisible).map((c) => c.key),
    ),
  );

  protected readonly visibleDefs = computed(() =>
    this.columnDefs().filter((c) => !this.hidden().has(c.key)),
  );

  /** Filterable visible defs — drives the second header row. */
  protected isHidden(key: string): boolean {
    return this.hidden().has(key);
  }

  protected toggleHidden(key: string): void {
    const next = new Set(this.hidden());
    if (next.has(key)) next.delete(key);
    else next.add(key);
    this.hidden.set(next);
  }

  // ── distinct-value pickers ───────────────────────────────────────────

  /** 'in'-picker options per column — only values present in the
   *  universe, so a dead-end choice (e.g. OPEN under the quarantine)
   *  can't be picked. Enums keep canonical enumValues order. */
  protected optionsFor(col: AnalysisColumnDef): (string | number)[] {
    const present = new Set(distinctRowValues(this.universeRows(), col.key));
    return col.kind === 'enum' && col.enumValues
      ? col.enumValues.filter((v) => present.has(v))
      : [...present].sort((a, b) =>
          typeof a === 'number' && typeof b === 'number'
            ? a - b
            : String(a).localeCompare(String(b)),
        );
  }

  // ── sort headers (#1067 pattern) ─────────────────────────────────────

  protected toggleSort(
    col: AnalysisColumnDef,
    ev?: MouseEvent | KeyboardEvent | Event,
  ): void {
    const additive =
      ev instanceof MouseEvent || ev instanceof KeyboardEvent
        ? ev.shiftKey
        : false;
    this.sortToggled.emit({ column: col.key, additive });
  }

  protected sortAria(col: AnalysisColumnDef): 'ascending' | 'descending' | 'none' {
    const s = this.sorts().find((x) => x.column === col.key);
    return s ? (s.dir === 'asc' ? 'ascending' : 'descending') : 'none';
  }

  protected sortIcon(col: AnalysisColumnDef): string | null {
    const s = this.sorts().find((x) => x.column === col.key);
    return s ? (s.dir === 'asc' ? 'arrow_upward' : 'arrow_downward') : null;
  }

  protected sortRank(col: AnalysisColumnDef): number | null {
    if (this.sorts().length < 2) return null;
    const i = this.sorts().findIndex((x) => x.column === col.key);
    return i === -1 ? null : i + 1;
  }

  // ── per-column filters → chain edits ─────────────────────────────────

  private replaceColumnFilter(
    col: AnalysisColumnDef,
    next: SliceFilter | null,
  ): void {
    const rest = this.filters().filter((f) => f.column !== col.key);
    this.filtersChanged.emit(next ? [...rest, next] : rest);
  }

  /** Whether the column currently has an active filter — icon state. */
  protected hasFilter(col: AnalysisColumnDef): boolean {
    return this.filters().some((f) => f.column === col.key);
  }

  /** Current 'in' selection for a column (empty when unfiltered). */
  protected inValues(col: AnalysisColumnDef): (string | number)[] {
    const f = this.filters().find(
      (x) => x.column === col.key && x.op === 'in',
    );
    return f && f.op === 'in' ? [...f.value] : [];
  }

  setInFilter(col: AnalysisColumnDef, values: (string | number)[]): void {
    this.replaceColumnFilter(
      col,
      values.length === 0
        ? null
        : { column: col.key, op: 'in', value: values },
    );
  }

  protected rangeValue(
    col: AnalysisColumnDef,
    bound: 'min' | 'max' | 'from' | 'to',
  ): string {
    const f = this.filters().find(
      (x) => x.column === col.key && (x.op === 'range' || x.op === 'dateRange'),
    );
    if (!f) return '';
    if (f.op === 'range') {
      const v = bound === 'min' ? f.value.min : f.value.max;
      return v === undefined ? '' : String(v);
    }
    if (f.op === 'dateRange') {
      const v = bound === 'from' ? f.value.from : f.value.to;
      return v ?? '';
    }
    return '';
  }

  setRangeFilter(col: AnalysisColumnDef, bound: 'min' | 'max', raw: string): void {
    const f = this.filters().find(
      (x) => x.column === col.key && x.op === 'range',
    );
    const cur = f && f.op === 'range' ? f.value : {};
    const num = raw === '' ? undefined : Number(raw);
    const value = { ...cur, [bound]: num };
    this.replaceColumnFilter(
      col,
      value.min === undefined && value.max === undefined
        ? null
        : { column: col.key, op: 'range', value },
    );
  }

  setDateFilter(col: AnalysisColumnDef, bound: 'from' | 'to', raw: string): void {
    const f = this.filters().find(
      (x) => x.column === col.key && x.op === 'dateRange',
    );
    const cur = f && f.op === 'dateRange' ? f.value : {};
    const value = { ...cur, [bound]: raw === '' ? undefined : raw };
    this.replaceColumnFilter(
      col,
      value.from === undefined && value.to === undefined
        ? null
        : { column: col.key, op: 'dateRange', value },
    );
  }

  protected removeFilterAt(index: number): void {
    this.filtersChanged.emit(this.filters().filter((_, i) => i !== index));
  }

  protected resetFilters(): void {
    this.filtersChanged.emit([]);
  }

  /** Chip text — `Col: 2 values`, `Col: ≥ 3`, `Col: 2024-01-01 → …`. */
  protected chipLabel(f: SliceFilter): string {
    switch (f.op) {
      case 'in':
        return `${f.column}: ${f.value.length === 1 ? f.value[0] : `${f.value.length} values`}`;
      case 'range': {
        const { min, max } = f.value;
        if (min !== undefined && max !== undefined)
          return `${f.column}: ${min}–${max}`;
        return min !== undefined ? `${f.column}: ≥ ${min}` : `${f.column}: ≤ ${max}`;
      }
      case 'dateRange': {
        const { from, to } = f.value;
        if (from && to) return `${f.column}: ${from} → ${to}`;
        return from ? `${f.column}: ≥ ${from}` : `${f.column}: ≤ ${to}`;
      }
    }
  }

  // ── cells ────────────────────────────────────────────────────────────

  protected cellText(row: TradeAnalysisRow, col: AnalysisColumnDef): string {
    const v = row[col.key];
    if (v === null) return '—';
    if (col.kind === 'number') {
      return v.toLocaleString('en-US', { maximumFractionDigits: 3 });
    }
    return String(v);
  }

  protected cellClass(row: TradeAnalysisRow, col: AnalysisColumnDef): string {
    const cls = [`cell-${col.kind}`];
    if (col.kind === 'number') cls.push('mono');
    if (col.key === 'status') {
      const s = row.status;
      cls.push('status-chip');
      cls.push(
        s === 'CLOSED' ? 'status-closed' : s === 'OPEN' || s === 'PENDING' ? 'status-open' : 'status-other',
      );
    }
    if (col.key === 'tradeRetPct' || col.key === 'realizedPnl' || col.key === 'symbolMovePct') {
      const v = row[col.key];
      if (typeof v === 'number') cls.push(v > 0 ? 'positive' : v < 0 ? 'negative' : '');
    }
    return cls.join(' ');
  }

  /** Open/provisional + excluded-cohort rows get a marked row when the
   *  quarantine is lifted. */
  protected isProvisional(row: TradeAnalysisRow): boolean {
    return row.status !== 'CLOSED' || row.analysisCohort === 'excluded';
  }
}
