/**
 * AllocationBucketDialogComponent — the single create/edit/retire dialog
 * (task #589). The dialog owns the store write: closes only on success,
 * stays open with an inline error on failure.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import {
  AllocationBucketDialogComponent,
  type BucketDialogData,
} from './allocation-bucket-dialog.component';
import { AllocationStore } from './allocation.store';
import { BucketStatus } from '@portfolio-allocation/contracts';
import type { AllocationBucket } from '@portfolio-allocation/contracts';

const ACCT = '5AC11111';
const BUCKET: AllocationBucket = {
  id: 'b1', userId: 'u', accountNumber: ACCT, name: 'Wheel',
  targetPct: 25, status: BucketStatus.ACTIVE, createdAt: 'x', updatedAt: 'x',
};

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('AllocationBucketDialogComponent', () => {
  let fixture: ComponentFixture<AllocationBucketDialogComponent>;
  let dialogRef: { close: jest.Mock };
  let store: {
    createBucket: jest.Mock;
    renameBucket: jest.Mock;
    updateTargetPct: jest.Mock;
    retireBucket: jest.Mock;
    deleteBucket: jest.Mock;
  };

  async function setup(data: BucketDialogData) {
    dialogRef = { close: jest.fn() };
    store = {
      createBucket: jest.fn(async () => undefined),
      renameBucket: jest.fn(async () => undefined),
      updateTargetPct: jest.fn(async () => undefined),
      retireBucket: jest.fn(async () => undefined),
      deleteBucket: jest.fn(async () => undefined),
    };
    await TestBed.configureTestingModule({
      imports: [AllocationBucketDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: AllocationStore, useValue: store },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AllocationBucketDialogComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  function fields() {
    const el = fixture.nativeElement as HTMLElement;
    return {
      name: el.querySelector('[data-testid="bucket-name-input"]') as HTMLInputElement,
      pct: el.querySelector('[data-testid="bucket-pct-input"]') as HTMLInputElement,
      save: el.querySelector('[data-testid="dialog-save"]') as HTMLButtonElement,
      confirm: el.querySelector('[data-testid="dialog-confirm"]') as HTMLButtonElement | null,
    };
  }

  function setInput(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
  }

  it('create: save disabled until valid, then writes + closes(true)', async () => {
    await setup({ mode: 'create', accountNumber: ACCT });
    const { name, pct, save } = fields();
    expect(save.disabled).toBe(true);
    setInput(name, 'Wheel');
    setInput(pct, '25');
    expect(save.disabled).toBe(false);
    save.click();
    await flush();
    expect(store.createBucket).toHaveBeenCalledWith(ACCT, 'Wheel', 25);
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('edit: prefilled; writes only what changed', async () => {
    await setup({ mode: 'edit', accountNumber: ACCT, bucket: BUCKET });
    const { name, pct, save } = fields();
    expect(name.value).toBe('Wheel');
    expect(pct.value).toBe('25');
    setInput(name, 'Theta Wheel');
    save.click();
    await flush();
    expect(store.renameBucket).toHaveBeenCalledWith(ACCT, 'b1', 'Theta Wheel');
    expect(store.updateTargetPct).not.toHaveBeenCalled(); // unchanged
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('edit: target-only change writes just the target', async () => {
    await setup({ mode: 'edit', accountNumber: ACCT, bucket: BUCKET });
    const { pct, save } = fields();
    setInput(pct, '30');
    save.click();
    await flush();
    expect(store.renameBucket).not.toHaveBeenCalled();
    expect(store.updateTargetPct).toHaveBeenCalledWith(ACCT, 'b1', 30);
  });

  it('retire: confirm copy + retire write + close(true)', async () => {
    await setup({ mode: 'retire', accountNumber: ACCT, bucket: BUCKET });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Wheel');
    expect(text).toContain('reject new attributions');
    expect(fixture.nativeElement.querySelector('[data-testid="bucket-name-input"]')).toBeNull();
    fields().confirm!.click();
    await flush();
    expect(store.retireBucket).toHaveBeenCalledWith(ACCT, 'b1');
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('write failure: stays open, shows the error, no close', async () => {
    await setup({ mode: 'create', accountNumber: ACCT });
    store.createBucket.mockRejectedValue(new Error('Bucket name conflict'));
    const { name, pct, save } = fields();
    setInput(name, 'Wheel');
    setInput(pct, '25');
    save.click();
    await flush();
    fixture.detectChanges();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="dialog-error"]')?.textContent)
      .toContain('Bucket name conflict');
    // Retry enabled — not stuck pending.
    expect(fields().save.disabled).toBe(false);
  });

  it('delete: confirm copy says contents return to Unassigned; writes + closes(true)', async () => {
    await setup({ mode: 'delete', accountNumber: ACCT, bucket: BUCKET });
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Wheel');
    expect(text).toContain('Unassigned');
    fields().confirm!.click();
    await flush();
    expect(store.deleteBucket).toHaveBeenCalledWith(ACCT, 'b1');
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('cancel closes with no payload', async () => {
    await setup({ mode: 'create', accountNumber: ACCT });
    (fixture.nativeElement.querySelector('[data-testid="dialog-cancel"]') as HTMLButtonElement).click();
    expect(dialogRef.close).toHaveBeenCalledWith(undefined);
    expect(store.createBucket).not.toHaveBeenCalled();
  });

  it('rejects out-of-range / empty inputs', async () => {
    await setup({ mode: 'create', accountNumber: ACCT });
    const { name, pct, save } = fields();
    setInput(name, '  ');
    setInput(pct, '150');
    expect(save.disabled).toBe(true);
    setInput(pct, '-5');
    setInput(name, 'Wheel');
    expect(save.disabled).toBe(true);
  });

  it('cleared pct input (NaN) disables save', async () => {
    await setup({ mode: 'create', accountNumber: ACCT });
    const { name, pct, save } = fields();
    setInput(name, 'Wheel');
    setInput(pct, '');
    expect(save.disabled).toBe(true);
  });
});
