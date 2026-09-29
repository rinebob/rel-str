/**
 * AllocationBucketDetailDialogComponent — the bucket detail dialog
 * (task #591). View-switcher swaps buckets without closing; position
 * carousel iterates the bucket's positions; per-position fills list;
 * trade-chart slot is a stub. All content reads through
 * store.bucketDetail() — selector-driven, so attribution changes
 * elsewhere update the open dialog.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';

import {
  AllocationBucketDetailDialogComponent,
  type BucketDetailDialogData,
} from './allocation-bucket-detail-dialog.component';
import { AllocationStore } from './allocation.store';
import { BucketStatus } from '@portfolio-allocation/contracts';
import type { AllocationBucket } from '@portfolio-allocation/contracts';
import type {
  AccountAllocation,
  BucketDetail,
  PositionRow,
} from './allocation.types';

const ACCT = '5AC11111';

function bucket(id: string, name: string, status = BucketStatus.ACTIVE): AllocationBucket {
  return {
    id, userId: 'u', accountNumber: ACCT, name, targetPct: 25,
    status, createdAt: 'x', updatedAt: 'x',
  };
}

function prow(instrumentId: string, bucketId: string, mv = 1000, cb = 900): PositionRow {
  return {
    position: { instrumentId, quantity: 10, marketValue: mv, costBasis: cb },
    bucketId, bucketName: 'B',
  };
}

function detail(
  b: AllocationBucket,
  ids: string[] = ['AAPL', 'MSFT'],
  fills: BucketDetail['fills'] = [],
): BucketDetail {
  return {
    bucket: b,
    stats: {
      bucketId: b.id, exposure: 2000, netValue: 2000, targetDollars: 2500,
      drift: -500, realizedPnl: 300, unrealizedPnl: 100,
      openCount: ids.length, closedCount: 0, asOf: 'x', equityCurve: [],
    },
    positions: ids.map((id) => prow(id, b.id)),
    fills,
  };
}

describe('AllocationBucketDetailDialogComponent', () => {
  let fixture: ComponentFixture<AllocationBucketDetailDialogComponent>;
  // Signal-backed so bucketDetail() re-derives when the underlying data
  // changes — matching the real store's selector semantics.
  let details: ReturnType<typeof signal<Map<string, BucketDetail | null>>>;
  let buckets: AllocationBucket[];
  let mockedStore: {
    bucketDetail: jest.Mock;
    byAccount: ReturnType<typeof signal<Record<string, AccountAllocation>>>;
  };

  async function setup(bucketId: string) {
    buckets = [bucket('b1', 'Wheel'), bucket('b2', 'Income'), bucket('b3', 'Old', BucketStatus.RETIRED)];
    details = signal(new Map<string, BucketDetail | null>([
      ['b1', detail(buckets[0])],
      ['b2', detail(buckets[1], ['TSLA'])],
      ['b3', detail(buckets[2], [])],
    ]));
    const alloc: AccountAllocation = {
      snapshot: null, positions: [], fills: [], buckets,
      attributions: [], asOf: null, loading: false, error: null,
    };
    mockedStore = {
      bucketDetail: jest.fn((_acct: string, id: string) => details().get(id) ?? null),
      byAccount: signal<Record<string, AccountAllocation>>({ [ACCT]: alloc }),
    };
    await TestBed.configureTestingModule({
      imports: [AllocationBucketDetailDialogComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        {
          provide: MAT_DIALOG_DATA,
          useValue: { accountNumber: ACCT, bucketId } satisfies BucketDetailDialogData,
        },
        { provide: MatDialogRef, useValue: { close: jest.fn() } },
        { provide: AllocationStore, useValue: mockedStore },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AllocationBucketDetailDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable(); // mat-select trigger label resolves async
    fixture.detectChanges();
  }

  function setDetail(bucketId: string, d: BucketDetail | null): void {
    const next = new Map(details());
    next.set(bucketId, d);
    details.set(next);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('header shows bucket name + metadata; stats render', async () => {
    await setup('b1');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Wheel');
    expect(el.textContent).toContain('25');      // targetPct
    expect(el.textContent).toContain('2,000');   // exposure
    expect(el.textContent).toContain('300');     // realized
    expect(el.textContent).toContain('-500');    // drift
  });

  it('dialog opens scoped to the captured account, not the selected one', async () => {
    await setup('b1');
    expect(mockedStore.bucketDetail).toHaveBeenCalledWith(ACCT, 'b1');
  });

  it('carousel iterates positions — pager shows i/N, next/prev walk', async () => {
    await setup('b1');
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-testid="carousel-pager"]')?.textContent).toContain('1 of 2');
    expect(el.textContent).toContain('AAPL');
    (el.querySelector('[data-testid="carousel-next"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="carousel-pager"]')?.textContent).toContain('2 of 2');
    expect(el.textContent).toContain('MSFT');
    (el.querySelector('[data-testid="carousel-prev"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.textContent).toContain('AAPL');
  });

  it('shrink while viewing the LAST position → prev still steps immediately', async () => {
    await setup('b1');
    const el = fixture.nativeElement as HTMLElement;
    (el.querySelector('[data-testid="carousel-next"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Attribution change drops the bucket to 1 position while viewing idx 1.
    setDetail('b1', detail(buckets[0], ['AAPL']));
    fixture.detectChanges();
    expect(el.querySelector('[data-testid="carousel-pager"]')?.textContent).toContain('1 of 1');
    // Prev must be DISABLED at position 0 — and must not sit on a stale idx.
    const prev = el.querySelector('[data-testid="carousel-prev"]') as HTMLButtonElement;
    expect(prev.disabled).toBe(true);
  });

  it('view-switcher swaps buckets without closing', async () => {
    await setup('b1');
    const comp = fixture.componentInstance;
    comp.switchBucket('b2');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.textContent).toContain('Income');
    expect(el.textContent).toContain('TSLA');
    expect(el.textContent).toContain('1 of 1');
  });

  it('empty bucket renders an empty state, not a crash', async () => {
    await setup('b3');
    expect(fixture.nativeElement.textContent).toContain('Old');
    expect(fixture.nativeElement.textContent).toContain('No positions');
  });

  it('trade-chart slot renders a placeholder', async () => {
    await setup('b1');
    expect(fixture.nativeElement.querySelector('[data-testid="trade-chart-stub"]')).toBeTruthy();
  });

  it('shown position lists its recent fills (orders alongside positions)', async () => {
    await setup('b1');
    setDetail('b1', detail(buckets[0], ['AAPL'], [
      { instrumentId: 'AAPL', side: 'buy', quantity: 10, price: 80, multiplier: 1, filledAt: '2026-09-01T15:00:00Z' },
      { instrumentId: 'MSFT', side: 'buy', quantity: 5, price: 190, multiplier: 1, filledAt: '2026-09-02T15:00:00Z' },
    ]));
    fixture.detectChanges();
    const fills = fixture.nativeElement.querySelector('[data-testid="position-fills"]');
    expect(fills?.textContent).toContain('buy 10 @ 80');
    expect(fills?.textContent).toContain('2026-09-01');
    // MSFT fill belongs to a different instrument — not shown on AAPL.
    expect(fills?.textContent).not.toContain('190');
  });

  it('fills sort newest-first regardless of broker response order', async () => {
    await setup('b1');
    setDetail('b1', detail(buckets[0], ['AAPL'], [
      // Oldest delivered first (raw RH response order can vary).
      { instrumentId: 'AAPL', side: 'buy', quantity: 1, price: 70, multiplier: 1, filledAt: '2026-08-01T15:00:00Z' },
      { instrumentId: 'AAPL', side: 'buy', quantity: 9, price: 80, multiplier: 1, filledAt: '2026-09-10T15:00:00Z' },
    ]));
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="position-fills"] .fill-row');
    expect((rows[0] as HTMLElement).textContent).toContain('2026-09-10');
    expect((rows[1] as HTMLElement).textContent).toContain('2026-08-01');
  });

  it('content is selector-driven — a store-side change re-derives the view', async () => {
    await setup('b1');
    // Simulate an attribution change elsewhere: detail now has 1 position.
    setDetail('b1', detail(buckets[0], ['AAPL']));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="carousel-pager"]')?.textContent)
      .toContain('1 of 1');
  });

  it('bucket deleted out from under the dialog → fallback message', async () => {
    await setup('b1');
    setDetail('b1', null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('no longer exists');
  });
});
