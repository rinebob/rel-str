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
import { MatIconModule } from '@angular/material/icon';
import { OptionType } from '@options-contract/contracts';
import { PctChangeGridComponent } from './pct-change-grid.component';
import { buildGrids } from '../utils/pct-change.utils';
import type { PctChangeGrid } from '../utils/pct-change.utils';
import type { SwingCompareRun } from '../utils/swing-compare.utils';

@Component({
  selector: 'app-run-section',
  standalone: true,
  imports: [PctChangeGridComponent, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <!-- details IS the run container — the summary is the header row, so
         the expand/collapse control lives inside the group header instead
         of on its own row. -->
    <details
      class="run-section"
      [class.call]="run().type === optionTypeCall"
      [class.put]="run().type === optionTypePut"
      data-testid="run-details"
      (toggle)="onToggle($event)"
    >
      <summary class="run-header">
        <span class="run-title">
          <span class="run-num">Run {{ index() + 1 }}</span>
          {{ run().startDate }} → {{ run().targetDates.join(', ') }}
          <span class="run-type">{{ run().type }}</span>
        </span>
        <span class="run-header-actions">
          <span class="grids-label">grids ({{ run().targetDates.length }})</span>
          <mat-icon class="expand-icon">expand_more</mat-icon>
          <button
            type="button"
            class="remove-btn"
            data-testid="remove-run-btn"
            [attr.aria-label]="'Remove run ' + (index() + 1)"
            (click)="$event.preventDefault(); removed.emit(run().id)"
          >✕</button>
        </span>
      </summary>
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
  `,
  styles: [
    `
      /* Runs need to read as separate containers at a glance — heavy
         border, accent stripe, and a filled header band per run. */
      .run-section {
        border: 1.5px solid #90a4ae;
        border-radius: 6px;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
        overflow: hidden;
      }
      .run-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 8px 12px;
        background: #dde4ec;
        border-left: 5px solid #607d8b;
        font-size: 0.95rem; font-weight: 600;
        cursor: pointer;
        user-select: none;
        list-style: none;
      }
      .run-header::-webkit-details-marker { display: none; }
      .run-section.call .run-header { border-left-color: #2e7d32; }
      .run-section.put .run-header { border-left-color: #c62828; }
      .run-num { font-weight: 700; margin-right: 4px; }
      .run-header-actions {
        display: flex; align-items: center; gap: 8px; flex-shrink: 0;
      }
      .grids-label { font-size: 0.72rem; font-weight: 400; color: #555; }
      .expand-icon { font-size: 18px; width: 18px; height: 18px; transition: transform 0.15s; color: #555; }
      .run-section[open] .expand-icon { transform: rotate(180deg); }
      .run-type {
        margin-left: 8px; padding: 1px 8px;
        font-size: 0.72rem; font-weight: 700;
        border-radius: 10px; text-transform: uppercase;
        background: #607d8b; color: #fff;
      }
      .run-section.call .run-type { background: #2e7d32; }
      .run-section.put .run-type { background: #c62828; }
      .remove-btn {
        border: none; background: transparent; cursor: pointer;
        color: #999; font-size: 0.9rem; padding: 0 4px;
      }
      .remove-btn:hover { color: #c62828; }
      .run-body { padding: 8px 10px; border-top: 1px solid #b0bec5; }
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
  protected readonly optionTypeCall = OptionType.CALL;
  protected readonly optionTypePut = OptionType.PUT;

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
    if (!(event.currentTarget as HTMLDetailsElement).open) {
      this.open.set(false);
      return;
    }
    this.open.set(true);
    const r = this.run();
    this.store.ensureSnapshots([r.startDate, ...r.targetDates]);
  }
}
