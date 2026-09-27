/**
 * SwingSettingsDialogComponent — the swing-analysis page's settings gear.
 *
 * Two-list config manager: the top "Available" section lists canned presets
 * plus the user's st-swing-configs library (activated with `+`, deleted with
 * `×`); the bottom "Active" section lists the N live configs with edit-expand
 * param controls, clone/remove row actions, and a save-to-library row. The
 * library loads lazily when the dialog opens. Symbol selection lives in the
 * nav row's tracked-only autocomplete, not here.
 */
import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

import { LARGE_CONFIG, SMALL_CONFIG, SwingAnalysisStore } from '../swing-analysis.store';
import type { SwingConfigDoc } from '../swing-analysis.types';
import type { ZigZagConfig } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';
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
  @if (error()) {
    <div class="dialog-error" data-testid="dialog-error">{{ error() }}</div>
  }
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

  <!-- Available configs — presets + saved library; "+" activates into configs[]. -->
  <section class="available" data-testid="available-configs">
    <h3 class="section-heading">Available</h3>
    <div class="group-label">Presets</div>
    @for (preset of presets; track preset.name; let pi = $index) {
      <div class="lib-row">
        <span class="lib-name">{{ preset.name }}</span>
        <span class="lib-summary">{{ paramSummary(preset.config) }}</span>
        <button
          class="row-btn"
          [attr.data-testid]="'preset-activate-' + pi"
          type="button"
          (click)="activateConfig(preset.config)"
        >+</button>
      </div>
    }
    <div class="group-label">Saved</div>
    @if (configLibraryLoading()) {
      <div class="lib-empty">Loading…</div>
    } @else if (configLibrary().length === 0) {
      <div class="lib-empty" data-testid="library-empty">No saved configs</div>
    } @else {
      @for (doc of configLibrary(); track doc.id) {
        <div class="lib-row" [attr.data-testid]="'saved-row-' + doc.paramsId">
          <span class="lib-name">{{ doc.name ?? paramSummary(doc.config) }}</span>
          <span class="lib-summary">{{ paramSummary(doc.config) }}</span>
          <button
            class="row-btn"
            [attr.data-testid]="'saved-activate-' + doc.paramsId"
            type="button"
            (click)="activateConfig(doc.config)"
          >+</button>
          <button
            class="row-btn row-btn-danger"
            [attr.data-testid]="'saved-delete-' + doc.paramsId"
            type="button"
            (click)="onDeleteSaved(doc)"
          >×</button>
        </div>
      }
    }
  </section>

  <!-- Active configs — N live slots; row actions + edit-expand param controls. -->
  <section class="config-sections">
    <h3 class="section-heading">Active</h3>
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
        <span class="row-actions">
          <button
            class="row-btn"
            [attr.data-testid]="'clone-config-btn-' + i"
            type="button"
            (click)="onClone(i, $event)"
          >Clone</button>
          <button
            class="row-btn row-btn-danger"
            [attr.data-testid]="'remove-config-btn-' + i"
            type="button"
            (click)="onRemove(i, $event)"
          >Remove</button>
        </span>
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

        <label class="control save-name">
          <span class="control-label">Save to library</span>
          <input
            #saveName
            [attr.data-testid]="'save-config-name-' + i"
            type="text"
            [placeholder]="paramSummary(cfg)"
          />
        </label>
        <button
          [attr.data-testid]="'save-config-btn-' + i"
          mat-raised-button
          color="primary"
          type="button"
          (click)="onSaveToLibrary(i, saveName.value)"
        >
          Save
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
    .section-heading {
      margin: 0 0 4px;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #555;
    }
    .available {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .group-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #888;
      margin-top: 4px;
    }
    .lib-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 8px;
      border: 1px solid #e4e4e4;
      border-radius: 4px;
      background: #fafafa;
    }
    .lib-name {
      font-size: 0.85rem;
      font-weight: 600;
    }
    .lib-summary {
      flex: 1;
      font-size: 0.75rem;
      color: #777;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lib-empty {
      padding: 4px 8px;
      font-size: 0.8rem;
      color: #888;
    }
    .control-symbol {
      display: flex;
      align-items: center;
      gap: 12px;
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
    .dialog-error {
      padding: 8px 12px;
      font-size: 0.8rem;
      color: #b3261e;
      background: #fbeae9;
      border: 1px solid #f0c6c3;
      border-radius: 4px;
    }
    .row-btn {
      font-size: 0.75rem;
      padding: 2px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      background: #fff;
      cursor: pointer;
    }
    .row-btn:hover {
      background: #f0f0f0;
    }
    .row-btn-danger {
      color: #b3261e;
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
    .row-actions {
      margin-left: auto;
      display: flex;
      gap: 6px;
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
    .control input[type="number"] {
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 100px;
    }
    .control input[type="text"] {
      padding: 4px 8px;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 200px;
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
  readonly configLibrary = this.store.configLibrary;
  readonly configLibraryLoading = this.store.configLibraryLoading;
  readonly error = this.store.error;

  /** Canned presets — display name + immutable template config. */
  readonly presets = [
    { name: 'Large', config: LARGE_CONFIG },
    { name: 'Small', config: SMALL_CONFIG },
  ] as const;

  /** Pending lineColor update awaiting the debounce window. */
  private pendingColor: { index: number; value: string } | null = null;
  /** Handle for the active debounce timer; null when no update is in flight. */
  private colorDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Lazy load — the saved group renders only after the dialog opens.
    this.store.loadConfigLibrary();
  }

  ngOnDestroy(): void {
    if (this.colorDebounceTimer !== null) clearTimeout(this.colorDebounceTimer);
  }

  /** Label for a config section — "Large Swings" or "Small Swings". */
  configLabel(index: number): string {
    return CONFIG_LABELS[index] ?? `Config ${index}`;
  }

  /** Compact param summary — fallback display for unnamed library docs and
   *  the save-name placeholder. Includes the flag params (paramsId segments)
   *  so two docs differing only in flags don't render identically. */
  paramSummary(cfg: ZigZagConfig): string {
    const trig = cfg.showTriggerDots !== false ? 'trigY' : 'trigN';
    const oneBar = cfg.allowZigZagOnOneBar ? '1barY' : '1barN';
    return `dev${cfg.devThreshold} L${cfg.leftDepth} R${cfg.rightDepth} ${oneBar} ${trig}`;
  }

  /** Numeric bounds for a param — single source of truth for template and handler. */
  numericBounds(key: NumericParam): { min: number; max: number } {
    return NUMERIC_BOUNDS[key];
  }

  onSymbol(event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim().toUpperCase();
    this.store.setSymbol(value);
  }

  /** Activate a preset or library config — pushes a copy into configs[]. */
  activateConfig(cfg: ZigZagConfig): void {
    this.store.activateConfig({ ...cfg });
  }

  onDeleteSaved(doc: SwingConfigDoc): void {
    this.store.deleteSavedConfig(doc.paramsId);
  }

  onClone(index: number, event: Event): void {
    event.preventDefault();
    this.store.cloneConfig(index);
  }

  onRemove(index: number, event: Event): void {
    event.preventDefault();
    this.store.removeActiveConfig(index);
  }

  onSaveToLibrary(index: number, name: string): void {
    const trimmed = (name ?? '').trim();
    this.store.saveActiveConfig(index, trimmed || undefined);
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
}
