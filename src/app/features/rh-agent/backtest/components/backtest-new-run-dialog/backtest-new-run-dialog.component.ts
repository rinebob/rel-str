/**
 * Backtest New Run Dialog
 *
 * Provides a thin dialog surface that delegates form construction,
 * validation, and normalization to BacktestNewRunFormBuilder.
 */
import { Component, ChangeDetectionStrategy, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

import type {
  BacktestReportTier,
  BacktestRunType,
  StartBacktestRequest,
} from '../../common/backtest.types';
import {
  BacktestNewRunFormBuilder,
  type BacktestNewRunDialogData,
  type ConfigSchemaEntry,
} from './backtest-new-run-form.builder';

@Component({
  selector: 'app-backtest-new-run-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
  ],
  providers: [BacktestNewRunFormBuilder],
  templateUrl: './backtest-new-run-dialog.component.html',
  styleUrl: './backtest-new-run-dialog.component.scss',
})
export class BacktestNewRunDialogComponent {
  private readonly dialogRef = inject<MatDialogRef<BacktestNewRunDialogComponent, StartBacktestRequest | undefined>>(
    MatDialogRef
  );
  private readonly formBuilder = inject(BacktestNewRunFormBuilder);
  readonly data: BacktestNewRunDialogData = inject(MAT_DIALOG_DATA);

  readonly runTypes: BacktestRunType[] = ['allData', 'expandingWindow'];
  readonly reportTiers: BacktestReportTier[] = ['summary', 'full'];

  readonly mainForm = this.formBuilder.buildMainForm();
  configForm: FormGroup = this.formBuilder.buildConfigForm('', this.data.strategies);

  readonly selectedStrategyId = signal<string>('');

  readonly selectedStrategy = computed(() => this.data.strategies.find((s) => s.id === this.selectedStrategyId()) ?? null);

  readonly configSchemaEntries = computed((): ConfigSchemaEntry[] => {
    const schema = this.selectedStrategy()?.configSchema;
    if (!schema) return [];
    return Object.entries(schema).map(([key, field]) => ({ key, field }));
  });

  constructor() {
    const defaultStrategyId = this.formBuilder.resolveDefaultStrategyId(this.data.strategies);
    this.selectedStrategyId.set(defaultStrategyId);
    this.mainForm.patchValue({ strategyId: defaultStrategyId });
    this.configForm = this.formBuilder.buildConfigForm(defaultStrategyId, this.data.strategies);
  }

  onStrategyChange(strategyId: string): void {
    this.selectedStrategyId.set(strategyId);
    this.mainForm.patchValue({ strategyId });
    this.configForm = this.formBuilder.buildConfigForm(strategyId, this.data.strategies);
  }

  submit(): void {
    this.mainForm.markAllAsTouched();
    this.configForm.markAllAsTouched();

    if (this.mainForm.invalid || this.configForm.invalid) {
      return;
    }

    const request = this.formBuilder.buildStartBacktestRequest(
      this.mainForm.getRawValue(),
      this.configForm.getRawValue(),
      this.data.strategies
    );

    if (!request) {
      this.mainForm.controls.symbolsText.setErrors({ required: true });
      return;
    }

    this.dialogRef.close(request);
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
