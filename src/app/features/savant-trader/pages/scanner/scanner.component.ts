/**
 * @topic #1098 — RH Scanner | @task #1199
 *
 * Scanner page — the auto-run overview (#1183), rail + detail layout
 * (winner of the ?variant= prototype: the rail IS the morning scoreboard
 * — one row per recipe with live status/count/top tickers — while the
 * detail pane shows the selected recipe's full sortable table). On mount
 * it fires `runAllRecipes` (one staggered preview_scan per catalog
 * recipe) and re-arms a 15-minute refresh interval. The page owns the
 * interval, the tracked-symbol set, and the selected recipe; the
 * per-recipe lifecycle (stagger, failure isolation, auth taxonomy) lives
 * in ScannerStore (#1198) and table rendering in
 * ScannerRecipeTableComponent (#1197). Single-run picker/compare/
 * proposal machinery stays in the store but is not surfaced here.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
  type OnDestroy,
  type OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';

import {
  idleRun,
  ScannerStore,
  type RecipeRunState,
} from '../../stores/scanner.store';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import type { ScannerRecipe } from '../../scanner/scanner-recipes';
import { normScanSymbol } from '../../utils/scanner-rows.util';
import { baselineSortedRows } from '../../utils/scanner-sort.util';
import { ScannerRecipeTableComponent } from './scanner-recipe-table.component';

/** Auto-refresh cadence — the PRD's 15-minute cycle. */
const SCAN_REFRESH_MS = 15 * 60 * 1000;

/** One scoreboard row in the rail — everything the morning glance needs
 *  without opening a table: the run (status drives the CSS dot class
 *  directly), hit count, and the top-of-order tickers (same baseline
 *  sort the detail table seeds). */
interface RailEntry {
  recipe: ScannerRecipe;
  run: RecipeRunState;
  count: string;
  tickers: string;
}

@Component({
  selector: 'app-scanner',
  standalone: true,
  imports: [
    CommonModule,
    MatButtonModule,
    MatIconModule,
    ScannerRecipeTableComponent,
  ],
  templateUrl: './scanner.component.html',
  styleUrl: './scanner.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScannerComponent implements OnInit, OnDestroy {
  protected readonly store = inject(ScannerStore);
  private readonly symbolLists = inject(SymbolListStore);
  private readonly mcp = inject(RobinhoodMcpObservationService);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly reauthing = signal(false);

  /** Tracked-universe membership for the table's badge column — the
   *  list store keeps `string[]`; the table matches on a Set. */
  protected readonly tracked = computed<ReadonlySet<string>>(
    () => new Set(this.symbolLists.trackedSymbols()),
  );

  /** Normalized tracked set for the rail's shared sort resolver. */
  private readonly trackedNorm = computed<ReadonlySet<string>>(
    () => new Set(Array.from(this.tracked(), normScanSymbol)),
  );

  /** Rail selection — null falls through to the first catalog recipe so
   *  the detail pane always has a target on first paint. */
  protected readonly selectedId = signal<string | null>(null);

  protected readonly currentId = computed(
    () => this.selectedId() ?? this.store.recipes()[0]?.id ?? null,
  );

  /** Per-recipe scoreboard rows — catalog order, all recipes including
   *  failures (a failed scan IS scoreboard state, not an absent row).
   *  Count follows the stale-render policy: a retained result keeps
   *  showing `N / M` through loading; error flags 'err' (the failure is
   *  the state — last-known tickers still render alongside it). */
  protected readonly railEntries = computed<RailEntry[]>(() =>
    this.store.recipes().map((recipe) => {
      // Same `?? idleRun()` fallback the store's own launchRecipe uses —
      // a recipe id without a runs entry degrades to queued, not a crash.
      const run = this.store.runs()[recipe.id] ?? idleRun();
      const rows = baselineSortedRows(recipe, run.result, this.trackedNorm());
      // Baseline sort is shared with the detail table (scanner-sort.util)
      // — rail top tickers are exactly the table's seeded top rows.
      let count: string;
      if (run.status === 'error') count = 'err';
      else if (run.result)
        count = `${rows.length} / ${run.result.total_items}`;
      else count = run.status === 'loading' ? '…' : '—';
      return {
        recipe,
        run,
        count,
        tickers: rows
          .slice(0, 4)
          .map((r) => r.symbol)
          .join(' · '),
      };
    }),
  );

  /** The entry the detail pane renders — the selected recipe. */
  protected readonly selectedEntry = computed<RailEntry | null>(
    () =>
      this.railEntries().find((e) => e.recipe.id === this.currentId()) ??
      null,
  );



  /** Max `ranAt` across recipe runs — the header's last-refresh readout. */
  protected readonly lastRefresh = computed<Date | null>(() => {
    let max: string | null = null;
    for (const run of Object.values(this.store.runs())) {
      if (run.ranAt !== null && (max === null || run.ranAt > max)) {
        max = run.ranAt;
      }
    }
    return max === null ? null : new Date(max);
  });

  /** The armed 15-min refresh interval — the page owns it (not the
   *  root store): a remount re-arms it and `ngOnDestroy` stops
   *  re-arming; an already-fired stagger wave still completes in the
   *  root-scoped store after the page is gone. */
  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    void this.symbolLists.loadTrackedSymbols();
    this.store.runAllRecipes();
    this.refreshTimer = setInterval(
      () => this.store.runAllRecipes(),
      SCAN_REFRESH_MS,
    );
  }

  ngOnDestroy(): void {
    if (this.refreshTimer !== null) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
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
        this.snackBar.open(
          'Robinhood re-authenticated — re-running the scans',
          'Dismiss',
          { duration: 4000 },
        );
        this.store.clearError();
        // authFailed clears per-recipe as each relaunch starts — a fresh
        // wave both dismisses the banner and restores the failed tables.
        this.store.runAllRecipes();
      } else {
        const detail = result.error ?? result.state ?? 'Authorization incomplete';
        this.snackBar.open(`Re-auth failed: ${detail}`, 'Dismiss', {
          duration: 6000,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.snackBar.open(`Re-auth failed: ${msg}`, 'Dismiss', { duration: 6000 });
    } finally {
      this.reauthing.set(false);
    }
  }
}
