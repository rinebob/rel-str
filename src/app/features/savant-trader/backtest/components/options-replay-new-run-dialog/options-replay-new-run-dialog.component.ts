/**
 * Options Replay New Run Dialog
 *
 * Launches a Selection Replay run — template picker bound to the shared
 * REPLAY_TEMPLATES registry (name + description), symbols text field
 * (same comma/space convention as the sim dialog), and a start date
 * entered as three Y/M/D dropdowns (no native datepicker; impossible
 * dates are unconstructable because the day list is clamped to the
 * month). Closes with an OptionsReplayStartRequest; the callable
 * re-validates server-side.
 */
import { Component, ChangeDetectionStrategy, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { DsDialogRef } from '../../../../../shared/ds/ds-dialog';

import type { OptionsReplayStartRequest } from '@options-replay/contracts';
import { REPLAY_TEMPLATES } from '@options-replay/templates';

const MONTH_OPTIONS = [
  { value: 1, label: 'Jan' }, { value: 2, label: 'Feb' }, { value: 3, label: 'Mar' },
  { value: 4, label: 'Apr' }, { value: 5, label: 'May' }, { value: 6, label: 'Jun' },
  { value: 7, label: 'Jul' }, { value: 8, label: 'Aug' }, { value: 9, label: 'Sep' },
  { value: 10, label: 'Oct' }, { value: 11, label: 'Nov' }, { value: 12, label: 'Dec' },
];

/** Pick-doc coverage starts 2026 — earlier years can never have shards,
 *  so the year select is floored there rather than offering dead picks. */
const EARLIEST_COVERAGE_YEAR = 2026;
const YEAR_SPAN = 10;

function yearOptions(): number[] {
  const now = new Date().getFullYear();
  const floor = Math.max(now - YEAR_SPAN, EARLIEST_COVERAGE_YEAR);
  return Array.from({ length: now - floor + 1 }, (_, i) => now - i);
}

/** Calendar days in a year/month — leap years handled by the Date epoch. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function parseSymbols(symbolsText: string): string[] {
  return String(symbolsText)
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

@Component({
  selector: 'app-options-replay-new-run-dialog',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    ],
  templateUrl: './options-replay-new-run-dialog.component.html',
  styleUrl: './options-replay-new-run-dialog.component.scss',
})
export class OptionsReplayNewRunDialogComponent {
  private readonly dialogRef = inject<DsDialogRef<OptionsReplayNewRunDialogComponent, OptionsReplayStartRequest | undefined>>(
    DsDialogRef
  );

  readonly templates = REPLAY_TEMPLATES;
  readonly years = yearOptions();
  readonly months = MONTH_OPTIONS;

  /** Default start: 2026-01-01 — the pick-doc grid's earliest materialized
   *  coverage (nothing exists before it). */
  private static readonly DEFAULT_START = { y: 2026, m: 1, d: 1 };

  readonly form = new FormGroup({
    templateId: new FormControl<string>(REPLAY_TEMPLATES[0]?.id ?? '', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    symbolsText: new FormControl<string>('QQQ', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    startYear: new FormControl<number>(OptionsReplayNewRunDialogComponent.DEFAULT_START.y, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    startMonth: new FormControl<number>(OptionsReplayNewRunDialogComponent.DEFAULT_START.m, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    startDay: new FormControl<number>(OptionsReplayNewRunDialogComponent.DEFAULT_START.d, {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  private readonly destroyRef = inject(DestroyRef);

  constructor() {
    // Clamp the day when month/year shrinks the month — Jan 31 → Feb must
    // land on the 28th/29th, not produce an impossible date. Subscribing to
    // the day control too closes the programmatic-write hole: setValue sets
    // controls in declaration order (day last), so {month:2, day:31} would
    // otherwise land Feb 31 after the month-change clamp already ran.
    const clampDay = () => {
      const day = this.form.controls.startDay;
      const max = daysInMonth(this.form.controls.startYear.value, this.form.controls.startMonth.value);
      if (day.value > max) day.setValue(max);
    };
    this.form.controls.startMonth.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(clampDay);
    this.form.controls.startYear.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(clampDay);
    this.form.controls.startDay.valueChanges.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(clampDay);
  }

  /** Days for the selected month/year — the only way to pick Feb 30 is if
   *  the month itself is invalid, which required already guards. */
  dayOptions(): number[] {
    return Array.from(
      { length: daysInMonth(this.form.controls.startYear.value, this.form.controls.startMonth.value) },
      (_, i) => i + 1,
    );
  }

  /** Trigger shows the selected template's name only — the description
   *  lives in the dropdown options, not mashed into the closed select. */
  selectedTemplateName(): string {
    const id = this.form.controls.templateId.value;
    return this.templates.find((t) => t.id === id)?.name ?? id;
  }

  submit(): void {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;

    const symbols = parseSymbols(this.form.controls.symbolsText.value);
    if (symbols.length === 0) {
      this.form.controls.symbolsText.setErrors({ required: true });
      return;
    }

    const { startYear, startMonth, startDay } = this.form.controls;
    this.dialogRef.close({
      templateId: this.form.controls.templateId.value,
      symbols,
      startDate: `${startYear.value}-${pad2(startMonth.value)}-${pad2(startDay.value)}`,
    });
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
