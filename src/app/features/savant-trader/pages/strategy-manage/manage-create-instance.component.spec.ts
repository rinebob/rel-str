/// <reference types="jest" />
/**
 * Tests for ManageCreateInstanceComponent — the Create New Instance dialog
 * (#1547). The store is mocked so the seam is the dialog's public form
 * surface: variant/mode/trigger/stop-type pickers, multi-symbol parsing,
 * per-symbol ID preview, duplicate blocking, and the create write.
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

import { ManageCreateInstanceComponent } from './manage-create-instance.component';
import { StrategyManageStore } from '../../stores/strategy-manage.store';
import { DsDialogRef } from '../../../../shared/ds/ds-dialog';
import { MANAGE_VARIANTS } from '@manage/variant-catalog';
import type { ManageInstance } from '@manage/instance-contracts';

function makeInstance(overrides: Partial<ManageInstance> = {}): ManageInstance {
  return {
    id: 'QQQ-CDS-30-50-40-ALL',
    variantRef: 'cds-30-50-40',
    variant: MANAGE_VARIANTS[0],
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'UNSTARTED',
    userId: 'test-user',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

describe('ManageCreateInstanceComponent', () => {
  let fixture: ComponentFixture<ManageCreateInstanceComponent>;
  let component: ManageCreateInstanceComponent;
  let mockStore: {
    variants: ReturnType<typeof signal>;
    sessionVariants: ReturnType<typeof signal>;
    instances: ReturnType<typeof signal>;
    error: ReturnType<typeof signal>;
    createInstances: jest.Mock;
  };
  let mockRef: { close: jest.Mock; disableClose?: boolean };

  const sessionVariant = {
    ...MANAGE_VARIANTS[0],
    id: 'session-cds-30-50-35',
    name: 'call debit spread 30 50-35',
  };

  function create(instances: ManageInstance[] = []): void {
    mockStore = {
      variants: signal([...MANAGE_VARIANTS, sessionVariant]),
      sessionVariants: signal([sessionVariant]),
      instances: signal(instances),
      error: signal<string | null>(null),
      // Filter-submit (#1605): resolves {created, skipped} — default is
      // "everything submitted landed" so clean-only tests close the dialog.
      createInstances: jest
        .fn()
        .mockImplementation((inputs: { id: string }[]) =>
          Promise.resolve({ created: inputs.map((i) => i.id), skipped: [] }),
        ),
    };
    mockRef = { close: jest.fn() };

    TestBed.configureTestingModule({
      imports: [ManageCreateInstanceComponent],
      providers: [
        { provide: StrategyManageStore, useValue: mockStore },
        { provide: DsDialogRef, useValue: mockRef },
      ],
    });
    fixture = TestBed.createComponent(ManageCreateInstanceComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  const el = (testid: string): HTMLElement | null =>
    fixture.nativeElement.querySelector(`[data-testid="${testid}"]`);

  it('offers catalog + session variants in the picker', () => {
    create();
    const select = el('variant-select') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent?.trim());
    expect(labels).toEqual([
      ...MANAGE_VARIANTS.map((v) => v.name),
      'call debit spread 30 50-35',
    ]);
  });

  it('previews one ALL-CAPS instance id per parsed symbol', () => {
    create();
    component.symbolsText.set('qqq, spy');
    fixture.detectChanges();

    expect(el('id-preview-QQQ')?.textContent).toContain('QQQ-CDS-30-50-40-ALL');
    expect(el('id-preview-SPY')?.textContent).toContain('SPY-CDS-30-50-40-ALL');
  });

  it('marks a duplicate row but keeps Create enabled while a clean row exists', () => {
    create([makeInstance()]);
    component.symbolsText.set('QQQ, SPY');
    fixture.detectChanges();

    expect(el('id-preview-QQQ')?.classList).toContain('dup');
    expect(el('id-preview-SPY')?.classList).not.toContain('dup');
    expect((el('dialog-create') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables Create only when every row is flagged', () => {
    create([makeInstance()]);
    component.symbolsText.set('QQQ');
    fixture.detectChanges();
    expect((el('dialog-create') as HTMLButtonElement).disabled).toBe(true);

    component.symbolsText.set('QQQ, BAD-SYM');
    fixture.detectChanges();
    expect((el('dialog-create') as HTMLButtonElement).disabled).toBe(true);
  });

  it('flags unparseable symbols in the preview instead of minting ids', () => {
    create();
    component.symbolsText.set('QQQ, BAD-SYM');
    fixture.detectChanges();

    expect(el('id-preview-BAD-SYM')?.textContent).toContain('not a valid symbol');
    expect((el('dialog-create') as HTMLButtonElement).disabled).toBe(false);
  });

  it('disables the real mode option in v1', () => {
    create();
    const select = el('mode-select') as HTMLSelectElement;
    const real = Array.from(select.options).find((o) => o.value === 'real');
    expect(real?.disabled).toBe(true);
  });

  it('fixes the stop type to ALL under paper and never offers ALL under real', () => {
    create();
    expect(component.stopTypeOptions()).toEqual(['ALL']);

    component.mode.set('real');
    fixture.detectChanges();
    expect(component.stopTypeOptions()).not.toContain('ALL');
    expect(component.stopTypeOptions().length).toBeGreaterThan(0);
  });

  it('creates one instance input per symbol and closes on success', async () => {
    create();
    component.symbolsText.set('QQQ, SPY');
    component.trigger.set('signal');
    fixture.detectChanges();

    await component.create();

    expect(mockStore.createInstances).toHaveBeenCalledWith([
      {
        id: 'QQQ-CDS-30-50-40-ALL',
        variantRef: 'cds-30-50-40',
        variant: MANAGE_VARIANTS[0],
        symbol: 'QQQ',
        mode: 'paper',
        trigger: 'signal',
        stopType: 'ALL',
      },
      {
        id: 'SPY-CDS-30-50-40-ALL',
        variantRef: 'cds-30-50-40',
        variant: MANAGE_VARIANTS[0],
        symbol: 'SPY',
        mode: 'paper',
        trigger: 'signal',
        stopType: 'ALL',
      },
    ]);
    expect(mockRef.close).toHaveBeenCalledWith(true);
  });

  it('submits only the clean rows, keeps the flagged leftovers in the field', async () => {
    create([makeInstance()]);
    component.symbolsText.set('QQQ, SPY, BAD-SYM');
    fixture.detectChanges();

    await component.create();

    // Only SPY minted — the dup (QQQ) and the invalid (BAD-SYM) never
    // reach the write seam.
    expect(mockStore.createInstances).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'SPY-CDS-30-50-40-ALL', symbol: 'SPY' }),
    ]);
    // Dialog stays open; the field keeps exactly the leftovers.
    expect(mockRef.close).not.toHaveBeenCalled();
    expect(component.symbolsText()).toBe('QQQ BAD-SYM');
    fixture.detectChanges();
    expect(el('dialog-notice')?.textContent).toContain('Created 1 — 2 left');
  });

  it('closes when every submitted symbol lands and nothing is left behind', async () => {
    create();
    component.symbolsText.set('QQQ, SPY');
    fixture.detectChanges();

    await component.create();

    expect(component.notice()).toBeNull();
    expect(mockRef.close).toHaveBeenCalledWith(true);
  });

  it('keeps a race-skipped symbol in the field after a partial commit', async () => {
    create();
    mockStore.createInstances.mockResolvedValue({
      created: [],
      skipped: ['QQQ-CDS-30-50-40-ALL'],
    });
    component.symbolsText.set('QQQ');
    fixture.detectChanges();

    await component.create();

    expect(mockRef.close).not.toHaveBeenCalled();
    expect(component.symbolsText()).toBe('QQQ');
    expect(component.notice()).toContain('Created 0 — 1 left');
  });

  it('stamps the adhoc variantRef for session variants', async () => {
    create();
    component.selectedVariantId.set('session-cds-30-50-35');
    component.symbolsText.set('QQQ');
    fixture.detectChanges();

    await component.create();

    expect(mockStore.createInstances).toHaveBeenCalledWith([
      expect.objectContaining({ variantRef: 'adhoc' }),
    ]);
  });

  it('stays open with the failure message inline when the write fails', async () => {
    create();
    mockStore.createInstances.mockResolvedValue("Instance 'SPY-CDS-30-50-40-ALL' already exists");
    component.symbolsText.set('SPY');
    fixture.detectChanges();

    await component.create();

    expect(mockRef.close).not.toHaveBeenCalled();
    expect(component.error()).toContain('already exists');
    expect(component.pending()).toBe(false);
  });

  it('locks backdrop/Escape dismiss while the write is in flight', async () => {
    create();
    let resolveWrite: (v: unknown) => void = () => {};
    mockStore.createInstances.mockReturnValue(
      new Promise((r) => (resolveWrite = r)),
    );
    component.symbolsText.set('QQQ');
    fixture.detectChanges();

    const writing = component.create();
    expect(mockRef.disableClose).toBe(true);

    resolveWrite({ created: ['QQQ-CDS-30-50-40-ALL'], skipped: [] });
    await writing;
    expect(mockRef.disableClose).toBe(false);
    expect(mockRef.close).toHaveBeenCalledWith(true);
  });

  it('surfaces a template-resolution failure in the preview rather than minting', () => {
    create();
    const orphan = {
      ...MANAGE_VARIANTS[0],
      id: 'orphan',
      templateId: 'no-such-template',
    };
    mockStore.variants.set([orphan]);
    component.selectedVariantId.set('orphan');
    component.symbolsText.set('QQQ');
    fixture.detectChanges();

    expect(el('id-preview-QQQ')?.textContent).toContain('did not resolve');
    expect((el('dialog-create') as HTMLButtonElement).disabled).toBe(true);
  });

  it('mints the CUSTOM-segment id for a variant on the custom template sentinel', () => {
    create();
    const custom = {
      ...MANAGE_VARIANTS[0],
      id: 'custom-legs',
      templateId: 'custom',
    };
    mockStore.variants.set([custom]);
    component.selectedVariantId.set('custom-legs');
    component.symbolsText.set('QQQ');
    fixture.detectChanges();

    expect(el('id-preview-QQQ')?.textContent).toContain('QQQ-CUSTOM-');
    expect(el('id-preview-QQQ')?.textContent).not.toContain('not a valid');
  });

  it('resets stopType to a valid option when mode flips', () => {
    create();
    expect(component.stopType()).toBe('ALL');

    component.mode.set('real');
    fixture.detectChanges();

    expect(component.stopType()).not.toBe('ALL');
    expect(component.stopTypeOptions()).toContain(component.stopType());
  });

  it('blocks create past the symbol cap with an inline error', () => {
    create();
    component.symbolsText.set(
      Array.from({ length: 51 }, (_, i) => `SYM${i}`).join(' '),
    );
    fixture.detectChanges();

    expect(el('symbols-error')?.textContent).toContain('Too many symbols');
    expect((el('dialog-create') as HTMLButtonElement).disabled).toBe(true);
  });

  it('dedupes repeated symbols into one preview row', () => {
    create();
    component.symbolsText.set('QQQ QQQ, qqq');
    fixture.detectChanges();

    expect(component.previews().length).toBe(1);
    expect(el('id-preview-QQQ')?.textContent).toContain('QQQ-CDS-30-50-40-ALL');
  });

  it('does not submit when canCreate is false or a write is in flight', async () => {
    create();
    await component.create();
    expect(mockStore.createInstances).not.toHaveBeenCalled();

    component.symbolsText.set('QQQ');
    fixture.detectChanges();
    component.pending.set(true);
    await component.create();
    expect(mockStore.createInstances).not.toHaveBeenCalled();
  });
});
