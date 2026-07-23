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

const PERCENT_FIELDS = [
  'dropPct',
  'targetGainPct',
  'stopLossPct',
  'trailingStopPct',
];

const OPTION_KEYS = [
  'optionType',
  'targetDelta',
  'targetDte',
  'minDte',
  'maxDte',
];

const CONFIG_ORDER = [
  'dropPct',
  'targetGainPct',
  'stopLossPct',
  'trailingStopPct',
  'maxHoldDays',
  'maxConcurrentPositions',
  'positionSize',
  'useUnderlying',
  'optionType',
  'targetDelta',
  'targetDte',
  'minDte',
  'maxDte',
];

function integerValidator(control: AbstractControl): ValidationErrors | null {
  const value = control.value;
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isInteger(n) ? null : { integer: true };
}

@Injectable()
export class BacktestNewRunFormBuilder {
  readonly optionKeys = OPTION_KEYS;
  buildMainForm(): FormGroup<{
    strategyId: FormControl<string>;
    symbolsText: FormControl<string>;
    initialCash: FormControl<number>;
    runType: FormControl<BacktestRunType>;
    reportTier: FormControl<BacktestReportTier>;
  }> {
    return new FormGroup({
      strategyId: new FormControl<string>('', { nonNullable: true, validators: [Validators.required] }),
      symbolsText: new FormControl<string>('QQQ', { nonNullable: true, validators: [Validators.required] }),
      initialCash: new FormControl<number>(100000, { nonNullable: true, validators: [Validators.required, Validators.min(0)] }),
      runType: new FormControl<BacktestRunType>('allData', { nonNullable: true, validators: [Validators.required] }),
      reportTier: new FormControl<BacktestReportTier>('full', { nonNullable: true, validators: [Validators.required] }),
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

    const defaults = strategy.defaultConfig ?? {};
    const schema = strategy.configSchema ?? {};

    for (const [key, field] of this.orderedSchemaEntries(schema)) {
      const defaultValue = this.resolveDefaultValue(key, field, defaults[key]);
      const validators = this.buildValidators(key, field);
      form.addControl(key, new FormControl(defaultValue, validators));
    }

    return form;
  }

  getConfigEntries(strategyId: string, strategies: BacktestStrategyMetadata[]): ConfigSchemaEntry[] {
    const strategy = strategies.find((s) => s.id === strategyId);
    const schema = strategy?.configSchema ?? {};
    return this.orderedSchemaEntries(schema).map(([key, field]) => ({ key, field }));
  }

  private orderedSchemaEntries(schema: Record<string, BacktestStrategyConfigField>): [string, BacktestStrategyConfigField][] {
    const entries = Object.entries(schema);
    entries.sort(([a], [b]) => {
      const indexA = CONFIG_ORDER.indexOf(a);
      const indexB = CONFIG_ORDER.indexOf(b);
      if (indexA === -1 && indexB === -1) return a.localeCompare(b);
      if (indexA === -1) return 1;
      if (indexB === -1) return -1;
      return indexA - indexB;
    });
    return entries;
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
        const scaled = this.isPercentField(key) ? num / 100 : num;
        normalized[key] = Number.isNaN(scaled) ? (field.min ?? 0) : scaled;
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
    const base =
      fallback !== undefined
        ? fallback
        : field.type === 'boolean'
        ? false
        : field.type === 'integer' || field.type === 'number'
        ? (field.min ?? 0)
        : field.enum && field.enum.length > 0
        ? field.enum[0]
        : '';
    if (this.isPercentField(key) && typeof base === 'number') {
      return base * 100;
    }
    return base;
  }

  private buildValidators(key: string, field: BacktestStrategyConfigField): ValidatorFn[] {
    const validators: ValidatorFn[] = [];
    if (field.type === 'integer') validators.push(integerValidator);
    const min = this.isPercentField(key) && field.min !== undefined ? field.min * 100 : field.min;
    const max = this.isPercentField(key) && field.max !== undefined ? field.max * 100 : field.max;
    if (min !== undefined) validators.push(Validators.min(min));
    if (max !== undefined) validators.push(Validators.max(max));
    return validators;
  }

  isPercentField(key: string): boolean {
    return PERCENT_FIELDS.includes(key);
  }

  isOptionField(key: string): boolean {
    return this.optionKeys.includes(key);
  }
}
