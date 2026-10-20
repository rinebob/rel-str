/**
 * Analysis views (task #1084) — stats block, histogram, scatter.
 * Syncfusion ChartModule is swapped for NO_ERRORS_SCHEMA per the TEST
 * doc's light-stub precedent: assertions bind on the component computeds,
 * not the chart DOM.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { ChartModule } from '@syncfusion/ej2-angular-charts';

import { AnalysisStatsComponent } from './analysis-stats.component';
import { AnalysisHistogramComponent } from './analysis-histogram.component';
import { AnalysisScatterComponent } from './analysis-scatter.component';
import { PaperTradeStatus } from '@paper-trading/contracts';
import { TradeSide } from '@common';
import {
  AnalysisCohort,
  type TradeAnalysisRow,
} from '@paper-trading/analysis';

function row(over: Partial<TradeAnalysisRow> = {}): TradeAnalysisRow {
  return {
    tradeId: 'tr-x',
    signalType: 'D_ST_TREND_RIDER_V1_LONG',
    symbol: 'AMAT',
    direction: TradeSide.LONG,
    analysisCohort: AnalysisCohort.SIGNAL_EQUITY,
    status: PaperTradeStatus.CLOSED,
    entryDate: '2024-10-01',
    tradeRetPct: 5,
    daysHeld: 10,
    mfePct: 8,
    maePct: -3,
    givebackRatio: 0.3,
    'ind.zoneV2': 4,
    ...over,
  } as TradeAnalysisRow;
}

const ROWS = [
  row({ tradeId: 'a', tradeRetPct: 10 }),
  row({ tradeId: 'b', tradeRetPct: -5, signalType: 'D_ST_TREND_RIDER_V2_LONG' }),
  row({ tradeId: 'c', tradeRetPct: 7 }),
];

describe('AnalysisStatsComponent', () => {
  let fixture: ComponentFixture<AnalysisStatsComponent>;
  const el = (sel: string) =>
    fixture.nativeElement.querySelector(sel) as HTMLElement | null;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisStatsComponent, NoopAnimationsModule],
    }).compileComponents();
    fixture = TestBed.createComponent(AnalysisStatsComponent);
    fixture.componentRef.setInput('rows', ROWS);
    fixture.detectChanges();
  });

  it('renders the metric grid from the filtered rows', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('3'); // trades
    expect(text).toContain('66.7%'); // win rate 2/3
    expect(text).toContain('4.00%'); // avg ret (10-5+7)/3
  });

  it('renders the per-signalType breakdown', () => {
    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('D_ST_TREND_RIDER_V1_LONG');
    expect(text).toContain('D_ST_TREND_RIDER_V2_LONG');
  });

  it('empty input shows dashes, not NaN', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain('NaN');
    expect(text).toContain('—');
  });
});

describe('AnalysisHistogramComponent', () => {
  let fixture: ComponentFixture<AnalysisHistogramComponent>;
  let component: AnalysisHistogramComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisHistogramComponent, NoopAnimationsModule],
    })
      .overrideComponent(AnalysisHistogramComponent, {
        remove: { imports: [ChartModule] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(AnalysisHistogramComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('rows', ROWS);
    fixture.detectChanges();
  });

  it('charts win/loss-colored bins at the default width', () => {
    const data = component['chartData']();
    expect(data.length).toBe(3);
    expect(data.filter((d) => d.fill === '#2e7d32').length).toBe(2);
    expect(data.filter((d) => d.fill === '#c62828').length).toBe(1);
  });

  it('bin width changes rebucket the data', () => {
    component['setBinWidth'](2.5);
    expect(component['bins']().length).toBeGreaterThanOrEqual(2);
  });

  it('mean/median striplines are computed for the axis', () => {
    const strips = component['primaryXAxis']().stripLines;
    expect(strips.length).toBe(2);
    expect(strips[0].start).toBeCloseTo(4); // mean
    expect(strips[1].start).toBeCloseTo(7); // median
  });

  it('empty input renders the empty state', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).textContent,
    ).toContain('No rows with returns');
  });

  it('second-cohort overlay bins the baseline on the same edges and toggles', () => {
    const baseline = [
      ...ROWS,
      row({ tradeId: 'd', tradeRetPct: -20 }),
      row({ tradeId: 'e', tradeRetPct: -20 }),
    ];
    fixture.componentRef.setInput('baselineRows', baseline);
    fixture.detectChanges();
    expect(component['baselineActive']()).toBe(true);
    expect(component['baselineData']().length).toBe(4); // adds the -20 bin
    component['setShowBaseline'](false);
    expect(component['baselineActive']()).toBe(false);
    expect(component['legendSettings']().visible).toBe(false);
  });
});

describe('AnalysisScatterComponent', () => {
  let fixture: ComponentFixture<AnalysisScatterComponent>;
  let component: AnalysisScatterComponent;

  const PRESENT = [
    'tradeId', 'signalType', 'daysHeld', 'tradeRetPct', 'mfePct',
    'ind.zoneV2', 'symbol', 'direction',
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalysisScatterComponent, NoopAnimationsModule],
    })
      .overrideComponent(AnalysisScatterComponent, {
        remove: { imports: [ChartModule] },
        add: { schemas: [NO_ERRORS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(AnalysisScatterComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('rows', ROWS);
    fixture.componentRef.setInput('columns', PRESENT);
    fixture.detectChanges();
  });

  it('numeric picker options are manifest∩CSV number columns only', () => {
    const keys = component['numericCols']().map((c) => c.key);
    expect(keys).toContain('daysHeld');
    expect(keys).toContain('tradeRetPct');
    expect(keys).not.toContain('symbol');
    expect(keys).not.toContain('signalType');
  });

  it('defaults to daysHeld × tradeRetPct; a color column splits series', () => {
    expect(component['points']().length).toBe(3);
    expect(component['series']().length).toBe(1);
    component['setColor']('signalType');
    const s = component['series']();
    expect(s.length).toBe(2);
    expect(s.find((g) => g.name === 'D_ST_TREND_RIDER_V2_LONG')?.data.length).toBe(1);
  });

  it('jitter nudges discrete x deterministically without mutating order', () => {
    component['setX']('ind.zoneV2'); // single value → discrete check
    expect(component['discreteX']()).toBe(false); // one distinct x → no jitter offer
    component['setJitter'](true);
    expect(component['points']().map((p) => p.x)).toEqual([4, 4, 4]);
  });

  it('jitter actually displaces points when x has a few distinct values', () => {
    fixture.componentRef.setInput('rows', [
      row({ tradeId: 'a', 'ind.zoneV2': 3 }),
      row({ tradeId: 'b', 'ind.zoneV2': 3 }),
      row({ tradeId: 'c', 'ind.zoneV2': 4 }),
    ]);
    fixture.detectChanges();
    component['setX']('ind.zoneV2');
    expect(component['discreteX']()).toBe(true);
    component['setJitter'](true);
    const xs = component['points']().map((p) => p.x);
    expect(xs.every((x) => x === 3 || x === 4)).toBe(false); // nudged off exact values
    // Deterministic: same input → same offsets across recompute.
    const again = component['points']().map((p) => p.x);
    expect(again).toEqual(xs);
    // First two share the base value so their jitter is what separates them.
    expect(xs[0]).not.toBe(xs[1]);
    expect(xs[0]).toBeGreaterThan(3 - 0.5);
    expect(xs[0]).toBeLessThan(3 + 0.5);
  });

  it('empty input renders the empty state', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).textContent,
    ).toContain('No plottable rows');
  });
});
