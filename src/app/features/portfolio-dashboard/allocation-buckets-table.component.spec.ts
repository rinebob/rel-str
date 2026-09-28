/**
 * AllocationBucketsTableComponent — the unified Buckets subtab (task #589).
 *
 * Config + analytics in one table: name, target %, target $, exposure,
 * drift, P&L, open/closed, status — plus row actions (edit, retire) and a
 * create affordance. Cash pinned last, Unassigned shown with no actions,
 * RETIRED buckets collapsed into a toggleable section. The dialog owns
 * writes — the table only opens it with the right data.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { AllocationBucketsTableComponent } from './allocation-buckets-table.component';
import { AllocationBucketDialogComponent } from './allocation-bucket-dialog.component';
import { AllocationStore } from './allocation.store';
import type { AccountInfo } from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { BucketRow } from './allocation.types';
import { BucketStatus } from '@portfolio-allocation/contracts';
import type { AllocationBucket } from '@portfolio-allocation/contracts';

const ACCT = '5AC11111';

function bucket(id: string, name: string, targetPct: number, status = BucketStatus.ACTIVE): AllocationBucket {
  return {
    id, userId: 'u', accountNumber: ACCT, name, targetPct, status,
    createdAt: 'x', updatedAt: 'x',
  };
}

function bucketRow(b: AllocationBucket, exposure = 1000): BucketRow {
  return {
    kind: 'bucket', bucket: b, cash: null,
    stats: {
      bucketId: b.id, exposure, netValue: exposure,
      targetDollars: exposure * 0.9, drift: exposure * 0.1,
      realizedPnl: 120, unrealizedPnl: -40, openCount: 2, closedCount: 1,
      asOf: 'x', equityCurve: [],
    },
  };
}

function mockStore(rows: BucketRow[]) {
  return {
    bucketRows: signal<BucketRow[]>(rows),
    selectedAccount: signal<AccountInfo | null>({
      accountNumber: ACCT, accountName: 'A', accountType: 'margin', agenticAllowed: true,
    }),
  };
}

describe('AllocationBucketsTableComponent', () => {
  let fixture: ComponentFixture<AllocationBucketsTableComponent>;
  let store: ReturnType<typeof mockStore>;
  let dialog: { open: jest.Mock };

  async function setup(rows: BucketRow[]) {
    store = mockStore(rows);
    dialog = { open: jest.fn(() => ({ afterClosed: () => of(undefined) })) };
    await TestBed.configureTestingModule({
      imports: [AllocationBucketsTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: AllocationStore, useValue: store },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AllocationBucketsTableComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('renders all row kinds — buckets, Unassigned, Cash pinned last', async () => {
    await setup([
      bucketRow(bucket('b1', 'Wheel', 25)),
      { kind: 'unassigned', bucket: null, stats: null, cash: null },
      { kind: 'cash', bucket: null, stats: null, cash: { actual: 4000, derived: 3900, diverged: false } as never },
    ]);
    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="bucket-row-"]');
    expect(rows.length).toBe(3);
    const last = rows[rows.length - 1];
    expect(last.getAttribute('data-kind')).toBe('cash');
    expect(last.textContent).toContain('Cash');
    // Unassigned row has no row actions.
    const un = fixture.nativeElement.querySelector('[data-kind="unassigned"]');
    expect(un.querySelector('[data-testid^="edit-"]')).toBeNull();
    expect(un.querySelector('[data-testid^="retire-"]')).toBeNull();
  });

  it('bucket row shows name, target %, target $, exposure, drift, P&L, counts, status', async () => {
    await setup([bucketRow(bucket('b1', 'Wheel', 25), 1000)]);
    const row = fixture.nativeElement.querySelector('[data-testid="bucket-row-b1"]');
    const text = row.textContent;
    expect(text).toContain('Wheel');
    expect(text).toContain('25');
    expect(text).toContain('900');   // targetDollars
    expect(text).toContain('1,000'); // exposure
    expect(text).toContain('100');   // drift
    expect(text).toContain('120');   // realized
    expect(text).toContain('-40');   // unrealized
    expect(text).toContain('2');     // openCount
    expect(text).toContain('ACTIVE');
  });

  it('retired buckets live in a collapsed section — hidden by default, stats intact when expanded', async () => {
    await setup([
      bucketRow(bucket('b1', 'Active', 25)),
      bucketRow(bucket('b2', 'Old', 30, BucketStatus.RETIRED)),
    ]);
    // Main table: only the active row. Retired section header shows the count.
    const mainRows = fixture.nativeElement
      .querySelectorAll('tbody > tr[data-testid^="bucket-row-"]');
    expect(mainRows.length).toBe(1);
    const toggle = fixture.nativeElement.querySelector('[data-testid="retired-toggle"]');
    expect(toggle.textContent).toContain('Retired (1)');
    // Hidden until toggled.
    expect(fixture.nativeElement.querySelector('.retired')).toBeNull();
    toggle.click();
    fixture.detectChanges();
    const retiredRow = fixture.nativeElement.querySelector('.retired [data-testid="bucket-row-b2"]');
    expect(retiredRow).toBeTruthy();
    expect(retiredRow.textContent).toContain('Old');
    expect(retiredRow.textContent).toContain('30');    // targetPct preserved
    expect(retiredRow.textContent).toContain('1,000'); // exposure preserved
    expect(retiredRow.textContent).toContain('RETIRED');
    // No edit/retire on retired rows — but delete stays available.
    expect(retiredRow.querySelector('[data-testid^="edit-"]')).toBeNull();
    expect(retiredRow.querySelector('[data-testid^="retire-"]')).toBeNull();
    expect(retiredRow.querySelector('[data-testid="delete-b2"]')).toBeTruthy();
  });

  it('warns (never blocks) when active targets sum over 100%', async () => {
    await setup([
      bucketRow(bucket('b1', 'A', 60)),
      bucketRow(bucket('b2', 'B', 50)),
      bucketRow(bucket('b3', 'Ret', 30, BucketStatus.RETIRED)), // retired targets don't count
    ]);
    const warn = fixture.nativeElement.querySelector('[data-testid="target-over-100"]');
    expect(warn).toBeTruthy();
    expect(warn.textContent).toContain('110');
  });

  it('cash row surfaces the diverged note when broker ≠ derived', async () => {
    await setup([
      { kind: 'cash', bucket: null, stats: null, cash: { actual: 4000, derived: 3100, diverged: true } as never },
    ]);
    const row = fixture.nativeElement.querySelector('[data-kind="cash"]');
    expect(row.textContent).toContain('diverge');
    expect(row.textContent).toContain('4,000');
    expect(row.textContent).toContain('3,100');
  });

  it('no warn when targets fit within 100%', async () => {
    await setup([bucketRow(bucket('b1', 'A', 60)), bucketRow(bucket('b2', 'B', 40))]);
    expect(fixture.nativeElement.querySelector('[data-testid="target-over-100"]')).toBeNull();
  });

  it('create button opens the dialog in create mode with the account number', async () => {
    await setup([]);
    (fixture.nativeElement.querySelector('[data-testid="create-bucket-btn"]') as HTMLElement).click();
    expect(dialog.open).toHaveBeenCalledWith(
      AllocationBucketDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({ mode: 'create', accountNumber: ACCT }),
      }),
    );
  });

  it('edit opens dialog in edit mode with the row bucket + account', async () => {
    const b = bucket('b1', 'Wheel', 25);
    await setup([bucketRow(b)]);
    (fixture.nativeElement.querySelector('[data-testid="edit-b1"]') as HTMLElement).click();
    expect(dialog.open).toHaveBeenCalledWith(
      AllocationBucketDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({ mode: 'edit', accountNumber: ACCT, bucket: b }),
      }),
    );
  });

  it('retire opens a confirm dialog targeting the bucket', async () => {
    const b = bucket('b1', 'Wheel', 25);
    await setup([bucketRow(b)]);
    (fixture.nativeElement.querySelector('[data-testid="retire-b1"]') as HTMLElement).click();
    expect(dialog.open).toHaveBeenCalledWith(
      AllocationBucketDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({ mode: 'retire', accountNumber: ACCT, bucket: b }),
      }),
    );
  });

  it('delete opens a confirm dialog targeting the bucket — active rows', async () => {
    const b = bucket('b1', 'Wheel', 25);
    await setup([bucketRow(b)]);
    (fixture.nativeElement.querySelector('[data-testid="delete-b1"]') as HTMLElement).click();
    expect(dialog.open).toHaveBeenCalledWith(
      AllocationBucketDialogComponent,
      expect.objectContaining({
        data: expect.objectContaining({ mode: 'delete', accountNumber: ACCT, bucket: b }),
      }),
    );
  });
});
