/**
 * AllocationAssignDialogComponent — the assign/move bucket picker
 * (task #590). ACTIVE buckets only; choosing Unassigned routes through
 * unassignPositions. Bulk mode takes items[] (per-item linkKey preserved).
 * Owns the write — closes only on success.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import {
  AllocationAssignDialogComponent,
  type AssignDialogData,
} from './allocation-assign-dialog.component';
import { AllocationStore } from './allocation.store';
import { BucketStatus } from '@portfolio-allocation/contracts';
import type { AllocationBucket } from '@portfolio-allocation/contracts';

const ACCT = '5AC11111';

function bucket(id: string, name: string): AllocationBucket {
  return {
    id, userId: 'u', accountNumber: ACCT, name, targetPct: 10,
    status: BucketStatus.ACTIVE, createdAt: 'x', updatedAt: 'x',
  };
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

describe('AllocationAssignDialogComponent', () => {
  let fixture: ComponentFixture<AllocationAssignDialogComponent>;
  let dialogRef: { close: jest.Mock };
  let store: { assignPositions: jest.Mock; unassignPositions: jest.Mock };

  async function setup(data: AssignDialogData) {
    dialogRef = { close: jest.fn() };
    store = {
      assignPositions: jest.fn(async () => undefined),
      unassignPositions: jest.fn(async () => undefined),
    };
    await TestBed.configureTestingModule({
      imports: [AllocationAssignDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: MAT_DIALOG_DATA, useValue: data },
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: AllocationStore, useValue: store },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AllocationAssignDialogComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  function data(
    items: AssignDialogData['items'] = [{ instrumentId: 'AAPL' }],
    buckets = [bucket('b1', 'Wheel'), bucket('b2', 'Income')],
  ): AssignDialogData {
    return { mode: 'assign', accountNumber: ACCT, items, buckets };
  }

  function pick(testid: string) {
    (fixture.nativeElement.querySelector(`[data-testid="${testid}"] input`) as HTMLInputElement).click();
    fixture.detectChanges();
  }
  function save() {
    (fixture.nativeElement.querySelector('[data-testid="dialog-save"]') as HTMLButtonElement).click();
  }

  it('single: title names the instrument; picker lists buckets + Unassigned; current preselected', async () => {
    await setup({ ...data(), currentBucketId: 'b1' });
    expect(fixture.nativeElement.textContent).toContain('Assign AAPL');
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="pick-"]').length).toBe(3);
    expect(fixture.nativeElement.textContent).toContain('Wheel');
    expect(fixture.nativeElement.textContent).toContain('Income');
    expect(fixture.nativeElement.textContent).toContain('Unassigned');
    expect(fixture.componentInstance.selected).toBe('b1');
  });

  it('single: confirm writes assignPositions with the item + linkKey, closes(true)', async () => {
    await setup(data([{ instrumentId: 'AAPL', linkKey: 'ord-1' }]));
    pick('pick-b2');
    save();
    await flush();
    expect(store.assignPositions).toHaveBeenCalledWith(
      ACCT, [{ instrumentId: 'AAPL', linkKey: 'ord-1' }], 'b2',
    );
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('choosing Unassigned routes through unassignPositions', async () => {
    await setup({ ...data(), currentBucketId: 'b1' });
    pick('pick-unassigned');
    save();
    await flush();
    expect(store.unassignPositions).toHaveBeenCalledWith(ACCT, ['AAPL']);
    expect(store.assignPositions).not.toHaveBeenCalled();
  });

  it('bulk: title counts items; every item + its linkKey is forwarded', async () => {
    await setup(data([
      { instrumentId: 'AAPL', linkKey: 'ord-1' },
      { instrumentId: 'MSFT' },
    ]));
    expect(fixture.nativeElement.textContent).toContain('Assign 2 positions');
    pick('pick-b1');
    save();
    await flush();
    expect(store.assignPositions).toHaveBeenCalledWith(
      ACCT,
      [{ instrumentId: 'AAPL', linkKey: 'ord-1' }, { instrumentId: 'MSFT' }],
      'b1',
    );
    expect(dialogRef.close).toHaveBeenCalledWith(true);
  });

  it('bulk: no preselect for a mixed selection', async () => {
    await setup(data([{ instrumentId: 'AAPL' }, { instrumentId: 'MSFT' }]));
    expect(fixture.componentInstance.selected).toBe('__unassigned__');
    // Unassign is the no-op choice — save disabled until a bucket is picked.
    expect((fixture.nativeElement.querySelector('[data-testid="dialog-save"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('linkKey note shows when any item is linked', async () => {
    await setup(data([{ instrumentId: 'AAPL', linkKey: 'ord-1' }]));
    const note = fixture.nativeElement.querySelector('[data-testid="link-note"]');
    expect(note).toBeTruthy();
    expect(note.textContent).toContain('leg');
  });

  it('no linkKey note for unlinked items', async () => {
    await setup(data());
    expect(fixture.nativeElement.querySelector('[data-testid="link-note"]')).toBeNull();
  });

  it('write failure: stays open, shows error, no close', async () => {
    await setup(data());
    store.assignPositions.mockRejectedValue(new Error("Target bucket 'b1' is missing or retired"));
    pick('pick-b1');
    save();
    await flush();
    fixture.detectChanges();
    expect(dialogRef.close).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('[data-testid="dialog-error"]')?.textContent)
      .toContain('missing or retired');
  });
});
