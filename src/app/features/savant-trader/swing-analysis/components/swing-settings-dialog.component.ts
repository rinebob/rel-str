/**
 * SwingSettingsDialogComponent — the swing-analysis page's settings gear.
 *
 * With pre-seeded swing sets driving most analysis, the manual controls
 * are secondary — they live in this dialog: symbol input, dual-mode
 * toggle, the N ZigZag config sections (params + save), and the batch
 * sweep. Opened via MatDialog from the page header's settings icon.
 */
import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

import { SwingAnalysisStore } from '../swing-analysis.store';
import { BatchSweepComponent } from './batch-sweep.component';

/** Numeric ZigZagConfig keys that accept number values. */
type NumericParam = 'devThreshold' | 'leftDepth' | 'rightDepth';

/** Boolean ZigZagConfig keys that accept boolean values. */
type BoolParam = 'allowZigZagOnOneBar' | 'showTriggerDots';

/** Per-param validation bounds for numeric inputs. */
const NUMERIC_BOUNDS: Record<NumericParam, { min: number; max: number }> = {
  devThreshold: { min: 0.1, max: 100 },
  leftDepth: { min: 2, max: 100 },
  rightDepth: { min: 2, max: 100 },
};

/** Labels for each config section — index 0 is the large/primary config. */
const CONFIG_LABELS = ['Large Swings', 'Small Swings'] as const;

@Component({
  selector: 'app-swing-settings-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, BatchSweepComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h2 mat-dialog-title>Swing settings</h2>
<mat-dialog-content class="settings-content">
  <section class="swing-analysis-controls">
    <label class="control control-symbol">
      <span class="control-label symbol-label">Symbol</span>
      <input
        data-testid="symbol-input"
        class="symbol-input"
        type="text"
        [value]="symbol()"
        (input)="onSymbol($event)"
        placeholder="AAPL"
      />
    </label>

    <label class="control control-checkbox">
      <input
        data-testid="dual-mode-toggle"
        type="checkbox"
        [checked]="dualMode()"
        (change)="onToggleDualMode($event)"
      />
      <span class="control-label">Dual Mode</span>
    </label>
  </section>

  <section class="config-sections">
  @for (cfg of configs(); track $index; let i = $index) {
    <details
      class="config-section"
      [attr.data-testid]="'config-section-' + i"
      open
    >
      <summary class="config-section-header">
        <span class="config-section-label">{{ configLabel(i) }}</span>
        <span
          class="config-section-swatch"
          [style.background-color]="cfg.lineColor"
          aria-hidden="true"
        ></span>
      </summary>

      <div class="config-controls">
        <label class="control">
          <span class="control-label">Dev Threshold</span>
          <input
            [attr.data-testid]="'param-devThreshold-' + i"
            type="number"
            [attr.min]="numericBounds('devThreshold').min"
            [attr.max]="numericBounds('devThreshold').max"
            step="0.1"
            [value]="cfg.devThreshold"
            (change)="onNumberParam(i, 'devThreshold', $event)"
          />
        </label>

        <label class="control">
          <span class="control-label">Left Depth</span>
          <input
            [attr.data-testid]="'param-leftDepth-' + i"
            type="number"
            [attr.min]="numericBounds('leftDepth').min"
            [attr.max]="numericBounds('leftDepth').max"
            step="1"
            [value]="cfg.leftDepth"
            (change)="onNumberParam(i, 'leftDepth', $event)"
          />
        </label>

        <label class="control">
          <span class="control-label">Right Depth</span>
          <input
            [attr.data-testid]="'param-rightDepth-' + i"
            type="number"
            [attr.min]="numericBounds('rightDepth').min"
            [attr.max]="numericBounds('rightDepth').max"
            step="1"
            [value]="cfg.rightDepth"
            (change)="onNumberParam(i, 'rightDepth', $event)"
          />
        </label>

        <label class="control">
          <span class="control-label">Line Color</span>
          <input
            [attr.data-testid]="'param-lineColor-' + i"
            type="color"
            [value]="cfg.lineColor"
            (input)="onColorParam(i, 'lineColor', $event)"
          />
        </label>

        <label class="control control-checkbox">
          <input
            [attr.data-testid]="'param-allowZigZagOnOneBar-' + i"
            type="checkbox"
            [checked]="cfg.allowZigZagOnOneBar"
            (change)="onBoolParam(i, 'allowZigZagOnOneBar', $event)"
          />
          <span class="control-label">Allow ZigZag on One Bar</span>
        </label>

        <label class="control control-checkbox">
          <input
            [attr.data-testid]="'param-showTriggerDots-' + i"
            type="checkbox"
            [checked]="cfg.showTriggerDots !== false"
            (change)="onBoolParam(i, 'showTriggerDots', $event)"
          />
          <span class="control-label">Trigger Dots</span>
        </label>

        <button
          [attr.data-testid]="'save-analysis-btn-' + i"
          mat-raised-button
          color="primary"
          [disabled]="!canSave(i)"
          (click)="onSave(i)"
        >
          Save {{ configLabel(i) }}
        </button>
      </div>
    </details>
  }
  </section>

  <!-- Batch sweep — same store orchestration, tucked inside settings. -->
  <app-batch-sweep />
</mat-dialog-content>
<mat-dialog-actions align="end">
  <button mat-button mat-dialog-close>Close</button>
</mat-dialog-actions>
  `,
  styles: [`
    .settings-content {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 640px;
    }
    .swing-analysis-controls {
      display: flex;
      gap: 24px;
      align-items: flex-end;
    }
    .control-symbol .symbol-label {
      font-size: 0.85rem;
      font-weight: 600;
      color: #333;
    }
    .control-symbol .symbol-input {
      font-size: 1.15rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      padding: 6px 10px;
      width: 140px;
    }
    .config-sections {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .config-section {
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow: hidden;
    }
    .config-section-header {
      display: flex;
      align-items: center;
      gap: 8px;
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
    .config-section-swatch {
      width: 16px;
      height: 16px;
      border-radius: 2px;
      border: 1px solid #999;
    }
    .config-controls {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-end;
      padding: 12px;
    }
    .control {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .control-checkbox {
      flex-direction: row;
      align-items: center;
      gap: 6px;
    }
    .control-label {
      font-size: 0.75rem;
      color: #666;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .control input[type="text"],
    .control input[type="number"] {
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 100px;
    }
    .control input[type="color"] {
      padding: 0;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 40px;
      height: 28px;
      cursor: pointer;
    }
  `],
})
export class SwingSettingsDialogComponent implements OnDestroy {
  readonly store = inject(SwingAnalysisStore);

  readonly symbol = this.store.symbol;
  readonly configs = this.store.configs;
  readonly dualMode = this.store.dualMode;
  readonly loading = this.store.loading;

  /** Pending lineColor update awaiting the debounce window. */
  private pendingColor: { index: number; value: string } | null = null;
  /** Handle for the active debounce timer; null when no update is in flight. */
  private colorDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  ngOnDestroy(): void {
    if (this.colorDebounceTimer !== null) clearTimeout(this.colorDebounceTimer);
  }

  /** Label for a config section — "Large Swings" or "Small Swings". */
  configLabel(index: number): string {
    return CONFIG_LABELS[index] ?? `Config ${index}`;
  }

  /** Numeric bounds for a param — single source of truth for template and handler. */
  numericBounds(key: NumericParam): { min: number; max: number } {
    return NUMERIC_BOUNDS[key];
  }

  /** Save is enabled for a config when a symbol is set and stats exist. */
  canSave(index: number): boolean {
    return this.symbol().length > 0 && this.store.stats()[index] != null && !this.loading();
  }

  onSymbol(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.store.setSymbol(value);
  }

  onToggleDualMode(event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    if (checked !== this.store.dualMode()) {
      this.store.toggleDualMode();
    }
  }

  onNumberParam(index: number, key: NumericParam, event: Event): void {
    const raw = (event.target as HTMLInputElement).value;
    if (raw === '') return;
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    const bounds = NUMERIC_BOUNDS[key];
    const clamped = Math.min(bounds.max, Math.max(bounds.min, value));
    this.store.updateConfig(index, { [key]: clamped });
  }

  onBoolParam(index: number, key: BoolParam, event: Event): void {
    const checked = (event.target as HTMLInputElement).checked;
    this.store.updateConfig(index, { [key]: checked });
  }

  /** Debounce the native color picker — it fires `input` continuously while
   *  dragging, and each event triggers a full pivots/swings/stats recompute
   *  in updateConfig. Hold the latest value for 300 ms (same window as the
   *  indicator-menu debounce) and apply once. */
  onColorParam(index: number, key: 'lineColor', event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.pendingColor = { index, value };
    if (this.colorDebounceTimer !== null) clearTimeout(this.colorDebounceTimer);
    this.colorDebounceTimer = setTimeout(() => {
      this.colorDebounceTimer = null;
      const pending = this.pendingColor;
      this.pendingColor = null;
      if (pending) this.store.updateConfig(pending.index, { [key]: pending.value });
    }, 300);
  }

  onSave(index: number): void {
    this.store.saveAnalysis(index);
  }
}
