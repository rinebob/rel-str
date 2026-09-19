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
import { By } from '@angular/platform-browser';
import { of, Subject } from 'rxjs';

import { SwingAnalysisPageComponent } from './swing-analysis-page.component';
import { SwingAnalysisStore, LARGE_CONFIG, SMALL_CONFIG } from './swing-analysis.store';
import { ChartService } from '../services/chart.service';
import { SwingAnalysisService } from './swing-analysis.service';
import { StIndicator } from '../../shared/components/flex-chart/flex-chart.types';
import { BarsInterval } from '../../../core/models/partner.types';
import { UiStateService } from '../../../core/services/ui-state.service';
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
  template: `<div class="mock-swing-table" [attr.data-loading]="loading" [attr.data-swing-count]="swings.length" [attr.data-small-swing-count]="smallSwings === null ? 'null' : smallSwings.length"></div>`,
})
class MockSwingTableComponent {
  @Input() swings: Swing[] = [];
  @Input() smallSwings: Swing[] | null = null;
  @Input() loading = false;
  @Input() error: string | null = null;
}

@Component({
  selector: 'app-stats-panel',
  standalone: true,
  template: `<div class="mock-stats-panel" [attr.data-loading]="loading" [attr.data-has-stats]="stats !== null" [attr.data-stats-sets]="statsSets === null ? 'null' : statsSets.length"></div>`,
})
class MockStatsPanelComponent {
  @Input() stats: SwingStats | null = null;
  @Input() statsSets: (SwingStats | null)[] | null = null;
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

  it('resets store state then loads the default QQQ symbol on init', async () => {
    const { store } = await setupPage();
    expect(store.symbol()).toBe('QQQ');
    expect(store.bars().length).toBeGreaterThan(0);
    expect(store.stats()[0]).not.toBeNull();
  });

  it('enters fullscreen on init and restores the app header on destroy', async () => {
    const { fixture } = await setupPage();
    const ui = TestBed.inject(UiStateService);
    expect(ui.fullscreen()).toBe(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('fullscreen')).toBe(true);
    fixture.destroy();
    expect(ui.fullscreen()).toBe(false);
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

  it('renders param controls for devThreshold, leftDepth, rightDepth, lineColor, allowZigZagOnOneBar', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="param-devThreshold-0"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-leftDepth-0"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-rightDepth-0"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-lineColor-0"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-allowZigZagOnOneBar-0"]')).toBeTruthy();
  });

  it('does not render a projectionPivots toggle', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="param-projectionPivots-0"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="param-projectionPivots-1"]')).toBeNull();
  });

  it('reflects default config values in param controls', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold-0"]') as HTMLInputElement;
    const left = fixture.nativeElement.querySelector('[data-testid="param-leftDepth-0"]') as HTMLInputElement;
    const right = fixture.nativeElement.querySelector('[data-testid="param-rightDepth-0"]') as HTMLInputElement;
    const color = fixture.nativeElement.querySelector('[data-testid="param-lineColor-0"]') as HTMLInputElement;
    const oneBar = fixture.nativeElement.querySelector('[data-testid="param-allowZigZagOnOneBar-0"]') as HTMLInputElement;
    expect(Number(dev.value)).toBe(LARGE_CONFIG.devThreshold);
    expect(Number(left.value)).toBe(LARGE_CONFIG.leftDepth);
    expect(Number(right.value)).toBe(LARGE_CONFIG.rightDepth);
    expect(color.value).toBe(LARGE_CONFIG.lineColor);
    expect(oneBar.checked).toBe(LARGE_CONFIG.allowZigZagOnOneBar);
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
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold-0"]') as HTMLInputElement;
    dev.value = '7.5';
    dev.dispatchEvent(new Event('change'));
    expect(store.configs()[0].devThreshold).toBe(7.5);
  });

  it('clamps numeric param to minimum', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold-0"]') as HTMLInputElement;
    dev.value = '0.01';
    dev.dispatchEvent(new Event('change'));
    expect(store.configs()[0].devThreshold).toBe(0.1);
  });

  it('rejects empty numeric input', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const original = store.configs()[0].devThreshold;
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold-0"]') as HTMLInputElement;
    dev.value = '';
    dev.dispatchEvent(new Event('change'));
    expect(store.configs()[0].devThreshold).toBe(original);
  });

  it('calls store.updateConfig when a boolean param toggles', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const oneBar = fixture.nativeElement.querySelector('[data-testid="param-allowZigZagOnOneBar-0"]') as HTMLInputElement;
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
    expect(config.indicators.length).toBe(2); // dual mode is the default
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

  it('passes null smallSwings to the swing table in single mode', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    store.toggleDualMode(); // dual is the default — turn off for single mode
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('.mock-swing-table');
    expect(table.getAttribute('data-small-swing-count')).toBe('null');
  });

  it('passes swings()[1] as smallSwings to the swing table in dual mode', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL'); // dual is the default — slot 1 already computed
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('.mock-swing-table');
    expect(table.getAttribute('data-small-swing-count')).toBe(String(store.swings()[1].length));
  });

  it('passes null statsSets to the stats panel in single mode', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    store.toggleDualMode(); // dual is the default — turn off for single mode
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.mock-stats-panel');
    expect(panel.getAttribute('data-stats-sets')).toBe('null');
  });

  it('passes [large, small, all] statsSets to the stats panel in dual mode', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL'); // dual is the default
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.mock-stats-panel');
    expect(panel.getAttribute('data-stats-sets')).toBe('3');
    // Assert content identity, not just length — [large, small, all] order.
    const panelComp = fixture.debugElement.query(By.directive(MockStatsPanelComponent)).componentInstance as MockStatsPanelComponent;
    expect(panelComp.statsSets?.[0]).toBe(store.stats()[0]);
    expect(panelComp.statsSets?.[1]).toBe(store.stats()[1]);
    expect(panelComp.statsSets?.[2]).toBe(store.allStats());
    expect(store.allStats()).not.toBeNull();
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
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-0"]');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Save');
  });

  it('calls store.saveAnalysis when Save button clicked', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const saveSpy = jest.spyOn(store, 'saveAnalysis');
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-0"]');
    btn.click();
    expect(saveSpy).toHaveBeenCalledWith(0);
  });

  it('Save button click reaches SwingAnalysisService.saveAnalysis', async () => {
    const { fixture, store, service } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-0"]');
    btn.click();
    expect(service.saveAnalysis).toHaveBeenCalled();
  });

  it('disables Save button when no symbol or no stats', async () => {
    const { fixture, store } = await setupPage();
    store.resetState(); // clear the auto-loaded QQQ analysis
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-0"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables Save button when symbol and stats exist', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-0"]') as HTMLButtonElement;
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

  // =========================================================================
  // Dual mode — toggle, collapsible config sections, unique indicator ids
  // =========================================================================

  it('renders a dual-mode toggle control', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector('[data-testid="dual-mode-toggle"]');
    expect(toggle).toBeTruthy();
  });

  it('shows one config section when dual mode is off', async () => {
    const { fixture, store } = await setupPage();
    store.toggleDualMode(); // dual is the default — turn off
    fixture.detectChanges();
    const sections = fixture.nativeElement.querySelectorAll('.config-section');
    expect(sections.length).toBe(1);
  });

  it('shows two config sections by default (dual mode)', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const sections = fixture.nativeElement.querySelectorAll('.config-section');
    expect(sections.length).toBe(2);
  });

  it('labels config sections as Large Swings and Small Swings', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const labels = fixture.nativeElement.querySelectorAll('.config-section-label');
    expect(labels[0].textContent.trim()).toBe('Large Swings');
    expect(labels[1].textContent.trim()).toBe('Small Swings');
  });

  it('calls store.toggleDualMode when the toggle is clicked', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const toggleSpy = jest.spyOn(store, 'toggleDualMode');
    const toggle = fixture.nativeElement.querySelector('[data-testid="dual-mode-toggle"]') as HTMLInputElement;
    // Dual is the default — unchecking differs from dualMode() so the
    // handler's guard passes and toggleDualMode is invoked.
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    expect(toggleSpy).toHaveBeenCalled();
  });

  it('builds chartConfig with one IndicatorConfig when dual mode off', async () => {
    const { fixture, store } = await setupPage();
    store.toggleDualMode(); // dual is the default — turn off
    fixture.detectChanges();
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    const config = chartComp.componentInstance.config;
    expect(config.indicators.length).toBe(1);
    expect(config.indicators[0].id).toBe('st-zigzag-0');
    expect(config.indicators[0].type).toBe(StIndicator.ST_ZIGZAG);
  });

  it('builds chartConfig with two IndicatorConfigs with unique ids when dual mode on', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    const config = chartComp.componentInstance.config;
    expect(config.indicators.length).toBe(2);
    expect(config.indicators[0].id).toBe('st-zigzag-0');
    expect(config.indicators[1].id).toBe('st-zigzag-1');
    expect(config.indicators[0].type).toBe(StIndicator.ST_ZIGZAG);
    expect(config.indicators[1].type).toBe(StIndicator.ST_ZIGZAG);
  });

  it('passes per-config params to each chart indicator', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    store.updateConfig(1, { devThreshold: 7 });
    fixture.detectChanges();
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    const params0 = chartComp.componentInstance.config.indicators[0].params;
    const params1 = chartComp.componentInstance.config.indicators[1].params;
    expect(params0['devThreshold']).toBe(LARGE_CONFIG.devThreshold);
    expect(params1['devThreshold']).toBe(7);
    expect(params0['lineColor']).toBe(LARGE_CONFIG.lineColor);
    expect(params1['lineColor']).toBe(SMALL_CONFIG.lineColor);
  });

  it('calls store.updateConfig with the correct index when a param changes', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const dev = fixture.nativeElement.querySelector('[data-testid="param-devThreshold-1"]') as HTMLInputElement;
    dev.value = '7.5';
    dev.dispatchEvent(new Event('change'));
    expect(store.configs()[1].devThreshold).toBe(7.5);
    expect(store.configs()[0].devThreshold).toBe(LARGE_CONFIG.devThreshold);
  });

  it('calls store.updateConfig when lineColor changes', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const color = fixture.nativeElement.querySelector('[data-testid="param-lineColor-1"]') as HTMLInputElement;
    color.value = '#ff0000';
    color.dispatchEvent(new Event('input'));
    expect(store.configs()[1].lineColor).toBe('#ff0000');
  });

  it('calls store.saveAnalysis with the correct index when a save button is clicked', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const saveSpy = jest.spyOn(store, 'saveAnalysis');
    const btn = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-1"]');
    btn.click();
    expect(saveSpy).toHaveBeenCalledWith(1);
  });

  it('enables each save button independently based on that config\'s stats', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const btn0 = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-0"]') as HTMLButtonElement;
    const btn1 = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-1"]') as HTMLButtonElement;
    expect(btn0.disabled).toBe(false);
    expect(btn1.disabled).toBe(false);
  });

  it('restores single config section and one indicator when toggled off', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.config-section').length).toBe(2);

    store.toggleDualMode(); // dual is the default — this turns it off
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.config-section').length).toBe(1);
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    expect(chartComp.componentInstance.config.indicators.length).toBe(1);
  });

  it('renders collapsible config sections via details/summary', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const sections = fixture.nativeElement.querySelectorAll('details.config-section');
    expect(sections.length).toBe(2);
    sections.forEach((section: HTMLDetailsElement) => {
      expect(section.tagName).toBe('DETAILS');
      expect(section.open).toBe(true);
      const summary = section.querySelector('summary.config-section-header');
      expect(summary).toBeTruthy();
    });
  });

  it('renders a Trigger Dots checkbox per config section', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-testid="param-showTriggerDots-0"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="param-showTriggerDots-1"]')).toBeTruthy();
  });

  it('calls updateConfig when the Trigger Dots checkbox toggles', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const cb = fixture.nativeElement.querySelector('[data-testid="param-showTriggerDots-1"]') as HTMLInputElement;
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(store.configs()[1].showTriggerDots).toBe(false);
    // Other config untouched.
    expect(store.configs()[0].showTriggerDots).toBeUndefined();
  });

  it('passes showTriggerDots=false into the chart indicator params', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    store.updateConfig(1, { showTriggerDots: false });
    fixture.detectChanges();
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    const indicators = chartComp.componentInstance.config.indicators;
    expect(indicators[0].params['showTriggerDots']).toBe(true);
    expect(indicators[1].params['showTriggerDots']).toBe(false);
  });

  it('disables save button when that config has no stats', async () => {
    const { fixture, store } = await setupPage();
    store.resetState(); // clear the auto-loaded QQQ analysis
    fixture.detectChanges();
    const btn0 = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-0"]') as HTMLButtonElement;
    expect(btn0.disabled).toBe(true);
    // Dual is the default — config 1's button already exists after reset.
    const btn1 = fixture.nativeElement.querySelector('[data-testid="save-analysis-btn-1"]') as HTMLButtonElement;
    expect(btn1.disabled).toBe(true);
  });
});
