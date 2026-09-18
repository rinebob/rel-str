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

/** Payload emitted when pct-change sub-mode params change. */
export interface PctParamsChange {
  mode: PctMode;
  values: number[];
  step: number;
  count: number;
  direction: PctDirection;
}

/** Payload emitted when user-dates interval params change. */
export interface IntervalParamsChange {
  count: number;
  intervalDays: number;
}

/** Parse a positive number from an input event. Returns null if invalid. */
function parsePositiveNumber(event: Event): number | null {
  const v = Number((event.target as HTMLInputElement).value);
  return Number.isFinite(v) && v > 0 ? v : null;
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
            [class.active]="targetTypeSig() === opt.value"
            [attr.data-testid]="'target-type-btn-' + opt.value"
            (click)="selectTargetType(opt.value)"
          >
            {{ opt.label }}
          </button>
        }
      </div>

      <!-- Pct Change mode -->
      @if (targetTypeSig() === 'pct-change') {
        <div class="sub-mode">
          <div class="mode-toggle" data-testid="pct-mode-toggle">
            <button
              type="button"
              mat-stroked-button
              [class.active]="pctModeSig() === 'list'"
              data-testid="pct-mode-list"
              (click)="selectPctMode('list')"
            >
              List
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.active]="pctModeSig() === 'gradation'"
              data-testid="pct-mode-gradation"
              (click)="selectPctMode('gradation')"
            >
              Gradation
            </button>
          </div>

          @if (pctModeSig() === 'list') {
            <div class="form-group">
              <label for="pct-values">Percentages (comma-separated)</label>
              <input
                id="pct-values"
                type="text"
                [value]="pctValuesInputSig()"
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
                [value]="pctStepSig()"
                data-testid="pct-step-input"
                (change)="onPctStepInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="pct-count">Count</label>
              <input
                id="pct-count"
                type="number"
                [value]="pctCountSig()"
                data-testid="pct-count-input"
                (change)="onPctCountInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="pct-direction">Direction</label>
              <select
                id="pct-direction"
                [value]="pctDirectionSig()"
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
      @if (targetTypeSig() === 'swing-extremes') {
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
      @if (targetTypeSig() === 'user-dates') {
        <div class="sub-mode">
          <div class="mode-toggle" data-testid="user-dates-mode-toggle">
            <button
              type="button"
              mat-stroked-button
              [class.active]="userDatesModeSig() === 'manual'"
              data-testid="user-dates-mode-manual"
              (click)="selectUserDatesMode('manual')"
            >
              Manual
            </button>
            <button
              type="button"
              mat-stroked-button
              [class.active]="userDatesModeSig() === 'interval'"
              data-testid="user-dates-mode-interval"
              (click)="selectUserDatesMode('interval')"
            >
              Interval
            </button>
          </div>

          @if (userDatesModeSig() === 'manual') {
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
                [value]="intervalCountSig()"
                data-testid="interval-count-input"
                (change)="onIntervalCountInput($event)"
              />
            </div>
            <div class="form-group">
              <label for="interval-days">Interval (days)</label>
              <input
                id="interval-days"
                type="number"
                [value]="intervalDaysSig()"
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
      @if (targetDatesSig().length > 0) {
        <div class="target-dates-list">
          <label>Target Dates</label>
          @for (dt of targetDatesSig(); track $index) {
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
  @Input() targetDates: string[] = [];

  // Config-driven inputs — allow the parent to restore a saved config's
  // sub-mode state into the selector UI.
  @Input() targetType: TargetType = 'pct-change';
  @Input() pctMode: PctMode = 'list';
  @Input() pctValues: number[] = [];
  @Input() pctStep = 5;
  @Input() pctCount = 4;
  @Input() pctDirection: PctDirection = 'up';
  @Input() userDatesMode: UserDatesMode = 'manual';
  @Input() intervalCount = 5;
  @Input() intervalDays = 5;

  @Output() targetTypeChange = new EventEmitter<TargetType>();
  @Output() targetDatesChange = new EventEmitter<string[]>();
  @Output() resolvePctChangeRequest = new EventEmitter<ResolvePctChangeRequest>();
  @Output() pctModeChange = new EventEmitter<PctMode>();
  @Output() pctParamsChange = new EventEmitter<PctParamsChange>();
  @Output() userDatesModeChange = new EventEmitter<UserDatesMode>();
  @Output() intervalParamsChange = new EventEmitter<IntervalParamsChange>();

  // Internal signals (writable — driven by ngOnChanges and user interaction)
  private readonly _targetType = signal<TargetType>('pct-change');
  private readonly _pctMode = signal<PctMode>('list');
  private readonly _userDatesMode = signal<UserDatesMode>('manual');
  private readonly _targetDates = signal<string[]>([]);
  private readonly _pctValuesInput = signal('');
  private readonly _pctStep = signal(5);
  private readonly _pctCount = signal(4);
  private readonly _pctDirection = signal<PctDirection>('up');
  private readonly _intervalCount = signal(5);
  private readonly _intervalDays = signal(5);

  // Swing-extremes inputs (disabled — coming soon)
  readonly swingCount = signal(3);
  readonly swingDeviation = signal(5);
  readonly swingDepth = signal(5);
  readonly swingBackstep = signal(5);

  // Read-only views for the template
  readonly targetTypeSig = this._targetType.asReadonly();
  readonly pctModeSig = this._pctMode.asReadonly();
  readonly userDatesModeSig = this._userDatesMode.asReadonly();
  readonly targetDatesSig = this._targetDates.asReadonly();
  readonly pctValuesInputSig = this._pctValuesInput.asReadonly();
  readonly pctStepSig = this._pctStep.asReadonly();
  readonly pctCountSig = this._pctCount.asReadonly();
  readonly pctDirectionSig = this._pctDirection.asReadonly();
  readonly intervalCountSig = this._intervalCount.asReadonly();
  readonly intervalDaysSig = this._intervalDays.asReadonly();

  /** Options for the segmented target type button group. */
  readonly targetTypeOptions: ReadonlyArray<{ value: TargetType; label: string }> = [
    { value: 'pct-change', label: 'Pct Change' },
    { value: 'swing-extremes', label: 'Swing Extremes' },
    { value: 'user-dates', label: 'User Dates' },
  ];

  ngOnChanges(changes: SimpleChanges): void {
    // Use presence checks (`changes['x']`) consistently — truthy checks
    // silently drop falsy-but-valid values like empty arrays or 0.
    if (changes['targetDates']) {
      const incoming = changes['targetDates'].currentValue as string[] | undefined;
      // Don't echo back if value-equal — avoids clobbering user edits.
      if (incoming && JSON.stringify(incoming) !== JSON.stringify(this._targetDates())) {
        this._targetDates.set(incoming);
      }
    }
    if (changes['targetType']) {
      this._targetType.set(changes['targetType'].currentValue);
    }
    if (changes['pctMode']) {
      this._pctMode.set(changes['pctMode'].currentValue);
    }
    if (changes['pctValues']) {
      // Only reformat the text input on external changes (e.g. config load),
      // not when the store echoes back our own emitted values.
      const incoming = changes['pctValues'].currentValue as number[] | undefined;
      if (incoming) {
        const formatted = incoming.join(', ');
        if (formatted !== this._pctValuesInput()) {
          this._pctValuesInput.set(formatted);
        }
      }
    }
    if (changes['pctStep']) {
      this._pctStep.set(changes['pctStep'].currentValue);
    }
    if (changes['pctCount']) {
      this._pctCount.set(changes['pctCount'].currentValue);
    }
    if (changes['pctDirection']) {
      this._pctDirection.set(changes['pctDirection'].currentValue);
    }
    if (changes['userDatesMode']) {
      this._userDatesMode.set(changes['userDatesMode'].currentValue);
    }
    if (changes['intervalCount']) {
      this._intervalCount.set(changes['intervalCount'].currentValue);
    }
    if (changes['intervalDays']) {
      this._intervalDays.set(changes['intervalDays'].currentValue);
    }
  }

  // -------------------------------------------------------------------------
  // Target type selection
  // -------------------------------------------------------------------------

  selectTargetType(type: TargetType): void {
    this._targetType.set(type);
    this.targetTypeChange.emit(type);
  }

  // -------------------------------------------------------------------------
  // Pct-change sub-mode
  // -------------------------------------------------------------------------

  selectPctMode(mode: PctMode): void {
    this._pctMode.set(mode);
    this.pctModeChange.emit(mode);
  }

  onPctValuesInput(event: Event): void {
    this._pctValuesInput.set((event.target as HTMLInputElement).value);
    this.emitPctParamsChange();
  }

  onPctStepInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) {
      this._pctStep.set(v);
      this.emitPctParamsChange();
    }
  }

  onPctCountInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) {
      this._pctCount.set(v);
      this.emitPctParamsChange();
    }
  }

  onPctDirectionInput(event: Event): void {
    const v = (event.target as HTMLSelectElement).value as PctDirection;
    if (v === 'up' || v === 'down') {
      this._pctDirection.set(v);
      this.emitPctParamsChange();
    }
  }

  /** Emit the current pct-change params so the parent store can persist them. */
  private emitPctParamsChange(): void {
    this.pctParamsChange.emit({
      mode: this._pctMode(),
      values: this.parsePctValues(this._pctValuesInput()),
      step: this._pctStep(),
      count: this._pctCount(),
      direction: this._pctDirection(),
    });
  }

  /** Parse pct values and emit a resolve request for the store to fulfill. */
  resolvePctChange(): void {
    if (this._pctMode() === 'list') {
      const values = this.parsePctValues(this._pctValuesInput());
      if (values.length === 0) return;
      this.resolvePctChangeRequest.emit({ mode: 'list', values });
    } else {
      const step = this._pctStep();
      const count = this._pctCount();
      const direction = this._pctDirection();
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
    const v = parsePositiveNumber(event);
    if (v !== null) this.swingCount.set(v);
  }

  onSwingDeviationInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) this.swingDeviation.set(v);
  }

  onSwingDepthInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) this.swingDepth.set(v);
  }

  onSwingBackstepInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) this.swingBackstep.set(v);
  }

  // -------------------------------------------------------------------------
  // User-dates sub-mode
  // -------------------------------------------------------------------------

  selectUserDatesMode(mode: UserDatesMode): void {
    this._userDatesMode.set(mode);
    this.userDatesModeChange.emit(mode);
  }

  onIntervalCountInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) {
      this._intervalCount.set(v);
      this.emitIntervalParamsChange();
    }
  }

  onIntervalDaysInput(event: Event): void {
    const v = parsePositiveNumber(event);
    if (v !== null) {
      this._intervalDays.set(v);
      this.emitIntervalParamsChange();
    }
  }

  /** Emit the current interval params so the parent store can persist them. */
  private emitIntervalParamsChange(): void {
    this.intervalParamsChange.emit({
      count: this._intervalCount(),
      intervalDays: this._intervalDays(),
    });
  }

  /** Generate interval dates from the start date input. */
  generateInterval(): void {
    if (!this.startDate) return;
    const dates = generateIntervalDates(
      this.startDate,
      this._intervalCount(),
      this._intervalDays(),
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
    // Update local signal immediately for responsive UI, but only emit
    // non-empty values to the store — the store filters empties, which
    // would cause the row to disappear mid-edit via the round-trip.
    const dates = [...this._targetDates()];
    dates[index] = value;
    this._targetDates.set(dates);
    if (value) {
      this.targetDatesChange.emit(dates);
    }
  }

  removeTargetDate(index: number): void {
    const dates = this._targetDates().filter((_, i) => i !== index);
    this._targetDates.set(dates);
    this.targetDatesChange.emit(dates);
  }
}
