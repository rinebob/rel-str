/**
 * Option Chain Pct Change Page
 *
 * Left panel: input form (symbol, start date, target dates, type, filters).
 * Right panel: stacked grids (one per target date), loading/error states.
 *
 * Follows the existing options-strategy-dashboard.component pattern.
 */
import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';

import { OptionChainPctChangeStore } from './option-chain-pct-change.store';
import { PctChangeGridComponent } from './components/pct-change-grid.component';
import { toNum } from './utils/pct-change.utils';
import { OptionType } from '@options-contract/contracts';

@Component({
  selector: 'app-option-chain-pct-change',
  standalone: true,
  imports: [
    MatButtonModule,
    MatProgressSpinnerModule,
    PctChangeGridComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pct-change-page">
      <div class="input-panel">
        <h2>Option Chain % Change Grid</h2>

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

        <div class="form-group">
          <label>Target Dates</label>
          <div class="target-dates">
            @for (dt of store.targetDates(); track dt) {
              <div class="target-date-chip">
                <span>{{ dt }}</span>
                <button
                  type="button"
                  mat-icon-button
                  (click)="store.removeTargetDate(dt)"
                  aria-label="Remove target date"
                >
                  ✕
                </button>
              </div>
            }
          </div>
          <div class="add-target">
            <input
              #newTargetDate
              type="date"
              (change)="addTargetDate(newTargetDate)"
            />
            <button
              type="button"
              mat-stroked-button
              (click)="addTargetDate(newTargetDate)"
            >
              Add
            </button>
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
  `,
  styles: [`
    .pct-change-page {
      display: flex;
      gap: 1.5rem;
      padding: 1rem;
      height: 100%;
      min-height: 400px;
    }

    .input-panel {
      width: 280px;
      flex-shrink: 0;
      padding: 1rem;
      background: #f9f9f9;
      border-radius: 6px;
      overflow-y: auto;
    }

    .input-panel h2 {
      margin: 0 0 1rem;
      font-size: 1.1rem;
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

    .target-dates {
      display: flex;
      flex-wrap: wrap;
      gap: 0.25rem;
      margin-bottom: 0.5rem;
    }

    .target-date-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.2rem 0.4rem;
      background: #e3f2fd;
      border-radius: 12px;
      font-size: 0.75rem;
    }

    .target-date-chip button {
      width: 18px;
      height: 18px;
      line-height: 18px;
      font-size: 0.65rem;
    }

    .add-target {
      display: flex;
      gap: 0.25rem;
    }

    .add-target input {
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
  `],
})
export class OptionChainPctChangeComponent {
  readonly store = inject(OptionChainPctChangeStore);
  protected readonly optionTypeCall = OptionType.CALL;
  protected readonly optionTypePut = OptionType.PUT;
  protected readonly toNum = toNum;

  /** Add a target date from the date input element. */
  addTargetDate(input: HTMLInputElement): void {
    const value = input.value;
    if (value) {
      this.store.addTargetDate(value);
      input.value = '';
    }
  }

  /** Read a string value from an input event. */
  inputValue(ev: Event): string {
    return (ev.target as HTMLInputElement | null)?.value ?? '';
  }
}
