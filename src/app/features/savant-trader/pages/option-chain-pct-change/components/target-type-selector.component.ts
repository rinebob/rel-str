/**
 * Target Type Selector Component
 *
 * Segmented button group for selecting the target date resolution mode:
 * - Pct Change: resolve target dates from percentage moves (list/gradation)
 * - Swing Extremes: stubbed, displays "Coming soon"
 * - User Dates: manual entry or interval generation
 *
 * Reads and writes the OptionChainPctChangeStore directly — the store is
 * the single source of truth for all config state. The only local state is
 * transient UI state: the raw pct-values text input and the working copy
 * of the target-dates list (so mid-edit values survive while the store is
 * only patched with committed rows).
 */
import { ChangeDetectionStrategy, Component, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatExpansionModule } from '@angular/material/expansion';

import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import { generateIntervalDates } from '../utils/pct-change-config.utils';
import type { TargetType, PctMode, UserDatesMode, PctDirection, ResolvePctChangeRequest } from '@shared/pct-change-config-contracts';

/** Parse a positive number from an input event. Returns null if invalid. */
function parsePositiveNumber(event: Event): number | null {
  const v = Number((event.target as HTMLInputElement).value);
  return Number.isFinite(v) && v > 0 ? v : null;
}

@Component({
  selector: 'app-target-type-selector',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, MatExpansionModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="target-type-selector">
      <!-- Segmented button group -->
      <div class="segmented-group">
        @for (opt of targetTypeOptions; track opt.value) {
          <button
            type="button"
            mat-stroked-button
            [class.active]="store.targetType() === opt.value"
            [attr.data-testid]="'target-type-btn-' + opt.value"
            (click)="store.setTargetType(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <!-- Pct Change mode -->
      @if (store.targetType() === 'pct-change') {
        <div class="sub-mode">
          <div class="mode-toggle" data-testid="pct-mode-toggle">
            <button
              type="button"
              mat-stroked-button
              [class.active]="store.pctMode() === 'list'"
              data-testid="pct-mode-list"
              (click)="store.setPctMode('list')"
            >
              List
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.active]="store.pctMode() === 'gradation'"
              data-testid="pct-mode-gradation"
              (click)="store.setPctMode('gradation')"
            >
              Gradation
            </button>
          </div>

          @if (store.pctMode() === 'list') {
            <div class="form-group">
              <label for="pct-values">Percentages (comma-separated)</label>
              <input
                id="pct-values"
                type="text"
                [value]="pctValuesInput()"
                data-testid="pct-values-input"
                (change)="onPctValuesInput($event)"
                placeholder="-3, 5, 10"
              />
            </div>
          } @else {
            <div class="form-group">
              <label for="pct-step">Step (%)</label>
              <input
                id="pct-step"
                type="number"
                [value]="store.pctStep()"
                data-testid="pct-step-input"
                (change)="onPctStepInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="pct-count">Count</label>
              <input
                id="pct-count"
                type="number"
                [value]="store.pctCount()"
                data-testid="pct-count-input"
                (change)="onPctCountInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="pct-direction">Direction</label>
              <select
                id="pct-direction"
                [value]="store.pctDirection()"
                data-testid="pct-direction-input"
                (change)="onPctDirectionInput($event)"
              >
                <option value="up">Up</option>
                <option value="down">Down</option>
              </select>
            </div>
          }

          <button
            type="button"
            mat-stroked-button
            data-testid="pct-resolve-btn"
            (click)="resolvePctChange()"
          >
            Resolve
          </button>
        </div>
      }

      <!-- Swing Extremes mode — stub until the ZigZag integration lands;
           the real param set isn't decided yet. -->
      @if (store.targetType() === 'swing-extremes') {
        <div class="sub-mode">
          <div class="coming-soon" data-testid="swing-coming-soon">
            Coming soon — ZigZag swing-extremes integration pending.
          </div>
        </div>
      }

      <!-- User Dates mode -->
      @if (store.targetType() === 'user-dates') {
        <div class="sub-mode">
          <div class="mode-toggle" data-testid="user-dates-mode-toggle">
            <button
              type="button"
              mat-stroked-button
              [class.active]="store.userDatesMode() === 'manual'"
              data-testid="user-dates-mode-manual"
              (click)="store.setUserDatesMode('manual')"
            >
              Manual
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.active]="store.userDatesMode() === 'interval'"
              data-testid="user-dates-mode-interval"
              (click)="store.setUserDatesMode('interval')"
            >
              Interval
            </button>
          </div>

          @if (store.userDatesMode() === 'manual') {
            <div class="add-date-row">
              <input
                #newDate
                type="date"
                data-testid="manual-date-input"
              />
              <button
                type="button"
                mat-stroked-button
                data-testid="manual-add-btn"
                (click)="addManualDate(newDate)"
              >
                Add
              </button>
            </div>
          } @else {
            <div class="form-group">
              <label for="interval-count">Count</label>
              <input
                id="interval-count"
                type="number"
                [value]="store.intervalCount()"
                data-testid="interval-count-input"
                (change)="onIntervalCountInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="interval-days">Interval (days)</label>
              <input
                id="interval-days"
                type="number"
                [value]="store.intervalDays()"
                data-testid="interval-days-input"
                (change)="onIntervalDaysInput($event)"
              />
            </div>
            <button
              type="button"
              mat-stroked-button
              data-testid="interval-generate-btn"
              (click)="generateInterval()"
            >
              Generate
            </button>
          }
        </div>
      }

      <!-- Editable target dates — in their own expansion panel so resolved
           dates are visible the moment they arrive (auto-expands on new
           input), and collapsible once reviewed. -->
      @if (targetDates().length > 0) {
        <mat-expansion-panel
          class="dates-panel"
          [expanded]="datesExpanded()"
          (opened)="datesExpanded.set(true)"
          (closed)="datesExpanded.set(false)"
        >
          <mat-expansion-panel-header>
            <mat-panel-title>Dates ({{ targetDates().length }})</mat-panel-title>
          </mat-expansion-panel-header>
          <div class="target-dates-list">
            <div class="target-dates-actions">
              <button
                type="button"
                mat-stroked-button
                data-testid="clear-target-dates"
                (click)="clearTargetDates()"
              >
                Clear All
              </button>
            </div>
            @for (dt of targetDates(); track $index) {
              <div class="target-date-row">
                <input
                  type="date"
                  [value]="dt"
                  [attr.data-testid]="'target-date-input-' + $index"
                  (change)="onTargetDateInput($index, $event)"
                />
                <button
                  type="button"
                  mat-icon-button
                  [attr.data-testid]="'remove-target-date-' + $index"
                  (click)="removeTargetDate($index)"
                  aria-label="Remove target date"
                >
                  <mat-icon>close</mat-icon>
                </button>
              </div>
            }
          </div>
        </mat-expansion-panel>
      }
    </div>
  `,
  styles: [`
    .target-type-selector {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .segmented-group {
      display: flex;
      gap: 8px;
    }

    .segmented-group button.active {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    .sub-mode {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 8px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
    }

    .mode-toggle {
      display: flex;
      gap: 8px;
    }

    .mode-toggle button.active {
      background: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .form-group label {
      font-size: 0.85rem;
      font-weight: 500;
    }

    .form-group input,
    .form-group select {
      padding: 4px 8px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
    }

    .add-date-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    .add-date-row input {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
    }

    .coming-soon {
      padding: 12px;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
      font-style: italic;
    }

    .target-dates-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .dates-panel {
      box-shadow: none;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
    }

    .dates-panel mat-expansion-panel-header {
      padding: 0 8px;
      --mat-expansion-header-collapsed-state-height: 36px;
      --mat-expansion-header-expanded-state-height: 36px;
    }

    .dates-panel ::ng-deep .mat-expansion-panel-body {
      padding: 0 8px 8px;
    }

    .target-dates-actions {
      display: flex;
      justify-content: flex-end;
      margin-bottom: 4px;
    }

    .target-dates-actions button {
      --mdc-outlined-button-container-height: 24px;
      padding: 0 8px;
      font-size: 0.75rem;
    }

    .target-date-row {
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .target-date-row input {
      flex: 1;
      padding: 4px 8px;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
      background: var(--mat-sys-surface);
      color: var(--mat-sys-on-surface);
    }
  `],
})
export class TargetTypeSelectorComponent {
  protected readonly store = inject(OptionChainPctChangeStore);

  /** Options for the segmented target type button group. */
  readonly targetTypeOptions: ReadonlyArray<{ value: TargetType; label: string }> = [
    { value: 'pct-change', label: 'Pct Change' },
    { value: 'swing-extremes', label: 'Swing Extremes' },
    { value: 'user-dates', label: 'User Dates' },
  ];

  /** Working copy of the dates list — synced from the store but allowed to
   *  hold mid-edit values (e.g. a cleared input) that aren't patched back. */
  private readonly _targetDates = signal<string[]>([]);
  /** Whether the Dates expansion panel is open. Auto-opens whenever a new
   *  non-empty date set arrives (resolve, generate, config load) so the
   *  user sees the result immediately. */
  readonly datesExpanded = signal(true);
  /** Raw text of the percentages input — parsed into the store's
   *  pctValues array on change. */
  readonly pctValuesInput = signal('');

  constructor() {
    // Store → working copies. untracked() keeps the effects' only
    // dependency the store value, so writing the local signal inside the
    // effect can't retrigger it.
    effect(() => {
      const incoming = this.store.targetDates();
      const current = untracked(this._targetDates);
      if (JSON.stringify(incoming) !== JSON.stringify(current)) {
        this._targetDates.set(incoming);
        // New dates arriving externally (resolve, config load) reopen the
        // panel so the result is visible even if the user collapsed it.
        if (incoming.length > 0) this.datesExpanded.set(true);
      }
    });
    effect(() => {
      const formatted = this.store.pctValues().join(', ');
      if (formatted !== untracked(this.pctValuesInput)) {
        this.pctValuesInput.set(formatted);
      }
    });
  }

  /** Read-only working list for the template. */
  readonly targetDates = this._targetDates.asReadonly();

  // -------------------------------------------------------------------------
  // Pct-change sub-mode
  // -------------------------------------------------------------------------

  onPctValuesInput(event: Event): void {
    this.pctValuesInput.set((event.target as HTMLInputElement).value);
    this.pushPctParams();
  }

  onPctStepInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) {
      this.store.setPctParams(this.parsedPctValues(), v, this.store.pctCount(), this.store.pctDirection());
    }
  }

  onPctCountInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) {
      this.store.setPctParams(this.parsedPctValues(), this.store.pctStep(), v, this.store.pctDirection());
    }
  }

  onPctDirectionInput(event: Event): void {
    const v = (event.target as HTMLSelectElement).value as PctDirection;
    if (v === 'up' || v === 'down') {
      this.store.setPctParams(this.parsedPctValues(), this.store.pctStep(), this.store.pctCount(), v);
    }
  }

  /** Persist the current pct-change params to the store. */
  private pushPctParams(): void {
    this.store.setPctParams(
      this.parsedPctValues(),
      this.store.pctStep(),
      this.store.pctCount(),
      this.store.pctDirection(),
    );
  }

  /** Ask the store to resolve dates from the current params. Always calls —
   *  the store validates and surfaces an error when nothing can be
   *  resolved, instead of silently doing nothing. */
  resolvePctChange(): void {
    const request: ResolvePctChangeRequest =
      this.store.pctMode() === 'list'
        ? { mode: 'list', values: this.parsedPctValues() }
        : {
            mode: 'gradation',
            values: [],
            step: this.store.pctStep(),
            count: this.store.pctCount(),
            direction: this.store.pctDirection(),
          };
    this.store.resolvePctChangeTargets(request);
  }

  /** Parse a comma-separated pct values string into a number array. */
  private parsedPctValues(): number[] {
    return this.pctValuesInput()
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  }

  // -------------------------------------------------------------------------
  // User-dates sub-mode
  // -------------------------------------------------------------------------

  onIntervalCountInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) this.store.setIntervalParams(v, this.store.intervalDays());
  }

  onIntervalDaysInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) this.store.setIntervalParams(this.store.intervalCount(), v);
  }

  /** Generate interval dates from the start date input. */
  generateInterval(): void {
    const start = this.store.startDate();
    if (!start) return;
    this.store.setTargetDates(
      generateIntervalDates(start, this.store.intervalCount(), this.store.intervalDays()),
    );
  }

  /** Add a manually-entered date. */
  addManualDate(input: HTMLInputElement): void {
    const value = input.value;
    if (!value) return;
    this.store.setTargetDates([...this._targetDates(), value]);
    input.value = '';
  }

  // -------------------------------------------------------------------------
  // Editable target dates
  // -------------------------------------------------------------------------

  onTargetDateInput(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    // Update the working copy immediately for responsive UI, but only
    // patch the store with non-empty values — the store filters empties,
    // which would make the row disappear mid-edit via the round-trip.
    const dates = [...this._targetDates()];
    dates[index] = value;
    this._targetDates.set(dates);
    if (value) {
      this.store.setTargetDates(dates);
    }
  }

  removeTargetDate(index: number): void {
    this.store.setTargetDates(this._targetDates().filter((_, i) => i !== index));
  }

  /** Clear all target dates at once. */
  clearTargetDates(): void {
    if (this._targetDates().length === 0) return;
    this.store.setTargetDates([]);
  }
}
