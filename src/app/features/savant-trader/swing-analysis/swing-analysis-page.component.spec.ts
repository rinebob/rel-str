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

import { Component, Input, computed, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { By } from '@angular/platform-browser';
import { of, Subject, Observable, throwError } from 'rxjs';

import { SwingAnalysisPageComponent } from './swing-analysis-page.component';
import { SwingAnalysisStore, LARGE_CONFIG, SMALL_CONFIG } from './swing-analysis.store';
import { ChartService } from '../services/chart.service';
import { SwingAnalysisService } from './swing-analysis.service';
import { RelStrDbV2Service } from '../../services/rel-str-db-v2.service';
import { SymbolListStore } from '../stores/symbol-list.store';
import { StIndicator } from '../../shared/components/flex-chart/flex-chart.types';
import { BarsInterval } from '../../../core/models/partner.types';
import { UiStateService } from '../../../core/services/ui-state.service';
import { FlexChartComponent } from '../../shared/components/flex-chart/flex-chart.component';
import { SwingTableComponent } from './components/swing-table.component';
import { StatsPanelComponent } from './components/stats-panel.component';
import type { PriceBar, Swing, SwingStats } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
import type { ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import type { SwingAnalysisDoc } from './swing-analysis.types';
import { deriveParamsId } from './swing-analysis.types';
import { NO_MEMBERSHIP } from '../common/constants';
import { isUnlisted } from '../utils/utils';
import type { ZigZagConfig } from '../../shared/components/flex-chart/indicators/st-zigzag.types';

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
  @Input() config: { indicators: { type: StIndicator; params: Record<string, number | string | boolean> }[]; logScale?: boolean } | undefined;
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

function mockSwingAnalysisService(
  docs: SwingAnalysisDoc[] = [],
  allSets: SwingAnalysisDoc[] = docs,
): Partial<SwingAnalysisService> & {
  saveAnalysis: jest.Mock;
  loadSavedAnalyses: jest.Mock;
  loadAllSwingSets: jest.Mock;
  loadAnalysis: jest.Mock;
} {
  return {
    loadSavedAnalyses: jest.fn(() => of(docs)),
    loadAllSwingSets: jest.fn(() => of(allSets)),
    saveAnalysis: jest.fn(() => of(undefined)),
    loadAnalysis: jest.fn(() => of(null)),
  };
}

interface PageSetup {
  store: InstanceType<typeof SwingAnalysisStore>;
  service: ReturnType<typeof mockSwingAnalysisService>;
  fixture: ComponentFixture<SwingAnalysisPageComponent>;
}

/** The settings overlay — the dialog renders outside fixture.nativeElement.
 *  Returns `any` deliberately: the pre-dialog queries went through
 *  `nativeElement` (any) and cast at the call site — same contract. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dlg(): any {
  return document.querySelector('.cdk-overlay-container');
}

/** Open the settings dialog via the header gear button. */
function openSettings(fixture: ComponentFixture<SwingAnalysisPageComponent>): void {
  (fixture.nativeElement.querySelector('[data-testid="settings-btn"]') as HTMLButtonElement).click();
  fixture.detectChanges();
}
async function setupPage(
  bars: PriceBar[] = makeBars(40),
  chart?: Partial<ChartService>,
  service: ReturnType<typeof mockSwingAnalysisService> = mockSwingAnalysisService([]),
  navSymbols: string[] = [],
  navLists: Record<string, string[]> = {},
): Promise<PageSetup> {
  const tracked = signal<string[]>([]);
  TestBed.configureTestingModule({
    providers: [
      { provide: ChartService, useValue: chart ?? mockChartService(bars) },
      { provide: RelStrDbV2Service, useValue: { getTrackedSymbols$: jest.fn(() => of(navSymbols.map((s) => ({ symbol: s })))) } },
      // SymbolListStore owns the tracked-symbols universe — the mock
      // reproduces its loadTrackedSymbols/unlistedSymbols contract so the
      // nav sequence can read it.
      { provide: SymbolListStore, useValue: {
        symbolLists: signal<Record<string, string[]>>(navLists),
        activeListFilter: signal('ALL'),
        trackedSymbols: tracked,
        unlistedSymbols: computed(() => tracked().filter((s) => isUnlisted(s, navLists))),
        loadTrackedSymbols: jest.fn(() => {
          if (tracked().length === 0) tracked.set([...navSymbols].sort());
          return Promise.resolve(tracked());
        }),
        loadSymbolLists: jest.fn(),
        toggleSymbolInList: jest.fn(),
        toggleMonitor: jest.fn(),
        addSymbolToList: jest.fn(),
        removeSymbolFromList: jest.fn(),
      } },
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
  afterEach(() => {
    try { TestBed.inject(MatDialog).closeAll(); } catch { /* TestBed already torn down */ }
    TestBed.resetTestingModule();
  });

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

  it('defaults the chart to log scale and flips it via the Log Y-axis pill', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    const chart = fixture.debugElement.query(By.directive(MockFlexChartComponent)).componentInstance;
    expect(chart.config?.logScale).toBe(true);

    const btn = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="log-pill"]')!;
    expect(btn.textContent).toContain('Yes');
    btn.click();
    fixture.detectChanges();

    expect(chart.config?.logScale).toBe(false);
    expect(btn.textContent).toContain('No');

    btn.click();
    fixture.detectChanges();
    expect(chart.config?.logScale).toBe(true);
    expect(btn.textContent).toContain('Yes');
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
    openSettings(fixture);
    const input = dlg().querySelector('input[data-testid="symbol-input"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe('AAPL');
  });

  it('renders param controls for devThreshold, leftDepth, rightDepth, lineColor, allowZigZagOnOneBar', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelector('[data-testid="param-devThreshold-0"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="param-leftDepth-0"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="param-rightDepth-0"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="param-lineColor-0"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="param-allowZigZagOnOneBar-0"]')).toBeTruthy();
  });

  it('does not render a projectionPivots toggle', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelector('[data-testid="param-projectionPivots-0"]')).toBeNull();
    expect(dlg().querySelector('[data-testid="param-projectionPivots-1"]')).toBeNull();
  });

  it('reflects default config values in param controls', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const dev = dlg().querySelector('[data-testid="param-devThreshold-0"]') as HTMLInputElement;
    const left = dlg().querySelector('[data-testid="param-leftDepth-0"]') as HTMLInputElement;
    const right = dlg().querySelector('[data-testid="param-rightDepth-0"]') as HTMLInputElement;
    const color = dlg().querySelector('[data-testid="param-lineColor-0"]') as HTMLInputElement;
    const oneBar = dlg().querySelector('[data-testid="param-allowZigZagOnOneBar-0"]') as HTMLInputElement;
    expect(Number(dev.value)).toBe(LARGE_CONFIG.devThreshold);
    expect(Number(left.value)).toBe(LARGE_CONFIG.leftDepth);
    expect(Number(right.value)).toBe(LARGE_CONFIG.rightDepth);
    expect(color.value).toBe(LARGE_CONFIG.lineColor);
    expect(oneBar.checked).toBe(LARGE_CONFIG.allowZigZagOnOneBar);
  });

  it('calls store.setSymbol when symbol input changes', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const input = dlg().querySelector('[data-testid="symbol-input"]') as HTMLInputElement;
    input.value = 'MSFT';
    input.dispatchEvent(new Event('input'));
    expect(store.symbol()).toBe('MSFT');
  });

  it('calls store.updateConfig when a numeric param changes', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const dev = dlg().querySelector('[data-testid="param-devThreshold-0"]') as HTMLInputElement;
    dev.value = '7.5';
    dev.dispatchEvent(new Event('change'));
    expect(store.configs()[0].devThreshold).toBe(7.5);
  });

  it('clamps numeric param to minimum', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const dev = dlg().querySelector('[data-testid="param-devThreshold-0"]') as HTMLInputElement;
    dev.value = '0.01';
    dev.dispatchEvent(new Event('change'));
    expect(store.configs()[0].devThreshold).toBe(0.1);
  });

  it('rejects empty numeric input', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    const original = store.configs()[0].devThreshold;
    openSettings(fixture);
    const dev = dlg().querySelector('[data-testid="param-devThreshold-0"]') as HTMLInputElement;
    dev.value = '';
    dev.dispatchEvent(new Event('change'));
    expect(store.configs()[0].devThreshold).toBe(original);
  });

  it('calls store.updateConfig when a boolean param toggles', async () => {
    const { fixture, store } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const oneBar = dlg().querySelector('[data-testid="param-allowZigZagOnOneBar-0"]') as HTMLInputElement;
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
    openSettings(fixture);
    const btn = dlg().querySelector('[data-testid="save-analysis-btn-0"]');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Save');
  });

  it('calls store.saveAnalysis when Save button clicked', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const saveSpy = jest.spyOn(store, 'saveAnalysis');
    openSettings(fixture);
    const btn = dlg().querySelector('[data-testid="save-analysis-btn-0"]');
    btn.click();
    expect(saveSpy).toHaveBeenCalledWith(0);
  });

  it('Save button click reaches SwingAnalysisService.saveAnalysis', async () => {
    const { fixture, store, service } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    const btn = dlg().querySelector('[data-testid="save-analysis-btn-0"]');
    btn.click();
    expect(service.saveAnalysis).toHaveBeenCalled();
  });

  it('disables Save button when no symbol or no stats', async () => {
    const { fixture, store } = await setupPage();
    store.resetState(); // clear the auto-loaded QQQ analysis
    fixture.detectChanges();
    openSettings(fixture);
    const btn = dlg().querySelector('[data-testid="save-analysis-btn-0"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('enables Save button when symbol and stats exist', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    const btn = dlg().querySelector('[data-testid="save-analysis-btn-0"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('renders an error message when store has an error', async () => {
    const barsSubject = new Subject<{ daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset; version: string }>();
    const { fixture, store } = await setupPage(
      makeBars(40),
      { loadBars$: () => barsSubject.asObservable() } as Partial<ChartService>,
    );
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
    const { fixture, store } = await setupPage(
      makeBars(40),
      { loadBars$: () => barsSubject.asObservable() } as Partial<ChartService>,
    );
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
    openSettings(fixture);
    const toggle = dlg().querySelector('[data-testid="dual-mode-toggle"]');
    expect(toggle).toBeTruthy();
  });

  it('shows one config section when dual mode is off', async () => {
    const { fixture, store } = await setupPage();
    store.toggleDualMode(); // dual is the default — turn off
    fixture.detectChanges();
    openSettings(fixture);
    const sections = dlg().querySelectorAll('.config-section');
    expect(sections.length).toBe(1);
  });

  it('shows two config sections by default (dual mode)', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    const sections = dlg().querySelectorAll('.config-section');
    expect(sections.length).toBe(2);
  });

  it('labels config sections as Large Swings and Small Swings', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    const labels = dlg().querySelectorAll('.config-section-label');
    expect(labels[0].textContent.trim()).toBe('Large Swings');
    expect(labels[1].textContent.trim()).toBe('Small Swings');
  });

  it('calls store.toggleDualMode when the toggle is clicked', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const toggleSpy = jest.spyOn(store, 'toggleDualMode');
    openSettings(fixture);
    const toggle = dlg().querySelector('[data-testid="dual-mode-toggle"]') as HTMLInputElement;
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
    openSettings(fixture);
    const dev = dlg().querySelector('[data-testid="param-devThreshold-1"]') as HTMLInputElement;
    dev.value = '7.5';
    dev.dispatchEvent(new Event('change'));
    expect(store.configs()[1].devThreshold).toBe(7.5);
    expect(store.configs()[0].devThreshold).toBe(LARGE_CONFIG.devThreshold);
  });

  it('debounces store.updateConfig when lineColor changes', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    jest.useFakeTimers();
    try {
      const updateSpy = jest.spyOn(store, 'updateConfig');
      openSettings(fixture);
      const color = dlg().querySelector('[data-testid="param-lineColor-1"]') as HTMLInputElement;
      color.value = '#ff0000';
      color.dispatchEvent(new Event('input'));
      // The update is held until the debounce window closes.
      expect(updateSpy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(300);
      expect(store.configs()[1].lineColor).toBe('#ff0000');
    } finally {
      jest.useRealTimers();
    }
  });

  it('collapses rapid lineColor input events into a single update with the latest value', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    jest.useFakeTimers();
    try {
      const updateSpy = jest.spyOn(store, 'updateConfig');
      openSettings(fixture);
      const color = dlg().querySelector('[data-testid="param-lineColor-1"]') as HTMLInputElement;
      color.value = '#ff0000';
      color.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(100);
      color.value = '#00ff00';
      color.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(100);
      color.value = '#0000ff';
      color.dispatchEvent(new Event('input'));
      jest.advanceTimersByTime(300);
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(store.configs()[1].lineColor).toBe('#0000ff');
    } finally {
      jest.useRealTimers();
    }
  });

  it('calls store.saveAnalysis with the correct index when a save button is clicked', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const saveSpy = jest.spyOn(store, 'saveAnalysis');
    openSettings(fixture);
    const btn = dlg().querySelector('[data-testid="save-analysis-btn-1"]');
    btn.click();
    expect(saveSpy).toHaveBeenCalledWith(1);
  });

  it('enables each save button independently based on that config\'s stats', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    const btn0 = dlg().querySelector('[data-testid="save-analysis-btn-0"]') as HTMLButtonElement;
    const btn1 = dlg().querySelector('[data-testid="save-analysis-btn-1"]') as HTMLButtonElement;
    expect(btn0.disabled).toBe(false);
    expect(btn1.disabled).toBe(false);
  });

  it('restores single config section and one indicator when toggled off', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelectorAll('.config-section').length).toBe(2);

    store.toggleDualMode(); // dual is the default — this turns it off
    fixture.detectChanges();
    expect(dlg().querySelectorAll('.config-section').length).toBe(1);
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    expect(chartComp.componentInstance.config.indicators.length).toBe(1);
  });

  it('renders collapsible config sections via details/summary', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    const sections = dlg().querySelectorAll('details.config-section');
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
    openSettings(fixture);
    expect(dlg().querySelector('[data-testid="param-showTriggerDots-0"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="param-showTriggerDots-1"]')).toBeTruthy();
  });

  it('calls updateConfig when the Trigger Dots checkbox toggles', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    // SMALL_CONFIG defaults showTriggerDots=false — toggling sets true.
    const cb = dlg().querySelector('[data-testid="param-showTriggerDots-1"]') as HTMLInputElement;
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
    expect(store.configs()[1].showTriggerDots).toBe(true);
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
    openSettings(fixture);
    const btn0 = dlg().querySelector('[data-testid="save-analysis-btn-0"]') as HTMLButtonElement;
    expect(btn0.disabled).toBe(true);
    // Dual is the default — config 1's button already exists after reset.
    const btn1 = dlg().querySelector('[data-testid="save-analysis-btn-1"]') as HTMLButtonElement;
    expect(btn1.disabled).toBe(true);
  });
});

// =============================================================================
// Batch sweep UI — textarea + Run + progress + results (#429)
// =============================================================================

describe('SwingAnalysisPageComponent — batch sweep UI', () => {
  type LoadBarsResult = { daily: ChartDataset; weekly: ChartDataset; monthly: ChartDataset; version: string };
  const pendingChart = (): Partial<ChartService> => ({
    loadBars$: jest.fn((): Observable<LoadBarsResult> => new Subject<LoadBarsResult>().asObservable()),
  });

  it('renders a collapsed batch section with textarea and disabled Run button', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const section = dlg().querySelector('[data-testid="batch-section"]') as HTMLDetailsElement;
    expect(section).toBeTruthy();
    expect(section.open).toBe(false);
    expect(dlg().querySelector('[data-testid="batch-symbols"]')).toBeTruthy();
    const runBtn = dlg().querySelector('[data-testid="run-batch-btn"]') as HTMLButtonElement;
    expect(runBtn.disabled).toBe(true);
  });

  it('enables Run only when the textarea has non-whitespace text', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const ta = dlg().querySelector('[data-testid="batch-symbols"]') as HTMLTextAreaElement;
    const runBtn = dlg().querySelector('[data-testid="run-batch-btn"]') as HTMLButtonElement;
    ta.value = '   ';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(runBtn.disabled).toBe(true);
    // Separators-only parses to zero symbols — Run must stay disabled
    // (canRunBatch uses parseSymbols, matching the store's no-op guard).
    ta.value = ', , ,';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(runBtn.disabled).toBe(true);
    ta.value = 'AAPL, MSFT';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(runBtn.disabled).toBe(false);
  });

  it('clicking Run calls store.runBatch with the pasted text', async () => {
    const { fixture, store } = await setupPage();
    const spy = jest.spyOn(store, 'runBatch');
    fixture.detectChanges();
    openSettings(fixture);
    const ta = dlg().querySelector('[data-testid="batch-symbols"]') as HTMLTextAreaElement;
    ta.value = 'aapl, msft';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (dlg().querySelector('[data-testid="run-batch-btn"]') as HTMLButtonElement).click();
    expect(spy).toHaveBeenCalledWith('aapl, msft');
  });

  it('shows progress and a Cancel button while a batch is running; Run disabled', async () => {
    const { fixture } = await setupPage(makeBars(40), pendingChart());
    fixture.detectChanges();
    openSettings(fixture);
    const ta = dlg().querySelector('[data-testid="batch-symbols"]') as HTMLTextAreaElement;
    ta.value = 'AAPL, MSFT';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (dlg().querySelector('[data-testid="run-batch-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const progress = dlg().querySelector('[data-testid="batch-progress"]') as HTMLElement;
    expect(progress.textContent).toContain('0/2');
    expect(progress.textContent).toContain('AAPL');
    expect((dlg().querySelector('[data-testid="run-batch-btn"]') as HTMLButtonElement).disabled).toBe(true);
    expect(dlg().querySelector('[data-testid="cancel-batch-btn"]')).toBeTruthy();
  });

  it('Cancel calls store.cancelBatch and re-enables Run', async () => {
    const { fixture, store } = await setupPage(makeBars(40), pendingChart());
    const spy = jest.spyOn(store, 'cancelBatch');
    fixture.detectChanges();
    openSettings(fixture);
    const ta = dlg().querySelector('[data-testid="batch-symbols"]') as HTMLTextAreaElement;
    ta.value = 'AAPL';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (dlg().querySelector('[data-testid="run-batch-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (dlg().querySelector('[data-testid="cancel-batch-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(spy).toHaveBeenCalled();
    expect((dlg().querySelector('[data-testid="run-batch-btn"]') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders per-symbol results with ok/fail markers after a run', async () => {
    // EMPTY returns no bars -> recorded as failed.
    const chart = {
      loadBars$: jest.fn((symbol: string) => of({
        daily: makeChartDataset(symbol === 'EMPTY' ? [] : makeBars(40)),
        weekly: makeChartDataset([]),
        monthly: makeChartDataset([]),
        version: 'test',
      })),
    };
    const { fixture } = await setupPage(makeBars(40), chart);
    fixture.detectChanges();
    openSettings(fixture);
    const ta = dlg().querySelector('[data-testid="batch-symbols"]') as HTMLTextAreaElement;
    ta.value = 'AAPL, EMPTY';
    ta.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    (dlg().querySelector('[data-testid="run-batch-btn"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    const rows = dlg().querySelectorAll('[data-testid="batch-results"] li');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('AAPL');
    expect(rows[0].classList.contains('ok')).toBe(true);
    expect(rows[1].textContent).toContain('EMPTY');
    expect(rows[1].classList.contains('fail')).toBe(true);
    expect(rows[1].textContent).toContain('no bars');
  });
});

// =============================================================================
// Saved-sets browser — lazy collection load, filter, multi-select, N-slot load
// =============================================================================

function makeStats(): SwingStats {
  const ds = { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
  const side = () => ({
    count: 1, magnitudePercent: { ...ds }, magnitudeAbsolute: { ...ds },
    duration: { ...ds }, magnitudeHistogram: { bins: [] }, durationHistogram: { bins: [] },
  });
  return { up: side(), down: side() };
}

function makeSetDoc(id: string, symbol: string, config: ZigZagConfig, savedAt: string): SwingAnalysisDoc {
  return {
    id, userId: 'u', symbol, paramsId: deriveParamsId(config),
    config,
    pivots: [], projection: null, swings: [], stats: makeStats(), savedAt,
  };
}

describe('SwingAnalysisPageComponent — saved-sets browser', () => {
  // The page opens on QQQ — the panel fetches the current symbol's sets.
  const sets = () => [
    // dev10 + dev3 match the live default slots (LARGE_CONFIG/SMALL_CONFIG)
    // → their rows render checked when the panel opens.
    makeSetDoc('QQQ_dev10', 'QQQ', { ...LARGE_CONFIG }, '2026-09-20T10:00:00Z'),
    makeSetDoc('QQQ_dev3', 'QQQ', { ...SMALL_CONFIG }, '2026-09-21T10:00:00Z'),
    makeSetDoc('QQQ_dev2', 'QQQ', { ...SMALL_CONFIG, devThreshold: 2, leftDepth: 2, rightDepth: 2 }, '2026-09-18T10:00:00Z'),
    makeSetDoc('MSFT_dev5', 'MSFT', { ...LARGE_CONFIG, devThreshold: 5, leftDepth: 5, rightDepth: 5 }, '2026-09-19T10:00:00Z'),
  ];

  async function setupWithSets() {
    const allSets = sets();
    const service = mockSwingAnalysisService([], allSets);
    // Symbol-scoped fetch — mirror the real query's where(symbol==).
    service.loadSavedAnalyses.mockImplementation((sym: string) =>
      of(allSets.filter((d) => d.symbol === sym)),
    );
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, service, ['QQQ', 'MSFT', 'AAPL'],
    );
    return { fixture, store, service };
  }

  function expandPanel(fixture: ComponentFixture<SwingAnalysisPageComponent>): void {
    const details = fixture.nativeElement.querySelector('[data-testid="saved-sets-section"]') as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
  }

  it('lazy-loads the current symbol\'s sets on first expand only — never the whole collection', async () => {
    const { fixture, service } = await setupWithSets();
    expect(service.loadSavedAnalyses).not.toHaveBeenCalled();
    expect(service.loadAllSwingSets).not.toHaveBeenCalled();

    expandPanel(fixture);
    expect(service.loadSavedAnalyses).toHaveBeenCalledWith('QQQ');
    expect(service.loadAllSwingSets).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelectorAll('[data-testid="saved-set-row"]').length).toBe(3);

    // Second expand does not refetch.
    const details = fixture.nativeElement.querySelector('[data-testid="saved-sets-section"]') as HTMLDetailsElement;
    details.open = false;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    details.open = true;
    details.dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    expect(service.loadSavedAnalyses).toHaveBeenCalledTimes(1);
  });

  it('switching the symbol picker refetches that symbol\'s sets, newest-first', async () => {
    const { fixture, service } = await setupWithSets();
    expandPanel(fixture);

    const select = fixture.nativeElement.querySelector('[data-testid="saved-sets-symbol"]') as HTMLSelectElement;
    select.value = 'MSFT';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(service.loadSavedAnalyses).toHaveBeenCalledWith('MSFT');
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="saved-set-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('dev5_L5_R5');
  });

  it('follows nav — symbol change refetches that symbol\'s sets and resyncs picker + checks', async () => {
    const { fixture, store, service } = await setupWithSets();
    expandPanel(fixture);
    expect(service.loadSavedAnalyses).toHaveBeenCalledWith('QQQ');

    store.setSymbol('MSFT');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Refetched for the new symbol — dropdown follows, rows show MSFT docs.
    expect(service.loadSavedAnalyses).toHaveBeenCalledWith('MSFT');
    const select = fixture.nativeElement.querySelector('[data-testid="saved-sets-symbol"]') as HTMLSelectElement;
    expect(select.value).toBe('MSFT');
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="saved-set-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('dev5_L5_R5');

    // Checks reflect the CURRENT symbol's configs — dev5 matches no live
    // slot, so the row is unchecked (no stale QQQ checks carried over).
    const box = rows[0].querySelector('[data-testid="saved-set-checkbox"]') as HTMLInputElement;
    expect(box.checked).toBe(false);
  });

  it('doc rows sort newest savedAt first', async () => {
    const { fixture } = await setupWithSets();
    expandPanel(fixture);

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="saved-set-row"]');
    expect(rows.length).toBe(3);
    // Newest-first: dev3 (09-21), dev10 (09-20), dev2 (09-18).
    expect(rows[0].textContent).toContain('dev3_L3_R3');
    expect(rows[1].textContent).toContain('dev10_L10_R10');
    expect(rows[2].textContent).toContain('dev2_L2_R2');
  });

  it('docs matching the live config slots are checked by default', async () => {
    const { fixture } = await setupWithSets();
    expandPanel(fixture);

    const boxes = fixture.nativeElement.querySelectorAll('[data-testid="saved-set-checkbox"]') as NodeListOf<HTMLInputElement>;
    // Rows newest-first: dev3 (slot 1), dev10 (slot 0) checked; dev2 not.
    expect(boxes[0].checked).toBe(true);
    expect(boxes[1].checked).toBe(true);
    expect(boxes[2].checked).toBe(false);
    const btn = fixture.nativeElement.querySelector('[data-testid="load-sets-btn"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.textContent).toContain('Load 2 selected');
  });

  it('unchecking an auto-checked slot doc removes it; Load disables when none checked', async () => {
    const { fixture } = await setupWithSets();
    expandPanel(fixture);
    const btn = () => fixture.nativeElement.querySelector('[data-testid="load-sets-btn"]') as HTMLButtonElement;
    const boxes = () => fixture.nativeElement.querySelectorAll('[data-testid="saved-set-checkbox"]') as NodeListOf<HTMLInputElement>;

    boxes()[0].click(); // uncheck dev3
    fixture.detectChanges();
    expect(boxes()[0].checked).toBe(false);
    expect(btn().disabled).toBe(false); // dev10 still checked

    boxes()[1].click(); // uncheck dev10
    fixture.detectChanges();
    expect(btn().disabled).toBe(true);
  });

  it('Load calls loadSwingSetsIntoSlots with the checked docs; N slots render N config sections', async () => {
    const { fixture, store } = await setupWithSets();
    expandPanel(fixture);
    const spy = jest.spyOn(store, 'loadSwingSetsIntoSlots');

    // dev3 + dev10 are already auto-checked (they match the live slots) —
    // checking dev2 yields all three QQQ docs.
    const boxes = fixture.nativeElement.querySelectorAll('[data-testid="saved-set-checkbox"]') as NodeListOf<HTMLInputElement>;
    boxes[2].click();
    fixture.detectChanges();

    fixture.nativeElement.querySelector('[data-testid="load-sets-btn"]').click();
    fixture.detectChanges();

    expect(spy).toHaveBeenCalledTimes(1);
    const docs = spy.mock.calls[0][0] as SwingAnalysisDoc[];
    expect(docs.map((d) => d.id)).toEqual(['QQQ_dev3', 'QQQ_dev10', 'QQQ_dev2']);
    expect(store.configs().length).toBe(3);
    expect(store.configs().map((c) => c.devThreshold)).toEqual([3, 10, 2]);
    // N>2 actually renders N config sections + N chart overlays.
    openSettings(fixture);
    expect(dlg().querySelectorAll('[data-testid^="config-section-"]').length).toBe(3);
    expect(fixture.componentInstance.chartConfig().indicators.length).toBe(3);
  });
});

describe('SwingAnalysisPageComponent — symbol nav', () => {
  it('renders prev/next, current symbol, and position in the nav sequence', async () => {
    const { fixture } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService([]), ['AAPL', 'MSFT', 'QQQ']);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="nav-symbol"]').textContent).toContain('QQQ');
    // Sorted sequence [AAPL, MSFT, QQQ] — QQQ is last.
    expect(fixture.nativeElement.querySelector('[data-testid="nav-position"]').textContent).toContain('3 of 3');
  });

  it('next/prev step through the sequence and wrap at the ends', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService([]), ['AAPL', 'MSFT', 'QQQ']);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="nav-next"]') as HTMLButtonElement).click();
    expect(store.symbol()).toBe('AAPL'); // wrapped past the end

    (fixture.nativeElement.querySelector('[data-testid="nav-next"]') as HTMLButtonElement).click();
    expect(store.symbol()).toBe('MSFT');

    (fixture.nativeElement.querySelector('[data-testid="nav-prev"]') as HTMLButtonElement).click();
    expect(store.symbol()).toBe('AAPL');
  });

  it('disables prev/next when the tracked-symbols universe is empty', async () => {
    const { fixture } = await setupPage(); // navSymbols defaults to []
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('[data-testid="nav-prev"]') as HTMLButtonElement).disabled).toBe(true);
    expect((fixture.nativeElement.querySelector('[data-testid="nav-next"]') as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.nativeElement.querySelector('[data-testid="nav-position"]').textContent).toContain('of 0');
  });

  it('watchlist filter narrows the nav sequence to list members', async () => {
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService([]),
      ['AAPL', 'MSFT', 'QQQ', 'TSLA'],
      { 'PRIMARY': ['MSFT', 'QQQ'] },
    );
    fixture.detectChanges();

    const sel = fixture.nativeElement.querySelector('[data-testid="nav-filter"]') as HTMLSelectElement;
    sel.value = 'PRIMARY';
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // Filter change jumps to the first member — MSFT in [MSFT, QQQ].
    expect(store.symbol()).toBe('MSFT');
    expect(fixture.nativeElement.querySelector('[data-testid="nav-position"]').textContent).toContain('1 of 2');
    (fixture.nativeElement.querySelector('[data-testid="nav-next"]') as HTMLButtonElement).click();
    expect(store.symbol()).toBe('QQQ'); // wraps within the watchlist, not all tracked
  });

  it('No memberships filter navs to tracked symbols in zero lists', async () => {
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService([]),
      ['AAPL', 'MSFT', 'QQQ', 'TSLA'],
      { 'PRIMARY': ['MSFT', 'QQQ', 'TSLA'] },
    );
    fixture.detectChanges();

    const sel = fixture.nativeElement.querySelector('[data-testid="nav-filter"]') as HTMLSelectElement;
    sel.value = NO_MEMBERSHIP;
    sel.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    // AAPL is the only tracked symbol in zero lists.
    expect(store.symbol()).toBe('AAPL');
    expect(fixture.nativeElement.querySelector('[data-testid="nav-position"]').textContent).toContain('1 of 1');
  });

  it('watchlist filter select lists the canonical options in fixed order', async () => {
    const { fixture } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService([]), ['QQQ'],
    );
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelectorAll('[data-testid="nav-filter"] option');
    const values = [...options].map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['ALL', 'PRIMARY', 'SECONDARY', 'NEUTRAL', 'AVOID', 'HIDE', 'NO_MEMBERSHIP', 'MONITOR']);
    const labels = [...options].map((o) => (o as HTMLOptionElement).textContent.trim());
    expect(labels).toContain('No memberships');
  });

  it('renders the watchlist chip row bound to the current symbol', async () => {
    const { fixture } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService([]), ['QQQ'],
      { 'PRIMARY': ['QQQ'] },
    );
    fixture.detectChanges();

    const chips = fixture.nativeElement.querySelector('[data-testid="nav-list-actions"]');
    expect(chips).toBeTruthy();
    // PRIMARY chip reflects QQQ's membership.
    const primary = chips.querySelector('[class*="active"]');
    expect(primary?.textContent).toBeTruthy();
  });

  it('chip toggle delegates to SymbolListStore.toggleSymbolInList', async () => {
    const { fixture } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService([]), ['QQQ'], { 'PRIMARY': [] },
    );
    fixture.detectChanges();
    const listStore = TestBed.inject(SymbolListStore) as unknown as { toggleSymbolInList: jest.Mock };

    // Click the first chip (PRIMARY) in the actions row.
    const chip = fixture.nativeElement.querySelector('[data-testid="nav-list-actions"] button') as HTMLButtonElement;
    chip.click();
    expect(listStore.toggleSymbolInList).toHaveBeenCalledWith('QQQ', 'PRIMARY');
  });

  it('loads symbol lists on mount when cold', async () => {
    await setupPage();
    const listStore = TestBed.inject(SymbolListStore) as unknown as { loadSymbolLists: jest.Mock };
    expect(listStore.loadSymbolLists).toHaveBeenCalled();
  });

  it('navigating onto a failed symbol shows the error state and nav stays usable', async () => {
    const chart = {
      loadBars$: jest.fn((symbol: string) =>
        symbol === 'BAD'
          ? throwError(() => new Error('Failed to load bars'))
          : of({ daily: makeChartDataset(makeBars(40)), weekly: makeChartDataset([]), monthly: makeChartDataset([]), version: 'test' }),
      ),
    };
    // Sequence [AAPL, BAD, QQQ] — QQQ is current; prev lands on BAD.
    const { fixture, store } = await setupPage(makeBars(40), chart, mockSwingAnalysisService([]), ['AAPL', 'BAD', 'QQQ']);
    fixture.detectChanges();

    (fixture.nativeElement.querySelector('[data-testid="nav-prev"]') as HTMLButtonElement).click();
    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();

    expect(store.symbol()).toBe('BAD');
    expect(store.error()).toContain('Failed to load bars');
    expect(fixture.nativeElement.querySelector('[data-testid="error-message"]')).toBeTruthy();

    // Nav stays usable — next continues to QQQ.
    (fixture.nativeElement.querySelector('[data-testid="nav-next"]') as HTMLButtonElement).click();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(store.symbol()).toBe('QQQ');
  });
});
