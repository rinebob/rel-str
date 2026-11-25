/**
 * ScannerChartPopupComponent spec (#1098/#1307+#1308) — the chart popup
 * chrome rendered inside the recipe table's cdkConnectedOverlay. Pins the
 * header (symbol + name), the tracked-mode fork, and the fetch-state
 * shells; the untracked fork's chart body is store-driven — the spec
 * stubs ScannerChartStore at the provider seam and FlexChartComponent at
 * the component seam (gallery-card-chart precedent — Syncfusion can't
 * run under jsdom).
 */
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { Component, input } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { ScannerChartPopupComponent } from './scanner-chart-popup.component';
import { ScannerChartStore } from '../../stores/scanner-chart.store';
import { FlexChartComponent } from '../../../shared/components/flex-chart/flex-chart.component';
import type {
  FlexChartConfig,
  FlexChartDataset,
  PriceBar,
} from '../../../shared/components/flex-chart/flex-chart.types';

@Component({
  selector: 'app-flex-chart',
  standalone: true,
  template: '',
})
class FlexChartStub {
  chartData = input<FlexChartDataset | null>();
  config = input<FlexChartConfig>();
  height = input<string>();
}

const pb = (date: string, close: number): PriceBar => ({
  date,
  x: new Date(`${date}T00:00:00Z`),
  open: close,
  high: close,
  low: close,
  close,
});

describe('ScannerChartPopupComponent', () => {
  let fixture: ComponentFixture<ScannerChartPopupComponent>;
  let chartStore: {
    bars: ReturnType<typeof signal<Record<string, PriceBar[]>>>;
    loading: ReturnType<typeof signal<Record<string, boolean>>>;
    error: ReturnType<
      typeof signal<Record<string, { message: string; auth: boolean } | null>>
    >;
    ensureBars: jest.Mock;
    clearError: jest.Mock;
  };

  function mount(extras: {
    name?: string;
    tracked?: boolean;
    state?: 'loading' | 'error' | 'auth';
  } = {}): void {
    fixture = TestBed.createComponent(ScannerChartPopupComponent);
    fixture.componentRef.setInput('symbol', 'AAPL');
    if (extras.name !== undefined) {
      fixture.componentRef.setInput('name', extras.name);
    }
    if (extras.tracked !== undefined) {
      fixture.componentRef.setInput('tracked', extras.tracked);
    }
    if (extras.state !== undefined) {
      fixture.componentRef.setInput('state', extras.state);
    }
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    chartStore = {
      bars: signal<Record<string, PriceBar[]>>({}),
      loading: signal<Record<string, boolean>>({}),
      error: signal<
        Record<string, { message: string; auth: boolean } | null>
      >({}),
      ensureBars: jest.fn(),
      clearError: jest.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [ScannerChartPopupComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: ScannerChartStore, useValue: chartStore },
      ],
    })
      .overrideComponent(ScannerChartPopupComponent, {
        remove: { imports: [FlexChartComponent] },
        add: { imports: [FlexChartStub] },
      })
      .compileComponents();
  });

  it('renders the symbol + name header', () => {
    mount({ name: 'Apple Inc' });
    const head = el().querySelector('.popup-head')!;
    expect(head.textContent).toContain('AAPL');
    expect(head.textContent).toContain('Apple Inc');
  });

  it('omits the name span when the row carries no display name', () => {
    mount({});
    expect(el().querySelector('.popup-head')!.textContent).toContain('AAPL');
    expect(el().querySelector('.popup-name')).toBeNull();
  });

  it('marks the body with the tracked-mode fork for the chart tasks', () => {
    mount({ tracked: true });
    expect(
      el().querySelector('.popup-body')!.getAttribute('data-mode'),
    ).toBe('tracked');
  });

  it('marks the body untracked for new rows', () => {
    mount({ tracked: false });
    expect(
      el().querySelector('.popup-body')!.getAttribute('data-mode'),
    ).toBe('untracked');
  });

  it('shows the loading state by default — a spinner, not a blank frame', () => {
    mount({});
    const body = el().querySelector('.popup-body')!;
    expect(body.querySelector('[role="progressbar"]')).not.toBeNull();
    expect(body.textContent).toContain('Loading chart');
  });

  it('explicit error state without a store message falls back to honest copy', () => {
    mount({ state: 'error' });
    const body = el().querySelector('.popup-body')!;
    expect(body.textContent).toContain('Chart unavailable');
    expect(body.querySelector('[role="progressbar"]')).toBeNull();
  });

  it('auth state surfaces the reauth affordance and emits on click', () => {
    mount({ state: 'auth' });
    let fired = 0;
    fixture.componentInstance.reauth.subscribe(() => fired++);
    const btn = el().querySelector<HTMLButtonElement>(
      '.popup-body button',
    )!;
    expect(btn.textContent).toContain('Re-authorize');
    btn.click();
    expect(fired).toBe(1);
  });

  it('containsFocus reports focus inside the popup (grace guard)', () => {
    mount({ state: 'auth' });
    expect(fixture.componentInstance.containsFocus()).toBe(false);
    const btn = el().querySelector<HTMLElement>('.popup-body button')!;
    btn.focus();
    expect(fixture.componentInstance.containsFocus()).toBe(true);
    btn.blur();
  });

  it('emits openChart from the header deep-link affordance in every state', () => {
    mount({ state: 'auth' });
    let fired = 0;
    fixture.componentInstance.openChart.subscribe(() => fired++);
    const btn = el().querySelector<HTMLButtonElement>(
      '[data-testid="open-chart-btn"]',
    )!;
    expect(btn).not.toBeNull();
    btn.click();
    expect(fired).toBe(1);
  });

  it('Enter lands on the body affordance, not the header deep-link button', () => {
    mount({ state: 'auth' });
    fixture.componentInstance.focusPrimary();
    expect(
      document.activeElement?.textContent?.includes('Re-authorize'),
    ).toBe(true);
  });

  describe('untracked body (#1308)', () => {
    const stub = () =>
      fixture.debugElement.query(By.directive(FlexChartStub))
        ?.componentInstance as FlexChartStub | undefined;

    it('calls ensureBars for the row symbol on mount', () => {
      mount({});
      expect(chartStore.ensureBars).toHaveBeenCalledWith('AAPL');
    });

    it('does not fetch for tracked rows — the #1309 path stays untouched', () => {
      mount({ tracked: true });
      expect(chartStore.ensureBars).not.toHaveBeenCalled();
      expect(el().querySelector('[data-testid="popup-chart"]')).toBeNull();
      expect(
        el().querySelector('.popup-body')!.textContent,
      ).toContain('Loading chart');
    });

    it('settled bars mount the flex chart — candle dataset + three SMA lines', () => {
      chartStore.bars.set({
        AAPL: Array.from({ length: 80 }, (_, i) =>
          pb(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 100 + i),
        ),
      });
      mount({});
      fixture.detectChanges();
      const chart = stub();
      expect(chart).toBeTruthy();
      expect(chart!.chartData()!.symbol).toBe('AAPL');
      expect(chart!.chartData()!.bars).toHaveLength(80);
      const indicators = chart!.config()!.indicators;
      // 'custom' — externally-computed data, no registered calculator.
      expect(indicators.map((i) => i.type)).toEqual([
        'custom',
        'custom',
        'custom',
      ]);
      expect(indicators.map((i) => i.seriesType)).toEqual([
        'line',
        'line',
        'line',
      ]);
      expect(indicators.map((i) => i.pane)).toEqual([
        'overlay',
        'overlay',
        'overlay',
      ]);
      expect(indicators.map((i) => i.params['period'])).toEqual([10, 20, 50]);
      // Warmup nulls are dropped — each series starts at its first full
      // window, aligned to bar x dates.
      expect(indicators[0].data).toHaveLength(80 - 9);
      expect(indicators[2].data).toHaveLength(80 - 49);
      const cfg = chart!.config()!;
      expect(cfg.showZoomToolbar).toBe(false);
      expect(cfg.enableScrollbar).toBe(false);
      expect(cfg.showCrosshair).toBe(false);
      expect(cfg.visibleBars).toBe(60);
    });

    it('volume-bearing bars add a lower-pane column series + 75/25 pane split', () => {
      chartStore.bars.set({
        AAPL: Array.from({ length: 80 }, (_, i) => ({
          ...pb(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 100 + i),
          volume: 1_000_000 + i,
        })),
      });
      mount({});
      fixture.detectChanges();
      const cfg = stub()!.config()!;
      const vol = cfg.indicators.find((i) => i.id === 'volume')!;
      expect(vol.type).toBe('volume');
      expect(vol.pane).toBe('lower-1');
      expect(vol.seriesType).toBe('column');
      expect(vol.data).toHaveLength(80);
      expect(cfg.mainPanePercent).toBe(75);
    });

    it('bars without volume emit no volume indicator — the lower pane collapses', () => {
      chartStore.bars.set({
        AAPL: Array.from({ length: 80 }, (_, i) =>
          pb(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`, 100 + i),
        ),
      });
      mount({});
      fixture.detectChanges();
      const cfg = stub()!.config()!;
      expect(cfg.indicators.some((i) => i.pane === 'lower-1')).toBe(false);
    });

    it('store error renders the message in the untracked fork', () => {
      chartStore.error.set({
        AAPL: { message: 'historicals unavailable', auth: false },
      });
      mount({});
      fixture.detectChanges();
      expect(el().querySelector('.popup-body')!.textContent).toContain(
        'historicals unavailable',
      );
      expect(el().querySelector('[data-testid="popup-chart"]')).toBeNull();
    });

    it('store auth error renders the reauth affordance', () => {
      chartStore.error.set({
        AAPL: { message: 'unauthorized', auth: true },
      });
      mount({});
      fixture.detectChanges();
      const btn = el().querySelector<HTMLButtonElement>(
        '.popup-body button',
      )!;
      expect(btn.textContent).toContain('Re-authorize');
    });

    it('Re-authorize click clears + retries the symbol fetch and emits for the page', () => {
      chartStore.error.set({
        AAPL: { message: 'unauthorized', auth: true },
      });
      mount({});
      fixture.detectChanges();
      chartStore.ensureBars.mockClear();
      let fired = 0;
      fixture.componentInstance.reauth.subscribe(() => fired++);
      el()
        .querySelector<HTMLButtonElement>('.popup-body button')!
        .click();
      expect(chartStore.clearError).toHaveBeenCalledWith('AAPL');
      expect(chartStore.ensureBars).toHaveBeenCalledWith('AAPL');
      expect(fired).toBe(1);
    });

    it('empty bars render an honest no-data note, not a blank chart', () => {
      chartStore.bars.set({ AAPL: [] });
      mount({});
      fixture.detectChanges();
      expect(el().querySelector('.popup-body')!.textContent).toContain(
        'No daily bars',
      );
    });

    it('loading while the fetch is in flight', () => {
      mount({});
      expect(
        el().querySelector('.popup-body [role="progressbar"]'),
      ).not.toBeNull();
    });
  });
});
