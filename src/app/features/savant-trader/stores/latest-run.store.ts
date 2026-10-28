/**
 * Latest Run Store
 *
 * Read side of the scan latest-run cache (`st-scanner/latest-runs/items`)
 * — the scan-source dropdown's data for the chart-view page (#1232/#1258).
 * `loadLatestRuns()` snapshots once per page visit; no live subscription this
 * thread (a fresher run lands on the next visit — acceptable, noted in
 * the IMPL plan).
 */
import { computed, inject } from '@angular/core';
import {
  signalStore,
  withComputed,
  withMethods,
  withState,
  patchState,
} from '@ngrx/signals';

import { ScannerService } from '../services/scanner.service';
import { SCANNER_RECIPES } from '../scanner/scanner-recipes';
import { SCAN_SOURCE_PREFIX, type SymbolListFilter } from '../common/constants';
import type { RhSelectOption } from '../components/rh-select-menu/rh-select-menu.component';
import type { ScanLatestRun } from '@st/scanner';
import type { ScanResultRow } from '@robinhood-mcp/contracts';

/** Short PT timestamp for option labels — same format the run-history
 *  panel uses (staleness cue, not a full timestamp). */
const formatRanAt = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: 'America/Los_Angeles',
});

interface LatestRunState {
  latestRuns: Map<string, ScanLatestRun>;
}

const initialState: LatestRunState = {
  latestRuns: new Map(),
};

export const LatestRunStore = signalStore(
  { providedIn: 'root' },
  withState(initialState),
  withComputed(({ latestRuns }) => ({
    /** One dropdown option per catalog recipe with a cache doc —
     *  `{title} · {ranAt}`, plus `{rows}/{total}` when the run was
     *  truncated (TEST-FE: the label communicates the cap). Recipes
     *  without a doc aren't offered (nothing to show); non-catalog cache
     *  docs never produce an option (the label can't resolve a title). */
    scanOptions: computed<RhSelectOption<SymbolListFilter>[]>(() => {
      const runs = latestRuns();
      return SCANNER_RECIPES.flatMap((r) => {
        const run = runs.get(r.id);
        if (!run) return [];
        // Shape-valid doc with an unparseable ranAt — format() would
        // throw and brick the whole list; same skip posture as drift.
        const date = new Date(run.ranAt);
        if (Number.isNaN(date.getTime())) return [];
        const ranAt = formatRanAt.format(date);
        const cap = run.truncated && run.rows.length < run.totalItems
          ? ` · ${run.rows.length}/${run.totalItems}`
          : '';
        return [{ value: `${SCAN_SOURCE_PREFIX}${r.id}`, label: `${r.title} · ${ranAt}${cap}` }];
      });
    }),
  })),
  withMethods((store, service = inject(ScannerService)) => ({
    /** Snapshot the cache into the map. A failed read keeps the prior
     *  snapshot — a stale dropdown beats an empty one. */
    async loadLatestRuns(): Promise<void> {
      try {
        const runs = await service.listLatestRuns();
        patchState(store, {
          latestRuns: new Map(runs.map((r) => [r.recipeId, r])),
        });
      } catch (err) {
        // Same posture as drifted-doc skips — but logged like the
        // SymbolListStore reads.
        console.error('[LatestRunStore] load failed — keeping prior snapshot', err);
      }
    },
    /** Cached wire rows for a recipe — [] for unknown/uncached ids. */
    rowsFor(recipeId: string): ScanResultRow[] {
      return store.latestRuns().get(recipeId)?.rows ?? [];
    },
  })),
);
