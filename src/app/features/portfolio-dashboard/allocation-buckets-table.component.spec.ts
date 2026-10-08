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
import type { BucketRow, PositionRow } from './allocation.types';
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

function posRow(instrumentId: string, bucketId: string | null, unresolved = false, quantity = 10): PositionRow {
  return {
    position: { instrumentId, quantity, marketValue: 1200, costBasis: 1000 },
    bucketId,
    // Mirrors the store derivation: null → 'Unassigned', dangling → 'Unknown bucket'.
    bucketName: bucketId === null ? 'Unassigned' : (unresolved ? 'Unknown bucket' : bucketId),
    ...(unresolved ? { unresolved: true } : {}),
  };
}

function mockStore(rows: BucketRow[], positions: PositionRow[] = []) {
  return {
    bucketRows: signal<BucketRow[]>(rows),
    positionsRows: signal<PositionRow[]>(positions),
    selectedAccount: signal<AccountInfo | null>({
      accountNumber: ACCT, accountName: 'A', accountType: 'margin', agenticAllowed: true,
    }),
  };
}

describe('AllocationBucketsTableComponent', () => {
  let fixture: ComponentFixture<AllocationBucketsTableComponent>;
  let store: ReturnType<typeof mockStore>;
  let dialog: { open: jest.Mock };

  async function setup(rows: BucketRow[], positions: PositionRow[] = []) {
    store = mockStore(rows, positions);
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
      { kind: 'cash', bucket: null, stats: null, cash: { actual: 4000, derived: 3900, discrepancy: 100, diverged: false } },
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
      { kind: 'cash', bucket: null, stats: null, cash: { actual: 4000, derived: 3100, discrepancy: 900, diverged: true } },
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

  // ── #693: expandable bucket rows ────────────────────────────────────────

  it('bucket name expands an inline panel with stats + the bucket positions — no dialog', async () => {
    const b = bucket('b1', 'Wheel', 25);
    await setup(
      [bucketRow(b)],
      [posRow('AAPL', 'b1'), posRow('MSFT', 'b1'), posRow('NVDA', 'b2')],
    );
    (fixture.nativeElement.querySelector('[data-testid="expand-b1"]') as HTMLElement).click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('[data-testid="expand-panel-b1"]');
    expect(panel).toBeTruthy();
    // Stats strip — same numbers the row shows.
    expect(panel.textContent).toContain('1,000'); // exposure
    expect(panel.textContent).toContain('900');   // targetDollars
    // Mini-table — this bucket's positions only.
    expect(panel.textContent).toContain('AAPL');
    expect(panel.textContent).toContain('MSFT');
    expect(panel.textContent).not.toContain('NVDA');
    expect(dialog.open).not.toHaveBeenCalled();
  });

  it('expanded mini-table shows column totals for market value, cost basis, and unrealized', async () => {
    const b = bucket('b1', 'Wheel', 25);
    await setup(
      [bucketRow(b)],
      [posRow('AAPL', 'b1'), posRow('MSFT', 'b1'), posRow('NVDA', 'b2')],
    );
    (fixture.nativeElement.querySelector('[data-testid="expand-b1"]') as HTMLElement).click();
    fixture.detectChanges();

    // Two positions in b1: MV 1200 each, cost 1000 each, unrealized 200 each.
    const totals = fixture.nativeElement.querySelector('[data-testid="expand-totals-b1"]');
    expect(totals).toBeTruthy();
    expect(totals.textContent).toContain('Total');
    expect(totals.textContent).toContain('2,400'); // market value
    expect(totals.textContent).toContain('2,000'); // cost basis
    expect(totals.textContent).toContain('400');   // unrealized
    // Qty total is meaningless across instruments — the cell stays empty.
    const qtyCell = totals.querySelector('.qty');
    expect(qtyCell.textContent.trim()).toBe('');
  });

  it('mini-table renders fractional share quantities to 2 decimals', async () => {
    const b = bucket('b1', 'Wheel', 25);
    await setup([bucketRow(b)], [posRow('AAPL', 'b1', false, 1.64123)]);
    (fixture.nativeElement.querySelector('[data-testid="expand-b1"]') as HTMLElement).click();
    fixture.detectChanges();
    const cell = fixture.nativeElement.querySelector('[data-testid="expand-pos-AAPL"] .num');
    expect(cell.textContent.trim()).toBe('1.64');
  });

  it('a second name click collapses the panel', async () => {
    const b = bucket('b1', 'Wheel', 25);
    await setup([bucketRow(b)], [posRow('AAPL', 'b1')]);
    const link = () => fixture.nativeElement.querySelector('[data-testid="expand-b1"]') as HTMLElement;
    link().click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="expand-panel-b1"]')).toBeTruthy();
    link().click(); fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="expand-panel-b1"]')).toBeNull();
  });

  it('multiple rows can be expanded at once', async () => {
    await setup(
      [bucketRow(bucket('b1', 'A', 60)), bucketRow(bucket('b2', 'B', 40))],
      [posRow('AAPL', 'b1'), posRow('MSFT', 'b2')],
    );
    for (const id of ['expand-b1', 'expand-b2']) {
      (fixture.nativeElement.querySelector(`[data-testid="${id}"]`) as HTMLElement).click();
    }
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="expand-panel-b1"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="expand-panel-b2"]')).toBeTruthy();
  });

  it('the Unassigned row expands to list unattributed positions', async () => {
    await setup(
      [{ kind: 'unassigned', bucket: null, stats: null, cash: null }],
      [posRow('AAPL', null), posRow('MSFT', 'gone-bucket', true), posRow('NVDA', 'b1')],
    );
    (fixture.nativeElement.querySelector('[data-testid="expand-unassigned"]') as HTMLElement).click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('[data-testid="expand-panel-unassigned"]');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('AAPL');
    // Dangling attribution (deleted bucket) counts as unassigned too.
    expect(panel.textContent).toContain('MSFT');
    expect(panel.textContent).not.toContain('NVDA');
  });

  it('retired rows expand inside the retired section', async () => {
    const b = bucket('b2', 'Old', 30, BucketStatus.RETIRED);
    await setup([bucketRow(bucket('b1', 'Active', 25)), bucketRow(b)], [posRow('AAPL', 'b2')]);
    (fixture.nativeElement.querySelector('[data-testid="retired-toggle"]') as HTMLElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="expand-b2"]') as HTMLElement).click();
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('[data-testid="expand-panel-b2"]');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('AAPL');
  });

  it('the Cash row has no expand affordance', async () => {
    await setup([
      { kind: 'cash', bucket: null, stats: null, cash: { actual: 4000, derived: 3900, discrepancy: 100, diverged: false } },
    ]);
    expect(fixture.nativeElement.querySelector('[data-kind="cash"] [data-testid^="expand-"]')).toBeNull();
  });

  it('an empty bucket expands to an empty state, not a blank panel', async () => {
    const b = bucket('b1', 'Empty', 25);
    await setup([bucketRow(b)]);
    (fixture.nativeElement.querySelector('[data-testid="expand-b1"]') as HTMLElement).click();
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('[data-testid="expand-panel-b1"]');
    expect(panel).toBeTruthy();
    expect(panel.textContent).toContain('No positions');
  });

  it('expanded panel re-derives when positions change — a moved position disappears', async () => {
    const b = bucket('b1', 'Wheel', 25);
    await setup([bucketRow(b)], [posRow('AAPL', 'b1')]);
    (fixture.nativeElement.querySelector('[data-testid="expand-b1"]') as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="expand-panel-b1"]').textContent).toContain('AAPL');

    store.positionsRows.set([posRow('AAPL', 'b2')]); // moved out of b1
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="expand-panel-b1"]').textContent).not.toContain('AAPL');
    expect(fixture.nativeElement.querySelector('[data-testid="expand-panel-b1"]').textContent).toContain('No positions');
  });
});
