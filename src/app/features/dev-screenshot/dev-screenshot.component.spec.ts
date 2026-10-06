/// <reference types="jest" />
/**
 * Tests for DevScreenshotComponent — the /dev/screenshot page that invokes
 * captureChartSnapshot and renders the returned artifacts (Topic #746,
 * task #770).
 *
 * ScreenshotService is mocked — the page's own wiring (spec assembly, result
 * rendering, typed error display) is the unit under test.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, Subject, throwError } from 'rxjs';

import { DevScreenshotComponent } from './dev-screenshot.component';
import { ScreenshotService } from './screenshot.service';
import {
  CaptureChartResult,
  CaptureChartSpec,
  CaptureEvent,
  ChartInterval,
  PositionType,
} from '@screenshot-capture/contracts';
import CORE_ROUTES from '../../core/core-routes';
import { AppRoutes } from '../../core/common/interfaces';
import { authGuard } from '../../core/auth/auth.guard';

// Realistic svg root: W=664, plotX=4, barWidth=6, count=100 → plot 4..604,
// 60px right gutter. sliceSvgRight(180) → viewBox="484 0 180 560".
const DAILY_SVG =
  '<svg viewBox="0 0 664 560" width="664" height="560" data-plot-x="4" data-bar-width="6" data-bar-count="100"><text>daily</text></svg>';
const WEEKLY_SVG =
  '<svg viewBox="0 0 664 560" width="664" height="560" data-plot-x="4" data-bar-width="6" data-bar-count="100"><text>weekly</text></svg>';

const RESULT: CaptureChartResult = {
  svg: DAILY_SVG,
  paths: ['st-trade-screenshots/GOOG/x-daily.svg', 'st-trade-screenshots/GOOG/x-daily.png'],
  artifacts: [
    {
      interval: ChartInterval.DAILY,
      svg: DAILY_SVG,
      svgPath: 'st-trade-screenshots/GOOG/x-daily.svg',
      pngPath: 'st-trade-screenshots/GOOG/x-daily.png',
    },
    {
      interval: ChartInterval.WEEKLY,
      svg: WEEKLY_SVG,
      svgPath: 'st-trade-screenshots/GOOG/x-weekly.svg',
      pngPath: 'st-trade-screenshots/GOOG/x-weekly.png',
    },
  ],
};

describe('DevScreenshotComponent', () => {
  let component: DevScreenshotComponent;
  let fixture: ComponentFixture<DevScreenshotComponent>;
  let serviceMock: { captureChartSnapshot$: jest.Mock };

  function mount(): void {
    fixture = TestBed.createComponent(DevScreenshotComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  function setInput(selector: string, value: string): void {
    const el = fixture.nativeElement.querySelector(selector) as HTMLInputElement;
    el.value = value;
    el.dispatchEvent(new Event('input'));
  }

  function submit(): void {
    (fixture.nativeElement.querySelector('form') as HTMLFormElement)
      .dispatchEvent(new Event('submit'));
    fixture.detectChanges();
  }

  const lastSpec = (): CaptureChartSpec =>
    serviceMock.captureChartSnapshot$.mock.calls.at(-1)![0];
  const submittedSpec = (): CaptureChartSpec =>
    serviceMock.captureChartSnapshot$.mock.calls[0][0];

  beforeEach(async () => {
    serviceMock = { captureChartSnapshot$: jest.fn().mockReturnValue(of(RESULT)) };

    await TestBed.configureTestingModule({
      imports: [DevScreenshotComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ScreenshotService, useValue: serviceMock },
      ],
    }).compileComponents();
  });

  it('registers dev/screenshot as an authGuarded lazy route', () => {
    const root = CORE_ROUTES[0];
    const route = (root.children ?? []).find((r) => r.path === AppRoutes.SCREENSHOT_DEV);
    expect(route).toBeTruthy();
    expect(route?.canActivate).toContain(authGuard);
    expect(route?.loadComponent).toBeTruthy();
    expect(AppRoutes.SCREENSHOT_DEV).toBe('dev/screenshot');
  });

  it('submits defaults — manual event, stock, D+W intervals, no optional overrides', () => {
    mount();
    setInput('#symbol', 'goog');
    submit();

    expect(submittedSpec()).toEqual({
      symbol: 'GOOG',
      event: CaptureEvent.MANUAL,
      positionType: PositionType.STOCK,
      intervals: [ChartInterval.DAILY, ChartInterval.WEEKLY],
      renderOnly: false, // storeArtifacts defaults checked → primary persists
    });
  });

  it('submits renderOnly:true when the store checkbox is unchecked', () => {
    mount();
    setInput('#symbol', 'goog');
    (fixture.nativeElement.querySelector('#store-artifacts') as HTMLInputElement).click();
    fixture.detectChanges();
    submit();

    expect(submittedSpec().renderOnly).toBe(true);
  });

  it('blocks submit when the symbol is empty', () => {
    mount();
    setInput('#symbol', '   ');
    submit();
    expect(serviceMock.captureChartSnapshot$).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Symbol is required');
  });

  it('blocks submit when no interval is selected', () => {
    mount();
    setInput('#symbol', 'GOOG');
    (fixture.nativeElement.querySelector('#interval-daily') as HTMLInputElement).click();
    (fixture.nativeElement.querySelector('#interval-weekly') as HTMLInputElement).click();
    fixture.detectChanges();
    submit();

    expect(serviceMock.captureChartSnapshot$).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Select at least one interval');
  });

  it('passes width/height/visibleBars/refId overrides when set', () => {
    mount();
    setInput('#symbol', 'AAPL');
    setInput('#width', '400');
    setInput('#height', '280');
    setInput('#visible-bars', 'all');
    setInput('#ref-id', 'ord-42');
    submit();

    expect(submittedSpec()).toMatchObject({
      symbol: 'AAPL',
      width: 400,
      height: 280,
      visibleBars: 'all',
      refId: 'ord-42',
    });
  });

  it('interval checkboxes trim the requested set', () => {
    mount();
    setInput('#symbol', 'AAPL');
    const weeklyBox = fixture.nativeElement.querySelector('#interval-weekly') as HTMLInputElement;
    weeklyBox.click();
    fixture.detectChanges();
    submit();

    expect(submittedSpec().intervals).toEqual([ChartInterval.DAILY]);
  });

  it('renders each returned artifact inline plus its storage paths', async () => {
    mount();
    setInput('#symbol', 'GOOG');
    submit();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    const cards = el.querySelectorAll('.artifact');
    expect(cards).toHaveLength(2);
    expect(cards[0].querySelector('svg')).toBeTruthy();
    expect(el.textContent).toContain('st-trade-screenshots/GOOG/x-daily.svg');
    expect(el.textContent).toContain('st-trade-screenshots/GOOG/x-daily.png');
    expect(el.textContent).toContain('st-trade-screenshots/GOOG/x-weekly.svg');
  });

  it.each([
    ['functions/invalid-argument', 'invalid'],
    ['functions/failed-precondition', 'precondition'],
    ['functions/unauthenticated', 'unauthenticated'],
    ['functions/internal', 'internal'],
  ])('surfaces a distinguishable message for %s', async (code, marker) => {
    serviceMock.captureChartSnapshot$.mockReturnValue(
      throwError(() => Object.assign(new Error('boom'), { code })),
    );
    mount();
    setInput('#symbol', 'GOOG');
    submit();
    await fixture.whenStable();
    fixture.detectChanges();

    const err = fixture.nativeElement.querySelector('.capture-error') as HTMLElement;
    expect(err.textContent!.toLowerCase()).toContain(marker);
  });

  describe('layout playground + zoom (#771)', () => {
    async function mountResult(): Promise<void> {
      mount();
      setInput('#symbol', 'GOOG');
      submit();
      await fixture.whenStable();
      fixture.detectChanges();
    }

    it('renders 3-5 layout variants of the same capture per artifact', async () => {
      await mountResult();
      const artifacts = fixture.nativeElement.querySelectorAll('.artifact');
      artifacts.forEach((a: Element) => {
        const variants = a.querySelectorAll('.variant');
        expect(variants.length).toBeGreaterThanOrEqual(3);
        expect(variants.length).toBeLessThanOrEqual(5);
      });
    });

    it('narrow variants re-render via the callable — one call per interval × width, visibleBars scaled per artifact', async () => {
      await mountResult();
      // Primary + 3 widths × 2 intervals (per-interval calls — a thin
      // interval can't fail the other's variants).
      expect(serviceMock.captureChartSnapshot$).toHaveBeenCalledTimes(7);
      const calls = serviceMock.captureChartSnapshot$.mock.calls.map((c) => c[0] as CaptureChartSpec);
      // Fixture barWidth=6 → visibleBars = (widthPx-64)/6: 480→69, 320→43, 180→19.
      expect(calls[1]).toMatchObject({ intervals: [ChartInterval.DAILY], width: 480, visibleBars: 69, renderOnly: true });
      expect(calls[2]).toMatchObject({ intervals: [ChartInterval.DAILY], width: 320, visibleBars: 43, renderOnly: true });
      expect(calls[3]).toMatchObject({ intervals: [ChartInterval.DAILY], width: 180, visibleBars: 19, renderOnly: true });
      expect(calls[4]).toMatchObject({ intervals: [ChartInterval.WEEKLY], width: 480, visibleBars: 69, renderOnly: true });
      expect(calls[5]).toMatchObject({ intervals: [ChartInterval.WEEKLY], width: 320, visibleBars: 43, renderOnly: true });
      expect(calls[6]).toMatchObject({ intervals: [ChartInterval.WEEKLY], width: 180, visibleBars: 19, renderOnly: true });
      // Height is inherited from the spec (unset here → backend default).
      expect(calls[1].height).toBeUndefined();
      // Variant cards render the re-rendered svg (the RESULT fixture svg).
      const daily = fixture.nativeElement.querySelector('.artifact');
      const svgs = [...daily.querySelectorAll('.variant svg')] as SVGElement[];
      expect(svgs.at(-1)!.textContent).toContain('daily');
    });

    it('a failed-precondition variant keeps its slice placeholder without stomping the banner', async () => {
      let n = 0;
      serviceMock.captureChartSnapshot$.mockImplementation(() => {
        n += 1;
        if (n === 1) return of(RESULT); // primary
        if (n === 5) return throwError(() => Object.assign(new Error('thin'), { code: 'functions/failed-precondition' })); // first weekly variant
        return of(RESULT);
      });
      await mountResult();

      // 7 calls ran; no error banner — placeholders stand in for failures.
      expect(serviceMock.captureChartSnapshot$).toHaveBeenCalledTimes(7);
      expect(fixture.nativeElement.querySelector('.capture-error')).toBeNull();
      const weekly = fixture.nativeElement.querySelectorAll('.artifact')[1];
      const svgs = [...weekly.querySelectorAll('.variant svg')] as SVGElement[];
      expect(svgs.length).toBe(4);
    });

    const ZOOMED_SVG =
      '<svg viewBox="0 0 664 560" data-zoomed="daily"><text>zoomed-daily</text></svg>';
    const ZOOM_RESULT: CaptureChartResult = {
      svg: ZOOMED_SVG,
      paths: ['st-trade-screenshots/GOOG/z-daily.svg'],
      artifacts: [
        { interval: ChartInterval.DAILY, svg: ZOOMED_SVG, svgPath: 'st-trade-screenshots/GOOG/z-daily.svg' },
      ],
    };

    it('zoom re-renders via the callable — same spec, narrowed interval, visibleBars=15', async () => {
      await mountResult();
      serviceMock.captureChartSnapshot$.mockReturnValue(of(ZOOM_RESULT));
      const daily = fixture.nativeElement.querySelector('.artifact');

      (daily.querySelector('.zoom-toggle') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(serviceMock.captureChartSnapshot$).toHaveBeenCalledTimes(8); // primary + 6 variants + zoom
      expect(lastSpec()).toMatchObject({ intervals: [ChartInterval.DAILY], visibleBars: 15, renderOnly: true });
      expect(daily.textContent).toContain('zoomed-daily');
    });

    it('zoom restores the original render on second toggle', async () => {
      await mountResult();
      serviceMock.captureChartSnapshot$.mockReturnValue(of(ZOOM_RESULT));
      const daily = fixture.nativeElement.querySelector('.artifact');
      const btn = daily.querySelector('.zoom-toggle') as HTMLButtonElement;
      btn.click(); fixture.detectChanges();
      await fixture.whenStable(); fixture.detectChanges();
      btn.click(); fixture.detectChanges();

      expect(daily.textContent).toContain('daily');
      expect(daily.textContent).not.toContain('zoomed-daily');
      expect(serviceMock.captureChartSnapshot$).toHaveBeenCalledTimes(8);
    });

    it('drops in-flight variant responses from a superseded capture', async () => {
      const primary1 = new Subject<CaptureChartResult>();
      const laterCalls: Subject<CaptureChartResult>[] = [];
      serviceMock.captureChartSnapshot$
        .mockReturnValueOnce(primary1)
        .mockImplementation(() => {
          const s = new Subject<CaptureChartResult>();
          laterCalls.push(s);
          return s;
        });
      mount();
      setInput('#symbol', 'GOOG');
      submit();
      primary1.next(RESULT);
      primary1.complete();
      await fixture.whenStable();

      // Primary + 6 variant renders in flight.
      expect(laterCalls).toHaveLength(6);

      // Resubmit supersedes the first capture, then resolves.
      submit();
      const primary2 = laterCalls[6];
      primary2.next(RESULT);
      primary2.complete();
      await fixture.whenStable();

      // A stale variant from capture 1 resolves — must not paint.
      laterCalls[0].next({
        svg: '<svg><text>STALE</text></svg>',
        paths: [],
        artifacts: [{ interval: ChartInterval.DAILY, svg: '<svg><text>STALE</text></svg>' }],
      });
      laterCalls[0].complete();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('STALE');
    });

    it('drops an in-flight zoom response from a superseded capture', async () => {
      await mountResult();
      const zoomSubject = new Subject<CaptureChartResult>();
      serviceMock.captureChartSnapshot$.mockReturnValue(zoomSubject);
      const daily = fixture.nativeElement.querySelector('.artifact');

      (daily.querySelector('.zoom-toggle') as HTMLButtonElement).click();
      fixture.detectChanges();

      // Resubmit supersedes the capture mid-zoom; re-arm variants/zoom
      // with deferred Subjects so nothing resolves synchronously.
      const deferred: Subject<CaptureChartResult>[] = [];
      serviceMock.captureChartSnapshot$.mockImplementation(() => {
        const s = new Subject<CaptureChartResult>();
        deferred.push(s);
        return s;
      });
      submit();
      deferred[0].next(RESULT);
      deferred[0].complete();
      await fixture.whenStable();
      fixture.detectChanges();

      // The stale zoom response resolves — must not paint.
      zoomSubject.next({
        svg: '<svg><text>STALE-ZOOM</text></svg>',
        paths: [],
        artifacts: [{ interval: ChartInterval.DAILY, svg: '<svg><text>STALE-ZOOM</text></svg>' }],
      });
      zoomSubject.complete();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(fixture.nativeElement.textContent).not.toContain('STALE-ZOOM');
    });

    it('zoom state is per-artifact — weekly zoom leaves daily alone', async () => {
      await mountResult();
      const weeklyZoom: CaptureChartResult = {
        ...ZOOM_RESULT,
        artifacts: [{ ...ZOOM_RESULT.artifacts[0], interval: ChartInterval.WEEKLY,
          svg: '<svg><text>zoomed-weekly</text></svg>' }],
      };
      serviceMock.captureChartSnapshot$.mockReturnValue(of(weeklyZoom));
      const [daily, weekly] = fixture.nativeElement.querySelectorAll('.artifact');

      (weekly.querySelector('.zoom-toggle') as HTMLButtonElement).click();
      fixture.detectChanges();
      await fixture.whenStable(); fixture.detectChanges();

      expect(lastSpec()).toMatchObject({ intervals: [ChartInterval.WEEKLY], visibleBars: 15 });
      expect(weekly.textContent).toContain('zoomed-weekly');
      expect(daily.textContent).not.toContain('zoomed');
    });
  });

  it('prevents a second submit while a capture is in flight', async () => {
    serviceMock.captureChartSnapshot$.mockReturnValue(new Subject<CaptureChartResult>());
    mount();
    setInput('#symbol', 'GOOG');
    submit();
    submit();

    expect(serviceMock.captureChartSnapshot$).toHaveBeenCalledTimes(1);
    const btn = fixture.nativeElement.querySelector('#capture-submit') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
