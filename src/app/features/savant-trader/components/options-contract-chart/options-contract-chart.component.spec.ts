import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { ChartModule } from '@syncfusion/ej2-angular-charts';

import {
  OptionsContractChartComponent,
  MARKER_NAME_PREFIX,
  type PlottedChartContract,
  type ChartSeriesSpec,
} from './options-contract-chart.component';
import type { ParsedObservation } from '../../utils/contract-observation.utils';
import type { OHLCDatum } from '../../../shared/types/rs.interfaces';

const obs = (date: string, mark: number | null, extra: Partial<ParsedObservation> = {}): ParsedObservation => ({
  date, mark, bid: null, ask: null, volume: null, openInterest: null,
  iv: null, delta: null, gamma: null, theta: null, vega: null, rho: null,
  ...extra,
});

const contract = (over: Partial<PlottedChartContract> = {}): PlottedChartContract => ({
  contractId: 'QQQ260116C00600000',
  label: '600C 2026-01-16',
  strike: 600,
  expiration: '2026-01-16',
  openDate: '2025-11-03',
  points: [],
  ...over,
});

const bar = (date: string, close: number): OHLCDatum => ({
  x: new Date(`${date}T00:00:00Z`), date, open: close, high: close, low: close, close,
});

/** The real ejs-chart needs browser SVG APIs jsdom lacks — this stub exposes
 *  just the members the component's effects touch so signals stay testable. */
@Component({ selector: 'ejs-chart', standalone: true, template: '' })
class EjsChartStub {
  primaryXAxis: Record<string, unknown> = {};
  primaryYAxis: Record<string, unknown> = {};
  axisCollections: { name?: string; minimum?: number; maximum?: number; visibleRange?: { min: number; max: number } }[] = [];
  animateSeries = false;
  refresh(): void {}
  dataBind(): void {}
}

describe('OptionsContractChartComponent', () => {
  let fixture: ComponentFixture<OptionsContractChartComponent>;
  let component: OptionsContractChartComponent;

  const series = (): ChartSeriesSpec[] => component.seriesCollection();
  const markSeries = () => series().filter((s) => s.role === 'mark');
  const markerSeries = () => series().filter((s) => s.role === 'marker');
  const setInputs = (seriesIn: PlottedChartContract[], labels: string[], extras: Record<string, unknown> = {}) => {
    fixture.componentRef.setInput('plottedSeries', seriesIn);
    fixture.componentRef.setInput('xLabels', labels);
    fixture.componentRef.setInput('underlyingBars', extras['underlyingBars'] ?? []);
    fixture.componentRef.setInput('showUnderlying', extras['showUnderlying'] ?? true);
    fixture.componentRef.setInput('showGreeks', extras['showGreeks'] ?? true);
    fixture.componentRef.setInput('showVolumeOI', extras['showVolumeOI'] ?? true);
    fixture.componentRef.setInput('padDays', extras['padDays'] ?? 0);
  };

  beforeEach(async () => {
    // Assert on the component's computed signals; the stub replaces the real
    // chart so no SVG rendering happens under jsdom.
    await TestBed.configureTestingModule({
      imports: [OptionsContractChartComponent],
    })
      .overrideComponent(OptionsContractChartComponent, {
        remove: { imports: [ChartModule] },
        add: { imports: [EjsChartStub] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(OptionsContractChartComponent);
    component = fixture.componentRef.instance;
  });

  describe('multi-series main pane', () => {
    it('renders one mark line per plotted contract', () => {
      const a = contract({ points: [obs('2025-11-03', 10), obs('2025-11-04', 11)] });
      const b = contract({
        contractId: 'QQQ260220P00580000', label: '580P 2026-02-20', strike: 580,
        expiration: '2026-02-20', openDate: '2025-11-04',
        points: [obs('2025-11-04', 5), obs('2025-11-05', 6)],
      });
      setInputs([a, b], ['2025-11-03', '2025-11-04', '2025-11-05', '2026-01-16', '2026-02-20']);
      fixture.detectChanges();

      const marks = markSeries();
      expect(marks.length).toBe(2);
      expect(marks.map((s) => s.name)).toEqual(['600C 2026-01-16', '580P 2026-02-20']);
      expect(marks.every((s) => s.type === 'Line')).toBe(true);
      expect(marks.every((s) => s.yAxisName === undefined)).toBe(true);
    });

    it('pads mark series to the union axis with nulls for missing dates', () => {
      const a = contract({ points: [obs('2025-11-03', 10), obs('2025-11-05', 12)] });
      const b = contract({
        contractId: 'QQQ260220P00580000', label: 'B', strike: 580, expiration: '2026-02-20',
        openDate: '2025-11-04', points: [obs('2025-11-04', 5)],
      });
      setInputs([a, b], ['2025-11-03', '2025-11-04', '2025-11-05', '2026-01-16', '2026-02-20']);
      fixture.detectChanges();

      const marks = markSeries();
      expect(marks[0].dataSource).toEqual([
        { date: '2025-11-03', value: 10 },
        { date: '2025-11-04', value: null },
        { date: '2025-11-05', value: 12 },
        { date: '2026-01-16', value: null },
        { date: '2026-02-20', value: null },
      ]);
      expect(marks[1].dataSource).toEqual([
        { date: '2025-11-03', value: null },
        { date: '2025-11-04', value: 5 },
        { date: '2025-11-05', value: null },
        { date: '2026-01-16', value: null },
        { date: '2026-02-20', value: null },
      ]);
    });

    it('renders the underlying overlay on the opposed axis padded to the union', () => {
      const a = contract({ points: [obs('2025-11-03', 10)] });
      setInputs([a], ['2025-11-03', '2025-11-04'], {
        underlyingBars: [bar('2025-11-03', 590), bar('2025-11-04', 592)],
      });
      fixture.detectChanges();

      const und = series().find((s) => s.role === 'underlying');
      expect(und).toBeTruthy();
      expect(und!.yAxisName).toBe('underlyingAxis');
      // Padded to the axis union — the contract's expiration endpoint lands
      // as a null (gap) since no bar exists there.
      expect(und!.dataSource).toEqual([
        { date: '2025-11-03', value: 590 },
        { date: '2025-11-04', value: 592 },
        { date: '2026-01-16', value: null },
      ]);
    });
  });

  describe('span markers', () => {
    it('draws a 2-point line from openDate to expiration at strike on the underlying axis', () => {
      const a = contract({ points: [obs('2025-11-03', 10)] });
      setInputs([a], ['2025-11-03', '2026-01-16']);
      fixture.detectChanges();

      const markers = markerSeries();
      expect(markers.length).toBe(1);
      expect(markers[0].name).toBe(`${MARKER_NAME_PREFIX}${a.contractId}`);
      expect(markers[0].yAxisName).toBe('underlyingAxis');
      expect(markers[0].dataSource).toEqual([
        { date: '2025-11-03', value: 600 },
        { date: '2026-01-16', value: 600 },
      ]);
      expect(markers[0].marker?.visible).toBe(true);
    });

    it('emits no marker when openDate is absent (bare ID — no selection date)', () => {
      const a = contract({
        openDate: null,
        points: [obs('2025-10-01', 8), obs('2025-10-02', 9)],
      });
      setInputs([a], ['2025-10-01', '2025-10-02', '2026-01-16']);
      fixture.detectChanges();

      expect(markerSeries()).toHaveLength(0);
      expect(markSeries()).toHaveLength(1);
    });

    it('skips the marker when the span start is after expiration', () => {
      const a = contract({ openDate: '2026-03-01', points: [obs('2025-11-03', 10)] });
      setInputs([a], ['2025-11-03', '2026-03-01']);
      fixture.detectChanges();

      expect(markerSeries().length).toBe(0);
      // Contract's mark line still renders
      expect(markSeries().length).toBe(1);
    });

    it('skips the marker for a contract with no points and no openDate', () => {
      const a = contract({ openDate: null, points: [] });
      setInputs([a], ['2026-01-16']);
      fixture.detectChanges();

      expect(markerSeries().length).toBe(0);
    });

    it('color-matches each marker to its mark line', () => {
      const a = contract({ points: [obs('2025-11-03', 10)] });
      const b = contract({
        contractId: 'QQQ260220P00580000', label: 'B', strike: 580, expiration: '2026-02-20',
        openDate: '2025-11-04', points: [obs('2025-11-04', 5)],
      });
      setInputs([a, b], ['2025-11-03', '2025-11-04', '2026-01-16', '2026-02-20']);
      fixture.detectChanges();

      const marks = markSeries();
      const markers = markerSeries();
      expect(markers[0].fill).toBe(marks[0].fill);
      expect(markers[1].fill).toBe(marks[1].fill);
    });

    it('cancels legend entries for marker series', () => {
      const args = { text: `${MARKER_NAME_PREFIX}QQQ260116C00600000`, cancel: false };
      component.onLegendRender(args);
      expect(args.cancel).toBe(true);

      const keep = { text: '600C 2026-01-16', cancel: false };
      component.onLegendRender(keep);
      expect(keep.cancel).toBe(false);
    });

    it('unions marker endpoints into the axis even when absent from xLabels', () => {
      // The chart owns the endpoint invariant — a caller passing plain
      // observation dates must still get aligned span markers.
      const a = contract({ points: [obs('2025-11-03', 10)] });
      setInputs([a], ['2025-11-03']);
      fixture.detectChanges();

      expect(component.axisLabels()).toEqual(['2025-11-03', '2026-01-16']);
    });
  });

  describe('pane gating', () => {
    it('renders IV/Greeks/Volume-OI panes when exactly one contract is plotted', () => {
      const a = contract({ points: [obs('2025-11-03', 10, { iv: 0.4, delta: 0.5, gamma: 0.02, volume: 100, openInterest: 5000 })] });
      setInputs([a], ['2025-11-03'], { underlyingBars: [bar('2025-11-03', 590)] });
      fixture.detectChanges();

      expect(component.rows().length).toBe(4);
      const names = series().map((s) => s.name);
      for (const pane of ['IV', 'Delta', 'Gamma', 'Volume', 'OI']) {
        expect(names).toContain(pane);
      }
    });

    it('hides lower panes in multi mode', () => {
      const a = contract({ points: [obs('2025-11-03', 10)] });
      const b = contract({
        contractId: 'QQQ260220P00580000', label: 'B', strike: 580, expiration: '2026-02-20',
        openDate: '2025-11-04', points: [obs('2025-11-04', 5)],
      });
      setInputs([a, b], ['2025-11-03', '2025-11-04']);
      fixture.detectChanges();

      expect(component.rows().length).toBe(1);
      const names = series().map((s) => s.name);
      for (const pane of ['IV', 'Delta', 'Gamma', 'Volume', 'OI']) {
        expect(names).not.toContain(pane);
      }
    });

    it('renders a single pane when nothing is plotted (underlying-only fallback)', () => {
      setInputs([], ['2025-11-03', '2025-11-04'], {
        underlyingBars: [bar('2025-11-03', 590), bar('2025-11-04', 592)],
      });
      fixture.detectChanges();

      expect(component.rows().length).toBe(1);
      expect(markSeries().length).toBe(0);
      expect(markerSeries().length).toBe(0);
      expect(series().some((s) => s.name === 'Underlying')).toBe(true);
    });
  });

  describe('axis ranges', () => {
    it('marks range spans all plotted series within the visible window', () => {
      const a = contract({ points: [obs('2025-11-03', 10), obs('2025-11-04', 20)] });
      const b = contract({
        contractId: 'QQQ260220P00580000', label: 'B', strike: 580, expiration: '2026-02-20',
        openDate: '2025-11-04', points: [obs('2025-11-04', 2), obs('2025-11-05', 4)],
      });
      setInputs([a, b], ['2025-11-03', '2025-11-04', '2025-11-05']);
      fixture.detectChanges();

      const ranges = component.axisRanges();
      expect(ranges).toBeTruthy();
      expect(ranges!.mark.min).toBe(2);
      expect(ranges!.mark.max).toBe(20);
    });

    it('underlying range covers a marker strike outside the close range', () => {
      // A deep-OTM marker sits ON the underlying axis — the axis must widen
      // to the strike or the span marker renders invisible.
      const a = contract({ strike: 900, points: [obs('2025-11-03', 10)] });
      setInputs([a], ['2025-11-03'], {
        underlyingBars: [bar('2025-11-03', 590), bar('2025-11-04', 592)],
      });
      fixture.detectChanges();

      expect(component.axisRanges()!.underlying.max).toBeGreaterThanOrEqual(900);
    });

    it('underlying range covers marker strikes when no bars are loaded', () => {
      const a = contract({ strike: 600, points: [obs('2025-11-03', 10)] });
      setInputs([a], ['2025-11-03'], { underlyingBars: [] });
      fixture.detectChanges();

      const ranges = component.axisRanges()!;
      expect(ranges.underlying.min).toBeLessThanOrEqual(600);
      expect(ranges.underlying.max).toBeGreaterThanOrEqual(600);
    });
  });
});
