/**
 * @topic #137 — Strategy Builder UI
 *
 * Compact dialog form for creating and editing strategy instances.
 * Single-screen layout with small fields — no stepper.
 */
import { Component, ChangeDetectionStrategy, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup, Validators, AbstractControl, ValidationErrors } from '@angular/forms';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';

import { StrategyBuilderStore } from '../../stores/strategy-builder.store';
import { PositionSpreadType, StrategyFrequency, OptionType } from '@options/common';
import { TradeSide } from '@common';
import {
  ExitPolicy,
  LifecycleState,
  type StrategyInstanceConfig,
  type ExitPolicyConfig,
  type StrategyInstancePhase,
} from '@options-strategy-engine/contracts';
import { generateInstanceId } from '@options-strategy-engine/id';

@Component({
  selector: 'app-strategy-builder-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './strategy-builder-form.component.html',
  styleUrl: './strategy-builder-form.component.scss',
})
export class StrategyBuilderFormComponent {
  readonly store = inject(StrategyBuilderStore);
  private readonly fb = inject(FormBuilder);
  private readonly dialogRef = inject(MatDialogRef<StrategyBuilderFormComponent>);
  private readonly data = inject<{ instance: StrategyInstanceConfig | null }>(MAT_DIALOG_DATA);

  protected readonly spreadTypes = Object.values(PositionSpreadType);
  protected readonly frequencies = Object.values(StrategyFrequency);
  protected readonly exitPolicies = Object.values(ExitPolicy);
  protected readonly exitPolicy = ExitPolicy;

  /** Regex for HH:MM format (00:00–23:59). */
  private static readonly OPEN_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

  /**
   * Pairs of exit policies that are contradictory when both selected.
   * HOLD_TO_EXPIRATION means "no active exit" — it conflicts with any
   * active policy. WHEEL_IF_ASSIGNED and HOLD_SHARES_IF_ASSIGNED define
   * different disposition paths on assignment.
   */
  private static readonly INCOMPATIBLE_PAIRS: ReadonlyArray<readonly [ExitPolicy, ExitPolicy]> = [
    [ExitPolicy.HOLD_TO_EXPIRATION, ExitPolicy.CLOSE_AT_TARGET_GAIN],
    [ExitPolicy.HOLD_TO_EXPIRATION, ExitPolicy.CLOSE_AT_DTE_THRESHOLD],
    [ExitPolicy.HOLD_TO_EXPIRATION, ExitPolicy.STOP_LOSS],
    [ExitPolicy.HOLD_TO_EXPIRATION, ExitPolicy.TRAILING_STOP],
    [ExitPolicy.HOLD_TO_EXPIRATION, ExitPolicy.ROLL],
    [ExitPolicy.HOLD_TO_EXPIRATION, ExitPolicy.EXIT_AND_REPLACE],
    [ExitPolicy.WHEEL_IF_ASSIGNED, ExitPolicy.HOLD_SHARES_IF_ASSIGNED],
  ];

  /** Single form — all fields on one screen. */
  readonly form = this.fb.group({
    spreadType: [PositionSpreadType.CASH_SECURED_PUT, [Validators.required]],
    symbol: ['', [Validators.required]],
    frequency: [StrategyFrequency.DAILY, [Validators.required]],
    openTimePT: ['12:00', [Validators.required, Validators.pattern(StrategyBuilderFormComponent.OPEN_TIME_PATTERN)]],
    targetDelta: [0.2, [Validators.required, Validators.min(0.01), Validators.max(1)]],
    dteMin: [21, [Validators.required, Validators.min(0)]],
    dteMax: [30, [Validators.required, Validators.min(0)]],
    targetGainPct: [null as number | null],
    dteExitThreshold: [null as number | null],
    stopLossPct: [null as number | null],
    trailingStopPct: [null as number | null],
    rollDteThreshold: [null as number | null],
    rollTargetDelta: [null as number | null],
  }, { validators: [dteMaxGreaterThanMin] });

  /** Selected exit policies (multi-select). Defaults to HOLD_TO_EXPIRATION. */
  readonly selectedExitPolicies = signal<ExitPolicy[]>([ExitPolicy.HOLD_TO_EXPIRATION]);

  /** Validation error for incompatible exit policy combinations. */
  readonly exitPolicyError = signal<string | null>(null);

  /** Whether a given exit policy is selected. */
  isPolicySelected(policy: ExitPolicy): boolean {
    return this.selectedExitPolicies().includes(policy);
  }

  /** Called when the multi-select changes — validates compatibility. */
  onExitPoliciesChange(policies: ExitPolicy[]): void {
    this.selectedExitPolicies.set(policies);
    this.exitPolicyError.set(this.validateExitPolicies(policies));
  }

  /** Check for incompatible exit policy combinations. */
  private validateExitPolicies(policies: ExitPolicy[]): string | null {
    if (policies.length === 0) {
      return 'At least one exit policy is required';
    }
    for (const [a, b] of StrategyBuilderFormComponent.INCOMPATIBLE_PAIRS) {
      if (policies.includes(a) && policies.includes(b)) {
        return `Incompatible exit policies: ${a}, ${b}`;
      }
    }
    return null;
  }

  /** Live preview of the instance ID from current form values. */
  readonly idPreview = signal('—');

  /** Whether we're in edit mode (vs create). */
  readonly isEditMode = computed(() => this.data.instance !== null);

  private updateIdPreview(): void {
    const v = this.form.value;
    if (!v.symbol || !v.frequency || !v.spreadType || v.targetDelta == null || v.dteMin == null || v.dteMax == null) {
      this.idPreview.set('—');
      return;
    }
    const phases: StrategyInstancePhase[] = [{ spreadType: v.spreadType, targetDelta: v.targetDelta, dteMin: v.dteMin, dteMax: v.dteMax }];
    try {
      this.idPreview.set(generateInstanceId(new Date(), v.symbol, phases, v.frequency, v.openTimePT ?? '12:00'));
    } catch {
      this.idPreview.set('—');
    }
  }

  constructor() {
    const instance = this.data.instance;
    if (instance) {
      this.prefillFromInstance(instance);
    }

    // Normalize symbol to uppercase on every change.
    this.form.controls.symbol.valueChanges.subscribe((val) => {
      if (val && val !== val.toUpperCase()) {
        this.form.controls.symbol.setValue(val.toUpperCase(), { emitEvent: false });
      }
    });

    // Trailing stop defaults to stop loss value when both are selected.
    this.form.controls.stopLossPct.valueChanges.subscribe((val) => {
      if (val != null && this.isPolicySelected(ExitPolicy.TRAILING_STOP)) {
        this.form.controls.trailingStopPct.setValue(val, { emitEvent: false });
      }
    });

    // Update ID preview on form changes.
    this.form.valueChanges.subscribe(() => this.updateIdPreview());
    this.updateIdPreview();
  }

  /** Pre-fill form from an existing instance (edit mode). */
  private prefillFromInstance(instance: StrategyInstanceConfig): void {
    const phase = instance.phases[0];
    this.form.patchValue({
      spreadType: phase?.spreadType ?? PositionSpreadType.CASH_SECURED_PUT,
      symbol: instance.symbol,
      frequency: instance.frequency,
      openTimePT: instance.openTimePT,
      targetDelta: phase?.targetDelta ?? 0.2,
      dteMin: phase?.dteMin ?? 21,
      dteMax: phase?.dteMax ?? 30,
    });
    const policies = instance.exitPolicies.map((p) => p.policy);
    this.selectedExitPolicies.set(policies);
    this.exitPolicyError.set(this.validateExitPolicies(policies));
    const ep = instance.exitPolicies[0];
    if (ep) {
      this.form.patchValue({
        targetGainPct: ep.targetGainPct ?? null,
        dteExitThreshold: ep.dteExitThreshold ?? null,
        stopLossPct: ep.stopLossPct ?? null,
        trailingStopPct: ep.trailingStopPct ?? null,
        rollDteThreshold: ep.rollDteThreshold ?? null,
        rollTargetDelta: ep.rollTargetDelta ?? null,
      });
    }
  }

  /** Build the config object from form values for store.create() or store.update(). */
  private buildConfig(): Omit<StrategyInstanceConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'> {
    const v = this.form.value;
    const spreadType = v.spreadType!;
    const targetDelta = v.targetDelta!;
    const dteMin = v.dteMin!;
    const dteMax = v.dteMax!;

    const phase: StrategyInstancePhase = { spreadType, targetDelta, dteMin, dteMax };
    const optionType = spreadType === PositionSpreadType.CASH_SECURED_PUT ? OptionType.PUT : OptionType.CALL;
    const side = TradeSide.SHORT;

    const exitPolicies: ExitPolicyConfig[] = this.selectedExitPolicies().map((policy) => {
      const cfg: ExitPolicyConfig = { policy };
      switch (policy) {
        case ExitPolicy.CLOSE_AT_TARGET_GAIN: cfg.targetGainPct = v.targetGainPct ?? undefined; break;
        case ExitPolicy.CLOSE_AT_DTE_THRESHOLD: cfg.dteExitThreshold = v.dteExitThreshold ?? undefined; break;
        case ExitPolicy.STOP_LOSS: cfg.stopLossPct = v.stopLossPct ?? undefined; break;
        case ExitPolicy.TRAILING_STOP: cfg.trailingStopPct = v.trailingStopPct ?? undefined; break;
        case ExitPolicy.ROLL:
          cfg.rollDteThreshold = v.rollDteThreshold ?? undefined;
          cfg.rollTargetDelta = v.rollTargetDelta ?? undefined;
          break;
      }
      return cfg;
    });

    return {
      symbol: v.symbol!,
      optionType,
      side,
      targetDelta,
      dteMin,
      dteMax,
      phases: [phase],
      frequency: v.frequency!,
      openTimePT: v.openTimePT!,
      exitPolicies,
      lifecycleState: this.data.instance?.lifecycleState ?? LifecycleState.ACTIVE,
    };
  }

  /** Save the strategy — calls store.create() or store.update() depending on mode. */
  async save(): Promise<void> {
    if (this.form.invalid || this.exitPolicyError()) return;

    const config = this.buildConfig();
    const selected = this.data.instance;

    if (selected) {
      await this.store.update(selected.id, config);
    } else {
      await this.store.create(config);
    }

    if (this.store.error()) return;
    this.dialogRef.close(true);
  }

  /** Close the dialog without saving. */
  cancel(): void {
    this.dialogRef.close();
  }
}

/** Custom validator: DTE max must be strictly greater than DTE min. */
function dteMaxGreaterThanMin(group: FormGroup): { [key: string]: boolean } | null {
  const min = group.get('dteMin')?.value;
  const max = group.get('dteMax')?.value;
  if (min != null && max != null && max <= min) {
    return { dteRange: true };
  }
  return null;
}
