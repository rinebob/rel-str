/**
 * Variant builder dialog specs (#1504) — three compose modes, band-bounded
 * pickers, live legs preview, submit result forms, Copy JSON export.
 */
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { DS_DIALOG_DATA, DsDialogRef } from '../../../../../shared/ds/ds-dialog';

import { TradeSide } from '@common';
import { OptionType } from '@options/common';
import { REPLAY_TEMPLATE_SHAPES, REPLAY_VARIANTS, getReplayVariant } from '@options-replay/templates';
import { validateVariantLegs } from '@options-replay/templates';
import type { VariantLeg } from '@options-replay/contracts';

import { OptionsVariantBuilderDialogComponent } from './options-variant-builder-dialog.component';
import type { VariantBuilderResult } from '../../utils/variant-builder.utils';

describe('OptionsVariantBuilderDialogComponent', () => {
  let dialogRef: { close: jest.Mock };

  async function setup(data?: { submitLabel?: string }) {
    dialogRef = { close: jest.fn() };
    await TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: DsDialogRef, useValue: dialogRef },
        { provide: DS_DIALOG_DATA, useValue: data ?? {} },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(OptionsVariantBuilderDialogComponent);
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance };
  }

  it('lists every named variant and defaults to the first', async () => {
    const { component } = await setup();
    expect(component.variants).toBe(REPLAY_VARIANTS);
    expect(component.store.variantId()).toBe(REPLAY_VARIANTS[0].id);
    expect(component.store.mode()).toBe('named');
  });

  it('named mode exposes the registry legs in the preview', async () => {
    const { component } = await setup();
    component.onVariantChange('csp-45-20');
    expect(component.store.composedLegs()).toEqual(getReplayVariant('csp-45-20')!.legs);
  });

  it('named submit emits the variantId request form', async () => {
    const { component } = await setup();
    component.onVariantChange('csp-45-20');
    component.submit();
    const result = dialogRef.close.mock.calls[0][0] as VariantBuilderResult;
    expect(result).toEqual({ variantId: 'csp-45-20' });
  });

  it('shape mode renders one band-bounded Δ + DTE picker per option leg', async () => {
    const { fixture, component } = await setup();
    component.onModeChange('shape');
    component.onShapeChange('put-credit-spread');
    fixture.detectChanges();
    const controls = component.store.shapeLegControls();
    const shape = REPLAY_TEMPLATE_SHAPES.find((s) => s.id === 'put-credit-spread')!;
    expect(controls.length).toBe(shape.legs.length);
    for (const [i, leg] of shape.legs.entries()) {
      expect(controls[i].kind).toBe('option');
      // Every Δ option is inside the leg's band — bounds enforced.
      for (const opt of controls[i].deltaOptions) {
        expect(opt).toBeGreaterThanOrEqual((leg as { deltaBand: readonly [number, number] }).deltaBand[0]);
        expect(opt).toBeLessThanOrEqual((leg as { deltaBand: readonly [number, number] }).deltaBand[1]);
      }
      expect(controls[i].dteOptions).toBe((leg as { dteBand: readonly number[] }).dteBand);
    }
  });

  it('a shape with a stock leg renders it as a fixed row (no pickers)', async () => {
    const { component } = await setup();
    component.onModeChange('shape');
    const stockShape = REPLAY_TEMPLATE_SHAPES.find((s) => s.legs.some((l) => l.kind === 'stock'))!;
    component.onShapeChange(stockShape.id);
    const controls = component.store.shapeLegControls();
    const stockIdx = stockShape.legs.findIndex((l) => l.kind === 'stock');
    expect(controls[stockIdx].kind).toBe('stock');
    expect(controls[stockIdx].deltaOptions).toEqual([]);
    expect(controls[stockIdx].pick).toBeNull();
  });

  it('dialed picks compose to signed concrete legs in the preview', async () => {
    const { component } = await setup();
    component.onModeChange('shape');
    component.onShapeChange('put-credit-spread');
    component.onDeltaPick(0, '20');
    component.onDeltaPick(1, '10');
    component.onDtePick(0, '45');
    component.onDtePick(1, '45');
    const legs = component.store.composedLegs();
    expect(validateVariantLegs(legs)).toEqual([]);
    expect(legs[0]).toEqual({ kind: 'option', type: OptionType.PUT, targetDelta: -0.2, dte: 45, side: TradeSide.SHORT });
    expect(legs[1]).toEqual({ kind: 'option', type: OptionType.PUT, targetDelta: -0.1, dte: 45, side: TradeSide.LONG });
  });

  it('shape submit emits {legs, variantName?} — no variantId', async () => {
    const { component } = await setup();
    component.onModeChange('shape');
    component.onShapeChange('put-credit-spread');
    component.onVariantName('  my pcs  ');
    component.submit();
    const result = dialogRef.close.mock.calls[0][0] as VariantBuilderResult;
    expect('variantId' in result).toBe(false);
    expect('legs' in result && result.variantName).toBe('my pcs');
    expect('legs' in result && validateVariantLegs(result.legs)).toEqual([]);
  });

  it('scratch mode: add/remove leg rows', async () => {
    const { component } = await setup();
    component.onModeChange('scratch');
    expect(component.store.scratchLegs().length).toBe(1);
    component.addScratchLeg();
    component.addScratchLeg();
    expect(component.store.scratchLegs().length).toBe(3);
    component.removeScratchLeg(1);
    expect(component.store.scratchLegs().length).toBe(2);
  });

  it('scratch rows compose valid legs (option + stock mix)', async () => {
    const { component } = await setup();
    component.onModeChange('scratch');
    component.updateScratchLeg(0, { kind: 'stock', side: TradeSide.LONG });
    component.addScratchLeg();
    component.updateScratchLeg(1, { type: OptionType.CALL, side: TradeSide.SHORT, deltaMag: 30, dte: 30 });
    const legs = component.store.composedLegs();
    expect(legs[0]).toEqual({ kind: 'stock', side: TradeSide.LONG });
    expect(legs[1]).toEqual({ kind: 'option', type: OptionType.CALL, targetDelta: 0.3, dte: 30, side: TradeSide.SHORT });
    expect(validateVariantLegs(legs)).toEqual([]);
  });

  it('an invalid composition blocks submit', async () => {
    const { component } = await setup();
    component.onModeChange('scratch');
    component.removeScratchLeg(0); // no legs left
    expect(component.store.canSubmit()).toBe(false);
    expect(component.store.submitResult()).toBeNull();
    component.submit();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('Copy JSON writes a paste-ready ReplayVariant block', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    const original = Object.getOwnPropertyDescriptor(Navigator.prototype, 'clipboard');
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    try {
      const { component } = await setup();
      component.onModeChange('shape');
      component.onShapeChange('put-credit-spread');
      component.onExportId('pcs-copy');
      component.onVariantName('my pcs');
      component.copyJson();
      expect(writeText).toHaveBeenCalled();
      const parsed = JSON.parse(writeText.mock.calls[0][0]) as { id: string; name: string; description: string; structure: string; legs: VariantLeg[] };
      expect(parsed.id).toBe('pcs-copy');
      expect(parsed.name).toBe('my pcs');
      expect(parsed.structure).toBe('put-credit-spread');
      expect(validateVariantLegs(parsed.legs)).toEqual([]);
    } finally {
      if (original) Object.defineProperty(navigator, 'clipboard', original);
    }
  });

  it('duplicate scratch legs surface legErrors and block submit', async () => {
    const { component } = await setup();
    component.onModeChange('scratch');
    component.addScratchLeg(); // identical second row → duplicate leg
    expect(component.store.legErrors().length).toBeGreaterThan(0);
    expect(component.store.legErrors().some((e) => e.includes('duplicate'))).toBe(true);
    expect(component.store.canSubmit()).toBe(false);
    expect(component.store.submitResult()).toBeNull();
    component.submit();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('Add-leg is capped at the request boundary (8 legs)', async () => {
    const { component } = await setup();
    component.onModeChange('scratch');
    for (let i = 0; i < 10; i++) component.addScratchLeg();
    expect(component.store.scratchLegs().length).toBe(8);
    // The composed set trips the validator (dupes) AND the cap check —
    // either way it can't submit a run the server would refuse.
    expect(component.store.canSubmit()).toBe(false);
  });

  it('Copy JSON is gated on a valid composition + free registry id', async () => {
    const { component } = await setup();
    component.onModeChange('scratch');
    component.addScratchLeg(); // dup → legErrors non-empty
    component.onExportId('scratch-bad');
    expect(component.store.exportJson()).toBe('');
    // Reserved sentinel id also blocked.
    component.removeScratchLeg(1);
    component.onExportId('custom');
    expect(component.store.exportJson()).toBe('');
    // An existing registry id collides on paste — blocked.
    component.onExportId('csp-45-20');
    expect(component.store.exportJson()).toBe('');
    component.onExportId('scratch-ok');
    expect(component.store.exportJson()).not.toBe('');
  });

  it('scratch-mode export stamps structure custom', async () => {
    const { component } = await setup();
    component.onModeChange('scratch');
    component.onExportId('scratch-1');
    const json = JSON.parse(component.store.exportJson()) as { structure: string };
    expect(json.structure).toBe('custom');
  });

  it('same composition twice produces identical legs', async () => {
    const { component } = await setup();
    component.onModeChange('shape');
    component.onShapeChange('iron-condor');
    const a = component.store.composedLegs();
    const b = component.store.composedLegs();
    expect(b).toEqual(a);
  });

  it('cancel closes with undefined — no partial submission', async () => {
    const { component } = await setup();
    component.cancel();
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
  });

  it('submitLabel comes from dialog data (Apply destination)', async () => {
    const { component } = await setup({ submitLabel: 'Apply' });
    expect(component.submitLabel).toBe('Apply');
  });

  it('submitLabel defaults to Run', async () => {
    const { component } = await setup();
    expect(component.submitLabel).toBe('Run');
  });
});
