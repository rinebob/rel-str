/**
 * @topic #1098 — RH Scanner | @task #1140
 *
 * Scanner page — recipe picker over the curated SCANNER_RECIPES catalog
 * (#1137), Run / Evaluate tracked actions, shown-of-matched status line
 * with truncation warning, and a dynamic-column results table (symbol /
 * name / tracked badge / recipe columns). All state lives in
 * ScannerStore (#1139); the compare panel + proposal history land in
 * #1141.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';

import { PREVIEW_SCAN_ROW_CAP } from '@robinhood-mcp/contracts';
import { ScannerStore } from '../../stores/scanner.store';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import {
  numericColumn,
  percentColumn,
  type ScanRow,
} from '../../utils/scanner-rows.util';

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './scanner.component.html',
  styleUrl: './scanner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerComponent {
  protected readonly store = inject(ScannerStore);
  private readonly mcp = inject(RobinhoodMcpObservationService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly reauthing = signal(false);

  /** Table columns — the active recipe's own column list (never hardcoded). */
  protected readonly columns = computed(
    () => this.store.activeRecipe()?.columns ?? [],
  );

  /** Rows ordered by the recipe's client-side ScanSort (#1137: the wire
   *  returns a Last-desc page; each recipe re-sorts within it). Missing
   *  metric values sink to the bottom regardless of direction. */
  protected readonly displayRows = computed<ScanRow[]>(() => {
    const recipe = this.store.activeRecipe();
    // Dedupe by normalized symbol, first-wins (same policy as the
    // compare engine's `seen` set) — a duplicated wire ticker would
    // otherwise hard-error the template's `track row.symbol` (NG0955),
    // and case/whitespace variants ('aapl'/'AAPL ') would render as
    // duplicate rows.
    const seen = new Set<string>();
    const rows = this.store.rows().filter((r) => {
      const key = r.symbol.trim().toUpperCase();
      return !seen.has(key) && !!seen.add(key);
    });
    const sort = recipe?.sort;
    if (!recipe || !sort) return rows;
    const dir = sort.direction === 'asc' ? 1 : -1;
    const lookup = this.lookup();
    rows.sort((a, b) => {
      const av = numericColumn(a, sort.column, lookup);
      const bv = numericColumn(b, sort.column, lookup);
      if (av === null && bv === null) return a.symbol.localeCompare(b.symbol);
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * dir || a.symbol.localeCompare(b.symbol);
    });
    return rows;
  });

  /** Status line — `matchedCount` is the wire's total_items under
   *  truncation, so it stays truthful past the row cap. Prune runs
   *  display coverage∪matched rows (they can outnumber the passers),
   *  so "shown of matched" would print N > M — the label switches to
   *  "rows · matched". */
  protected readonly statusLine = computed<string | null>(() => {
    const compare = this.store.compare();
    if (!compare) return null;
    const matched = this.store.matchedCount();
    let line: string;
    if (this.store.runKind() === 'eval') {
      // Prune display rows are coverage∪matched — rows that returned
      // data, NOT the evaluated universe (dead/chunk-failed symbols
      // were evaluated but produce no row). "evaluated" would
      // overcount; "shown of matched" would read N > M. "rows ·
      // matched" states both numbers without implying a subset.
      line = `${this.displayRows().length} rows`;
      if (matched !== null) line += ` · ${matched} matched`;
    } else {
      line = `${this.displayRows().length} shown`;
      if (matched !== null) line += ` of ${matched} matched`;
    }
    if (compare.truncated) {
      // isScanTruncated fires on both the full cap page and the
      // partial-page case (total_items > rows < cap) — the text
      // covers both without claiming which.
      line += ` — the ${PREVIEW_SCAN_ROW_CAP}-row page doesn't cover all matches; narrow the recipe for full coverage`;
    }
    return line;
  });

  /** Busy label — the evaluating signal ticks once per settled /batch
   *  group (binary progress, not per-chunk), so the text keeps it
   *  honest with a spinner + coarse count. */
  protected readonly progressLabel = computed(() => {
    const ev = this.store.evaluating();
    if (ev) {
      return ev.total > 0
        ? `Evaluating tracked symbols… ${ev.done}/${ev.total} chunks`
        : 'Evaluating tracked symbols…';
    }
    return 'Running scan…';
  });

  /** The run's effective column lookup — response-derived echo over the
   *  recipe's static map (falls back to the static map pre-run). */
  private lookup(): ReadonlyMap<string, string> | undefined {
    return this.store.columnLookup() ?? this.store.activeRecipe()?.columnLookup;
  }

  /** Cell text — fraction-scaled columns listed in the recipe's
   *  percentColumns render as `N.N%`; everything else renders the raw
   *  wire string (resolved through columnLookup first). */
  protected columnValue(row: ScanRow, displayName: string): string {
    const recipe = this.store.activeRecipe();
    const lookup = this.lookup();
    if (recipe?.percentColumns?.includes(displayName)) {
      const p = percentColumn(row, displayName, lookup);
      return p === null ? '—' : `${p.toFixed(1)}%`;
    }
    const key = lookup?.get(displayName) ?? displayName;
    const v: unknown = row.values[key] ?? row.values[displayName];
    if (v === undefined || v === null) return '—';
    // The wire strings every cell, but a drifted non-string value
    // (number/bool) would crash .trim() — render it, don't throw.
    return typeof v !== 'string' ? String(v) : v.trim() === '' ? '—' : v;
  }

  /** In-browser RH re-auth — same flow as signal-order's onReauth. */
  protected async onReauth(): Promise<void> {
    this.reauthing.set(true);
    this.snackBar.open('Opening Robinhood authorization in browser…', 'Dismiss', {
      duration: 4000,
    });
    try {
      const result = await this.mcp.reauthenticate();
      if (result.success) {
        this.snackBar.open('Robinhood re-authenticated — retry the scan', 'Dismiss', {
          duration: 4000,
        });
        this.store.clearError();
      } else {
        const detail = result.error ?? result.state ?? 'Authorization incomplete';
        this.snackBar.open(`Re-auth failed: ${detail}`, 'Dismiss', { duration: 6000 });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.snackBar.open(`Re-auth failed: ${msg}`, 'Dismiss', { duration: 6000 });
    } finally {
      this.reauthing.set(false);
    }
  }
}
