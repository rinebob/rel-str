/**
 * Target Type Selector Component
 *
 * Segmented button group for selecting the target date resolution mode:
 * - Pct Change: resolve target dates from percentage moves (list/gradation)
 * - Swing Extremes: stubbed, displays "Coming soon"
 * - User Dates: manual entry or interval generation
 *
 * Resolved/generated dates are editable and emitted via targetDatesChange.
 * Target type changes are emitted via targetTypeChange.
 * Pct-change resolution is delegated to the store via resolvePctChangeRequest
 * (the store has access to LocalBarReadService for daily bars).
 */
import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, signal, SimpleChanges } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

import { generateIntervalDates } from '../utils/pct-change-config.utils';
import type { TargetType, PctMode, UserDatesMode, PctDirection } from '@shared/pct-change-config-contracts';

/** Payload emitted when the user requests pct-change resolution. */
export interface ResolvePctChangeRequest {
  mode: PctMode;
  values: number[];
  step?: number;
  count?: number;
  direction?: PctDirection;
}

@Component({
  selector: 'app-target-type-selector',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="target-type-selector">
      <!-- Segmented button group -->
      <div class="segmented-group">
        @for (opt of targetTypeOptions; track opt.value) {
          <button
            type="button"
            mat-stroked-button
            [class.active]="targetType() === opt.value"
            [attr.data-testid]="'target-type-btn-' + opt.value"
            (click)="selectTargetType(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <!-- Pct Change mode -->
      @if (targetType() === 'pct-change') {
        <div class="sub-mode">
          <div class="mode-toggle" data-testid="pct-mode-toggle">
            <button
              type="button"
              mat-stroked-button
              [class.active]="pctMode() === 'list'"
              data-testid="pct-mode-list"
              (click)="selectPctMode('list')"
            >
              List
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.active]="pctMode() === 'gradation'"
              data-testid="pct-mode-gradation"
              (click)="selectPctMode('gradation')"
            >
              Gradation
            </button>
          </div>

          @if (pctMode() === 'list') {
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
                [value]="pctStep()"
                data-testid="pct-step-input"
                (change)="onPctStepInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="pct-count">Count</label>
              <input
                id="pct-count"
                type="number"
                [value]="pctCount()"
                data-testid="pct-count-input"
                (change)="onPctCountInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="pct-direction">Direction</label>
              <select
                id="pct-direction"
                [value]="pctDirection()"
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

      <!-- Swing Extremes mode -->
      @if (targetType() === 'swing-extremes') {
        <div class="sub-mode">
          <div class="form-group">
            <label for="swing-count">Swing Count</label>
            <input
              id="swing-count"
              type="number"
              [value]="swingCount()"
              data-testid="swing-count-input"
              (change)="onSwingCountInput($event)"
              disabled
            />
          </div>
          <div class="form-group">
            <label for="swing-deviation">Deviation (%)</label>
            <input
              id="swing-deviation"
              type="number"
              [value]="swingDeviation()"
              data-testid="swing-deviation-input"
              (change)="onSwingDeviationInput($event)"
              disabled
            />
          </div>
          <div class="form-group">
            <label for="swing-depth">Depth</label>
            <input
              id="swing-depth"
              type="number"
              [value]="swingDepth()"
              data-testid="swing-depth-input"
              (change)="onSwingDepthInput($event)"
              disabled
            />
          </div>
          <div class="form-group">
            <label for="swing-backstep">Backstep</label>
            <input
              id="swing-backstep"
              type="number"
              [value]="swingBackstep()"
              data-testid="swing-backstep-input"
              (change)="onSwingBackstepInput($event)"
              disabled
            />
          </div>
          <div class="coming-soon" data-testid="swing-coming-soon">
            Coming soon — ZigZag swing-extremes integration pending.
          </div>
        </div>
      }

      <!-- User Dates mode -->
      @if (targetType() === 'user-dates') {
        <div class="sub-mode">
          <div class="mode-toggle" data-testid="user-dates-mode-toggle">
            <button
              type="button"
              mat-stroked-button
              [class.active]="userDatesMode() === 'manual'"
              data-testid="user-dates-mode-manual"
              (click)="selectUserDatesMode('manual')"
            >
              Manual
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.active]="userDatesMode() === 'interval'"
              data-testid="user-dates-mode-interval"
              (click)="selectUserDatesMode('interval')"
            >
              Interval
            </button>
          </div>

          @if (userDatesMode() === 'manual') {
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
                [value]="intervalCount()"
                data-testid="interval-count-input"
                (change)="onIntervalCountInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="interval-days">Interval (days)</label>
              <input
                id="interval-days"
                type="number"
                [value]="intervalDays()"
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

      <!-- Editable target dates -->
      @if (targetDatesSignal().length > 0) {
        <div class="target-dates-list">
          <label>Target Dates</label>
          @for (dt of targetDatesSignal(); track $index) {
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

    .target-dates-list > label {
      font-size: 0.85rem;
      font-weight: 500;
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
export class TargetTypeSelectorComponent implements OnChanges {
  // Inputs (mirrored to signals for OnPush reactivity)
  @Input() startDate = '';
  @Input() set targetDates(value: string[]) {
    this._targetDates.set(value ?? []);
  }
  get targetDates(): string[] {
    return this._targetDates();
  }

  @Output() targetTypeChange = new EventEmitter<TargetType>();
  @Output() targetDatesChange = new EventEmitter<string[]>();
  @Output() resolvePctChangeRequest = new EventEmitter<ResolvePctChangeRequest>();

  // Internal signals
  readonly targetType = signal<TargetType>('pct-change');
  readonly pctMode = signal<PctMode>('list');
  readonly userDatesMode = signal<UserDatesMode>('manual');
  private readonly _targetDates = signal<string[]>([]);
  readonly targetDatesSignal = this._targetDates.asReadonly();

  // Pct-change inputs
  readonly pctValuesInput = signal('-3, 5, 10');
  readonly pctStep = signal(5);
  readonly pctCount = signal(4);
  readonly pctDirection = signal<PctDirection>('up');

  // User-dates interval inputs
  readonly intervalCount = signal(5);
  readonly intervalDays = signal(5);

  // Swing-extremes inputs (disabled — coming soon)
  readonly swingCount = signal(3);
  readonly swingDeviation = signal(5);
  readonly swingDepth = signal(5);
  readonly swingBackstep = signal(5);

  /** Options for the segmented target type button group. */
  readonly targetTypeOptions: ReadonlyArray<{ value: TargetType; label: string }> = [
    { value: 'pct-change', label: 'Pct Change' },
    { value: 'swing-extremes', label: 'Swing Extremes' },
    { value: 'user-dates', label: 'User Dates' },
  ];

  ngOnChanges(_changes: SimpleChanges): void {
    // Inputs are mirrored via setters; no additional sync needed.
  }

  // -------------------------------------------------------------------------
  // Target type selection
  // -------------------------------------------------------------------------

  selectTargetType(type: TargetType): void {
    this.targetType.set(type);
    this.targetTypeChange.emit(type);
  }

  // -------------------------------------------------------------------------
  // Pct-change sub-mode
  // -------------------------------------------------------------------------

  selectPctMode(mode: PctMode): void {
    this.pctMode.set(mode);
  }

  onPctValuesInput(event: Event): void {
    this.pctValuesInput.set((event.target as HTMLInputElement).value);
  }

  onPctStepInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.pctStep.set(v);
  }

  onPctCountInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.pctCount.set(v);
  }

  onPctDirectionInput(event: Event): void {
    const v = (event.target as HTMLSelectElement).value as PctDirection;
    if (v === 'up' || v === 'down') this.pctDirection.set(v);
  }

  /** Parse pct values and emit a resolve request for the store to fulfill. */
  resolvePctChange(): void {
    if (this.pctMode() === 'list') {
      const values = this.parsePctValues(this.pctValuesInput());
      if (values.length === 0) return;
      this.resolvePctChangeRequest.emit({ mode: 'list', values });
    } else {
      const step = this.pctStep();
      const count = this.pctCount();
      const direction = this.pctDirection();
      if (step <= 0 || count <= 0) return;
      this.resolvePctChangeRequest.emit({ mode: 'gradation', values: [], step, count, direction });
    }
  }

  /** Parse a comma-separated pct values string into a number array. */
  private parsePctValues(input: string): number[] {
    return input
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => Number(s))
      .filter((n) => Number.isFinite(n));
  }

  // -------------------------------------------------------------------------
  // Swing-extremes sub-mode (disabled — coming soon)
  // -------------------------------------------------------------------------

  onSwingCountInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.swingCount.set(v);
  }

  onSwingDeviationInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.swingDeviation.set(v);
  }

  onSwingDepthInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.swingDepth.set(v);
  }

  onSwingBackstepInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.swingBackstep.set(v);
  }

  // -------------------------------------------------------------------------
  // User-dates sub-mode
  // -------------------------------------------------------------------------

  selectUserDatesMode(mode: UserDatesMode): void {
    this.userDatesMode.set(mode);
  }

  onIntervalCountInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.intervalCount.set(v);
  }

  onIntervalDaysInput(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v) && v > 0) this.intervalDays.set(v);
  }

  /** Generate interval dates from the start date input. */
  generateInterval(): void {
    if (!this.startDate) return;
    const dates = generateIntervalDates(
      this.startDate,
      this.intervalCount(),
      this.intervalDays(),
    );
    this._targetDates.set(dates);
    this.targetDatesChange.emit(dates);
  }

  /** Add a manually-entered date. */
  addManualDate(input: HTMLInputElement): void {
    const value = input.value;
    if (!value) return;
    const dates = [...this._targetDates(), value];
    this._targetDates.set(dates);
    this.targetDatesChange.emit(dates);
    input.value = '';
  }

  // -------------------------------------------------------------------------
  // Editable target dates
  // -------------------------------------------------------------------------

  onTargetDateInput(index: number, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    const dates = [...this._targetDates()];
    dates[index] = value;
    this._targetDates.set(dates);
    this.targetDatesChange.emit(dates);
  }

  removeTargetDate(index: number): void {
    const dates = this._targetDates().filter((_, i) => i !== index);
    this._targetDates.set(dates);
    this.targetDatesChange.emit(dates);
  }
}
