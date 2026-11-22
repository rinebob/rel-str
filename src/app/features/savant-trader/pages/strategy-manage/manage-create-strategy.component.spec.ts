/// <reference types="jest" />
/**
 * Tests for ManageCreateStrategyComponent — the Create New Strategy
 * dialog (#1548). The store and dialog service are mocked so the seam is
 * the dialog's public surface: template-driven per-leg Δ/DTE inputs, the
 * suggested editable name, validation (incomplete legs, multi-expiry,
 * dup names), the session-variant save, and Export-to-JSON.
 */

jest.mock('@angular/fire/auth', () => ({ Auth: class {} }));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  collectionData: jest.fn(),
  doc: jest.fn(),
  runTransaction: jest.fn(),
  updateDoc: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
}));

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ManageCreateStrategyComponent } from './manage-create-strategy.component';
import { ManageExportJsonComponent } from './manage-export-json.component';
import { StrategyManageStore } from '../../stores/strategy-manage.store';
import { DsDialogRef, DsDialogService } from '../../../../shared/ds/ds-dialog';
import { MANAGE_VARIANTS } from '@manage/variant-catalog';
import type { ManageVariant } from '@manage/variant-contracts';
import { OptionType } from '@options/common';
import { TradeSide } from '@common';

const CDS = 'cds'; // the only seeded template today

describe('ManageCreateStrategyComponent', () => {
  let fixture: ComponentFixture<ManageCreateStrategyComponent>;
  let component: ManageCreateStrategyComponent;
  let mockStore: {
    variants: ReturnType<typeof signal>;
    sessionVariants: ReturnType<typeof signal>;
    addSessionVariant: jest.Mock;
  };
  let mockRef: { close: jest.Mock };
  let mockDialog: { open: jest.Mock };

  function create(sessionVariants: ManageVariant[] = []): void {
    mockStore = {
      variants: signal([...MANAGE_VARIANTS, ...sessionVariants]),
      sessionVariants: signal(sessionVariants),
      addSessionVariant: jest.fn(),
    };
    mockRef = { close: jest.fn() };
    mockDialog = { open: jest.fn() };

    TestBed.configureTestingModule({
      imports: [ManageCreateStrategyComponent],
      providers: [
        { provide: StrategyManageStore, useValue: mockStore },
        { provide: DsDialogRef, useValue: mockRef },
        { provide: DsDialogService, useValue: mockDialog },
      ],
    });
    fixture = TestBed.createComponent(ManageCreateStrategyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const el = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);
  const els = (testid: string): HTMLElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll(`[data-testid="${testid}"]`));

  /** Fill the two CDS option-leg inputs + name. */
  function fillLegs(delta1: string, dte1: string, delta2: string, dte2: string): void {
    component.setLegInput(0, 'delta', delta1);
    component.setLegInput(0, 'dte', dte1);
    component.setLegInput(1, 'delta', delta2);
    component.setLegInput(1, 'dte', dte2);
    fixture.detectChanges();
  }

  it('renders one Δ + DTE input row per template option leg', () => {
    create();
    const rows = els('leg-row');
    expect(rows.length).toBe(2); // cds: long + short call
    expect(rows[0].textContent).toContain('long');
    expect(rows[1].textContent).toContain('short');
    expect(el('leg-delta-0')).toBeTruthy();
    expect(el('leg-dte-0')).toBeTruthy();
    expect(el('leg-delta-1')).toBeTruthy();
    expect(el('leg-dte-1')).toBeTruthy();
  });

  it('prefills defaults — long 0.65Δ, short 0.55Δ, 30 DTE — and is already submittable', async () => {
    create();
    expect(component.legInputs()).toEqual([
      { delta: '0.65', dte: '30' },
      { delta: '0.55', dte: '30' },
    ]);
    // ngModel's writeValue lands on a microtask — flush per AGENTS.md.
    await new Promise<void>((r) => setTimeout(r, 0));
    const delta0 = el('leg-delta-0') as HTMLInputElement;
    const delta1 = el('leg-delta-1') as HTMLInputElement;
    expect(delta0.value).toBe('0.65');
    expect(delta1.value).toBe('0.55');
    expect((el('leg-dte-0') as HTMLInputElement).value).toBe('30');
    // Spinner step: 5Δ per click.
    expect(delta0.step).toBe('0.05');
    expect(component.name()).toBe('call debit spread 30 65-55');
    expect(el('variant-id')?.textContent).toContain('cds-30-65-55');
    expect(component.canSubmit()).toBe(true);
  });

  it('suggests a name from Δ and DTE once all legs are filled', () => {
    create();
    fillLegs('0.5', '30', '0.4', '30');
    expect(component.name()).toBe('call debit spread 30 50-40');
  });

  it('stops overwriting the name once the user edits it', () => {
    create();
    fillLegs('0.5', '30', '0.4', '30');
    component.name.set('my custom name');
    component.nameTouched.set(true);
    fillLegs('0.55', '35', '0.4', '35');
    expect(component.name()).toBe('my custom name');
  });

  it('blocks save with an empty leg (incomplete) and shows the error', () => {
    create();
    fillLegs('0.5', '30', '', '30');
    expect(component.canSubmit()).toBe(false);
    expect(el('form-error')?.textContent).toContain('leg 2');
  });

  it('rejects a delta outside (0,1]', () => {
    create();
    fillLegs('0.5', '30', '50', '30'); // raw '50' is not a delta
    expect(component.canSubmit()).toBe(false);
  });

  it('rejects a Δ sign mismatched with the leg type', () => {
    create();
    fillLegs('-0.5', '30', '0.4', '30'); // negative delta on a call slot
    expect(component.canSubmit()).toBe(false);
    expect(el('form-error')?.textContent).toMatch(/sign/i);
  });

  it('rejects sub-percent Δ precision the ID cannot encode', () => {
    create();
    fillLegs('0.505', '30', '0.4', '30');
    expect(component.canSubmit()).toBe(false);
    expect(el('form-error')?.textContent).toMatch(/percent/i);
  });

  it('handles real DOM input events — type=number emits number|null', () => {
    create();
    const delta0 = el('leg-delta-0') as HTMLInputElement;
    const dte0 = el('leg-dte-0') as HTMLInputElement;
    const delta1 = el('leg-delta-1') as HTMLInputElement;
    const dte1 = el('leg-dte-1') as HTMLInputElement;

    // ngModel on type=number emits numbers through NumberValueAccessor,
    // not strings — this drove the trim() crash the unit-fill bypassed.
    delta0.value = '0.5';
    delta0.dispatchEvent(new Event('input'));
    dte0.value = '30';
    dte0.dispatchEvent(new Event('input'));
    delta1.value = '0.4';
    delta1.dispatchEvent(new Event('input'));
    dte1.value = '30';
    dte1.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    expect(component.legInputs()[0].delta).toBe('0.5');
    expect(component.name()).toBe('call debit spread 30 50-40');
    expect(component.formError()).not.toBeNull(); // dup catalog recipe+name

    // Clearing back to '' emits null — must normalize, not crash.
    delta1.value = '';
    delta1.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(component.legInputs()[1].delta).toBe('');
    expect(el('form-error')?.textContent).toContain('leg 2');
  });

  it('syncs DTE edits across legs — verticals share one expiry (uniformDte)', () => {
    create();
    component.setLegInput(1, 'dte', '45'); // editing either leg…
    fixture.detectChanges();
    expect(component.legInputs()[0].dte).toBe('45'); // …updates the other
    component.setLegInput(0, 'dte', '60');
    fixture.detectChanges();
    expect(component.legInputs()[1].dte).toBe('60');
    // Multi-expiry is unreachable via the dialog — the uniform-DTE
    // guard in formError remains as the invariant.
    expect(component.formError()).toBeNull();
  });

  it('rejects a credit-ordered recipe on a debit template (direction)', () => {
    create();
    fillLegs('0.4', '30', '0.5', '30'); // |short| > |long| — not a debit spread
    expect(component.canSubmit()).toBe(false);
    expect(el('form-error')?.textContent).toMatch(/debit/i);
    // Equal deltas also violate strict ordering.
    fillLegs('0.5', '30', '0.5', '30');
    expect(component.canSubmit()).toBe(false);
    expect(el('form-error')?.textContent).toMatch(/debit/i);
  });

  it('rejects a name that duplicates an existing variant (catalog or session)', () => {
    create();
    fillLegs('0.55', '35', '0.45', '35'); // novel recipe — only the name dups
    component.name.set('call debit spread 30 50-40'); // catalog variant #0's name
    component.nameTouched.set(true);
    fixture.detectChanges();
    expect(component.canSubmit()).toBe(false);
    expect(el('form-error')?.textContent).toMatch(/name/i);
  });

  it('rejects a recipe whose deterministic id already exists in the catalog', () => {
    create();
    fillLegs('0.5', '30', '0.4', '30');
    component.name.set('unique name');
    component.nameTouched.set(true);
    fixture.detectChanges();
    expect(component.canSubmit()).toBe(false);
    expect(el('form-error')?.textContent).toContain('cds-30-50-40');
  });

  it('saves an ephemeral ad hoc variant into the session list — dialog stays open', () => {
    create();
    fillLegs('0.5', '35', '0.35', '35');
    component.name.set('call debit spread 35 50-35');
    component.nameTouched.set(true);
    fixture.detectChanges();

    component.save();

    expect(mockStore.addSessionVariant).toHaveBeenCalledTimes(1);
    const v: ManageVariant = mockStore.addSessionVariant.mock.calls[0][0];
    expect(v.templateId).toBe(CDS);
    expect(v.id).toBe('cds-35-50-35');
    expect(v.dte).toBe(35);
    expect(v.legs).toHaveLength(2);
    expect(v.legs[0]).toMatchObject({ kind: 'option', targetDelta: 0.5, dte: 35 });
    expect(v.legs[1]).toMatchObject({ kind: 'option', targetDelta: 0.35, dte: 35 });
    // Stays open for a creation run — the X is the only close button.
    expect(mockRef.close).not.toHaveBeenCalled();
    fixture.detectChanges();
    expect(el('saved-note')?.textContent).toContain('call debit spread 35 50-35');
    // Name re-suggests for the next recipe.
    expect(component.nameTouched()).toBe(false);

    // Once the store reflects the save, the unchanged recipe can't be
    // resubmitted — an edit re-enables Save.
    mockStore.variants.set([...MANAGE_VARIANTS, v]);
    fixture.detectChanges();
    expect(component.canSubmit()).toBe(false);
    fillLegs('0.5', '40', '0.35', '40');
    expect(component.canSubmit()).toBe(true);
  });

  it('the X is the only in-dialog close control — no Cancel button', () => {
    create();
    expect(el('dialog-cancel')).toBeNull();
    const x = el('dialog-x') as HTMLButtonElement;
    expect(x).toBeTruthy();
    x.click();
    expect(mockRef.close).toHaveBeenCalledWith(undefined);
  });

  it('disables Save while the draft is identical to a saved variant — nothing to save', () => {
    create([
      {
        id: 'cds-30-65-55',
        name: 'call debit spread 30 65-55',
        templateId: CDS,
        dte: 30,
        legs: [
          { kind: 'option', type: OptionType.CALL, side: TradeSide.LONG, targetDelta: 0.65, dte: 30 },
          { kind: 'option', type: OptionType.CALL, side: TradeSide.SHORT, targetDelta: 0.55, dte: 30 },
        ],
      },
    ]);
    // Defaults mint exactly cds-30-65-55 — already registered, no error…
    expect(component.formError()).toBeNull();
    // …but Save is disabled: identical variant exists, nothing changed.
    expect(component.canSubmit()).toBe(false);
    // Any edit re-enables (name rename-in-place or a leg change).
    component.name.set('renamed same recipe');
    fixture.detectChanges();
    expect(component.canSubmit()).toBe(true);
  });

  it('export opens the JSON dialog with registry-shaped JSON', () => {
    create();
    fillLegs('0.55', '40', '0.35', '40');
    component.name.set('call debit spread 40 55-35');
    component.nameTouched.set(true);
    fixture.detectChanges();

    component.exportJson();

    expect(mockDialog.open).toHaveBeenCalledWith(
      ManageExportJsonComponent,
      expect.objectContaining({ data: expect.objectContaining({ json: expect.any(String) }) }),
    );
    const json = JSON.parse(mockDialog.open.mock.calls[0][1].data.json);
    expect(json).toMatchObject({
      id: 'cds-40-55-35',
      name: 'call debit spread 40 55-35',
      templateId: CDS,
      dte: 40,
    });
    expect(json.legs).toHaveLength(2);
  });

  it('export is disabled while the form is invalid', () => {
    create();
    component.setLegInput(0, 'delta', ''); // break the prefilled recipe
    fixture.detectChanges();
    const btn = el('export-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
