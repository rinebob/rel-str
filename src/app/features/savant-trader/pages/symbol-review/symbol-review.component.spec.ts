/**
 * Unit tests for SymbolReviewComponent — picker renders queue rows with
 * the new-signal dot, row clicks call selectSymbol, and the empty states
 * gate on queue/selection/bundle.
 */

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { signal } from '@angular/core';
import { By } from '@angular/platform-browser';

import { SymbolReviewComponent } from './symbol-review.component';
import { SignalReviewStore } from '../../stores/signal-review.store';
import type { SignalReviewQueueRow } from '@paper-trading/contracts';

interface BundleStub {
  symbol: string;
  previousOpenedAt: string | null;
  openedAt: string;
  occurrences: unknown[];
}

const row = (over: Partial<SignalReviewQueueRow> & { hasNewSignal?: boolean } = {}) => {
  const { hasNewSignal = false, ...rest } = over;
  return {
    symbol: 'AAPL',
    lastDailySignalDate: '2026-11-14',
    hasNewSignal,
    ...rest,
  };
};

const bundleOf = (symbol: string, count = 1): BundleStub => ({
  symbol,
  previousOpenedAt: null,
  openedAt: '2026-11-17T15:00:00.000Z',
  occurrences: Array.from({ length: count }, (_, i) => ({ id: `o-${i}` })),
});

describe('SymbolReviewComponent', () => {
  let fixture: ComponentFixture<SymbolReviewComponent>;
  let queueRows: ReturnType<typeof signal<SignalReviewQueueRow[]>>;
  let pickerRows: ReturnType<typeof signal<ReturnType<typeof row>[]>>;
  let selectedSymbol: ReturnType<typeof signal<string | null>>;
  let bundle: ReturnType<typeof signal<BundleStub | null>>;
  let bundleLoading: ReturnType<typeof signal<boolean>>;
  let bundleError: ReturnType<typeof signal<string | null>>;
  let queueLoading: ReturnType<typeof signal<boolean>>;
  let queueError: ReturnType<typeof signal<string | null>>;
  let store: Record<string, unknown>;

  async function setup(): Promise<void> {
    store = {
      queueRows,
      pickerRows,
      selectedSymbol,
      bundle,
      bundleLoading,
      bundleError,
      queueLoading,
      queueError,
      loadQueue: jest.fn(),
      selectSymbol: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [SymbolReviewComponent],
      providers: [{ provide: SignalReviewStore, useValue: store }],
    }).compileComponents();
    fixture = TestBed.createComponent(SymbolReviewComponent);
  }

  beforeEach(() => {
    queueRows = signal<SignalReviewQueueRow[]>([]);
    pickerRows = signal<ReturnType<typeof row>[]>([]);
    selectedSymbol = signal<string | null>(null);
    bundle = signal<BundleStub | null>(null);
    bundleLoading = signal(false);
    bundleError = signal<string | null>(null);
    queueLoading = signal(false);
    queueError = signal<string | null>(null);
  });

  it('loads the queue on init', async () => {
    await setup();
    fixture.detectChanges();
    expect(store.loadQueue).toHaveBeenCalled();
  });

  it('re-opens a retained selection on init — re-fetch re-stamps the ledger', async () => {
    selectedSymbol.set('MSFT');
    await setup();
    fixture.detectChanges();
    expect(store.selectSymbol).toHaveBeenCalledWith('MSFT');
  });

  it('renders a row per queue symbol with the new-signal dot when flagged', async () => {
    pickerRows.set([
      row({ symbol: 'AAPL', hasNewSignal: true }),
      row({ symbol: 'MSFT', hasNewSignal: false }),
    ]);
    queueRows.set([{ symbol: 'AAPL' }, { symbol: 'MSFT' }]);
    await setup();
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('.symbol-row'));
    expect(rows).toHaveLength(2);
    expect(rows[0].nativeElement.textContent).toContain('AAPL');
    expect(rows[0].query(By.css('.new-dot'))).toBeTruthy();
    expect(rows[1].query(By.css('.new-dot'))).toBeNull();
  });

  it('calls selectSymbol when a row is clicked', async () => {
    pickerRows.set([row({ symbol: 'MSFT' })]);
    queueRows.set([{ symbol: 'MSFT' }]);
    await setup();
    fixture.detectChanges();
    fixture.debugElement.query(By.css('.symbol-row')).nativeElement.click();
    expect(store.selectSymbol).toHaveBeenCalledWith('MSFT');
  });

  it('shows the empty-queue state when there are no rows', async () => {
    await setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No symbols with un-groomed signals');
  });

  it('shows the queue error, not the empty state, when the first load fails', async () => {
    queueError.set('queue blew up');
    await setup();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Could not load the symbol queue');
    expect(text).not.toContain('No symbols with un-groomed signals');
  });

  it('shows the select-a-symbol empty state when nothing is selected', async () => {
    queueRows.set([{ symbol: 'AAPL' }]);
    pickerRows.set([row()]);
    await setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Select a symbol');
  });

  it('shows the empty-symbol state when the bundle has zero occurrences', async () => {
    queueRows.set([{ symbol: 'AAPL' }]);
    pickerRows.set([row()]);
    selectedSymbol.set('AAPL');
    bundle.set(bundleOf('AAPL', 0));
    await setup();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No un-groomed signals for AAPL');
  });

  it('never renders a kept bundle under a different selection', async () => {
    queueRows.set([{ symbol: 'AAPL' }, { symbol: 'MSFT' }]);
    selectedSymbol.set('MSFT');
    bundle.set(bundleOf('AAPL')); // kept bundle keyed to another symbol
    await setup();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Could not load MSFT');
    expect(text).not.toContain('AAPL — 1 signal(s) queued');
  });
});
