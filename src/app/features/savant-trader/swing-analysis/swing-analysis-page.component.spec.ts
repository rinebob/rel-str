/// <reference types="jest" />
/**
 * Tests for SwingAnalysisPageComponent — the page shell that wires the
 * SwingAnalysisStore, param controls, isolated flex-chart (ST_ZIGZAG only),
 * swing table, stats panel, and Save Analysis button.
 *
 * FlexChartComponent, SwingTableComponent, and StatsPanelComponent are mocked
 * so the page's own wiring is the unit under test. The real SwingAnalysisStore
 * is provided with mocked ChartService and SwingAnalysisService (same pattern
 * as the store spec).
 */

jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  collection: jest.fn(),
  collectionData: jest.fn(),
  doc: jest.fn(),
  setDoc: jest.fn(),
  getDoc: jest.fn(),
  getDocs: jest.fn(),
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
  authState: jest.fn(() => of({ uid: 'user-123' })),
}));

import { Component, Input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';

import { SwingAnalysisPageComponent } from './swing-analysis-page.component';
import { SwingAnalysisStore, LARGE_CONFIG } from './swing-analysis.store';
import { ChartService } from '../services/chart.service';
import { SwingAnalysisService } from './swing-analysis.service';
import { StIndicator } from '../../shared/components/flex-chart/flex-chart.types';
import { BarsInterval } from '../../../core/models/partner.types';
import { FlexChartComponent } from '../../shared/components/flex-chart/flex-chart.component';
import { SwingTableComponent } from './components/swing-table.component';
import { StatsPanelComponent } from './components/stats-panel.component';
import type { PriceBar, Swing, SwingStats } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
import type { ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import type { SwingAnalysisDoc } from './swing-analysis.types';

// =============================================================================
// Mock child components — capture inputs so the page test can assert wiring
// =============================================================================

@Component({
  selector: 'app-flex-chart',
  standalone: true,
  template: `<div class="mock-flex-chart" [attr.data-symbol]="chartData?.symbol ?? ''"></div>`,
})
class MockFlexChartComponent {
  @Input() chartData: { symbol: string; interval: BarsInterval; bars: PriceBar[] } | null = null;
  @Input() config: { indicators: { type: StIndicator; params: Record<string, number | string | boolean> }[] } | undefined;
  @Input() height = '400px';
}

@Component({
  selector: 'app-swing-table',
  standalone: true,
  template: `<div class="mock-swing-table" [attr.data-loading]="loading" [attr.data-swing-count]="swings.length"></div>`,
})
class MockSwingTableComponent {
  @Input() swings: Swing[] = [];
  @Input() loading = false;
  @Input() error: string | null = null;
}

@Component({
  selector: 'app-stats-panel',
  standalone: true,
  template: `<div class="mock-stats-panel" [attr.data-loading]="loading" [attr.data-has-stats]="stats !== null"></div>`,
})
class MockStatsPanelComponent {
  @Input() stats: SwingStats | null = null;
  @Input() loading = false;
}

// =============================================================================
// Test fixtures
// =============================================================================

function makeBars(n: number): PriceBar[] {
  const bars: PriceBar[] = [];
  // Phase length must exceed LARGE_CONFIG's leftDepth/rightDepth (10).
  const phaseLen = 15;
  for (let i = 0; i < n; i++) {
    const phase = Math.floor(i / phaseLen) % 2;
    const stepInPhase = i % phaseLen;
    const delta = phase === 0 ? stepInPhase * 5 : -stepInPhase * 5;
    const d = new Date(2026, 0, i + 1);
    bars.push({
      date: d.toISOString().slice(0, 10),
      x: d,
      open: 100 + delta,
      high: 105 + delta,
      low: 95 + delta,
      close: 100 + delta,
      volume: 1000,
    });
  }
  return bars;
}

function makeChartDataset(bars: PriceBar[]): ChartDataset {
  return {
    baseline: 'SPY',
    symbol: 'TEST',
    interval: BarsInterval.DAILY,
    bars,
    dateRange: { from: bars[0]?.date ?? '', to: bars[bars.length - 1]?.date ?? '' },
  };
}

function mockChartService(bars: PriceBar[]): Partial<ChartService> {
  return {
    loadBars$: () =>
      of({
        daily: makeChartDataset(bars),
        weekly: makeChartDataset(bars),
        monthly: makeChartDataset(bars),
        version: 'test',
      }),
  };
}

function mockSwingAnalysisService(docs: SwingAnalysisDoc[] = []): Partial<SwingAnalysisService> & {
  saveAnalysis: jest.Mock;
  loadSavedAnalyses: jest.Mock;
  loadAnalysis: jest.Mock;
} {
  return {
    loadSavedAnalyses: jest.fn(() => of(docs)),
    saveAnalysis: jest.fn(() => of(undefined)),
    loadAnalysis: jest.fn(() => of(null)),
  };
}

interface PageSetup {
  store: InstanceType<typeof SwingAnalysisStore>;
  service: ReturnType<typeof mockSwingAnalysisService>;
  fixture: any;
}

async function setupPage(bars: PriceBar[] = makeBars(40)): Promise<PageSetup> {
  const service = mockSwingAnalysisService([]);
  TestBed.configureTestingModule({
    providers: [
      { provide: ChartService, useValue: mockChartService(bars) },
      { provide: SwingAnalysisService, useValue: service },
      SwingAnalysisStore,
    ],
  });
  TestBed.overrideComponent(SwingAnalysisPageComponent, {
    remove: { imports: [FlexChartComponent, SwingTableComponent, StatsPanelComponent] },
    add: { imports: [MockFlexChartComponent, MockSwingTableComponent, MockStatsPanelComponent] },
  });
  await TestBed.compileComponents();
  const store = TestBed.inject(SwingAnalysisStore);
  const fixture = TestBed.createComponent(SwingAnalysisPageComponent);
  return { store, service, fixture };
}

// =============================================================================
// Tests
// =============================================================================

describe('SwingAnalysisPageComponent', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('creates', async () => {
    const { fixture } = await setupPage();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('injects SwingAnalysisStore', async () => {
    const { fixture, store } = await setupPage();
    expect(fixture.componentInstance.store).toBe(store);
  });

  it('resets store state on init', async () => {
    const { store } = await setupPage();
    expect(store.symbol()).toBe('');
    expect(store.bars()).toEqual([]);
    expect(store.stats()[0]).toBeNull();
  });

  it('renders a symbol input bound to store symbol', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    expect(store.symbol()).toBe('AAPL');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input[data-testid="symbol-input"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('AAPL');
  });

  it('renders param controls for devThreshold, leftDepth, rightDepth, allowZigZagOnOneBar, projectionPivots', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="param-devThreshold"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-leftDepth"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-rightDepth"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-allowZigZagOnOneBar"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-projectionPivots"]')).toBeTruthy();
  });

  it('reflects default config values in param controls', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold"]') as HTMLInputElement;
    const left = fixture.nativeElement.querySelector('[data-testid="param-leftDepth"]') as HTMLInputElement;
    const right = fixture.nativeElement.querySelector('[data-testid="param-rightDepth"]') as HTMLInputElement;
    const oneBar = fixture.nativeElement.querySelector('[data-testid="param-allowZigZagOnOneBar"]') as HTMLInputElement;
    const proj = fixture.nativeElement.querySelector('[data-testid="param-projectionPivots"]') as HTMLInputElement;
    expect(Number(dev.value)).toBe(LARGE_CONFIG.devThreshold);
    expect(Number(left.value)).toBe(LARGE_CONFIG.leftDepth);
    expect(Number(right.value)).toBe(LARGE_CONFIG.rightDepth);
    expect(oneBar.checked).toBe(LARGE_CONFIG.allowZigZagOnOneBar);
    expect(proj.checked).toBe(LARGE_CONFIG.projectionPivots);
  });

  it('calls store.setSymbol when symbol input changes', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('[data-testid="symbol-input"]') as HTMLInputElement;
    input.value = 'MSFT';
    input.dispatchEvent(new Event('input'));
    expect(store.symbol()).toBe('MSFT');
  });

  it('calls store.updateConfig when a numeric param changes', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold"]') as HTMLInputElement;
    dev.value = '7.5';
    dev.dispatchEvent(new Event('input'));
    expect(store.configs()[0].devThreshold).toBe(7.5);
  });

  it('clamps numeric param to minimum', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold"]') as HTMLInputElement;
    dev.value = '0.01';
    dev.dispatchEvent(new Event('input'));
    expect(store.configs()[0].devThreshold).toBe(0.1);
  });

  it('rejects empty numeric input', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const original = store.configs()[0].devThreshold;
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold"]') as HTMLInputElement;
    dev.value = '';
    dev.dispatchEvent(new Event('input'));
    expect(store.configs()[0].devThreshold).toBe(original);
  });

  it('calls store.updateConfig when a boolean param toggles', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const oneBar = fixture.nativeElement.querySelector('[data-testid="param-allowZigZagOnOneBar"]') as HTMLInputElement;
    oneBar.checked = false;
    oneBar.dispatchEvent(new Event('change'));
    expect(store.configs()[0].allowZigZagOnOneBar).toBe(false);
  });

  it('renders the flex-chart with chartData from store bars', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const chart = fixture.nativeElement.querySelector('.mock-flex-chart');
    expect(chart).toBeTruthy();
    expect(chart.getAttribute('data-symbol')).toBe('AAPL');
  });

  it('renders the flex-chart config with only ST_ZIGZAG indicator', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    expect(chartComp).toBeTruthy();
    const config = chartComp.componentInstance.config;
    expect(config).toBeTruthy();
    expect(config.indicators.length).toBe(1);
    expect(config.indicators[0].type).toBe(StIndicator.ST_ZIGZAG);
  });

  it('passes store config params to the chart indicator', async () => {
    const { fixture, store } = await setupPage();
    store.updateConfig(0, { devThreshold: 8, leftDepth: 7 });
    fixture.detectChanges();
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    const params = chartComp.componentInstance.config.indicators[0].params;
    expect(params['devThreshold']).toBe(8);
    expect(params['leftDepth']).toBe(7);
  });

  it('renders the swing table with store swings', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('.mock-swing-table');
    expect(table).toBeTruthy();
    expect(Number(table.getAttribute('data-swing-count'))).toBe(store.swings()[0].length);
  });

  it('passes loading state to the swing table', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('.mock-swing-table');
    expect(table.getAttribute('data-loading')).toBe('false');
  });

  it('renders the stats panel with store stats', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.mock-stats-panel');
    expect(panel).toBeTruthy();
    expect(panel.getAttribute('data-has-stats')).toBe(String(store.stats()[0] !== null));
  });

  it('renders a Save Analysis button', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn"]');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Save Analysis');
  });

  it('calls store.saveAnalysis when Save button clicked', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const saveSpy = jest.spyOn(store, 'saveAnalysis');
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn"]');
    btn.click();
    expect(saveSpy).toHaveBeenCalled();
  });

  it('Save button click reaches SwingAnalysisService.saveAnalysis', async () => {
    const { fixture, store, service } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn"]');
    btn.click();
    expect(service.saveAnalysis).toHaveBeenCalled();
  });

  it('disables Save button when no symbol or no stats', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables Save button when symbol and stats exist', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('renders an error message when store has an error', async () => {
    const barsSubject = new Subject<{ daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset; version: string }>();
    TestBed.configureTestingModule({
      providers: [
        { provide: ChartService, useValue: { loadBars$: () => barsSubject.asObservable() } },
        { provide: SwingAnalysisService, useValue: mockSwingAnalysisService([]) },
        SwingAnalysisStore,
      ],
    });
    TestBed.overrideComponent(SwingAnalysisPageComponent, {
      remove: { imports: [FlexChartComponent, SwingTableComponent, StatsPanelComponent] },
      add: { imports: [MockFlexChartComponent, MockSwingTableComponent, MockStatsPanelComponent] },
    });
    await TestBed.compileComponents();
    const store = TestBed.inject(SwingAnalysisStore);
    const fixture = TestBed.createComponent(SwingAnalysisPageComponent);
    store.setSymbol('BAD');
    fixture.detectChanges();
    barsSubject.error(new Error('Failed to load bars'));
    fixture.detectChanges();
    const errEl = fixture.nativeElement.querySelector('[data-testid="error-message"]');
    expect(errEl).toBeTruthy();
    expect(errEl.textContent).toContain('Failed to load bars');
  });

  it('shows loading indicator while bars are loading', async () => {
    const barsSubject = new Subject<{ daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset; version: string }>();
    TestBed.configureTestingModule({
      providers: [
        { provide: ChartService, useValue: { loadBars$: () => barsSubject.asObservable() } },
        { provide: SwingAnalysisService, useValue: mockSwingAnalysisService([]) },
        SwingAnalysisStore,
      ],
    });
    TestBed.overrideComponent(SwingAnalysisPageComponent, {
      remove: { imports: [FlexChartComponent, SwingTableComponent, StatsPanelComponent] },
      add: { imports: [MockFlexChartComponent, MockSwingTableComponent, MockStatsPanelComponent] },
    });
    await TestBed.compileComponents();
    const store = TestBed.inject(SwingAnalysisStore);
    const fixture = TestBed.createComponent(SwingAnalysisPageComponent);
    store.setSymbol('AAPL');
    fixture.detectChanges();
    expect(store.loading()).toBe(true);
    const loadingEl = fixture.nativeElement.querySelector('[data-testid="loading-indicator"]');
    expect(loadingEl).toBeTruthy();
  });
});
