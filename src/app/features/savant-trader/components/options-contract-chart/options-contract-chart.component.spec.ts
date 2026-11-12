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
  primaryYAxis: Record<string, unknown> = { rect: { x: 60, y: 20, width: 40, height: 300 } };
  /** Real Syncfusion populates this after layout — the X-axis rect itself
   *  is the label strip (height 0), so brush overlays take their vertical
   *  extent from seriesClipRect. */
  chartAxisLayoutPanel: { seriesClipRect?: { x: number; y: number; width: number; height: number } } = {};
  axisCollections: {
    name?: string;
    minimum?: number;
    maximum?: number;
    visibleRange?: { min: number; max: number; delta?: number };
    rect?: { x: number; y: number; width: number; height: number };
  }[] = [];
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

    it('dims every other mark/marker while one contract is highlighted', () => {
      const a = contract({ points: [obs('2025-11-03', 10)] });
      const b = contract({
        contractId: 'QQQ260220P00580000', label: 'B', strike: 580, expiration: '2026-02-20',
        openDate: '2025-11-04', points: [obs('2025-11-04', 5)],
      });
      setInputs([a, b], ['2025-11-03', '2025-11-04', '2026-01-16', '2026-02-20']);
      fixture.componentRef.setInput('highlightedContractId', a.contractId);
      fixture.detectChanges();

      const marks = markSeries();
      const markA = marks.find((s) => s.name === '600C 2026-01-16')!;
      const markB = marks.find((s) => s.name === 'B')!;
      expect(markA.opacity).toBe(1);
      expect(markA.width).toBe(3);
      expect(markB.opacity).toBe(0.25);
      // Z-order: the lit series reorders last — Syncfusion paints in
      // array order, so the bold line draws over the dimmed set.
      expect(marks.at(-1)!.name).toBe('600C 2026-01-16');

      const markers = markerSeries();
      const spanA = markers.find((s) => s.name.endsWith(a.contractId))!;
      const spanB = markers.find((s) => s.name.endsWith(b.contractId))!;
      expect(spanA.opacity).toBe(1);
      expect(spanB.opacity).toBe(0.25);
      // The hovered span bolds like the mark line; the dimmed span's dots
      // fade via marker-level opacity as well as the series line.
      expect(spanA.width).toBe(3);
      expect(spanA.marker!.width).toBe(11);
      expect(spanA.marker!.opacity).toBe(1);
      expect(spanB.width).toBe(1.5);
      expect(spanB.marker!.opacity).toBe(0.25);
      expect(markers.at(-1)!.name.endsWith(a.contractId)).toBe(true);
    });

    it('no highlight — every series at full weight', () => {
      const a = contract({ points: [obs('2025-11-03', 10)] });
      const b = contract({
        contractId: 'QQQ260220P00580000', label: 'B', strike: 580, expiration: '2026-02-20',
        openDate: '2025-11-04', points: [obs('2025-11-04', 5)],
      });
      setInputs([a, b], ['2025-11-03', '2025-11-04'], { showUnderlying: false });
      fixture.detectChanges();

      expect(markSeries().every((s) => s.opacity === 1 && s.width === 2)).toBe(true);
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

    it('draws one vertex per pick day plus expiration — a repeated contract marks every entry', () => {
      const a = contract({
        markerDates: ['2025-11-03', '2025-11-05', '2025-11-07'],
        points: [obs('2025-11-03', 10)],
      });
      setInputs([a], ['2025-11-03', '2025-11-05', '2025-11-07', '2026-01-16']);
      fixture.detectChanges();

      const markers = markerSeries();
      expect(markers.length).toBe(1);
      expect(markers[0].dataSource).toEqual([
        { date: '2025-11-03', value: 600 },
        { date: '2025-11-05', value: 600 },
        { date: '2025-11-07', value: 600 },
        { date: '2026-01-16', value: 600 },
      ]);
    });

    it('unions every pick day into the axis even when absent from xLabels', () => {
      const a = contract({
        markerDates: ['2025-11-03', '2025-11-05'],
        points: [obs('2025-11-03', 10)],
      });
      setInputs([a], ['2025-11-03']);
      fixture.detectChanges();

      expect(component.axisLabels()).toEqual(['2025-11-03', '2025-11-05', '2026-01-16']);
    });

    it('drops pick days past expiration but keeps the earlier ones', () => {
      const a = contract({
        markerDates: ['2025-11-03', '2026-03-01'],
        points: [obs('2025-11-03', 10)],
      });
      setInputs([a], ['2025-11-03', '2026-01-16']);
      fixture.detectChanges();

      const markers = markerSeries();
      expect(markers.length).toBe(1);
      expect(markers[0].dataSource).toEqual([
        { date: '2025-11-03', value: 600 },
        { date: '2026-01-16', value: 600 },
      ]);
    });

    it('emits no marker when every pick day is past expiration', () => {
      const a = contract({
        markerDates: ['2026-02-01', '2026-03-01'],
        points: [obs('2025-11-03', 10)],
      });
      setInputs([a], ['2025-11-03']);
      fixture.detectChanges();

      expect(markerSeries().length).toBe(0);
      expect(markSeries().length).toBe(1);
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

  describe('crosshair', () => {
    it('floats free and shows its y-value on the opposed (right-edge) axis', () => {
      expect(component.crosshair.snapToData).toBe(false);
      expect(
        (component.underlyingAxis() as { crosshairTooltip?: { enable: boolean } }).crosshairTooltip,
      ).toEqual({ enable: true });
      // Mark axis on the left carries no crosshair label.
      expect('crosshairTooltip' in component.primaryYAxis()).toBe(false);
    });
  });

  describe('series hover → contract id', () => {
    const mouseOver = (target: string) =>
      component.onChartMouseMove({ target } as Parameters<typeof component.onChartMouseMove>[0]);
    const TWO_CONTRACT_LEGEND = {
      // marks at g_0/g_1; cancelled markers consume g_2/g_3; underlying at g_4
      a: 'chart_chart_legend_g_0',
      b: 'chart_chart_legend_g_1',
      underlying: 'chart_chart_legend_g_4',
    };

    const twoContracts = () => {
      const a = contract({ points: [obs('2025-11-03', 10)] });
      const b = contract({
        contractId: 'QQQ260220P00580000', label: 'B', strike: 580, expiration: '2026-02-20',
        openDate: '2025-11-04', points: [obs('2025-11-04', 5)],
      });
      setInputs([a, b], ['2025-11-03', '2025-11-04', '2026-01-16', '2026-02-20']);
      fixture.detectChanges();
      return { a, b };
    };

    it('hovering a mark series emits its contract id; empty target emits null', () => {
      const { a, b } = twoContracts();
      const emitted: (string | null)[] = [];
      component.seriesHovered.subscribe((id) => emitted.push(id));

      mouseOver('chart_Series_1_Point_3');
      expect(emitted).toEqual([b.contractId]);

      mouseOver('chart_Series_0');
      expect(emitted).toEqual([b.contractId, a.contractId]);

      mouseOver('chart_secondary_YAxis_3');
      expect(emitted).toEqual([b.contractId, a.contractId, null]);
    });

    it('hovering a span marker emits its contract id — markers sit after the marks in the collection', () => {
      const { b } = twoContracts();
      const emitted: (string | null)[] = [];
      component.seriesHovered.subscribe((id) => emitted.push(id));

      // marks[0,1], then markers[2,3], then underlying — b's marker is index 3
      mouseOver('chart_Series_3');
      expect(emitted).toEqual([b.contractId]);
    });

    it('highlighted z-order reorder — hover resolves by spec contractId, not position', () => {
      const { a, b } = twoContracts();
      fixture.componentRef.setInput('highlightedContractId', a.contractId);
      fixture.detectChanges();

      // a's mark+span reorder to the end: collection =
      // [mark_b, span_b, underlying, mark_a, span_a]. An ordinal
      // index→contract map would call Series_0 "a" — the spec-tagged map
      // resolves the real id at every index.
      const emitted: (string | null)[] = [];
      component.seriesHovered.subscribe((id) => emitted.push(id));

      mouseOver('chart_Series_0'); // mark_b — NOT a, despite a's reorder
      expect(emitted).toEqual([b.contractId]);

      mouseOver('chart_Series_2'); // underlying — still not a contract
      expect(emitted).toEqual([b.contractId, null]);

      mouseOver('chart_Series_3'); // mark_a landed at the hot end
      expect(emitted).toEqual([b.contractId, null, a.contractId]);
    });

    it('hovering a legend item emits the mark contract id; non-contract legend items emit null', () => {
      const { a, b } = twoContracts();
      const emitted: (string | null)[] = [];
      component.seriesHovered.subscribe((id) => emitted.push(id));

      mouseOver(TWO_CONTRACT_LEGEND.b);
      expect(emitted).toEqual([b.contractId]);

      // The text label and shape glyph carry the same trailing index —
      // hovering any part of the legend item highlights the same contract.
      mouseOver('chart_chart_legend_text_0');
      expect(emitted).toEqual([b.contractId, a.contractId]);
      mouseOver('chart_chart_legend_shape_0');
      expect(emitted).toEqual([b.contractId, a.contractId]); // unchanged — deduped

      // Legend indices are visibleSeries positions — cancelled markers keep
      // their slots, so the underlying's real id is g_4, not g_2.
      mouseOver(TWO_CONTRACT_LEGEND.underlying);
      expect(emitted).toEqual([b.contractId, a.contractId, null]);
    });

    it('chart mouse leave emits null and repeated targets emit once', () => {
      const { a } = twoContracts();
      const emitted: (string | null)[] = [];
      component.seriesHovered.subscribe((id) => emitted.push(id));

      mouseOver('chart_Series_0');
      mouseOver('chart_Series_0_Point_1');
      expect(emitted).toEqual([a.contractId]);

      component.onChartMouseLeave();
      expect(emitted).toEqual([a.contractId, null]);
    });
  });

  describe('study-range brush (FE-4)', () => {
    const LABELS = ['2026-06-01', '2026-06-02', '2026-06-03', '2026-06-04', '2026-06-05'];
    // Matches the real SDK contract: the X-axis rect is the label strip
    // (height 0, y at plot bottom); the plot column lives in seriesClipRect.
    const AXIS_SPACE = {
      rect: { x: 100, y: 320, width: 800, height: 0 },
      visibleRange: { min: 0, max: 10, delta: 10 },
    };
    const CLIP_RECT = { x: 100, y: 20, width: 800, height: 300 };

    const chartEl = () =>
      fixture.debugElement.query((d) => d.componentInstance instanceof EjsChartStub)
        .componentInstance as EjsChartStub;

    const setupBrush = (corpus: string[] = []) => {
      setInputs([], LABELS, {});
      fixture.componentRef.setInput('brushArmed', true);
      fixture.componentRef.setInput('brushCorpus', corpus);
      fixture.detectChanges();
      const stub = chartEl();
      stub.axisCollections = [{ ...AXIS_SPACE }];
      stub.chartAxisLayoutPanel = { seriesClipRect: { ...CLIP_RECT } };
      fixture.detectChanges();
      return stub;
    };

    it('renders the capture layer only while armed', () => {
      setInputs([], LABELS, {});
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.brush-capture')).toBeNull();

      fixture.componentRef.setInput('brushArmed', true);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.brush-capture')).not.toBeNull();
    });

    it('a drag emits a snapped, ordered studyRange', () => {
      setupBrush();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(340);
      component.brushMoveTo(180);
      component.brushUpAt(180);

      expect(emitted).toEqual([{ start: '2026-06-02', end: '2026-06-04' }]);
    });

    it('the drag rect live-snaps its edges to the resolved dates', () => {
      setupBrush();
      component.brushDownAt(150); // raw edge — sits mid-slot
      component.brushMoveTo(330); // raw edge — sits mid-slot
      fixture.detectChanges();

      const rect = fixture.nativeElement.querySelector('.brush-rect') as HTMLElement;
      expect(rect).not.toBeNull();
      // Snapped: 150 → idx 1 (06-02) → 180px; 330 → idx 3 (06-04) → 340px.
      expect(rect.style.left).toBe('180px');
      expect(rect.style.width).toBe('160px');
    });

    it('snaps edges to corpusDates when the drawer has fetched', () => {
      setupBrush(['2026-06-02', '2026-06-04']);
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(180); // ~06-02
      component.brushUpAt(500);   // idx 5 → 06-06 out of domain → clamps to 06-05 → corpus 06-04

      expect(emitted).toEqual([{ start: '2026-06-02', end: '2026-06-04' }]);
    });

    it('clamps a drag that leaves the plot area to the axis domain', () => {
      setupBrush();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(-400);
      component.brushUpAt(9999);

      expect(emitted).toEqual([{ start: '2026-06-01', end: '2026-06-05' }]);
    });

    it('Esc disarms and cancels a mid-drag without emitting', () => {
      setupBrush();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(200);
      component.onEscapeKey();
      fixture.detectChanges();

      expect(emitted).toEqual([]);
      expect(component.brushArmed()).toBe(false);
      // mid-drag rect is gone
      expect(fixture.nativeElement.querySelector('.brush-rect')).toBeNull();
    });

    it('mouseleave mid-drag cancels without emitting', () => {
      setupBrush();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(200);
      component.brushCancel();

      expect(emitted).toEqual([]);
    });

    it('suppresses connected-hover emission while armed', () => {
      const a = contract({ points: [obs('2026-06-01', 10)] });
      setInputs([a], LABELS);
      fixture.componentRef.setInput('brushArmed', true);
      fixture.detectChanges();
      const emitted: (string | null)[] = [];
      component.seriesHovered.subscribe((id) => emitted.push(id));

      // Without the armed guard this target resolves contract a's id —
      // the spec would emit it, so [] proves suppression, not an empty map.
      component.onChartMouseMove({ target: 'chart_Series_0' } as Parameters<typeof component.onChartMouseMove>[0]);
      expect(emitted).toEqual([]);
    });

    it('the active refine bound renders as a band; clearing hides it', () => {
      setupBrush();
      fixture.componentRef.setInput('activeStudyRange', { start: '2026-06-02', end: '2026-06-04' });
      fixture.detectChanges();

      const band = fixture.nativeElement.querySelector('.brush-band') as HTMLElement;
      expect(band).not.toBeNull();
      // 06-02 → idx 1 → px 180; 06-04 → idx 3 → px 340; width 160.
      // Vertical extent comes from seriesClipRect, NOT the X-axis rect
      // (which is the label strip below the plot on a real chart).
      expect(band.style.left).toBe('180px');
      expect(band.style.width).toBe('160px');
      expect(band.style.top).toBe('20px');
      expect(band.style.height).toBe('300px');

      fixture.componentRef.setInput('activeStudyRange', null);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.brush-band')).toBeNull();
    });

    it('never mutates the axis config', () => {
      const stub = setupBrush();
      component.brushDownAt(180);
      component.brushUpAt(340);

      expect(stub.primaryXAxis['selectionMode']).toBeUndefined();
      expect(stub.primaryXAxis['minimum']).toBeUndefined();
      expect(stub.primaryXAxis['maximum']).toBeUndefined();
    });

    it('disarm mid-drag drops the gesture; re-arm is a single fresh gesture', () => {
      setupBrush();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(180);
      component.brushMoveTo(340);
      fixture.componentRef.setInput('brushArmed', false);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.brush-rect')).toBeNull();

      // Re-arm — a stray mouseup must not emit from the stale start px
      fixture.componentRef.setInput('brushArmed', true);
      fixture.detectChanges();
      component.brushUpAt(500);
      expect(emitted).toEqual([]);

      // The next gesture emits exactly once from its own endpoints
      component.brushDownAt(180);
      component.brushUpAt(500);
      expect(emitted).toEqual([{ start: '2026-06-02', end: '2026-06-05' }]);
    });

    it('armed while the chart has no axis yet — drag is a no-op, not an error', () => {
      setInputs([], LABELS, {});
      fixture.componentRef.setInput('brushArmed', true);
      fixture.detectChanges();
      chartEl().axisCollections = [];
      fixture.detectChanges();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(200);
      component.brushMoveTo(400);
      component.brushUpAt(400);

      expect(emitted).toEqual([]);
      expect(fixture.nativeElement.querySelector('.brush-rect')).toBeNull();
    });

    it('an axis with no labels emits nothing — applyRange never sees undefined', () => {
      setInputs([], [], {});
      fixture.componentRef.setInput('brushArmed', true);
      fixture.detectChanges();
      chartEl().axisCollections = [{ ...AXIS_SPACE }];
      fixture.detectChanges();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(180);
      component.brushUpAt(340);

      expect(emitted).toEqual([]);
    });

    it('a non-left-button mousedown starts no gesture', () => {
      setupBrush();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(180, 2); // right button
      component.brushMoveTo(340);
      component.brushUpAt(340);

      expect(emitted).toEqual([]);
    });

    it('a sub-2px drag is a click, not a selection — nothing emits', () => {
      setupBrush();
      const emitted: ({ start: string; end: string } | null)[] = [];
      component.studyRange.subscribe((r) => emitted.push(r));

      component.brushDownAt(200);
      component.brushUpAt(200.5);

      expect(emitted).toEqual([]);
    });

    it('the band tracks axis geometry across a scroll/zoom', () => {
      const stub = setupBrush();
      fixture.componentRef.setInput('activeStudyRange', { start: '2026-06-02', end: '2026-06-04' });
      fixture.detectChanges();
      const band = () => fixture.nativeElement.querySelector('.brush-band') as HTMLElement;
      expect(band().style.left).toBe('180px');

      // Plot area shifts (resize) — scrollEnd refreshes the tracked geometry
      stub.axisCollections = [{
        rect: { x: 50, y: 20, width: 800, height: 300 },
        visibleRange: { min: 0, max: 10, delta: 10 },
      }];
      component.onScrollEnd();
      fixture.detectChanges();
      expect(band().style.left).toBe('130px'); // 50 + (1/10)*800
    });

    it('a bound fully outside the rendered domain paints no band', () => {
      setupBrush();
      fixture.componentRef.setInput('activeStudyRange', { start: '2020-01-01', end: '2020-02-01' });
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.brush-band')).toBeNull();
    });

    it('arming clears a frozen hover highlight', () => {
      const a = contract({ points: [obs('2026-06-01', 10)] });
      setInputs([a], LABELS);
      fixture.detectChanges();
      const emitted: (string | null)[] = [];
      component.seriesHovered.subscribe((id) => emitted.push(id));
      component.onChartMouseMove({ target: 'chart_Series_0' } as Parameters<typeof component.onChartMouseMove>[0]);
      expect(emitted).toEqual([a.contractId]);

      fixture.componentRef.setInput('brushArmed', true);
      fixture.detectChanges();
      expect(emitted).toEqual([a.contractId, null]);
    });
  });

  describe('data window', () => {
    const LABELS10 = Array.from({ length: 10 }, (_, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);

    /** Axis geometry stub + a mousemove at chart px `x` (rect x=100, w=800, delta 10). */
    const hoverAt = (x: number) => {
      const stub = fixture.debugElement
        .query((d) => d.componentInstance instanceof EjsChartStub)
        .componentInstance as EjsChartStub;
      stub.axisCollections = [{ rect: { x: 100, y: 320, width: 800, height: 0 }, visibleRange: { min: 0, max: 10, delta: 10 } }];
      stub.chartAxisLayoutPanel = { seriesClipRect: { x: 100, y: 20, width: 800, height: 300 } };
      component.onChartMouseMove({ x, target: '' } as Parameters<typeof component.onChartMouseMove>[0]);
    };

    it('float (default) — shared tooltip keyed by series name', () => {
      const t = component.tooltip() as Record<string, unknown>;
      expect(t['enable']).toBe(true);
      expect(t['shared']).toBe(true);
      expect(t['format']).toBe('${series.name}: ${point.y}');
    });

    it('anchor — same Syncfusion config (the layer carries crosshair + axis labels); .dw-pinned hides only the box group', () => {
      setInputs([contract()], LABELS10);
      fixture.componentRef.setInput('tooltipMode', 'anchor');
      fixture.detectChanges();
      const t = component.tooltip() as Record<string, unknown>;
      expect(t['enable']).toBe(true);
      expect(t['shared']).toBe(true);
      expect(fixture.nativeElement.querySelector('.chart-wrap').classList.contains('dw-pinned')).toBe(true);
      expect(component.pinnedWindow()).toBeNull(); // no hover yet
    });

    it('anchor — panel rows mirror the shared tooltip: nearest point per series keyed by label', () => {
      const a = contract({ points: [obs('2026-06-07', 42)] });
      setInputs([a], LABELS10, { underlyingBars: [bar('2026-06-08', 123.45)], showGreeks: false, showVolumeOI: false });
      fixture.componentRef.setInput('tooltipMode', 'anchor');
      fixture.detectChanges();
      // axisLabels unions the marker-span endpoints (2025-11-03 + 2026-01-16)
      // → '2026-06-06' is category 7 → px = 100 + (7/10)·800.
      hoverAt(660);
      fixture.detectChanges();

      const win = component.pinnedWindow()!;
      expect(win.date).toBe('2026-06-06');
      expect(win.rows.map((r) => [r.key, r.value])).toEqual([
        ['600C 2026-01-16', '$42.00'],
        ['Underlying', '$123.45'],
      ]);
      const panel = fixture.nativeElement.querySelector('.dw-panel') as HTMLElement;
      expect(panel).not.toBeNull();
      expect(panel.textContent).toContain('600C 2026-01-16');
      expect(panel.textContent).toContain('$42.00');

      // Top-edge date tag tracks the same hovered category.
      const tag = fixture.nativeElement.querySelector('.dw-date') as HTMLElement;
      expect(tag).not.toBeNull();
      expect(tag.textContent).toBe('2026-06-06');
      expect(tag.style.left).toBe('660px');
    });

    it('hidden — tooltip disabled and no panel even after a hover; the top date tag still shows on hover and hides on leave', () => {
      setInputs([contract({ points: [obs('2026-06-07', 42)] })], LABELS10, { showGreeks: false, showVolumeOI: false });
      fixture.componentRef.setInput('tooltipMode', 'hidden');
      fixture.detectChanges();
      hoverAt(500);
      fixture.detectChanges();
      expect(component.tooltip()).toEqual({ enable: false });
      expect(component.pinnedWindow()).toBeNull();
      expect(fixture.nativeElement.querySelector('.dw-panel')).toBeNull();
      expect(fixture.nativeElement.querySelector('.dw-date')).not.toBeNull();

      component.onChartMouseLeave();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.dw-date')).toBeNull();
    });

    it('float — no custom panel; Syncfusion owns the window; the top date tag shows on hover and hides on leave', () => {
      setInputs([contract({ points: [obs('2026-06-07', 42)] })], LABELS10, { showGreeks: false, showVolumeOI: false });
      fixture.detectChanges();
      hoverAt(500);
      fixture.detectChanges();
      expect(component.pinnedWindow()).toBeNull();
      expect(fixture.nativeElement.querySelector('.dw-date')).not.toBeNull();

      component.onChartMouseLeave();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.dw-date')).toBeNull();
    });

    it('span-marker rows relabel to "{label} strike" — internal __span__ names never leak', () => {
      const a = contract({ points: [obs('2025-11-03', 10)] });
      setInputs([a], ['2025-11-03']);
      const args = {
        series: [
          { name: '600C 2026-01-16' },
          { name: `${MARKER_NAME_PREFIX}${a.contractId}` },
        ],
        text: [
          '600C 2026-01-16: $10.00',
          `${MARKER_NAME_PREFIX}${a.contractId}: $600.00`,
        ],
      };
      component.onSharedTooltipRender(args as Parameters<typeof component.onSharedTooltipRender>[0]);
      expect(args.text[0]).toBe('600C 2026-01-16: $10.00');
      expect(args.text[1]).toBe('600C 2026-01-16 strike: $600.00');
    });
  });
});
