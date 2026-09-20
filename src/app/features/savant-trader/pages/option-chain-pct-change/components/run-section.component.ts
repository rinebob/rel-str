/**
 * RunSection — one collapsible pct-change run. Task #424 ships the shell:
 * collapsed-by-default <details> with a run summary header; every expand
 * calls ensureSnapshots() to fill the shared snapshot cache for the run's
 * dates (the store dedupes cached/in-flight dates, so repeat expands are
 * no-ops). Task #425 adds the lazy pct-change grids inside.
 */
import { ChangeDetectionStrategy, Component, inject, input, output } from '@angular/core';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import type { SwingCompareRun } from '../utils/swing-compare.utils';

@Component({
  selector: 'app-run-section',
  standalone: true,
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
        <summary class="run-summary">grids</summary>
        <div class="run-body">
          <!-- #425: lazy pct-change grids per target date -->
          <p class="run-placeholder">grids load on expand (Task #425)</p>
        </div>
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
    `,
  ],
})
export class RunSectionComponent {
  readonly run = input.required<SwingCompareRun>();
  readonly index = input.required<number>();
  /** Emits the run id — parent calls store.removeRun. */
  readonly removed = output<string>();

  private readonly store = inject(OptionChainPctChangeStore);

  /** Fill the shared cache on every expand — ensureSnapshots dedupes
   *  cached and in-flight dates, so repeat opens are no-ops. */
  onToggle(event: Event): void {
    if (!(event.target as HTMLDetailsElement).open) return;
    const r = this.run();
    this.store.ensureSnapshots([r.startDate, ...r.targetDates]);
  }
}
