/**
 * BatchSweepComponent — the collapsed "Batch Sweep" section.
 *
 * Paste a symbol list, run the page's current configs across all of them,
 * and save each result. Orchestration lives in SwingAnalysisStore.runBatch;
 * this component is pure wiring — the only local state is the textarea's
 * contents. The displayed symbol/chart is untouched by a sweep.
 */
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';

import { SwingAnalysisStore } from '../swing-analysis.store';
import { parseSymbols } from '../swing-batch';

@Component({
  selector: 'app-batch-sweep',
  standalone: true,
  imports: [MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<details class="batch-section" data-testid="batch-section">
  <summary class="batch-section-header">
    <span class="config-section-label">Batch Sweep</span>
    <span class="batch-hint">run + save current configs for a pasted symbol list</span>
  </summary>
  <div class="batch-body">
    <textarea
      data-testid="batch-symbols"
      class="batch-symbols"
      rows="3"
      placeholder="AAPL, MSFT, QQQ — comma, space, or newline separated"
      [value]="batchText()"
      (input)="onBatchText($event)"
    ></textarea>
    <div class="batch-actions">
      <button
        mat-raised-button
        color="primary"
        data-testid="run-batch-btn"
        [disabled]="!canRunBatch()"
        (click)="onRunBatch()"
      >
        Run batch
      </button>
      @if (batchRunning()) {
        <button
          mat-button
          data-testid="cancel-batch-btn"
          (click)="onCancelBatch()"
        >
          Cancel
        </button>
      }
    </div>
    @if (batchProgress().total > 0) {
      <div class="batch-progress" data-testid="batch-progress" aria-live="polite">
        {{ batchProgress().done }}/{{ batchProgress().total }}@if (batchProgress().current) { — {{ batchProgress().current }} }
      </div>
    }
    @if (batchResults().length > 0) {
      <ul class="batch-results" data-testid="batch-results">
        @for (r of batchResults(); track r.symbol) {
          <li [class.ok]="r.ok" [class.fail]="!r.ok">
            {{ r.ok ? '✓' : '✗' }} {{ r.symbol }}@if (r.error) { — {{ r.error }} }
          </li>
        }
      </ul>
    }
  </div>
</details>
  `,
  styles: [`
    .batch-section {
      display: block;
      border: 1px solid #ddd;
      border-radius: 4px;
      margin-bottom: 16px;
      overflow: hidden;
    }
    .batch-section-header {
      display: flex;
      align-items: baseline;
      gap: 10px;
      padding: 8px 12px;
      background: #f5f5f5;
      cursor: pointer;
      user-select: none;
    }
    .config-section-label {
      font-size: 0.85rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .batch-hint {
      font-size: 0.75rem;
      color: #888;
    }
    .batch-body {
      padding: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .batch-symbols {
      width: 100%;
      box-sizing: border-box;
      padding: 6px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      font-family: inherit;
      font-size: 0.85rem;
      resize: vertical;
    }
    .batch-actions {
      display: flex;
      gap: 8px;
      align-items: center;
    }
    .batch-progress {
      font-size: 0.85rem;
      color: #555;
    }
    .batch-results {
      margin: 0;
      padding: 0 0 0 4px;
      list-style: none;
      font-size: 0.85rem;
      max-height: 200px;
      overflow-y: auto;
    }
    .batch-results li.ok { color: #1b5e20; }
    .batch-results li.fail { color: #b71c1c; }
  `],
})
export class BatchSweepComponent {
  readonly store = inject(SwingAnalysisStore);

  /** Transient textarea contents — run state itself is the store's. */
  readonly batchText = signal('');
  readonly batchRunning = this.store.batchRunning;
  readonly batchProgress = this.store.batchProgress;
  readonly batchResults = this.store.batchResults;

  /** Run enabled when the text parses to at least one symbol and no
   *  sweep is in flight. Uses the same parseSymbols as runBatch so a
   *  separators-only paste can't enable a silent no-op. */
  canRunBatch(): boolean {
    return !this.batchRunning() && parseSymbols(this.batchText()).length > 0;
  }

  onBatchText(event: Event): void {
    this.batchText.set((event.target as HTMLTextAreaElement).value);
  }

  onRunBatch(): void {
    this.store.runBatch(this.batchText());
  }

  onCancelBatch(): void {
    this.store.cancelBatch();
  }
}
