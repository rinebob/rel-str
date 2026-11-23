import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { DsDialogRef, DsDialogService } from '../../../../../shared/ds/ds-dialog';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { OptionsReplayNewRunDialogComponent } from './options-replay-new-run-dialog.component';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';
import type { OptionLeg } from '@options-replay/contracts';
import { REPLAY_VARIANTS } from '@options-replay/templates';
import type { VariantBuilderResult } from '../../utils/variant-builder.utils';
import { OptionsVariantBuilderDialogComponent } from '../options-variant-builder-dialog/options-variant-builder-dialog.component';

const PCS_LEGS: readonly OptionLeg[] = [
  { kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT },
  { kind: 'option', type: OptionType.PUT, targetDelta: -0.1, dte: 45, side: TradeSide.LONG },
];

describe('OptionsReplayNewRunDialogComponent', () => {
  let dialogRef: { close: jest.Mock };
  let dsDialog: { open: jest.Mock };

  async function setup() {
    dialogRef = { close: jest.fn() };
    dsDialog = { open: jest.fn() };

    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DsDialogRef, useValue: dialogRef },
        { provide: DsDialogService, useValue: dsDialog },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OptionsReplayNewRunDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  function emitBuilderResult(result: VariantBuilderResult | undefined) {
    dsDialog.open.mockReturnValue({ afterClosed: () => of(result) });
  }

  it('binds the named-variant dropdown to REPLAY_VARIANTS, defaulting to the first', async () => {
    const { component } = await setup();
    expect(component.variants).toBe(REPLAY_VARIANTS);
    expect(component.variants.length).toBeGreaterThan(0);
    expect(component.form.controls.selectionKind.value).toBe('named');
    expect(component.form.controls.variantId.value).toBe(REPLAY_VARIANTS[0].id);
  });

  it('renders each named variant option as name only; the caption shows description + leg signature and follows the selection', async () => {
    const { fixture, component } = await setup();
    const select = fixture.nativeElement.querySelector('select[formControlName="variantId"]') as HTMLSelectElement;
    const options = select.querySelectorAll('option');
    expect(options.length).toBe(REPLAY_VARIANTS.length);
    for (const v of REPLAY_VARIANTS) {
      const opt = Array.from(options).find((o) => o.textContent?.trim() === v.name);
      expect(opt).toBeTruthy();
    }

    const caption = fixture.nativeElement.querySelector('[data-testid="variant-caption"]');
    expect(caption?.textContent).toContain(REPLAY_VARIANTS[0].description);
    const firstOptionLeg = REPLAY_VARIANTS[0].legs.find((l) => l.kind === 'option');
    if (firstOptionLeg && firstOptionLeg.kind === 'option') {
      expect(caption?.textContent).toContain(`Δ${firstOptionLeg.targetDelta} ${firstOptionLeg.dte}DTE`);
    }

    component.form.controls.variantId.setValue(REPLAY_VARIANTS[1].id);
    fixture.detectChanges();
    expect(caption?.textContent).toContain(REPLAY_VARIANTS[1].description);
    expect(caption?.textContent).not.toContain(REPLAY_VARIANTS[0].description);
  });

  it('named path submits the {variantId} request form', async () => {
    const { component } = await setup();
    component.form.setValue({
      selectionKind: 'named',
      variantId: 'csp-30-30',
      customResult: null,
      symbolsText: 'spy, qqq  amat',
      startYear: 2026,
      startMonth: 1,
      startDay: 5,
    });

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      variantId: 'csp-30-30',
      symbols: ['SPY', 'QQQ', 'AMAT'],
      startDate: '2026-01-05',
    });
  });

  it('custom path submits the {legs, variantName} request form — no variantId', async () => {
    const { component } = await setup();
    emitBuilderResult({ legs: PCS_LEGS, variantName: 'my pcs' });
    component.form.patchValue({ selectionKind: 'custom', symbolsText: 'QQQ' });
    component.chooseVariant();

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith({
      legs: PCS_LEGS,
      variantName: 'my pcs',
      symbols: ['QQQ'],
      startDate: '2026-01-01',
    });
    const payload = dialogRef.close.mock.calls[0][0] as Record<string, unknown>;
    expect('variantId' in payload).toBe(false);
    expect('templateId' in payload).toBe(false);
  });

  it('custom path without a composed result cannot submit — and never emits the named form', async () => {
    const { component } = await setup();
    component.form.patchValue({ selectionKind: 'custom', symbolsText: 'QQQ' });

    expect(component.canSubmit()).toBe(false);
    component.submit();

    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('custom path without a variantName omits the key from the request', async () => {
    const { component } = await setup();
    emitBuilderResult({ legs: PCS_LEGS });
    component.form.patchValue({ selectionKind: 'custom', symbolsText: 'QQQ' });
    component.chooseVariant();

    component.submit();

    const payload = dialogRef.close.mock.calls[0][0] as Record<string, unknown>;
    expect(payload).toEqual({ legs: PCS_LEGS, symbols: ['QQQ'], startDate: '2026-01-01' });
    expect('variantName' in payload).toBe(false);
  });

  it('chooseVariant opens the builder with submitLabel Apply', async () => {
    const { component } = await setup();
    emitBuilderResult({ variantId: 'csp-45-20' });
    component.chooseVariant();
    expect(dsDialog.open).toHaveBeenCalledWith(
      OptionsVariantBuilderDialogComponent,
      expect.objectContaining({ data: { submitLabel: 'Apply' } }),
    );
  });

  it('a builder Apply result lands on the custom section — summary shows legs + name', async () => {
    const { component, fixture } = await setup();
    emitBuilderResult({ legs: PCS_LEGS, variantName: 'my pcs' });
    component.chooseVariant();
    fixture.detectChanges();

    expect(component.form.controls.customResult.value).toEqual({ legs: PCS_LEGS, variantName: 'my pcs' });
    expect(component.form.controls.selectionKind.value).toBe('custom');
    const summary = fixture.nativeElement.querySelector('[data-testid="custom-summary"]');
    expect(summary?.textContent).toContain('2 legs');
    expect(summary?.textContent).toContain('my pcs');
  });

  it('builder cancel leaves the selection unchanged', async () => {
    const { component } = await setup();
    emitBuilderResult(undefined);
    component.form.patchValue({ selectionKind: 'custom' });
    component.chooseVariant();

    expect(component.form.controls.customResult.value).toBeNull();
    expect(component.form.controls.selectionKind.value).toBe('custom');
  });

  it('a named-variant builder Apply switches the form back to the named section', async () => {
    const { component } = await setup();
    emitBuilderResult({ variantId: 'csp-30-30' });
    component.form.patchValue({ selectionKind: 'custom' });
    component.chooseVariant();

    expect(component.form.controls.selectionKind.value).toBe('named');
    expect(component.form.controls.variantId.value).toBe('csp-30-30');
  });

  it('defaults the start date to 2026-01-01 (earliest grid coverage)', async () => {
    const { component } = await setup();

    expect(component.form.controls.startYear.value).toBe(2026);
    expect(component.form.controls.startMonth.value).toBe(1);
    expect(component.form.controls.startDay.value).toBe(1);
  });

  it('emits a zero-padded YYYY-MM-DD startDate from the Y/M/D selects', async () => {
    const { component } = await setup();
    component.form.patchValue({ startYear: 2025, startMonth: 3, startDay: 7 });

    component.submit();

    expect(dialogRef.close).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: '2025-03-07' }),
    );
  });

  it('day dropdown tracks the month length — Feb 2026 offers 28 days', async () => {
    const { component } = await setup();
    component.form.patchValue({ startYear: 2026, startMonth: 2 });

    expect(component.dayOptions()).toHaveLength(28);
  });

  it('day dropdown honors leap years — Feb 2024 offers 29 days', async () => {
    const { component } = await setup();
    component.form.patchValue({ startYear: 2024, startMonth: 2 });

    expect(component.dayOptions()).toHaveLength(29);
  });

  it('clamps the day when the month shrinks — Jan 31 → Feb → 28', async () => {
    const { component } = await setup();
    component.form.patchValue({ startMonth: 1, startDay: 31 });

    component.form.controls.startMonth.setValue(2);

    expect(component.form.controls.startDay.value).toBe(28);
  });

  it('clamps the day when the year loses a leap day — Feb 29 2024 → 2025 → 28', async () => {
    const { component } = await setup();
    component.form.patchValue({ startYear: 2024, startMonth: 2, startDay: 29 });

    component.form.controls.startYear.setValue(2025);

    expect(component.form.controls.startDay.value).toBe(28);
  });

  it('clamps even on a programmatic setValue — {month: 2, day: 31} cannot persist Feb 31', async () => {
    const { component } = await setup();
    component.form.patchValue({ startMonth: 2, startDay: 31 });

    expect(component.form.controls.startDay.value).toBe(28);
  });

  it('floors the year select at 2026 — no dead picks before grid coverage', async () => {
    const { component } = await setup();

    expect(component.years).toContain(2026);
    expect(Math.min(...component.years)).toBe(2026);
  });

  it('does not close when symbols parse to nothing', async () => {
    const { component } = await setup();
    component.form.patchValue({ symbolsText: ' , , ' });
    // symbolsText passes `required` (non-empty string) but parses to zero
    component.form.controls.symbolsText.markAsTouched();
    component.submit();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(component.form.controls.symbolsText.hasError('required')).toBe(true);
  });

  it('whitespace symbols surface the required message in the DOM after Start Replay', async () => {
    const { fixture, component } = await setup();
    component.form.patchValue({ symbolsText: ' , , ' });
    const btn = fixture.nativeElement.querySelector('.actions .ds-btn.fill') as HTMLButtonElement;
    expect(btn.disabled).toBe(false); // form is valid — the parse-to-zero check lives in submit()

    btn.click();
    fixture.detectChanges();

    expect(dialogRef.close).not.toHaveBeenCalled();
    const err = fixture.nativeElement.querySelector('.field-error');
    expect(err?.textContent).toContain('At least one symbol is required');
  });

  it('cancel closes with undefined', async () => {
    const { component } = await setup();
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
  });
});
