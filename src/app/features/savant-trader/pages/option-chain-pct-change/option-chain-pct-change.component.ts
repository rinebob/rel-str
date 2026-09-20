/**
 * Option Chain Pct Change Page
 *
 * Left panel: input form (symbol, start date, target dates, type, filters).
 * Right panel: stacked grids (one per target date), loading/error states.
 *
 * Follows the existing options-strategy-dashboard.component pattern.
 */
import { Component, ChangeDetectionStrategy, inject, signal, computed, effect, OnInit, OnDestroy, HostListener } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';

import { UiStateService } from '../../../../core/services/ui-state.service';
import { OptionChainPctChangeStore } from './option-chain-pct-change.store';
import { PctChangeGridComponent } from './components/pct-change-grid.component';
import { TargetTypeSelectorComponent } from './components/target-type-selector.component';
import { ConfirmDialogComponent } from './components/confirm-dialog.component';
import { toNum, cellKey, CONTRACT_CHART_PANE_CLASS } from './utils/pct-change.utils';
import { DEFAULT_CELL_TEXT_MODE, type CellTextMode } from './utils/color-mapping.utils';
import { OptionType } from '@options-contract/contracts';
import { take } from 'rxjs';

@Component({
  selector: 'app-option-chain-pct-change',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    MatExpansionModule,
    PctChangeGridComponent,
    TargetTypeSelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pct-change-page" [class.fullscreen]="ui.fullscreen()">
      <div class="page-header">
        <h2>Option Chain % Change Grid</h2>
        <div class="header-actions">
          <label class="contrast-picker">
            Cell text
            <select [value]="contrastMode()" (change)="onContrastModeChange($event)">
              <option value="adaptive">Adaptive</option>
              <option value="bright">Bright</option>
              <option value="halo">Halo</option>
            </select>
          </label>
          <button
            mat-icon-button
            (click)="ui.toggleFullscreen()"
            [matTooltip]="ui.fullscreen() ? 'Exit fullscreen' : 'Fullscreen'"
          >
            <mat-icon>{{ ui.fullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
          </button>
        </div>
      </div>

      <div class="page-body">
        <div class="input-panel" [class.collapsed]="panelCollapsed()">
          <div class="panel-toolbar">
            <button
              type="button"
              mat-icon-button
              class="panel-collapse-btn"
              (click)="panelCollapsed.set(!panelCollapsed())"
              [matTooltip]="panelCollapsed() ? 'Expand panel' : 'Collapse panel'"
              aria-label="Toggle input panel"
            >
              <mat-icon>{{ panelCollapsed() ? 'chevron_right' : 'chevron_left' }}</mat-icon>
            </button>
          </div>
          <div class="form-group config-section">
            <label for="configSelect">Saved Config</label>
            <div class="config-controls">
              <select
                id="configSelect"
                [value]="store.selectedConfigId() ?? ''"
                (change)="onConfigSelect($event)"
              >
                <option value="">— Select —</option>
                @for (cfg of store.savedConfigs(); track cfg.id) {
                  <option [value]="cfg.id">{{ cfg.id }}</option>
                }
              </select>
              <button
                type="button"
                mat-stroked-button
                (click)="saveConfig()"
                [disabled]="!store.canRun()"
              >
                Save
              </button>
              <button
                type="button"
                mat-stroked-button
                (click)="deleteConfig()"
                [disabled]="!store.selectedConfigId()"
              >
                Delete
              </button>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label for="symbol">Symbol</label>
              <input
                id="symbol"
                type="text"
                [value]="store.symbol()"
                (change)="store.setSymbol(inputValue($event))"
                placeholder="QQQ"
              />
            </div>

            <div class="form-group">
              <label for="startDate">Start Date</label>
              <input
                id="startDate"
                type="date"
                [value]="store.startDate()"
                (change)="store.setStartDate(inputValue($event))"
              />
            </div>
          </div>

          <div class="form-group">
            <label>Type</label>
            <div class="type-toggle">
              <button
                type="button"
                mat-stroked-button
                [class.active]="store.type() === optionTypeCall"
                (click)="store.setType(optionTypeCall)"
              >
                Calls
              </button>
              <button
                type="button"
                mat-stroked-button
                [class.active]="store.type() === optionTypePut"
                (click)="store.setType(optionTypePut)"
              >
                Puts
              </button>
            </div>
          </div>

          <mat-expansion-panel
            class="panel-section"
            [expanded]="targetDatesExpanded()"
            (opened)="targetDatesExpanded.set(true)"
            (closed)="targetDatesExpanded.set(false)"
          >
            <mat-expansion-panel-header>
              <mat-panel-title>Target Dates</mat-panel-title>
            </mat-expansion-panel-header>

            <app-target-type-selector />
          </mat-expansion-panel>

          <mat-expansion-panel
            class="panel-section"
            [expanded]="filtersExpanded()"
            (opened)="filtersExpanded.set(true)"
            (closed)="filtersExpanded.set(false)"
          >
            <mat-expansion-panel-header>
              <mat-panel-title>Filters</mat-panel-title>
            </mat-expansion-panel-header>

          <div class="form-group">
            <label>Duration Range (days)</label>
            <div class="range-inputs">
              <input
                type="number"
                placeholder="Min"
                [value]="store.filter().durationGteDays ?? ''"
                (change)="store.setFilter({ durationGteDays: toNum(inputValue($event)) })"
              />
              <span>–</span>
              <input
                type="number"
                placeholder="Max"
                [value]="store.filter().durationLteDays ?? ''"
                (change)="store.setFilter({ durationLteDays: toNum(inputValue($event)) })"
              />
            </div>
          </div>

          <div class="form-group">
            <label>Strike Range</label>
            <div class="range-inputs">
              <input
                type="number"
                placeholder="Min"
                [value]="store.filter().strikeGte ?? ''"
                (change)="store.setFilter({ strikeGte: toNum(inputValue($event)) })"
              />
              <span>–</span>
              <input
                type="number"
                placeholder="Max"
                [value]="store.filter().strikeLte ?? ''"
                (change)="store.setFilter({ strikeLte: toNum(inputValue($event)) })"
              />
            </div>
          </div>

          <div class="form-group">
            <label>Delta Range</label>
            <div class="range-inputs">
              <input
                type="number"
                step="0.05"
                placeholder="Min"
                [value]="store.filter().deltaGte ?? ''"
                (change)="store.setFilter({ deltaGte: toNum(inputValue($event)) })"
              />
              <span>–</span>
              <input
                type="number"
                step="0.05"
                placeholder="Max"
                [value]="store.filter().deltaLte ?? ''"
                (change)="store.setFilter({ deltaLte: toNum(inputValue($event)) })"
              />
            </div>
          </div>
          </mat-expansion-panel>

          <div class="actions">
            <button
              type="button"
              mat-stroked-button
              [disabled]="!store.canRun() || store.loading()"
              (click)="store.runAnalysis()"
            >
              Run Analysis
            </button>
            <button type="button" mat-stroked-button (click)="store.reset()">
              Reset
            </button>
          </div>
        </div>

        <div class="results-panel">
          @if (store.loading()) {
            <mat-spinner />
          } @else if (store.error()) {
            <div class="error">{{ store.error() }}</div>
          } @else if (store.hasResults()) {
            @for (grid of store.grids(); track grid.targetDate) {
              <app-pct-change-grid
                [grid]="grid"
                [contrastMode]="contrastMode()"
                [linkedKey]="linkedKey()"
              />
            }
          } @else {
            <div class="placeholder">
              Enter a symbol, start date, and at least one target date, then click Run.
            </div>
          }
        </div>
      </div>
    </div>
  `,
  styles: [
    `
      .pct-change-page {
        display: flex;
        flex-direction: column;
        height: calc(100vh - 64px);
        min-height: 400px;
        overflow: hidden;
      }
      .pct-change-page.fullscreen {
        height: 100vh;
      }
      .page-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 0.5rem 1rem;
        border-bottom: 1px solid #e0e0e0;
        flex-shrink: 0;
      }
      .page-header h2 {
        margin: 0;
        font-size: 1.1rem;
      }
      .header-actions {
        display: flex;
        align-items: center;
        gap: 0.75rem;
      }
      .contrast-picker {
        display: flex;
        align-items: center;
        gap: 0.35rem;
        font-size: 0.75rem;
        color: #555;
      }
      .contrast-picker select {
        padding: 0.15rem 0.35rem;
        font-size: 0.75rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        background: #fff;
      }
      .page-body {
        display: flex;
        gap: 1.5rem;
        padding: 1rem;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .input-panel {
        width: 320px;
        flex-shrink: 0;
        padding: 1rem;
        background: #f9f9f9;
        border-radius: 6px;
        overflow-y: auto;
      }
      .panel-toolbar {
        display: flex;
        justify-content: flex-end;
        position: sticky;
        top: 0;
        z-index: 2;
        margin: -0.5rem -0.5rem 0.25rem;
      }
      .panel-collapse-btn {
        --mdc-icon-button-state-layer-size: 28px;
      }
      .input-panel.collapsed {
        width: 36px;
        padding: 0.25rem;
        overflow: hidden;
      }
      .input-panel.collapsed > :not(.panel-toolbar) {
        display: none;
      }
      .form-group {
        margin-bottom: 1rem;
      }
      /* Side-by-side field row — symbol + start date are narrow enough to
         share a line; labels stay stacked above their inputs. */
      .form-row {
        display: flex;
        gap: 0.75rem;
        align-items: flex-start;
      }
      .form-row .form-group {
        flex: 0 0 auto;
      }
      .form-group label {
        display: block;
        margin-bottom: 0.25rem;
        font-size: 0.8rem;
        font-weight: 600;
        color: #555;
      }
      .form-group input[type="text"],
      .form-group input[type="date"],
      .form-group input[type="number"] {
        box-sizing: border-box;
        width: 100%;
        padding: 0.35rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 0.85rem;
      }
      /* Symbol and start date only need a few characters — don't stretch
         them across the full panel width. */
      .form-group input#symbol {
        width: 100px;
      }
      .form-group input[type="date"] {
        width: 160px;
      }
      .config-section .config-controls {
        display: flex;
        gap: 0.25rem;
        align-items: center;
      }
      .config-section select {
        flex: 1;
        /* A select's intrinsic min-width is its longest <option> — override
           the flexbox min-width:auto default so a long config id shrinks the
           select instead of pushing Save/Delete out and scrolling. */
        min-width: 0;
        padding: 0.35rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 0.85rem;
      }
      .config-section .config-controls button {
        flex-shrink: 0;
      }
      .type-toggle {
        display: flex;
        gap: 0.5rem;
        width: 100%;
      }
      .type-toggle button {
        flex: 1;
        /* ~33% shorter than the default 40px outlined-button height */
        --mdc-outlined-button-container-height: 27px;
        padding: 0 8px;
      }
      .type-toggle button.active {
        background: #1976d2;
        color: white;
      }
      .panel-section {
        margin-bottom: 1rem;
      }
      .panel-section ::ng-deep .mat-expansion-panel-body {
        padding: 0 0.75rem 0.75rem;
      }
      .panel-section mat-expansion-panel-header {
        padding: 0 0.75rem;
        --mat-expansion-header-collapsed-state-height: 40px;
        --mat-expansion-header-expanded-state-height: 40px;
      }
      .range-inputs {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .range-inputs input {
        flex: 1;
        padding: 0.35rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 0.85rem;
      }
      .actions {
        display: flex;
        gap: 0.5rem;
        margin-top: 1rem;
      }
      .results-panel {
        flex: 1;
        overflow-y: auto;
        padding: 0.5rem;
      }
      .error {
        padding: 1rem;
        color: #d32f2f;
        background: #ffebee;
        border-radius: 4px;
        font-size: 0.85rem;
      }
      .placeholder {
        padding: 2rem;
        text-align: center;
        color: #999;
        font-size: 0.85rem;
      }
    `,
  ],
})
export class OptionChainPctChangeComponent implements OnInit, OnDestroy {
  readonly store = inject(OptionChainPctChangeStore);
  readonly ui = inject(UiStateService);
  private readonly dialog = inject(MatDialog);
  /** Whether the left input panel is collapsed to a slim rail. */
  readonly panelCollapsed = signal(false);
  /** Cell-text contrast mode — adaptive white text, brighter ramp
   *  endpoints, or a halo behind dark text on dark cells. */
  readonly contrastMode = signal<CellTextMode>(DEFAULT_CELL_TEXT_MODE);
  /** Expanded state for the Target Dates config panel. */
  readonly targetDatesExpanded = signal(true);
  /** Expanded state for the Filters config panel. */
  readonly filtersExpanded = signal(false);

  constructor() {
    // Reopen the Target Dates panel when a resolve lands — the nonce only
    // bumps on a successful resolve, so config select and manual edits
    // don't fight a user's collapsed panel.
    effect(() => {
      this.store.resolveNonce();
      this.targetDatesExpanded.set(true);
    });
  }
  protected readonly optionTypeCall = OptionType.CALL;
  protected readonly optionTypePut = OptionType.PUT;
  protected readonly toNum = toNum;

  /** Enter fullscreen on page load. */
  ngOnInit(): void {
    this.ui.setFullscreen(true);
    this.store.loadSavedConfigs();
  }

  /** Restore header when leaving the page. */
  ngOnDestroy(): void {
    this.ui.setFullscreen(false);
  }

  /**
   * Contract chart popup dismissal: any click outside the chart's overlay
   * pane clears the contract selection (and thus a pinned popup). Clicks
   * inside `.contract-chart-pane` are left alone so users can interact
   * with the chart; clicks inside *other* CDK panes (dialogs, selects)
   * count as outside. The grid's icon click stops propagation, so pinning
   * isn't undone by this listener.
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.(`.${CONTRACT_CHART_PANE_CLASS}`)) return;
    this.store.clearContractSelection();
    this.store.clearHighlight();
  }

  /** Read a string value from an input event. */
  inputValue(ev: Event): string {
    return (ev.target as HTMLInputElement | null)?.value ?? '';
  }

  /** Switch the grid's cell-text contrast mode. */
  onContrastModeChange(ev: Event): void {
    const v = this.inputValue(ev);
    if (v === 'adaptive' || v === 'bright' || v === 'halo') this.contrastMode.set(v);
  }

  /** The contract key (strike-expiration) of the highlighted contract —
   *  every grid outlines the matching cell, including the one that was
   *  clicked. Null when nothing is highlighted. */
  readonly linkedKey = computed(() => {
    const h = this.store.highlightedContract();
    return h ? cellKey(h.strike, h.expiration) : null;
  });

  /** Handle config dropdown selection change. Picking a saved config
   *  collapses the config panels so the loaded state is visible. */
  onConfigSelect(ev: Event): void {
    const value = (ev.target as HTMLSelectElement | null)?.value ?? '';
    if (value) {
      this.store.selectConfig(value);
      this.targetDatesExpanded.set(false);
      this.filtersExpanded.set(false);
    } else {
      this.store.deselectConfig();
    }
  }

  /** Save the current configuration. */
  saveConfig(): void {
    this.store.saveCurrentConfig();
  }

  /** Delete the currently selected configuration (with confirm dialog). */
  deleteConfig(): void {
    const id = this.store.selectedConfigId();
    if (!id) return;
    this.dialog
      .open(ConfirmDialogComponent, {
        data: { message: 'Delete this saved configuration?', confirmLabel: 'Delete' },
      })
      .afterClosed()
      .pipe(take(1))
      .subscribe((confirmed: boolean) => {
        if (confirmed) this.store.deleteConfig(id);
      });
  }
}
