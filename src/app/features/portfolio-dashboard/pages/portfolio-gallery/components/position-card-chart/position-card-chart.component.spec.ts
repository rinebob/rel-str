/**
 * PositionCardChartComponent spec (#952) — the position-gallery card
 * chart: same quick-charts daily stack as the gallery card chart minus
 * the signal-entity layer. The component takes `symbol` only — no
 * GalleryCard, no StSignalItem occurrences, no card-signal-dots overlay.
 * FlexChartComponent is stubbed — the config/dataset wiring is the unit
 * under test.
 */
import { Component, input, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { PositionCardChartComponent } from './position-card-chart.component';
import {
  DEFAULT_CHART_INDICATORS,
  DEFAULT_CHART_INTERVALS,
  DEFAULT_CHART_STRATEGIES,
} from '../../../../../savant-trader/stores/chart.store';
import { GalleryCardChartStore } from '../../../../../savant-trader/stores/gallery-card-chart.store';
import { GalleryChartMountQueueService } from '../../../../../savant-trader/services/gallery-chart-mount-queue.service';
import { IndicatorSeriesStore } from '../../../../../savant-trader/stores/indicator-series.store';
import { PortfolioGalleryUiStore } from '../../portfolio-gallery-ui.store';
import {
  CARD_CHART_VISIBLE_BARS,
  CARD_CHART_MIN_VISIBLE_BARS,
  CARD_CHART_BAR_STEP,
} from '../../../../../savant-trader/components/gallery-card-chart/gallery-card-chart.component';
import { SignalTimeframe } from '../../../../../savant-trader/common/constants';

import type { FlexChartConfig, FlexChartDataset } from '../../../../../shared/components/flex-chart/flex-chart.types';
import { ChartIntervalKey, StIndicator } from '../../../../../shared/components/flex-chart/flex-chart.types';
import type { PriceBar } from '../../../../../shared/components/flex-chart/flex-chart.types';
import { FlexChartComponent } from '../../../../../shared/components/flex-chart/flex-chart.component';

@Component({ selector: 'app-flex-chart', standalone: true, template: '' })
class FlexChartStub {
  chartData = input<FlexChartDataset | null>();
  config = input<FlexChartConfig>();
  height = input<string>();
}

/** jsdom's IntersectionObserver is a no-op that never fires — and `mounted`
 *  starts false with mounts gated on a queue grant (#860), so tests need
 *  an IO that reports every observed cell as intersecting. The
 *  viewport-unmount describe swaps in a controllable stub. */
class AutoVisibleIO {
  constructor(private cb: IntersectionObserverCallback) {}
  observe(): void {
    this.cb(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
}

const BARS: PriceBar[] = [
  { date: '2026-08-24', x: new Date(2026, 7, 24), open: 200, high: 205, low: 198, close: 203 },
  { date: '2026-08-25', x: new Date(2026, 7, 25), open: 203, high: 215, low: 202, close: 213.44 },
];

const WEEKLY_BARS: PriceBar[] = [
  { date: '2026-08-21', x: new Date(2026, 7, 21), open: 190, high: 210, low: 188, close: 205 },
  { date: '2026-08-28', x: new Date(2026, 7, 28), open: 205, high: 216, low: 200, close: 213 },
];

describe('PositionCardChartComponent', () => {
  let fixture: ComponentFixture<PositionCardChartComponent>;
  let uiStore: InstanceType<typeof PortfolioGalleryUiStore>;
  let storeMock: {
    ensureBars: jest.Mock;
    ensureWeeklyBars: jest.Mock;
    epoch: () => number;
    barsFor: () => (s: string) => PriceBar[] | undefined;
    weeklyBarsFor: () => (s: string) => PriceBar[] | undefined;
    versionFor: () => (s: string) => string;
    errorFor: () => (s: string) => string | null;
    weeklyErrorFor: () => (s: string) => string | null;
  };
  // Map-shaped signals — the real store holds ONE record per kind, so any
  // symbol's patch dirties every reader's selector; per-symbol signals here
  // would hide the cross-card invalidation the gallery relies on avoiding.
  const bars = signal<Record<string, PriceBar[] | undefined>>({});
  const weeklyBars = signal<Record<string, PriceBar[] | undefined>>({});
  const version = signal('v1');
  const epoch = signal(0);
  // Tracks the real responseFor call shape — a () => () => undefined mock
  // would silently tolerate a signature drift in IndicatorSeriesStore.
  // responseFor() is a selector-factory: the outer call takes no args, the
  // returned selector takes (symbol, version, intervals, indicators, strategies).
  const responseForSelector = jest.fn(() => undefined);
  const responseFor = jest.fn(() => responseForSelector);
  const error = signal<Record<string, string | null>>({});
  const weeklyError = signal<Record<string, string | null>>({});
  // Default: grants run synchronously; pacing tests override the impl.
  const mountQueue = {
    request: jest.fn((run: () => void, _stillValid?: () => boolean) => run()),
  };

  function mount(): PositionCardChartComponent {
    fixture = TestBed.createComponent(PositionCardChartComponent);
    fixture.componentRef.setInput('symbol', 'AAPL');
    fixture.detectChanges();
    return fixture.componentInstance;
  }

  function stub(): FlexChartStub {
    return fixture.debugElement.query(By.directive(FlexChartStub))!.componentInstance;
  }

  beforeEach(async () => {
    bars.set({});
    weeklyBars.set({});
    version.set('v1');
    epoch.set(0);
    error.set({});
    weeklyError.set({});
    responseFor.mockClear();
    responseForSelector.mockClear();
    storeMock = {
      ensureBars: jest.fn(),
      ensureWeeklyBars: jest.fn(),
      epoch,
      barsFor: () => (s: string) => bars()[s],
      weeklyBarsFor: () => (s: string) => weeklyBars()[s],
      versionFor: () => () => version(),
      errorFor: () => (s: string) => error()[s] ?? null,
      weeklyErrorFor: () => (s: string) => weeklyError()[s] ?? null,
    };

    await TestBed.configureTestingModule({
      imports: [PositionCardChartComponent],
      providers: [
        { provide: GalleryCardChartStore, useValue: storeMock },
        { provide: GalleryChartMountQueueService, useValue: mountQueue },
        { provide: IndicatorSeriesStore, useValue: { responseFor } },
      ],
    })
      .overrideComponent(PositionCardChartComponent, {
        remove: { imports: [FlexChartComponent] },
        add: { imports: [FlexChartStub] },
      })
      .compileComponents();
    // Real root-provided store — the component reads the header's chart
    // interval + seq tick from it directly.
    uiStore = TestBed.inject(PortfolioGalleryUiStore);
    uiStore.resetForPage();
    // Grants default to synchronous; tests that capture pending grants
    // re-mock request() — reset impl + call history so they don't leak.
    mountQueue.request.mockReset().mockImplementation((run) => run());
    (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = AutoVisibleIO;
  });

  it('kicks off a per-symbol bars load on mount', () => {
    mount();
    expect(storeMock.ensureBars).toHaveBeenCalledWith('AAPL');
  });

  it('shows a loading state before bars arrive', () => {
    mount();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cc-loading')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeFalsy();
  });

  it('overlays the symbol top-left — visible even mid-scroll past the card header', () => {
    mount();
    fixture.detectChanges();
    const badge = fixture.nativeElement.querySelector('.cc-symbol');
    expect(badge?.textContent).toContain('AAPL');
  });

  it('shows an unavailable placeholder when bars load empty', () => {
    mount();
    bars.set({ AAPL: [] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cc-error')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeFalsy();
  });

  it('shows the unavailable placeholder on a fetch error', () => {
    mount();
    bars.set({});
    error.set({ AAPL: 'boom' });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cc-error')).toBeTruthy();
  });

  it('renders the quick-charts daily stack — base panes, no chrome', () => {
    mount();
    bars.set({ AAPL: BARS });
    fixture.detectChanges();

    const cfg = stub().config()!;
    expect(cfg.interval).toBe(ChartIntervalKey.DAILY);
    expect(cfg.visibleBars).toBe(CARD_CHART_VISIBLE_BARS);
    expect(cfg.showCrosshair).toBe(false);
    expect(cfg.showZoomToolbar).toBe(false);
    expect(cfg.enableScrollbar).toBe(false);
    expect(stub().chartData()!.bars).toEqual(BARS);
    // Base indicators: trend bands + trend strength + zone V1 + zone V2
    expect(cfg.indicators.length).toBeGreaterThanOrEqual(4);
    // ST StdDevLines — locally-computed overlay, present on both intervals.
    expect(cfg.indicators.some((i) => i.type === StIndicator.ST_STD_DEV_LINES)).toBe(true);
  });

  // ── Entity boundary: price + indicators only, no signal input ────────────

  it('binds a symbol — there is no signal-entity input on the component', () => {
    const comp = mount();
    // The entity boundary (#952): the position chart takes `symbol`, never
    // a GalleryCard or StSignalItem — setting a `card` input would be a
    // compile-time non-input; assert the surface doesn't exist at runtime.
    expect('card' in comp).toBe(false);
  });

  it('draws no card signal dots — the config carries no signal-dots overlay', () => {
    mount();
    bars.set({ AAPL: BARS });
    fixture.detectChanges();

    const cfg = stub().config()!;
    // No occurrence-dot overlay — the gallery card injects its own dots
    // under 'st-card-signal-dots'; the position chart has no occurrences
    // to draw, so neither that id nor the signal-dots indicator type
    // appears on the price pane.
    expect(cfg.indicators.some((i) => i.id === 'st-card-signal-dots')).toBe(false);
    expect(
      cfg.indicators.some((i) => i.pane === 'overlay' && i.type === 'st-signal-dots'),
    ).toBe(false);
  });

  it('requests the default ST indicator set for the card symbol from IndicatorSeriesStore', () => {
    mount();
    bars.set({ AAPL: BARS });
    fixture.detectChanges();

    // The callable-indicator lane is exercised end-to-end: symbol + store
    // version + the shared DEFAULT_CHART_* filter sets.
    expect(responseForSelector).toHaveBeenCalledWith(
      'AAPL',
      'v1',
      DEFAULT_CHART_INTERVALS,
      DEFAULT_CHART_INDICATORS,
      DEFAULT_CHART_STRATEGIES,
    );
  });

  // ── header timeframe drives the chart interval ───────────────────────────

  function mountWeekly(): PositionCardChartComponent {
    const comp = mount();
    uiStore.setChartTimeframe(SignalTimeframe.WEEKLY);
    fixture.detectChanges();
    return comp;
  }

  it('weekly timeframe renders the weekly interval on weekly bars and lazily fetches them', () => {
    mountWeekly();
    expect(storeMock.ensureWeeklyBars).toHaveBeenCalledWith('AAPL');

    weeklyBars.set({ AAPL: WEEKLY_BARS });
    fixture.detectChanges();

    const cfg = stub().config()!;
    expect(cfg.interval).toBe(ChartIntervalKey.WEEKLY);
    expect(stub().chartData()!.bars).toEqual(WEEKLY_BARS);
    expect(stub().chartData()!.bars).not.toEqual(BARS);
    // Weekly stack also carries the StdDevLines overlay.
    expect(cfg.indicators.some((i) => i.type === StIndicator.ST_STD_DEV_LINES)).toBe(true);
  });

  it('does not fetch weekly bars while the timeframe stays daily', () => {
    mount();
    expect(storeMock.ensureWeeklyBars).not.toHaveBeenCalled();
  });

  it('re-ensures bars when the cache epoch bumps — clearCache re-fires the mount effect', () => {
    mount();
    expect(storeMock.ensureBars).toHaveBeenCalledTimes(1);

    epoch.update((e) => e + 1); // what clearCache() does
    fixture.detectChanges();
    expect(storeMock.ensureBars).toHaveBeenCalledTimes(2);
  });

  it('a mounted weekly chart also re-ensures on an epoch bump', () => {
    mountWeekly();
    expect(storeMock.ensureWeeklyBars).toHaveBeenCalledTimes(1);
    expect(storeMock.ensureBars).toHaveBeenCalledTimes(2); // mount + interval flip

    epoch.update((e) => e + 1);
    fixture.detectChanges();
    expect(storeMock.ensureBars).toHaveBeenCalledTimes(3);
    expect(storeMock.ensureWeeklyBars).toHaveBeenCalledTimes(2);
  });

  it('a weekly-load error does not make the daily chart unavailable', () => {
    mount();
    weeklyError.set({ AAPL: 'weekly boom' }); // failed weekly fetch for the symbol
    bars.set({ AAPL: BARS });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cc-error')).toBeFalsy();
    expect(stub().config()!.interval).toBe(ChartIntervalKey.DAILY);
  });

  it('a daily-load error does not block the weekly chart when W is selected', () => {
    mountWeekly();
    error.set({ AAPL: 'daily boom' }); // failed daily fetch for the symbol
    weeklyBars.set({ AAPL: WEEKLY_BARS });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cc-error')).toBeFalsy();
    expect(stub().config()!.interval).toBe(ChartIntervalKey.WEEKLY);
    expect(stub().chartData()!.bars).toEqual(WEEKLY_BARS);
  });

  it('a weekly-load error shows the unavailable placeholder only on the weekly chart', () => {
    mountWeekly();
    weeklyError.set({ AAPL: 'weekly boom' });
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cc-error')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeFalsy();
  });

  // ── per-card D/W chip ────────────────────────────────────────────────────

  it('per-card W chip switches to weekly and fetches weekly bars', () => {
    const comp = mount();
    comp.setChartInterval(ChartIntervalKey.WEEKLY);
    fixture.detectChanges();

    expect(storeMock.ensureWeeklyBars).toHaveBeenCalledWith('AAPL');
    weeklyBars.set({ AAPL: WEEKLY_BARS });
    fixture.detectChanges();
    expect(stub().config()!.interval).toBe(ChartIntervalKey.WEEKLY);
    expect(stub().chartData()!.bars).toEqual(WEEKLY_BARS);
  });

  it('a header Chart click resets a per-card override — even a same-value click', () => {
    const comp = mount();
    comp.setChartInterval(ChartIntervalKey.WEEKLY);
    fixture.detectChanges();
    expect(comp.interval()).toBe(ChartIntervalKey.WEEKLY);

    // "D" clicked while the header is already on daily — the value can't
    // change, so the real store's seq tick is what resyncs the card.
    uiStore.setChartTimeframe(SignalTimeframe.DAILY);
    fixture.detectChanges();
    expect(comp.interval()).toBe(ChartIntervalKey.DAILY);

    // A real value change resyncs too.
    comp.setChartInterval(ChartIntervalKey.DAILY); // re-override at D
    uiStore.setChartTimeframe(SignalTimeframe.WEEKLY);
    fixture.detectChanges();
    expect(comp.interval()).toBe(ChartIntervalKey.WEEKLY);
  });

  it('renders the D/W chip with the active interval marked', () => {
    mount();
    fixture.detectChanges();
    const group = fixture.nativeElement.querySelector('.cc-chip-group[aria-label="Chart timeframe"]');
    const buttons = group.querySelectorAll('button');
    expect(buttons).toHaveLength(2);
    expect(buttons[0].classList.contains('active')).toBe(true); // D active

    buttons[1].click();
    fixture.detectChanges();
    expect(group.querySelectorAll('button')[1].classList.contains('active')).toBe(true);
  });

  // ── ±50 visible-bar chips ────────────────────────────────────────────────

  it('+50 widens the visible window; −50 narrows it, floored at the min', () => {
    const many = Array.from({ length: 200 }, (_, i) => ({
      date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
      x: new Date(2026, 0, (i % 28) + 1),
      open: 100, high: 105, low: 95, close: 100,
    }));
    const comp = mount();
    bars.set({ AAPL: many });
    fixture.detectChanges();
    expect(stub().config()!.visibleBars).toBe(CARD_CHART_VISIBLE_BARS);

    comp.adjustVisibleBars(CARD_CHART_BAR_STEP);
    fixture.detectChanges();
    expect(stub().config()!.visibleBars).toBe(CARD_CHART_VISIBLE_BARS + CARD_CHART_BAR_STEP);

    comp.adjustVisibleBars(-CARD_CHART_BAR_STEP);
    comp.adjustVisibleBars(-CARD_CHART_BAR_STEP); // would go under the min — clamps
    fixture.detectChanges();
    expect(stub().config()!.visibleBars).toBe(CARD_CHART_MIN_VISIBLE_BARS);
  });

  it('+50 disables at the loaded-bars ceiling and −50 at the floor', () => {
    mount();
    bars.set({ AAPL: BARS }); // only 2 bars loaded — ceiling below the default window
    fixture.detectChanges();

    const comp = fixture.componentInstance;
    expect(comp.canAddBars()).toBe(false); // 40 > 2 bars loaded
    expect(comp.canRemoveBars()).toBe(true);
  });

  // ── flat-page perf: cross-symbol store patches must not rebuild this card ─

  it('an unrelated symbol landing in the store does not change config/dataset identity', () => {
    // The store's bars/errors are single map signals — a MSFT patch dirties
    // every mounted card's selectors. With 16 cards prefetching, an
    // always-dirty aggregate rebuilt every chart's config per patch per
    // card — the flat-page hang.
    mount();
    bars.set({ AAPL: BARS });
    fixture.detectChanges();
    const cfg = stub().config();
    const ds = stub().chartData();

    bars.update((m) => ({ ...m, MSFT: [...BARS] }));
    error.update((m) => ({ ...m, MSFT: 'msft boom' }));
    fixture.detectChanges();

    expect(stub().config()).toBe(cfg);
    expect(stub().chartData()).toBe(ds);
  });

  // ===========================================================================
  // Mount-once latch (#952) — the observer still gates the FIRST mount
  // (600px pre-mount margin on .pg-body), but once granted the chart stays
  // mounted on scroll-out: no destroy/remount flash on re-entry. The latch
  // releases only on data loss. The controllable IO stub replaces the
  // jsdom no-op for these tests.
  // ===========================================================================

  describe('IntersectionObserver mount-once latch', () => {
    const OriginalIO = globalThis.IntersectionObserver;
    let ioCallback: IntersectionObserverCallback;
    let ioOptions: IntersectionObserverInit | undefined;
    let ioDisconnect: jest.Mock;

    const fire = (...entries: { isIntersecting: boolean }[]) =>
      ioCallback(entries as IntersectionObserverEntry[], {} as IntersectionObserver);

    class TestIO {
      constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
        ioCallback = cb;
        ioOptions = opts;
      }
      observe(): void {}
      unobserve(): void {}
      disconnect = ioDisconnect = jest.fn();
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }

    beforeEach(() => {
      (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = TestIO;
    });

    afterEach(() => {
      (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = OriginalIO;
      jest.restoreAllMocks();
    });

    it('roots on the .pg-body scroll container with a 600px margin', () => {
      const scrollRoot = document.createElement('div');
      jest
        .spyOn(HTMLElement.prototype, 'closest')
        .mockImplementation(function (this: HTMLElement, sel: string) {
          return sel === '.pg-body' ? scrollRoot : null;
        });

      mount();

      expect(ioOptions?.root).toBe(scrollRoot);
      expect(ioOptions?.rootMargin).toBe('600px 0px');
    });

    it('falls back to the viewport when no scroll container is found', () => {
      mount();
      expect(ioOptions?.root).toBeNull();
    });

    it('keeps the flex-chart mounted when the cell scrolls out — no remount flash', () => {
      mount();
      bars.set({ AAPL: BARS });
      // TestIO doesn't auto-fire — simulate entering the window (sync grant).
      fire({ isIntersecting: true });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeTruthy();

      // Scrolling out leaves the chart mounted — mount-once latch means
      // re-entry renders the live instance, not a destroy/create cycle.
      fire({ isIntersecting: false });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeTruthy();
      expect(fixture.componentInstance.mounted()).toBe(true);

      fire({ isIntersecting: true });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeTruthy();
    });

    it('releases the latch on data loss — the remount re-paces through the queue', () => {
      const pending: { run: () => void; stillValid?: () => boolean }[] = [];
      mount();
      bars.set({ AAPL: BARS });
      fire({ isIntersecting: true });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeTruthy();

      // Cache clear → bars undefined → the latch releases and the chart
      // comes down; the refetched mount must re-request a grant.
      mountQueue.request.mockImplementation(
        (run: () => void, stillValid?: () => boolean) => void pending.push({ run, stillValid }),
      );
      bars.set({});
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeFalsy();

      bars.set({ AAPL: BARS });
      fixture.detectChanges();
      expect(pending).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeFalsy();
      pending[0].run();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeTruthy();
    });

    it('uses the last entry — batched out→in transitions settle on the freshest', () => {
      mount();
      bars.set({ AAPL: BARS });
      fixture.detectChanges();

      fire({ isIntersecting: false }, { isIntersecting: true });
      fixture.detectChanges();
      expect(fixture.componentInstance.mounted()).toBe(true);
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeTruthy();
    });

    it('disconnects the observer on destroy', () => {
      mount();
      fixture.destroy();
      expect(ioDisconnect).toHaveBeenCalled();
    });

    // ── #860: mounts are paced through the mount queue ─────────────────────

    type GrantEntry = { run: () => void; stillValid?: () => boolean };
    const captureGrants = (): GrantEntry[] => {
      const pending: GrantEntry[] = [];
      mountQueue.request.mockImplementation((run, stillValid) => void pending.push({ run, stillValid }));
      return pending;
    };

    it('no grant is requested while bars are pending — the data-arrival mount stays paced', () => {
      captureGrants();
      mount();
      fire({ isIntersecting: true });
      fixture.detectChanges();
      // Loading: nothing worth mounting — the grant request waits for bars,
      // so a coalesced multi-symbol landing can't mount K charts in one pass.
      expect(mountQueue.request).not.toHaveBeenCalled();

      bars.set({ AAPL: BARS });
      fixture.detectChanges();
      expect(mountQueue.request).toHaveBeenCalledTimes(1);
    });

    it('mounts only when the queue grants — a visible cell waits for its frame', () => {
      const pending = captureGrants();
      mount();
      bars.set({ AAPL: BARS });
      fixture.detectChanges();

      fire({ isIntersecting: true });
      fixture.detectChanges();
      expect(pending).toHaveLength(1);
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeFalsy();

      pending.shift()!.run(); // the grant fires on its frame
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeTruthy();
    });

    it('a queued grant survives scroll-out — the mount still lands on its frame', () => {
      const pending = captureGrants();
      mount();
      bars.set({ AAPL: BARS });
      fixture.detectChanges();

      fire({ isIntersecting: true });
      fixture.detectChanges(); // effect queues the grant → pending[0]
      fire({ isIntersecting: false });
      fixture.detectChanges(); // scroll-out before the grant's frame
      // Mount-once: the queued grant isn't invalidated by leaving the
      // window — when its frame comes the chart mounts and stays.
      expect(pending[0].stillValid!()).toBe(true);
      pending[0].run();
      fixture.detectChanges();

      expect(fixture.componentInstance.mounted()).toBe(true);
      expect(fixture.nativeElement.querySelector('app-flex-chart')).toBeTruthy();
    });

    it('a grant queued before destroy no-ops — the ticket invalidates it', () => {
      const pending = captureGrants();
      mount();
      bars.set({ AAPL: BARS });
      fire({ isIntersecting: true });
      fixture.detectChanges(); // grant queued
      expect(pending).toHaveLength(1);

      fixture.destroy();
      pending[0].run(); // frame fires after destroy — must not resurrect
      expect(fixture.componentInstance.mounted()).toBe(false);
    });
  });
});
