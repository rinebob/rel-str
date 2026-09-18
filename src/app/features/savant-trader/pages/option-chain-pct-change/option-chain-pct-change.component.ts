/**
 * Option Chain Pct Change Page
 *
 * Left panel: input form (symbol, start date, target dates, type, filters).
 * Right panel: stacked grids (one per target date), loading/error states.
 *
 * Follows the existing options-strategy-dashboard.component pattern.
 */
import { Component, ChangeDetectionStrategy, inject, OnInit, OnDestroy, HostListener } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';

import { UiStateService } from '../../../../core/services/ui-state.service';
import { OptionChainPctChangeStore } from './option-chain-pct-change.store';
import { PctChangeGridComponent } from './components/pct-change-grid.component';
import { TargetTypeSelectorComponent, type ResolvePctChangeRequest, type PctParamsChange, type IntervalParamsChange } from './components/target-type-selector.component';
import { ConfirmDialogComponent } from './components/confirm-dialog.component';
import { toNum } from './utils/pct-change.utils';
import { OptionType } from '@options-contract/contracts';
import type { TargetType, PctMode, UserDatesMode } from '@shared/pct-change-config-contracts';
import { take } from 'rxjs';

@Component({
  selector: 'app-option-chain-pct-change',
  standalone: true,
  imports: [
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressSpinnerModule,
    PctChangeGridComponent,
    TargetTypeSelectorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pct-change-page" [class.fullscreen]="ui.fullscreen()">
      <div class="page-header">
        <h2>Option Chain % Change Grid</h2>
        <button
          mat-icon-button
          (click)="ui.toggleFullscreen()"
          [matTooltip]="ui.fullscreen() ? 'Exit fullscreen' : 'Fullscreen'"
        >
          <mat-icon>{{ ui.fullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</mat-icon>
        </button>
      </div>

      <div class="page-body">
        <div class="input-panel">
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

          <app-target-type-selector
            [startDate]="store.startDate()"
            [targetDates]="store.targetDates()"
            [targetType]="store.targetType()"
            [pctMode]="store.pctMode()"
            [pctValues]="store.pctValues()"
            [pctStep]="store.pctStep()"
            [pctCount]="store.pctCount()"
            [pctDirection]="store.pctDirection()"
            [userDatesMode]="store.userDatesMode()"
            [intervalCount]="store.intervalCount()"
            [intervalDays]="store.intervalDays()"
            (targetTypeChange)="onTargetTypeChange($event)"
            (targetDatesChange)="onTargetDatesChange($event)"
            (resolvePctChangeRequest)="onResolvePctChangeRequest($event)"
            (pctModeChange)="onPctModeChange($event)"
            (pctParamsChange)="onPctParamsChange($event)"
            (userDatesModeChange)="onUserDatesModeChange($event)"
            (intervalParamsChange)="onIntervalParamsChange($event)"
          />

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
              <app-pct-change-grid [grid]="grid" />
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
      .page-body {
        display: flex;
        gap: 1.5rem;
        padding: 1rem;
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .input-panel {
        width: 280px;
        flex-shrink: 0;
        padding: 1rem;
        background: #f9f9f9;
        border-radius: 6px;
        overflow-y: auto;
      }
      .form-group {
        margin-bottom: 1rem;
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
        width: 100%;
        padding: 0.35rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 0.85rem;
      }
      .config-section .config-controls {
        display: flex;
        gap: 0.25rem;
        align-items: center;
      }
      .config-section select {
        flex: 1;
        padding: 0.35rem 0.5rem;
        border: 1px solid #ccc;
        border-radius: 4px;
        font-size: 0.85rem;
      }
      .type-toggle {
        display: flex;
        gap: 0.25rem;
      }
      .type-toggle button.active {
        background: #1976d2;
        color: white;
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
    if (target?.closest?.('.contract-chart-pane')) return;
    this.store.clearContractSelection();
  }

  /** Read a string value from an input event. */
  inputValue(ev: Event): string {
    return (ev.target as HTMLInputElement | null)?.value ?? '';
  }

  /** Handle target type change from the selector. */
  onTargetTypeChange(type: TargetType): void {
    this.store.setTargetType(type);
  }

  /** Handle target dates change from the selector. */
  onTargetDatesChange(dates: string[]): void {
    this.store.setTargetDates(dates);
  }

  /** Handle pct-change resolve request from the selector. */
  onResolvePctChangeRequest(request: ResolvePctChangeRequest): void {
    this.store.resolvePctChangeTargets(request);
  }

  /** Handle pct mode change from the selector. */
  onPctModeChange(mode: PctMode): void {
    this.store.setPctMode(mode);
  }

  /** Handle pct params change from the selector. */
  onPctParamsChange(params: PctParamsChange): void {
    this.store.setPctParams(params.values, params.step, params.count, params.direction);
  }

  /** Handle user-dates mode change from the selector. */
  onUserDatesModeChange(mode: UserDatesMode): void {
    this.store.setUserDatesMode(mode);
  }

  /** Handle interval params change from the selector. */
  onIntervalParamsChange(params: IntervalParamsChange): void {
    this.store.setIntervalParams(params.count, params.intervalDays);
  }

  /** Handle config dropdown selection change. */
  onConfigSelect(ev: Event): void {
    const value = (ev.target as HTMLSelectElement | null)?.value ?? '';
    if (value) {
      this.store.selectConfig(value);
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
