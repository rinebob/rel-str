/**
 * @topic #553 — Paper Trading Infra | @task #1082
 *
 * Run-config form for the trade-analysis dataset library. Two origins:
 *  - 'replay': full param surface — symbol scope, signal-type
 *    multi-select, exit rule (registry-grammar validated, invalid input
 *    blocks submission before the callable fires), bar range.
 *  - 'live': notes/tags only — the snapshot params are fixed defaults
 *    (all symbols/signal types, full-history range, trailing-8
 *    provenance, signal-bar-close).
 * Emits `submitted` with the callable-ready AnalysisRunParams plus the
 * tags/notes meta; the page forwards it to AnalysisStore.generateDataset.
 */
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  OnDestroy,
  output,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { Subscription } from 'rxjs';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  SIGNAL_TYPES,
  type AnalysisRunParams,
} from '@paper-trading/analysis';
import {
  isValidExitRule,
  parseSymbolScope,
  parseTags,
  toIsoDate,
  LIVE_DEFAULTS,
} from '../../utils/analysis-run-config.util';

export interface RunConfigSubmission {
  params: AnalysisRunParams;
  meta: { tags: string[]; notes?: string };
}

const exitRuleValidator: ValidatorFn = (
  c: AbstractControl,
): ValidationErrors | null =>
  isValidExitRule(String(c.value ?? '')) ? null : { exitRule: true };

const barRangeValidator: ValidatorFn = (
  g: AbstractControl,
): ValidationErrors | null => {
  const fromC = g.get('barFrom');
  const toC = g.get('barTo');
  // Disabled (live origin) — the stale replay dates must not block submit.
  if (!fromC || !toC || fromC.disabled || toC.disabled) return null;
  const from = fromC.value as Date | null;
  const to = toC.value as Date | null;
  return from && to && from.getTime() > to.getTime()
    ? { barRange: true }
    : null;
};

@Component({
  selector: 'app-analysis-run-config',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatIconModule,
  ],
  templateUrl: './analysis-run-config.component.html',
  styleUrl: './analysis-run-config.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AnalysisRunConfigComponent implements OnDestroy {
  /** True while the callable is in flight — submit is disabled. */
  @Input() busy = false;
  readonly submitted = output<RunConfigSubmission>();
  readonly cancelled = output<void>();

  readonly signalTypeOptions = SIGNAL_TYPES;

  readonly form = new FormGroup(
    {
      origin: new FormControl<'live' | 'replay'>('replay', {
        nonNullable: true,
      }),
      symbols: new FormControl('', { nonNullable: true }),
      signalTypes: new FormControl<string[]>([], { nonNullable: true }),
      exitRule: new FormControl('trailing-8', {
        nonNullable: true,
        validators: [Validators.required, exitRuleValidator],
      }),
      barFrom: new FormControl<Date | null>(new Date(2023, 0, 1), {
        validators: [Validators.required],
      }),
      barTo: new FormControl<Date | null>(new Date(), {
        validators: [Validators.required],
      }),
      tags: new FormControl('', { nonNullable: true }),
      notes: new FormControl('', { nonNullable: true }),
    },
    { validators: [barRangeValidator] },
  );

  /** Run-param controls — enabled for replay, disabled for live so a
   *  stale invalid exit rule can't block a live snapshot. */
  private static readonly REPLAY_CONTROLS = [
    'symbols',
    'signalTypes',
    'exitRule',
    'barFrom',
    'barTo',
  ] as const;

  protected readonly origin = toSignal(
    this.form.controls.origin.valueChanges,
    { initialValue: 'replay' as 'live' | 'replay' },
  );

  private readonly originSub: Subscription;

  constructor() {
    this.originSub = this.form.controls.origin.valueChanges.subscribe(
      (origin) => {
        for (const key of AnalysisRunConfigComponent.REPLAY_CONTROLS) {
          const c = this.form.controls[key];
          if (origin === 'replay') c.enable();
          else c.disable();
        }
      },
    );
  }

  ngOnDestroy(): void {
    this.originSub.unsubscribe();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return; // AC3 — nothing reaches the callable on invalid input
    }
    const v = this.form.getRawValue();
    const params: AnalysisRunParams =
      v.origin === 'live'
        ? {
            origin: 'live',
            ...LIVE_DEFAULTS,
            barRange: {
              ...LIVE_DEFAULTS.barRange,
              to: toIsoDate(new Date()),
            },
          }
        : {
            origin: 'replay',
            symbolScope: parseSymbolScope(v.symbols),
            signalTypes: v.signalTypes,
            exitRule: v.exitRule.trim(),
            barRange: {
              from: toIsoDate(v.barFrom as Date),
              to: toIsoDate(v.barTo as Date),
            },
            entryConvention: 'signal-bar-close',
          };
    this.submitted.emit({
      params,
      meta: {
        tags: parseTags(v.tags),
        notes: v.notes.trim() || undefined,
      },
    });
    this.reset(v.origin);
  }

  cancel(): void {
    this.reset('replay');
    this.cancelled.emit();
  }

  private reset(origin: 'live' | 'replay'): void {
    this.form.reset({
      origin,
      exitRule: 'trailing-8',
      barFrom: new Date(2023, 0, 1),
      barTo: new Date(),
      signalTypes: [],
      symbols: '',
      tags: '',
      notes: '',
    });
  }
}
