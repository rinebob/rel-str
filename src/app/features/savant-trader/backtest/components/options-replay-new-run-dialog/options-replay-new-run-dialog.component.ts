/**
 * Options Replay New Run Dialog
 *
 * Launches a Selection Replay run. The v1 template picker is replaced by
 * the two-section variant layout (#1505): a named-variant dropdown bound
 * to the REPLAY_VARIANTS registry, and a custom section that opens the
 * shared OptionsVariantBuilderDialog to dial a base template or compose
 * legs from scratch. Named selections submit `{variantId}`; composed
 * selections submit `{variantName?, legs[]}` — the request form matches
 * the selection path. Symbols (same comma/space convention as the sim
 * dialog) and the three-dropdown start date are unchanged. Closes with
 * an OptionsReplayStartRequest; the callable re-validates server-side.
 */
import { Component, ChangeDetectionStrategy, ChangeDetectorRef, DestroyRef, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { CommonModule } from '@angular/common';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';

import { DsDialogRef, DsDialogService } from '../../../../../shared/ds/ds-dialog';

import type { OptionsReplayStartRequest, ReplayVariant, VariantLeg } from '@options-replay/contracts';
import { REPLAY_VARIANTS } from '@options-replay/templates';

import {
  OptionsVariantBuilderDialogComponent,
  type VariantBuilderDialogData,
} from '../options-variant-builder-dialog/options-variant-builder-dialog.component';
import type { VariantBuilderResult, VariantLegsResult } from '../../utils/variant-builder.utils';

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

/** The legs-form of a builder result — narrows the union for submit. */
function isLegsResult(r: VariantBuilderResult): r is VariantLegsResult {
  return 'legs' in r;
}

type VariantSelectionKind = 'named' | 'custom';

/** One leg's compact signature — `short put Δ-0.2 45DTE`, `long stock`.
 *  Enum values are already lowercase literals, so they render as-is. */
function legSignature(leg: VariantLeg): string {
  if (leg.kind === 'stock') return `${leg.side} stock`;
  return `${leg.side} ${leg.type} Δ${leg.targetDelta} ${leg.dte}DTE`;
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
  private readonly dialog = inject(DsDialogService);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly variants = REPLAY_VARIANTS;
  readonly years = yearOptions();
  readonly months = MONTH_OPTIONS;

  /** Default start: 2026-01-01 — the pick-doc grid's earliest materialized
   *  coverage (nothing exists before it). */
  private static readonly DEFAULT_START = { y: 2026, m: 1, d: 1 };

  readonly form = new FormGroup({
    selectionKind: new FormControl<VariantSelectionKind>('named', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    variantId: new FormControl<string>(REPLAY_VARIANTS[0]?.id ?? '', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    customResult: new FormControl<VariantLegsResult | null>(null),
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

  /** The registry variant behind the dropdown — feeds the caption that
   *  carries the description the native <option> can't legibly show. */
  selectedVariant(): ReplayVariant | undefined {
    return this.variants.find((v) => v.id === this.form.controls.variantId.value);
  }

  /** Per-leg signature line under the dropdown, e.g.
   *  'short put Δ-0.2 45DTE + long put Δ-0.1 45DTE'. */
  legSummary(variant: ReplayVariant): string {
    return variant.legs.map(legSignature).join(' + ');
  }

  /** The request needs a selection on the active section — a custom
   *  section without a composed result can't start. */
  canSubmit(): boolean {
    if (this.form.invalid) return false;
    if (this.form.controls.selectionKind.value === 'custom') {
      return this.form.controls.customResult.value !== null;
    }
    return true;
  }

  /** Open the shared builder over this dialog; an Apply result routes to
   *  the matching section — {variantId} back to named, {legs} to custom. */
  chooseVariant(): void {
    const ref = this.dialog.open<
      OptionsVariantBuilderDialogComponent,
      VariantBuilderDialogData,
      VariantBuilderResult | undefined
    >(OptionsVariantBuilderDialogComponent, {
      width: '480px',
      data: { submitLabel: 'Apply' },
    });
    ref.afterClosed().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((result) => {
      if (!result) return;
      if (isLegsResult(result)) {
        this.form.patchValue({ selectionKind: 'custom', customResult: result });
      } else {
        this.form.patchValue({ selectionKind: 'named', variantId: result.variantId });
      }
      // The result lands outside template events — mark the view so OnPush
      // re-reads the selection branch on the next check.
      this.cdr.markForCheck();
    });
  }

  submit(): void {
    this.form.markAllAsTouched();

    const symbols = parseSymbols(this.form.controls.symbolsText.value);
    if (symbols.length === 0) {
      this.form.controls.symbolsText.setErrors({ required: true });
      return;
    }

    const selection = this.form.controls.selectionKind.value;
    const custom = this.form.controls.customResult.value;
    // canSubmit() already gates this in the UI — the return keeps a direct
    // submit() call from emitting the named form on an uncomposed custom.
    if (selection === 'custom' && !custom) return;
    if (this.form.invalid) return;

    const { startYear, startMonth, startDay } = this.form.controls;
    const startDate = `${startYear.value}-${pad2(startMonth.value)}-${pad2(startDay.value)}`;

    if (selection === 'custom' && custom) {
      this.dialogRef.close({
        legs: custom.legs,
        ...(custom.variantName ? { variantName: custom.variantName } : {}),
        symbols,
        startDate,
      });
      return;
    }
    this.dialogRef.close({
      variantId: this.form.controls.variantId.value,
      symbols,
      startDate,
    });
  }

  cancel(): void {
    this.dialogRef.close(undefined);
  }
}
