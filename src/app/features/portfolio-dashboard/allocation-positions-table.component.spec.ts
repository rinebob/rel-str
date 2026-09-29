/**
 * AllocationPositionsTableComponent — the Positions subtab (task #590).
 * Every row shows its bucket (or Unassigned); the All/Unassigned filter
 * and per-row assign action live here. The dialog owns writes.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';

import { AllocationPositionsTableComponent } from './allocation-positions-table.component';
import { AllocationAssignDialogComponent } from './allocation-assign-dialog.component';
import { AllocationStore } from './allocation.store';
import type { AccountInfo } from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import type { AccountAllocation, PositionRow } from './allocation.types';
import { BucketStatus } from '@portfolio-allocation/contracts';
import type { AllocationBucket, PositionAttribution } from '@portfolio-allocation/contracts';

const ACCT = '5AC11111';

function activeBucket(id: string, name: string): AllocationBucket {
  return {
    id, userId: 'u', accountNumber: ACCT, name, targetPct: 10,
    status: BucketStatus.ACTIVE, createdAt: 'x', updatedAt: 'x',
  };
}

function row(
  instrumentId: string, bucketId: string | null, bucketName: string,
  linkKey?: string, unresolved?: boolean,
): PositionRow {
  return {
    position: {
      instrumentId, marketValue: 1000, costBasis: 900, quantity: 1,
    },
    bucketId, bucketName, linkKey, unresolved,
  };
}

function mockStore(rows: PositionRow[], buckets: AllocationBucket[], attrs: PositionAttribution[] = []) {
  return {
    positionsRows: signal<PositionRow[]>(rows),
    selectedAllocation: signal<AccountAllocation>({
      snapshot: null, positions: [], fills: [], buckets, attributions: attrs,
      asOf: null, loading: false, error: null,
    }),
    selectedAccount: signal<AccountInfo | null>({
      accountNumber: ACCT, accountName: 'A', accountType: 'margin', agenticAllowed: true,
    }),
    assignPositions: jest.fn(async () => undefined),
    unassignPositions: jest.fn(async () => undefined),
  };
}

describe('AllocationPositionsTableComponent', () => {
  let fixture: ComponentFixture<AllocationPositionsTableComponent>;
  let store: ReturnType<typeof mockStore>;
  let dialog: { open: jest.Mock };

  async function setup(rows: PositionRow[], buckets: AllocationBucket[] = [activeBucket('b1', 'Wheel')]) {
    store = mockStore(rows, buckets);
    dialog = { open: jest.fn(() => ({ afterClosed: () => of(undefined) })) };
    await TestBed.configureTestingModule({
      imports: [AllocationPositionsTableComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: AllocationStore, useValue: store },
        { provide: MatDialog, useValue: dialog },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AllocationPositionsTableComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('every row shows instrument, value, and its bucket or Unassigned', async () => {
    await setup([
      row('AAPL', 'b1', 'Wheel'),
      row('MSFT', null, 'Unassigned'),
    ]);
    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="position-row-"]');
    expect(rows.length).toBe(2);
    const aapl = fixture.nativeElement.querySelector('[data-testid="position-row-AAPL"]');
    const msft = fixture.nativeElement.querySelector('[data-testid="position-row-MSFT"]');
    expect(aapl.textContent).toContain('AAPL');
    expect(aapl.textContent).toContain('1,000');
    expect(aapl.textContent).toContain('Wheel');
    expect(msft.textContent).toContain('Unassigned');
  });

  it('Unassigned filter shows exactly the unattributed positions', async () => {
    await setup([
      row('AAPL', 'b1', 'Wheel'),
      row('MSFT', null, 'Unassigned'),
      row('TSLA', null, 'Unassigned'),
    ]);
    const filter = fixture.nativeElement.querySelector('[data-testid="filter-unassigned"]');
    filter.click();
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="position-row-"]');
    expect(rows.length).toBe(2);
    expect(fixture.nativeElement.textContent).not.toContain('AAPL');
    expect(fixture.nativeElement.textContent).toContain('MSFT');
    expect(fixture.nativeElement.textContent).toContain('TSLA');
    // Filter back to All restores everything.
    fixture.nativeElement.querySelector('[data-testid="filter-all"]').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('[data-testid^="position-row-"]').length).toBe(3);
  });

  it('row count badge on the Unassigned filter', async () => {
    await setup([row('AAPL', 'b1', 'Wheel'), row('MSFT', null, 'Unassigned')]);
    const filter = fixture.nativeElement.querySelector('[data-testid="filter-unassigned"]');
    expect(filter.textContent).toContain('1');
  });

  it('dangling attribution (Unknown bucket) counts + filters as unassigned', async () => {
    await setup([
      row('AAPL', 'b1', 'Wheel'),
      row('GONE', 'deleted-id', 'Unknown bucket', undefined, true),
    ]);
    const filter = fixture.nativeElement.querySelector('[data-testid="filter-unassigned"]');
    expect(filter.textContent).toContain('1'); // the dangling row only
    filter.click();
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('[data-testid^="position-row-"]');
    expect(rows.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Unknown bucket');
    expect(fixture.nativeElement.textContent).not.toContain('Wheel');
  });

  it('assign action opens the picker with ACTIVE buckets + current context', async () => {
    await setup(
      [row('AAPL', 'b2', 'Income')],
      [activeBucket('b1', 'Wheel'), activeBucket('b2', 'Income'),
       { ...activeBucket('b3', 'Dead'), status: BucketStatus.RETIRED }],
    );
    (fixture.nativeElement.querySelector('[data-testid="assign-AAPL"]') as HTMLElement).click();
    const [comp, cfg] = dialog.open.mock.calls[0];
    expect(comp).toBe(AllocationAssignDialogComponent);
    expect(cfg.data.accountNumber).toBe(ACCT);
    expect(cfg.data.items).toEqual([{ instrumentId: 'AAPL', linkKey: undefined }]);
    expect(cfg.data.currentBucketId).toBe('b2');
    // Retired bucket filtered out of the picker.
    expect(cfg.data.buckets.map((b: AllocationBucket) => b.id)).toEqual(['b1', 'b2']);
  });

  it('a linked row passes its linkKey so the group moves atomically', async () => {
    await setup([row('SPY-P', 'b1', 'Wheel', 'ord-9')]);
    (fixture.nativeElement.querySelector('[data-testid="assign-SPY-P"]') as HTMLElement).click();
    const [, cfg] = dialog.open.mock.calls[0];
    expect(cfg.data.items).toEqual([{ instrumentId: 'SPY-P', linkKey: 'ord-9' }]);
  });

  // -- bulk selection --

  function checkRow(id: string) {
    (fixture.nativeElement
      .querySelector(`[data-testid="select-${id}"] input`) as HTMLInputElement).click();
    fixture.detectChanges();
  }

  it('checking rows shows the selection bar with the count', async () => {
    await setup([row('AAPL', null, 'Unassigned'), row('MSFT', null, 'Unassigned')]);
    expect(fixture.nativeElement.querySelector('[data-testid="selection-bar"]')).toBeNull();
    checkRow('AAPL');
    checkRow('MSFT');
    const bar = fixture.nativeElement.querySelector('[data-testid="selection-bar"]');
    expect(bar.textContent).toContain('2 selected');
  });

  it('select-all checks the filtered view only', async () => {
    await setup([
      row('AAPL', 'b1', 'Wheel'),
      row('MSFT', null, 'Unassigned'),
      row('TSLA', null, 'Unassigned'),
    ]);
    (fixture.nativeElement.querySelector('[data-testid="filter-unassigned"]') as HTMLElement).click();
    fixture.detectChanges();
    fixture.nativeElement.querySelector('[data-testid="select-all"] input').click();
    fixture.detectChanges();
    // 2 visible unassigned rows selected — AAPL (hidden) is not.
    expect(fixture.nativeElement.querySelector('[data-testid="selection-bar"]').textContent)
      .toContain('2 selected');
  });

  it('bulk assign opens the dialog with all checked items + linkKeys', async () => {
    await setup([
      row('AAPL', null, 'Unassigned'),
      row('SPY-P', 'b1', 'Wheel', 'ord-9'),
    ]);
    checkRow('AAPL');
    checkRow('SPY-P');
    (fixture.nativeElement.querySelector('[data-testid="bulk-actions"]') as HTMLElement).click();
    fixture.detectChanges();
    // mat-menu items live in the overlay container.
    (document.querySelector('[data-testid="bulk-assign"]') as HTMLElement).click();
    const [, cfg] = dialog.open.mock.calls[0];
    expect(cfg.data.items).toEqual([
      { instrumentId: 'AAPL', linkKey: undefined },
      { instrumentId: 'SPY-P', linkKey: 'ord-9' },
    ]);
    expect(cfg.data.currentBucketId).toBeUndefined(); // mixed selection
  });

  it('bulk unassign writes each checked id and clears the selection', async () => {
    await setup([row('AAPL', 'b1', 'Wheel'), row('MSFT', 'b1', 'Wheel')]);
    checkRow('AAPL');
    checkRow('MSFT');
    (fixture.nativeElement.querySelector('[data-testid="bulk-actions"]') as HTMLElement).click();
    fixture.detectChanges();
    (document.querySelector('[data-testid="bulk-unassign"]') as HTMLElement).click();
    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();
    expect(store.unassignPositions).toHaveBeenCalledWith(ACCT, ['AAPL', 'MSFT']);
    expect(fixture.nativeElement.querySelector('[data-testid="selection-bar"]')).toBeNull();
  });
});
