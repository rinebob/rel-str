import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ContractMiniChartComponent } from './contract-mini-chart.component';
import { OptionType } from '@options-contract/contracts';
import type { ContractSeriesPoint } from '../utils/pct-change.utils';

const SERIES: ContractSeriesPoint[] = [
  { date: '2024-01-15', price: 10, delta: 0.5 },
  { date: '2024-02-15', price: 15, delta: 0.6 },
  { date: '2024-03-15', price: 20, delta: 0.7 },
];

function setupComponent(overrides: {
  series?: ContractSeriesPoint[];
  contractID?: string;
  strike?: number;
  expiration?: string;
  type?: OptionType;
} = {}): ComponentFixture<ContractMiniChartComponent> {
  const fixture = TestBed.createComponent(ContractMiniChartComponent);
  fixture.componentRef.setInput('contractID', overrides.contractID ?? 'TEST-A');
  fixture.componentRef.setInput('strike', overrides.strike ?? 100);
  fixture.componentRef.setInput('expiration', overrides.expiration ?? '2024-03-15');
  fixture.componentRef.setInput('type', overrides.type ?? OptionType.CALL);
  fixture.componentRef.setInput('series', overrides.series ?? SERIES);
  fixture.detectChanges();
  return fixture;
}

const el = (f: ComponentFixture<ContractMiniChartComponent>, sel: string) =>
  f.nativeElement.querySelector(sel) as HTMLElement | SVGElement | null;
const els = (f: ComponentFixture<ContractMiniChartComponent>, sel: string) =>
  Array.from(f.nativeElement.querySelectorAll(sel)) as (HTMLElement | SVGElement)[];
const text = (e: Element | null) => e?.textContent?.trim() ?? '';

describe('ContractMiniChartComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ContractMiniChartComponent],
    }).compileComponents();
  });

  it('renders header with contractID, strike, expiration, and type badge', () => {
    const fixture = setupComponent();
    expect(text(el(fixture, '.chart-header'))).toContain('TEST-A');
    expect(text(el(fixture, '.chart-header'))).toContain('100');
    expect(text(el(fixture, '.chart-header'))).toContain('2024-03-15');
    expect(text(el(fixture, '.type-badge'))).toBe('CALL');
  });

  it('renders PUT badge for put contracts', () => {
    const fixture = setupComponent({ type: OptionType.PUT });
    expect(text(el(fixture, '.type-badge'))).toBe('PUT');
  });

  it('renders an SVG with a price polyline and a delta polyline', () => {
    const fixture = setupComponent();
    expect(el(fixture, 'svg')).toBeTruthy();
    expect(el(fixture, 'polyline.price-line')).toBeTruthy();
    expect(el(fixture, 'polyline.delta-line')).toBeTruthy();
  });

  it('renders one polyline point per series point', () => {
    const fixture = setupComponent();
    const price = el(fixture, 'polyline.price-line')!.getAttribute('points')!;
    const delta = el(fixture, 'polyline.delta-line')!.getAttribute('points')!;
    expect(price.trim().split(/\s+/).length).toBe(3);
    expect(delta.trim().split(/\s+/).length).toBe(3);
  });

  it('shows actual price min and max values on the price axis', () => {
    const fixture = setupComponent();
    const ticks = els(fixture, '.price-tick').map((t) => text(t));
    expect(ticks).toContain('10.00');
    expect(ticks).toContain('20.00');
  });

  it('shows actual delta min and max values on the delta axis', () => {
    const fixture = setupComponent();
    const ticks = els(fixture, '.delta-tick').map((t) => text(t));
    expect(ticks).toContain('0.50');
    expect(ticks).toContain('0.70');
  });

  it('renders a legend with price and delta entries', () => {
    const fixture = setupComponent();
    const legend = text(el(fixture, '.chart-legend'));
    expect(legend).toContain('Price');
    expect(legend).toContain('Delta');
  });

  it('annotates every data point on each series', () => {
    const fixture = setupComponent();
    const annotations = els(fixture, '.value-annotation').map((t) => text(t));
    // Price verts: 10, 15, 20 → 3 labels; delta verts: 0.50, 0.60, 0.70 → 3.
    expect(els(fixture, '.price-annot').length).toBe(3);
    expect(els(fixture, '.delta-annot').length).toBe(3);
    expect(annotations).toContain('10.00');
    expect(annotations).toContain('15.00');
    expect(annotations).toContain('20.00');
    expect(annotations).toContain('0.50');
    expect(annotations).toContain('0.60');
    expect(annotations).toContain('0.70');
  });

  it('shows first and last dates for time context', () => {
    const fixture = setupComponent();
    expect(text(el(fixture, '.chart-dates'))).toContain('2024-01-15');
    expect(text(el(fixture, '.chart-dates'))).toContain('2024-03-15');
  });

  it('renders a single-point series as a dot (no polyline) without crashing', () => {
    const fixture = setupComponent({ series: [{ date: '2024-01-15', price: 0.01, delta: 0.05 }] });
    // A lone point can't form a line — the vertex dot is the visual.
    expect(el(fixture, 'circle.price-dot')).toBeTruthy();
    expect(el(fixture, 'polyline.price-line')).toBeNull();
    expect(text(el(fixture, '.chart-dates'))).toContain('2024-01-15');
  });

  it('splits the delta line into contiguous runs at a null-delta gap', () => {
    const fixture = setupComponent({
      series: [
        { date: '2024-01-15', price: 10, delta: 0.5 },
        { date: '2024-02-15', price: 15, delta: null },
        { date: '2024-03-15', price: 20, delta: 0.7 },
      ],
    });
    // Two isolated single-point runs → no bridging polyline, only dots.
    const lines = els(fixture, 'polyline.delta-line');
    expect(lines.length).toBe(0);
    expect(els(fixture, 'circle.delta-dot').length).toBe(2);
  });

  it('keeps contiguous delta runs as separate polylines across a gap', () => {
    const fixture = setupComponent({
      series: [
        { date: '2024-01-15', price: 10, delta: 0.5 },
        { date: '2024-02-15', price: 12, delta: 0.55 },
        { date: '2024-03-15', price: 15, delta: null },
        { date: '2024-04-15', price: 18, delta: 0.65 },
        { date: '2024-05-15', price: 20, delta: 0.7 },
      ],
    });
    const lines = els(fixture, 'polyline.delta-line');
    expect(lines.length).toBe(2); // two contiguous 2-point runs
    expect(els(fixture, 'circle.delta-dot').length).toBe(4);
  });

  it('dedupes tick labels on a flat series', () => {
    const fixture = setupComponent({
      series: [
        { date: '2024-01-15', price: 10, delta: 0.5 },
        { date: '2024-02-15', price: 10, delta: 0.5 },
      ],
    });
    // min=mid=max → one tick, not three stacked identical labels.
    expect(els(fixture, '.price-tick').length).toBe(1);
    expect(els(fixture, '.delta-tick').length).toBe(1);
  });

  it('renders a flat series (single distinct value) without crashing', () => {
    const fixture = setupComponent({
      series: [
        { date: '2024-01-15', price: 10, delta: 0.5 },
        { date: '2024-02-15', price: 10, delta: 0.5 },
      ],
    });
    expect(el(fixture, 'polyline.price-line')).toBeTruthy();
    // Degenerate range — min and max ticks collapse to the same value.
    const ticks = els(fixture, '.price-tick').map((t) => text(t));
    expect(ticks).toContain('10.00');
  });

  it('renders an empty series with a no-data message and no polylines', () => {
    const fixture = setupComponent({ series: [] });
    expect(text(el(fixture, '.chart-empty'))).toContain('No data');
    expect(el(fixture, 'polyline.price-line')).toBeNull();
    expect(el(fixture, 'polyline.delta-line')).toBeNull();
  });

  it('handles null deltas in the series', () => {
    const fixture = setupComponent({
      series: [
        { date: '2024-01-15', price: 10, delta: null },
        { date: '2024-02-15', price: 15, delta: 0.6 },
      ],
    });
    // Price line still renders all points; delta line may drop the null point.
    expect(el(fixture, 'polyline.price-line')).toBeTruthy();
    expect(text(el(fixture, '.chart-header'))).toContain('TEST-A');
  });
});
