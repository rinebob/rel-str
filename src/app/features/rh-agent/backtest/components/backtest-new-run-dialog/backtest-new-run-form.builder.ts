/**
 * Builds and normalizes the forms used by BacktestNewRunDialogComponent.
 */
import { Injectable } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';

import type {
  BacktestReportTier,
  BacktestRunType,
  BacktestStrategyConfigField,
  BacktestStrategyMetadata,
  StartBacktestRequest,
} from '../../common/backtest.types';
import { DEFAULT_BACKTEST_STRATEGY_ID } from '../../common/backtest.constants';

export interface BacktestNewRunDialogData {
  strategies: BacktestStrategyMetadata[];
}

export interface ConfigSchemaEntry {
  key: string;
  field: BacktestStrategyConfigField;
}

function integerValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? null : { integer: true };
}

@Injectable()
export class BacktestNewRunFormBuilder {
  buildMainForm(): FormGroup<{
    strategyId: FormControl<string>;
    symbolsText: FormControl<string>;
    initialCash: FormControl<number>;
    runType: FormControl<BacktestRunType>;
    reportTier: FormControl<BacktestReportTier>;
  }> {
    return new FormGroup({
      strategyId: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
      symbolsText: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
      initialCash: new FormControl<number>(100000, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
      runType: new FormControl<BacktestRunType>('allData', { nonNullable: true, validators: [Validators.required] }),
      reportTier: new FormControl<BacktestReportTier>('summary', { nonNullable: true, validators: [Validators.required] }),
    });
  }

  resolveDefaultStrategyId(strategies: BacktestStrategyMetadata[]): string {
    return (
      strategies.find((s) => s.id === DEFAULT_BACKTEST_STRATEGY_ID)?.id ??
      strategies[0]?.id ??
      ''
    );
  }

  buildConfigForm(strategyId: string, strategies: BacktestStrategyMetadata[]): FormGroup {
    const strategy = strategies.find((s) => s.id === strategyId);
    const form = new FormGroup({});
    if (!strategy) return form;

    const defaults = { ...(strategy.defaultConfig ?? {}) };
    const schema = strategy.configSchema ?? {};

    for (const [key, field] of Object.entries(schema)) {
      const defaultValue = this.resolveDefaultValue(key, field, defaults[key]);
      const validators = this.buildValidators(field);
      form.addControl(key, new FormControl(defaultValue, validators));
    }

    return form;
  }

  parseSymbols(symbolsText: string): string[] {
    return String(symbolsText)
      .split(/[,\s]+/)
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
  }

  normalizeConfigValues(raw: Record<string, unknown>, strategy: BacktestStrategyMetadata | undefined): Record<string, unknown> {
    const schema = strategy?.configSchema;
    if (!schema) return raw;

    const normalized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const field = schema[key];
      if (!field) {
        normalized[key] = value;
        continue;
      }

      if (field.type === 'boolean') {
        normalized[key] = Boolean(value);
      } else if (field.type === 'integer' || field.type === 'number') {
        const num = Number(value);
        normalized[key] = Number.isNaN(num) ? (field.min ?? 0) : num;
      } else {
        normalized[key] = value;
      }
    }
    return normalized;
  }

  buildStartBacktestRequest(
    mainFormValue: {
      strategyId: string;
      symbolsText: string;
      initialCash: number;
      runType: BacktestRunType;
      reportTier: BacktestReportTier;
    },
    configFormValue: Record<string, unknown>,
    strategies: BacktestStrategyMetadata[]
  ): StartBacktestRequest | null {
    const symbols = this.parseSymbols(mainFormValue.symbolsText);
    if (symbols.length === 0) return null;

    const strategy = strategies.find((s) => s.id === mainFormValue.strategyId);
    const config = this.normalizeConfigValues(configFormValue, strategy);

    return {
      symbols,
      strategyId: mainFormValue.strategyId,
      config,
      runType: mainFormValue.runType,
      initialCash: mainFormValue.initialCash,
      reportTier: mainFormValue.reportTier,
    };
  }

  private resolveDefaultValue(key: string, field: BacktestStrategyConfigField, fallback: unknown): unknown {
    if (fallback !== undefined) return fallback;
    if (field.type === 'boolean') return false;
    if (field.type === 'integer' || field.type === 'number') {
      return field.min ?? 0;
    }
    if (field.enum && field.enum.length > 0) return field.enum[0];
    return '';
  }

  private buildValidators(field: BacktestStrategyConfigField): ValidatorFn[] {
    const validators: ValidatorFn[] = [];
    if (field.type === 'integer') validators.push(integerValidator);
    if (field.min !== undefined) validators.push(Validators.min(field.min));
    if (field.max !== undefined) validators.push(Validators.max(field.max));
    return validators;
  }
}
