/**
 * SwingSettingsDialogComponent — the swing-analysis page's settings gear.
 *
 * Two-list config manager: the top "Available" section lists canned presets
 * plus the user's st-swing-configs library (activated with `+`, renamed via
 * `✎`, deleted with `×`); the bottom "Active" section renders one narrow
 * inline row per live config — 3 number inputs + color swatch + flag
 * checkboxes + Save/Clone/remove — so params are the row's identity. The
 * library loads lazily when the dialog opens. Symbol selection lives in the
 * nav row's tracked-only autocomplete, not here.
 */
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';

import { SwingAnalysisStore, SWING_PRESETS } from '../swing-analysis.store';
import type { SwingConfigDoc } from '../swing-analysis.types';
import { docConfigs, isConfigSet } from '../swing-analysis.types';
import type { ZigZagConfig } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';

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

@Component({
  selector: 'app-swing-settings-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
<h2 mat-dialog-title>Swing settings</h2>
<mat-dialog-content class="settings-content">
  @if (error()) {
    <div class="dialog-error" data-testid="dialog-error">{{ error() }}</div>
  }

  <!-- Available configs — presets + saved library; "+" activates into configs[]. -->
  <section class="available" data-testid="available-configs">
    <h3 class="section-heading">Available</h3>
    <div class="group-label">Presets</div>
    @for (preset of presets; track preset; let pi = $index) {
      <div class="lib-row" [attr.data-testid]="'preset-row-' + pi">
        <span class="swatch" [style.background-color]="preset.lineColor" aria-hidden="true"></span>
        <span class="lib-summary">{{ paramSummary(preset) }}</span>
        <button
          class="row-btn"
          [attr.data-testid]="'preset-activate-' + pi"
          type="button"
          (click)="activateConfig(preset)"
        >+</button>
      </div>
    }
    @for (doc of savedPresets(); track doc.paramsId) {
      <div class="lib-row" [attr.data-testid]="'saved-preset-row-' + doc.paramsId">
        <span class="swatch" [style.background-color]="doc.config?.lineColor" aria-hidden="true"></span>
        @if (renamingParamsId() === doc.paramsId) {
          <input
            class="rename-input"
            [attr.data-testid]="'saved-rename-input-' + doc.paramsId"
            type="text"
            [value]="doc.name ?? ''"
            [placeholder]="doc.config ? paramSummary(doc.config) : ''"
            (keydown.enter)="onRenameSaved(doc, $event)"
            (blur)="onRenameSaved(doc, $event)"
          />
        } @else {
          @if (doc.name) {
            <span class="lib-name">{{ doc.name }}</span>
            <span class="lib-summary">{{ doc.config ? paramSummary(doc.config) : '' }}</span>
          } @else {
            <span class="lib-name">{{ doc.config ? paramSummary(doc.config) : '' }}</span>
          }
        }
        <button
          class="row-btn"
          [attr.data-testid]="'saved-preset-activate-' + doc.paramsId"
          type="button"
          (click)="activateConfig(doc.config!)"
        >+</button>
        <button
          class="row-btn"
          [attr.data-testid]="'saved-rename-' + doc.paramsId"
          type="button"
          title="Rename"
          (click)="renamingParamsId.set(doc.paramsId)"
        >✎</button>
        <button
          class="row-btn row-btn-danger"
          [attr.data-testid]="'saved-delete-' + doc.paramsId"
          type="button"
          (click)="onDeleteSaved(doc)"
        >×</button>
      </div>
    }
    <div class="group-label">Saved sets</div>
    @if (configLibraryLoading()) {
      <div class="lib-empty">Loading…</div>
    } @else if (savedSets().length === 0) {
      <div class="lib-empty" data-testid="library-empty">No saved sets</div>
    } @else {
      @for (doc of savedSets(); track doc.paramsId) {
        <div class="lib-row" [attr.data-testid]="'saved-row-' + doc.paramsId">
          <span class="set-badge" [attr.data-testid]="'saved-set-badge-' + doc.paramsId">{{ doc.configs?.length }}×cfg</span>
          @if (renamingParamsId() === doc.paramsId) {
            <input
              class="rename-input"
              [attr.data-testid]="'saved-rename-input-' + doc.paramsId"
              type="text"
              [value]="doc.name ?? ''"
              [placeholder]="setSummary(doc)"
              (keydown.enter)="onRenameSaved(doc, $event)"
              (blur)="onRenameSaved(doc, $event)"
            />
          } @else {
            <span class="lib-name">{{ doc.name ?? setSummary(doc) }}</span>
            <span class="lib-summary">{{ doc.name ? setSummary(doc) : '' }}</span>
          }
          <button
            class="row-btn"
            [attr.data-testid]="'saved-activate-' + doc.paramsId"
            type="button"
            title="Apply set — replaces active configs"
            (click)="applySet(doc)"
          >+</button>
          <button
            class="row-btn"
            [attr.data-testid]="'saved-rename-' + doc.paramsId"
            type="button"
            title="Rename"
            (click)="renamingParamsId.set(doc.paramsId)"
          >✎</button>
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

  <!-- Active configs — one narrow row per config; params are the identity. -->
  <section class="config-sections">
    <h3 class="section-heading">
      Active
      <span class="header-actions">
        <button
          class="row-btn save-btn"
          data-testid="save-set-btn"
          type="button"
          title="Save the whole active list as a config set"
          (click)="store.saveActiveSet()"
        >Save set</button>
        <button
          class="row-btn"
          data-testid="clone-all-btn"
          type="button"
          title="Duplicate every active config"
          (click)="store.cloneAllConfigs()"
        >Clone all</button>
        <button
          class="row-btn row-btn-danger"
          data-testid="clear-all-btn"
          type="button"
          title="Remove every active config"
          (click)="store.clearActiveConfigs()"
        >Clear</button>
      </span>
    </h3>
  @for (cfg of configs(); track $index; let i = $index) {
    <div class="active-row" [class.disabled]="!store.configEnabled()[i]" [attr.data-testid]="'active-row-' + i">
      <label class="chk" title="On/off — runtime only, not saved">
        <input
          [attr.data-testid]="'param-enabled-' + i"
          type="checkbox"
          [checked]="store.configEnabled()[i]"
          (change)="store.toggleActiveConfig(i)"
        />
      </label>
      <input
        [attr.data-testid]="'param-lineColor-' + i"
        class="swatch-input"
        type="color"
        [value]="cfg.lineColor"
        title="Line color"
        (input)="onColorParam(i, 'lineColor', $event)"
      />
      <input
        [attr.data-testid]="'param-devThreshold-' + i"
        class="num"
        type="number"
        title="Dev threshold"
        [attr.min]="numericBounds('devThreshold').min"
        [attr.max]="numericBounds('devThreshold').max"
        step="0.1"
        [value]="cfg.devThreshold"
        (change)="onNumberParam(i, 'devThreshold', $event)"
      />
      <input
        [attr.data-testid]="'param-leftDepth-' + i"
        class="num"
        type="number"
        title="Left depth"
        [attr.min]="numericBounds('leftDepth').min"
        [attr.max]="numericBounds('leftDepth').max"
        step="1"
        [value]="cfg.leftDepth"
        (change)="onNumberParam(i, 'leftDepth', $event)"
      />
      <input
        [attr.data-testid]="'param-rightDepth-' + i"
        class="num"
        type="number"
        title="Right depth"
        [attr.min]="numericBounds('rightDepth').min"
        [attr.max]="numericBounds('rightDepth').max"
        step="1"
        [value]="cfg.rightDepth"
        (change)="onNumberParam(i, 'rightDepth', $event)"
      />
      <label class="chk" title="Allow zigzag on one bar">
        <input
          [attr.data-testid]="'param-allowZigZagOnOneBar-' + i"
          type="checkbox"
          [checked]="cfg.allowZigZagOnOneBar"
          (change)="onBoolParam(i, 'allowZigZagOnOneBar', $event)"
        />
        <span>1bar</span>
      </label>
      <label class="chk" title="Show trigger dots">
        <input
          [attr.data-testid]="'param-showTriggerDots-' + i"
          type="checkbox"
          [checked]="cfg.showTriggerDots !== false"
          (change)="onBoolParam(i, 'showTriggerDots', $event)"
        />
        <span>trig</span>
      </label>
      <button
        [attr.data-testid]="'save-config-btn-' + i"
        class="row-btn save-btn"
        type="button"
        title="Save to library"
        (click)="onSaveToLibrary(i)"
      >Save</button>
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
      >×</button>
    </div>
  }
  </section>
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
      display: flex;
      align-items: center;
      margin: 0 0 2px;
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
      padding: 2px 8px;
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
    .dialog-error {
      padding: 8px 12px;
      font-size: 0.8rem;
      color: #b3261e;
      background: #fbeae9;
      border: 1px solid #f0c6c3;
      border-radius: 4px;
    }
    .row-btn {
      font-size: 0.72rem;
      padding: 1px 6px;
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
      gap: 4px;
    }
    .swatch {
      width: 12px;
      height: 12px;
      border-radius: 2px;
      border: 1px solid #999;
      flex-shrink: 0;
    }
    .set-badge {
      font-size: 0.65rem;
      font-weight: 700;
      color: #555;
      border: 1px solid #ccc;
      border-radius: 3px;
      padding: 0 3px;
      flex-shrink: 0;
    }
    .header-actions {
      margin-left: auto;
      display: flex;
      gap: 6px;
    }
    .rename-input {
      flex: 1;
      padding: 1px 6px;
      font-size: 0.8rem;
      border: 1px solid #ccc;
      border-radius: 4px;
      min-width: 0;
    }
    .active-row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 3px 8px;
      border: 1px solid #e4e4e4;
      border-radius: 4px;
      background: #fafafa;
      flex-wrap: wrap;
    }
    .active-row input.num {
      padding: 1px 4px;
      font-size: 0.78rem;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 52px;
    }
    .active-row input[type="color"].swatch-input {
      padding: 0;
      border: 1px solid #ccc;
      border-radius: 4px;
      width: 26px;
      height: 20px;
      cursor: pointer;
      flex-shrink: 0;
    }
    .chk {
      display: flex;
      align-items: center;
      gap: 3px;
      font-size: 0.72rem;
      color: #666;
      white-space: nowrap;
    }
    .active-row.disabled input.num,
    .active-row.disabled .swatch-input,
    .active-row.disabled .chk span {
      opacity: 0.45;
    }
    .save-btn {
      border-color: #1976d2;
      color: #1976d2;
      font-weight: 600;
    }
  `],
})
export class SwingSettingsDialogComponent implements OnDestroy {
  readonly store = inject(SwingAnalysisStore);

  readonly configs = this.store.configs;
  readonly configLibrary = this.store.configLibrary;
  readonly configLibraryLoading = this.store.configLibraryLoading;
  readonly error = this.store.error;

  /** Canned presets — the sweep set, highest→lowest devThreshold. */
  readonly presets = SWING_PRESETS;

  /** paramsId of the saved row currently in rename mode — null otherwise. */
  readonly renamingParamsId = signal<string | null>(null);

  /** Library single-config docs — render in the Presets group. Docs with
   *  no payload at all are malformed rows — filter them out. */
  readonly savedPresets = computed(() =>
    this.configLibrary().filter((d) => !isConfigSet(d) && !!d.config),
  );

  /** Library set docs — render in the Saved sets group. */
  readonly savedSets = computed(() => this.configLibrary().filter(isConfigSet));

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

  /** Activate a preset or library config — pushes a copy into configs[]. */
  activateConfig(cfg: ZigZagConfig): void {
    this.store.activateConfig({ ...cfg });
  }

  /** Apply a saved set — replaces the whole active list. */
  applySet(doc: SwingConfigDoc): void {
    this.store.applyConfigSet(doc);
  }

  /** Set row summary — joined member summaries, e.g. `dev10··· + dev3···`. */
  setSummary(doc: SwingConfigDoc): string {
    return docConfigs(doc).map((c) => this.paramSummary(c)).join(' + ');
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

  onSaveToLibrary(index: number): void {
    this.store.saveActiveConfig(index);
  }

  /** Commit a Saved-row rename — blank input clears the name (summary
   *  becomes the label again). Exits rename mode either way. */
  onRenameSaved(doc: SwingConfigDoc, event: Event): void {
    const value = (event.target as HTMLInputElement).value.trim();
    this.renamingParamsId.set(null);
    if (value === (doc.name ?? '') || (value === '' && !doc.name)) return;
    this.store.renameSavedConfig(doc, value || undefined);
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
