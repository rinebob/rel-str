/**
 * Unit tests for SymbolReviewComponent — picker renders queue rows with
 * the new-signal dot, row clicks call selectSymbol, and the empty states
 * gate on queue/selection/bundle.
 */

import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Component, EventEmitter, Input, Output, signal } from '@angular/core';
import { By } from '@angular/platform-browser';

import { SymbolReviewComponent } from './symbol-review.component';
import { SignalReviewStore } from '../../stores/signal-review.store';
import { ChartStore } from '../../stores/chart.store';
import { SignalDetailComponent } from '../../components/signal-detail/signal-detail.component';
import { TradeSide } from '@common';
import { ST_UPTICK_DOT_COLORS } from '@flex-chart/indicator-visuals';
import type { SymbolListDef } from '../../common/symbol-list-defs';
import type { ChartScatterPoint } from '../../utils/chart-indicators';
import type {
  SignalReviewOccurrence,
  SignalReviewQueueRow,
} from '@paper-trading/contracts';

/** Decorator-based mock (AGENTS.md — signal input()/output() breaks
 *  jest-preset-angular mock hoisting). Only the inputs the page binds. */
@Component({ selector: 'app-signal-detail', standalone: true, template: '' })
class MockSignalDetailComponent {
  @Input() manualSymbol: string | null = null;
  @Input() listCatalog: SymbolListDef[] = [];
  @Input() symbolIndex = -1;
  @Input() symbolCount = 0;
  @Input() showToolbar = true;
  @Input() reviewMarkers: ChartScatterPoint[] = [];
  @Output() toggleList = new EventEmitter<unknown>();
  @Output() prevSymbol = new EventEmitter<void>();
  @Output() nextSymbol = new EventEmitter<void>();
}

interface BundleStub {
  symbol: string;
  previousOpenedAt: string | null;
  openedAt: string;
  occurrences: SignalReviewOccurrence[];
}

const occ = (over: Partial<SignalReviewOccurrence> = {}): SignalReviewOccurrence => ({
  occurrenceId: 'AAPL_2026-11-14_D_ST_TREND_RIDER_V2_LONG',
  symbol: 'AAPL',
  signalType: 'D_ST_TREND_RIDER_V2_LONG',
  signalBarDate: '2026-11-14',
  signalTimeframe: 'D',
  direction: TradeSide.LONG,
  signalStatus: 'CONFIRMED',
  signalIndicators: {},
  sourceRunId: 'run-1',
  checked: false,
  ...over,
});

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
  occurrences: Array.from({ length: count }, (_, i) =>
    occ({ occurrenceId: `o-${i}`, symbol })),
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
  let dividerIndex: ReturnType<typeof signal<number>>;
  let togglePending: ReturnType<typeof signal<Record<string, true>>>;
  let rowErrors: ReturnType<typeof signal<Record<string, string>>>;
  let dailyBars: ReturnType<typeof signal<{ symbol: string; bars: { date: string; x: Date; open: number; high: number; low: number; close: number }[] } | null>>;
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
      dividerIndex,
      togglePending,
      rowErrors,
      loadQueue: jest.fn(),
      selectSymbol: jest.fn(),
      toggle: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [SymbolReviewComponent],
      providers: [
        { provide: SignalReviewStore, useValue: store },
        { provide: ChartStore, useValue: { dailyData: dailyBars } },
      ],
    })
      .overrideComponent(SymbolReviewComponent, {
        remove: { imports: [SignalDetailComponent] },
        add: { imports: [MockSignalDetailComponent] },
      })
      .compileComponents();
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
    dividerIndex = signal(0);
    togglePending = signal<Record<string, true>>({});
    rowErrors = signal<Record<string, string>>({});
    dailyBars = signal<{ symbol: string; bars: { date: string; x: Date; open: number; high: number; low: number; close: number }[] } | null>(null);
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
    expect(fixture.debugElement.queryAll(By.css('.occ-row'))).toHaveLength(0);
  });

  it('renders the occurrence list for the loaded bundle and forwards toggles to the store', async () => {
    queueRows.set([{ symbol: 'AAPL' }]);
    pickerRows.set([row()]);
    selectedSymbol.set('AAPL');
    bundle.set(bundleOf('AAPL', 2));
    dividerIndex.set(1);
    await setup();
    fixture.detectChanges();

    const rows = fixture.debugElement.queryAll(By.css('.occ-row'));
    expect(rows).toHaveLength(2);
    expect(fixture.debugElement.queryAll(By.css('.visit-divider'))).toHaveLength(1);

    const box = rows[0].query(By.css('input[type=checkbox]')).nativeElement as HTMLInputElement;
    box.click();
    expect(store.toggle).toHaveBeenCalledWith('o-0');
  });

  // ── Chart + occurrence markers (#1655) ─────────────────────────────────
  // The detail column mounts chart-view's signal-detail stack once a
  // symbol is selected; bundle occurrences feed it as reviewMarkers.

  const detail = () =>
    fixture.debugElement.query(By.directive(MockSignalDetailComponent))
      ?.componentInstance as MockSignalDetailComponent | undefined;

  it('does not mount the chart stack until a symbol is selected', async () => {
    await setup();
    fixture.detectChanges();
    expect(detail()).toBeUndefined();
  });

  it('mounts the chart stack bound to the selected symbol, toolbar suppressed', async () => {
    selectedSymbol.set('AAPL');
    bundle.set(bundleOf('AAPL'));
    await setup();
    fixture.detectChanges();

    const d = detail();
    expect(d).toBeTruthy();
    expect(d!.manualSymbol).toBe('AAPL');
    expect(d!.showToolbar).toBe(false);
  });

  it('feeds every bundle occurrence as a review marker — checked solid, unchecked ghost', async () => {
    selectedSymbol.set('AAPL');
    bundle.set({
      symbol: 'AAPL',
      previousOpenedAt: null,
      openedAt: '2026-11-17T15:00:00.000Z',
      occurrences: [
        occ({ occurrenceId: 'c', checked: true }),
        occ({ occurrenceId: 'u', checked: false }),
      ],
    });
    dailyBars.set({ symbol: 'AAPL', bars: [{ date: '2026-11-14', x: new Date('2026-11-14T00:00:00Z'), open: 349, high: 352, low: 348, close: 350.69 }] });
    await setup();
    fixture.detectChanges();

    const markers = detail()!.reviewMarkers;
    expect(markers).toHaveLength(2);
    // LONG dots land at low − 2.5×ATR (the price-pane convention); the
    // single stub bar has ATR 0 → y = bar.low.
    expect(markers.map(m => m.y)).toEqual([348, 348]);
    // V2 long family — checked solid vs unchecked ghost-alpha.
    expect(markers[0].color).toBe(ST_UPTICK_DOT_COLORS.v2Long);
    expect(markers[1].color).toBe(ST_UPTICK_DOT_COLORS.v2Long + '59');
  });

  it('occurrences outside the cached bar range produce no markers — list still renders', async () => {
    selectedSymbol.set('AAPL');
    bundle.set(bundleOf('AAPL', 1));
    dailyBars.set({ symbol: 'AAPL', bars: [] }); // nothing cached yet / all too old
    await setup();
    fixture.detectChanges();

    expect(detail()!.reviewMarkers).toEqual([]);
    expect(fixture.debugElement.queryAll(By.css('.occ-row'))).toHaveLength(1);
  });

  it('never feeds a kept bundle’s markers under a different selection', async () => {
    selectedSymbol.set('MSFT');
    bundle.set(bundleOf('AAPL')); // stale bundle keyed to another symbol
    dailyBars.set({ symbol: 'MSFT', bars: [{ date: '2026-11-14', x: new Date('2026-11-14T00:00:00Z'), open: 1, high: 1, low: 1, close: 1 }] });
    await setup();
    fixture.detectChanges();

    expect(detail()!.reviewMarkers).toEqual([]);
  });

  it('does not plot against the previous symbol’s bars while the new fetch is in flight', async () => {
    // Symbol-switch window: the MSFT bundle has landed but ChartStore still
    // holds AAPL's dataset — a same-date AAPL bar must not supply the close.
    selectedSymbol.set('MSFT');
    bundle.set(bundleOf('MSFT'));
    dailyBars.set({ symbol: 'AAPL', bars: [{ date: '2026-11-14', x: new Date('2026-11-14T00:00:00Z'), open: 999, high: 999, low: 999, close: 999 }] });
    await setup();
    fixture.detectChanges();

    expect(detail()!.reviewMarkers).toEqual([]);
  });
});
