/**
 * RunSection — one collapsible pct-change run. Collapsed by default;
 * expanding fills the shared snapshot cache (ensureSnapshots dedupes
 * cached/in-flight dates) and lazily renders one PctChangeGridComponent
 * per target date. Grids recompute live from the cache, so a second
 * expand after the fetch resolves just renders.
 *
 * The run's dates/type flow to the chart popup via seriesScope so a
 * run-grid cell charts the run's own start/target snapshots, not the
 * main-flow inputs.
 */
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { OptionChainPctChangeStore, type SeriesScope } from '../option-chain-pct-change.store';
import { PctChangeGridComponent } from './pct-change-grid.component';
import { buildGrids } from '../utils/pct-change.utils';
import type { PctChangeGrid } from '../utils/pct-change.utils';
import type { SwingCompareRun } from '../utils/swing-compare.utils';

@Component({
  selector: 'app-run-section',
  standalone: true,
  imports: [PctChangeGridComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="run-section">
      <div class="run-header">
        <span class="run-title">
          Run {{ index() + 1 }}: {{ run().startDate }} → {{ run().targetDates.join(', ') }}
          <span class="run-type">{{ run().type }}</span>
        </span>
        <button
          type="button"
          class="remove-btn"
          data-testid="remove-run-btn"
          [attr.aria-label]="'Remove run ' + (index() + 1)"
          (click)="removed.emit(run().id)"
        >✕</button>
      </div>
      <details class="run-details" data-testid="run-details" (toggle)="onToggle($event)">
        <summary class="run-summary">grids ({{ run().targetDates.length }})</summary>
        @if (open()) {
          <div class="run-body">
            @if (!snapshotsReady()) {
              <p class="run-placeholder" data-testid="run-loading">loading snapshots…</p>
            } @else {
              @if (startError(); as msg) {
                <p class="run-error" data-testid="run-start-error">
                  Start snapshot unavailable — {{ msg }}
                </p>
              }
              @for (d of failedDates(); track d) {
                <p class="run-error" data-testid="run-date-error">
                  {{ d }}: snapshot unavailable — {{ store.snapshotErrors()[d] }}
                  <button
                    type="button"
                    class="retry-btn"
                    data-testid="run-retry-btn"
                    (click)="store.ensureSnapshots([d])"
                  >retry</button>
                </p>
              }
              @for (grid of runGrids(); track grid.targetDate) {
                <app-pct-change-grid
                  [grid]="grid"
                  [linkedKey]="store.highlightedKey()"
                  [seriesScope]="scope()"
                />
              }
            }
          </div>
        }
      </details>
    </div>
  `,
  styles: [
    `
      .run-section { border: 1px solid #ddd; border-radius: 4px; }
      .run-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 6px 10px; background: #f7f7f7; font-size: 0.85rem;
      }
      .run-type { font-weight: 600; margin-left: 6px; text-transform: uppercase; }
      .remove-btn {
        border: none; background: transparent; cursor: pointer;
        color: #999; font-size: 0.9rem; padding: 0 4px;
      }
      .remove-btn:hover { color: #c62828; }
      .run-summary {
        padding: 4px 10px; font-size: 0.78rem; color: #666;
        cursor: pointer; user-select: none; border-top: 1px solid #eee;
      }
      .run-body { padding: 8px 10px; }
      .run-placeholder { color: #999; font-size: 0.8rem; margin: 0; }
      .run-error { color: #c62828; font-size: 0.8rem; margin: 0 0 4px; }
      .retry-btn {
        font-size: 0.7rem; padding: 0 6px; margin-left: 6px;
        cursor: pointer; border: 1px solid #ccc; border-radius: 4px;
        background: #fff;
      }
    `,
  ],
})
export class RunSectionComponent {
  readonly run = input.required<SwingCompareRun>();
  readonly index = input.required<number>();
  /** Emits the run id — parent calls store.removeRun. */
  readonly removed = output<string>();

  readonly store = inject(OptionChainPctChangeStore);

  /** Details open state — grids mount on expand and unmount on collapse
   *  (N runs × grids would be heavy if all stayed in the DOM). */
  readonly open = signal(false);

  /** The run's chart-popup scope — start/targets/type feed the mini-chart
   *  series instead of the main-flow inputs. */
  readonly scope = computed<SeriesScope>(() => ({
    startDate: this.run().startDate,
    targetDates: this.run().targetDates,
    type: this.run().type,
  }));

  /** True once the run's start date has resolved — landed in the shared
   *  cache OR recorded a fetch failure (distinguishes "still fetching"
   *  from "fetched" either way). */
  readonly snapshotsReady = computed(
    () =>
      this.run().startDate in this.store.snapshotCache() ||
      this.run().startDate in this.store.snapshotErrors(),
  );

  /** Start-date fetch failure message, if the start snapshot errored. */
  readonly startError = computed(
    () => this.store.snapshotErrors()[this.run().startDate] ?? null,
  );

  /** Target dates whose fetch failed — shown as error lines instead of
   *  an empty-skeleton grid. */
  readonly failedDates = computed(() =>
    this.run().targetDates.filter(
      (d) => !(d in this.store.snapshotCache()) && d in this.store.snapshotErrors(),
    ),
  );

  /** One pct-change grid per run target — pure recompute off the shared
   *  snapshot cache. Global filters apply (duration/strike/delta); the
   *  run's own option type overrides the main-flow filter type. Errored
   *  target dates are excluded — they render as error lines instead. */
  readonly runGrids = computed<PctChangeGrid[]>(() => {
    if (!this.open()) return [];
    const r = this.run();
    const filter = this.store.filter();
    const errors = this.store.snapshotErrors();
    const cache = this.store.snapshotCache();
    const targets = r.targetDates.filter((d) => d in cache || !(d in errors));
    return buildGrids(
      cache,
      this.store.underlyingPrices(),
      { ...filter, type: r.type },
      r.startDate,
      targets,
    );
  });

  /** Fill the shared cache on every expand — ensureSnapshots dedupes
   *  cached and in-flight dates, so repeat opens are no-ops. */
  onToggle(event: Event): void {
    if (!(event.target as HTMLDetailsElement).open) {
      this.open.set(false);
      return;
    }
    this.open.set(true);
    const r = this.run();
    this.store.ensureSnapshots([r.startDate, ...r.targetDates]);
  }
}
