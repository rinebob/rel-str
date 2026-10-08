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
import type { StSymbolProfile } from '../services/types';
import { StIndicator } from '../../shared/components/flex-chart/flex-chart.types';
import { BarsInterval } from '../../../core/models/partner.types';
import { UiStateService } from '../../../core/services/ui-state.service';
import { FlexChartComponent } from '../../shared/components/flex-chart/flex-chart.component';
import { SwingTableComponent } from './components/swing-table.component';
import { StatsPanelComponent } from './components/stats-panel.component';
import type { PriceBar, Swing, SwingStats } from '../../shared/components/flex-chart/indicators/st-zigzag.engine';
import type { ChartDataset } from '../../heatmap-chart/heatmap-chart.types';
import type { SwingConfigDoc } from './swing-analysis.types';
import type { ZigZagConfig } from '../../shared/components/flex-chart/indicators/st-zigzag.types';
import { NO_MEMBERSHIP } from '../common/constants';
import { isUntriaged } from '../utils/utils';
import { SYSTEM_LIST_DEFS } from '../common/symbol-list-defs';

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

function makeConfigDoc(name: string | undefined, config: ZigZagConfig, id?: string): SwingConfigDoc {
  const paramsId = id ?? `p-${config.devThreshold}-${config.leftDepth}-${config.rightDepth}`;
  return { id: paramsId, userId: 'u', name, config, savedAt: '2026-01-01T00:00:00Z', paramsId };
}

function mockSwingAnalysisService(
  library: SwingConfigDoc[] = [],
): Partial<SwingAnalysisService> & {
  loadConfigs: jest.Mock;
  saveConfig: jest.Mock;
  deleteConfig: jest.Mock;
} {
  return {
    loadConfigs: jest.fn(() => of(library)),
    saveConfig: jest.fn(() => of(undefined)),
    deleteConfig: jest.fn(() => of(undefined)),
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
  service: ReturnType<typeof mockSwingAnalysisService> = mockSwingAnalysisService(),
  navSymbols: string[] = [],
  navLists: Record<string, string[]> = {},
  profiles: StSymbolProfile[] = [],
): Promise<PageSetup> {
  const tracked = signal<string[]>([]);
  const listCatalog = [
    ...SYSTEM_LIST_DEFS.map((def) => ({
      ...def,
      symbols: navLists[def.key] ?? [],
      userId: 'test-user',
    })),
    ...Object.entries(navLists)
      .filter(([key]) => !SYSTEM_LIST_DEFS.some((def) => def.key === key))
      .map(([key, symbols], index) => ({
        key, label: key, order: 100 + index, role: 'nonexclusive' as const,
        hidden: false, symbols, userId: 'test-user',
      })),
  ];
  const filterOptionGroups = () => {
    const visible = listCatalog.filter((def) => !def.hidden);
    const toOption = (def: typeof listCatalog[number]) => ({ value: def.key, label: def.label });
    const myLists = visible.filter((def) => def.role === 'nonexclusive').map(toOption);
    return [
      {
        label: 'Triage',
        options: [
          ...visible.filter((def) => def.role === 'exclusive').map(toOption),
          { value: NO_MEMBERSHIP, label: 'Not triaged' },
        ],
      },
      ...(myLists.length ? [{ label: 'My lists', options: myLists }] : []),
    ];
  };
  TestBed.configureTestingModule({
    providers: [
      { provide: ChartService, useValue: chart ?? mockChartService(bars) },
      { provide: RelStrDbV2Service, useValue: { getTrackedSymbols$: jest.fn(() => of(navSymbols.map((s) => ({ symbol: s })))) } },
      // SymbolListStore owns the tracked-symbols universe — the mock
      // reproduces its loadTrackedSymbols/unlistedSymbols contract so the
      // nav sequence can read it.
      { provide: SymbolListStore, useValue: {
        catalog: () => listCatalog,
        filterOptionGroups,
        symbolLists: signal<Record<string, string[]>>(navLists),
        activeListFilter: signal('ALL'),
        trackedSymbols: tracked,
        unlistedSymbols: computed(() => tracked().filter((s) =>
          isUntriaged(s, navLists, SYSTEM_LIST_DEFS.filter((d) => d.role === 'exclusive').map((d) => d.key)),
        )),
        loadTrackedSymbols: jest.fn(() => {
          if (tracked().length === 0) tracked.set([...navSymbols].sort());
          return Promise.resolve(tracked());
        }),
        loadSymbolLists: jest.fn(),
        toggleSymbolInList: jest.fn(),
        addSymbolToList: jest.fn(),
        removeSymbolFromList: jest.fn(),
        profiles: signal<StSymbolProfile[]>(profiles),
        profilesLoading: signal(false),
        profilesBySymbol: signal(new Map<string, StSymbolProfile>(profiles.map((p) => [p.symbol.toUpperCase(), p]))),
        loadProfiles: jest.fn(() => Promise.resolve(profiles)),
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
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    btn.click();
    fixture.detectChanges();

    expect(chart.config?.logScale).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');

    btn.click();
    fixture.detectChanges();
    expect(chart.config?.logScale).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves the header visible on init; a manual fullscreen exits on destroy', async () => {
    const { fixture } = await setupPage();
    const ui = TestBed.inject(UiStateService);
    expect(ui.fullscreen()).toBe(false);
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('fullscreen')).toBe(false);

    ui.setFullscreen(true);
    fixture.detectChanges();
    expect(fixture.nativeElement.classList.contains('fullscreen')).toBe(true);
    fixture.destroy();
    expect(ui.fullscreen()).toBe(false);
  });

  it('does not render a free-text symbol input — the nav picker is the only entry point', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelector('input[data-testid="symbol-input"]')).toBeNull();
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
    expect(config.indicators.length).toBe(2); // two configs by default
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
    store.removeActiveConfig(1); // two configs by default — drop slot 1
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('.mock-swing-table');
    expect(table.getAttribute('data-small-swing-count')).toBe('null');
  });

  it('passes swings()[1] as smallSwings to the swing table', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL'); // two configs by default — slot 1 already computed
    fixture.detectChanges();
    const table = fixture.nativeElement.querySelector('.mock-swing-table');
    expect(table.getAttribute('data-small-swing-count')).toBe(String(store.swings()[1].length));
  });

  it('passes null statsSets to the stats panel in single mode', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    store.removeActiveConfig(1); // two configs by default — drop slot 1
    fixture.detectChanges();
    const panel = fixture.nativeElement.querySelector('.mock-stats-panel');
    expect(panel.getAttribute('data-stats-sets')).toBe('null');
  });

  it('passes [large, small, all] statsSets to the stats panel', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL'); // two configs by default
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

  it('renders a save-to-library button per config row', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const btn = dlg().querySelector('[data-testid="save-config-btn-0"]');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain('Save');
  });

  it('saves unnamed — library rows fall back to a param summary', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const saveSpy = jest.spyOn(store, 'saveActiveConfig');
    openSettings(fixture);
    dlg().querySelector('[data-testid="save-config-btn-0"]').click();
    expect(saveSpy).toHaveBeenCalledWith(0);
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
  // Config rows - one narrow row per config, unique indicator ids
  // =========================================================================

  it('shows one active row with a single config', async () => {
    const { fixture, store } = await setupPage();
    store.removeActiveConfig(1); // two configs by default — drop slot 1
    fixture.detectChanges();
    openSettings(fixture);
    const rows = dlg().querySelectorAll('.active-row');
    expect(rows.length).toBe(1);
  });

  it('shows two active rows by default', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    const rows = dlg().querySelectorAll('.active-row');
    expect(rows.length).toBe(2);
  });

  it('active rows have no Large/Small labels — params are the identity', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelectorAll('.config-section-label').length).toBe(0);
    expect(dlg().textContent).not.toContain('Large');
    expect(dlg().textContent).not.toContain('Small');
    const row = dlg().querySelector('[data-testid="active-row-0"]');
    expect(row).toBeTruthy();
    expect(row.textContent).not.toContain('Swings');
  });

  it('builds chartConfig with one IndicatorConfig when one config is active', async () => {
    const { fixture, store } = await setupPage();
    store.removeActiveConfig(1); // two configs by default — drop slot 1
    fixture.detectChanges();
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    const config = chartComp.componentInstance.config;
    expect(config.indicators.length).toBe(1);
    expect(config.indicators[0].id).toBe('st-zigzag-0');
    expect(config.indicators[0].type).toBe(StIndicator.ST_ZIGZAG);
  });

  it('builds chartConfig with two IndicatorConfigs with unique ids', async () => {
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

  it('calls store.saveActiveConfig with the correct index when that row\'s save button is clicked', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const saveSpy = jest.spyOn(store, 'saveActiveConfig');
    openSettings(fixture);
    dlg().querySelector('[data-testid="save-config-btn-1"]').click();
    expect(saveSpy).toHaveBeenCalledWith(1);
  });

  it('restores single config section and one indicator when toggled off', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelectorAll('.active-row').length).toBe(2);

    store.removeActiveConfig(1); // two configs by default — drop slot 1
    fixture.detectChanges();
    expect(dlg().querySelectorAll('.active-row').length).toBe(1);
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    expect(chartComp.componentInstance.config.indicators.length).toBe(1);
  });

  it('renders active configs as narrow rows — no details/summary blocks', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    const rows = dlg().querySelectorAll('.active-row');
    expect(rows.length).toBe(2);
    expect(dlg().querySelectorAll('details').length).toBe(0);
  });

  it('renders N>2 active rows after activating a preset', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    dlg().querySelector('[data-testid="preset-activate-0"]').click();
    fixture.detectChanges();
    dlg().querySelector('[data-testid="preset-activate-1"]').click();
    fixture.detectChanges();
    expect(dlg().querySelectorAll('.active-row').length).toBe(4);
    // every row carries its own param inputs + row actions
    expect(dlg().querySelector('[data-testid="param-devThreshold-3"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="remove-config-btn-3"]')).toBeTruthy();
  });

  it('the dialog contains no batch-sweep or saved-sets elements', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelector('[data-testid="batch-section"]')).toBeNull();
    expect(dlg().querySelector('[data-testid="batch-symbols"]')).toBeNull();
    expect(dlg().querySelector('[data-testid="run-batch-btn"]')).toBeNull();
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

});

// =============================================================================
// Config manager — available list (presets + saved) + active-row actions
// =============================================================================

describe('SwingAnalysisPageComponent — config manager', () => {
  const libraryDocs = (): SwingConfigDoc[] => [
    makeConfigDoc('Wide', { ...LARGE_CONFIG, devThreshold: 12, leftDepth: 40, rightDepth: 40 }, 'p-12-40-40'),
    makeConfigDoc(undefined, { ...SMALL_CONFIG, devThreshold: 4, leftDepth: 6, rightDepth: 6 }, 'p-4-6-6'),
  ];

  it('renders the Available section with Presets and Saved groups', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const section = dlg().querySelector('[data-testid="available-configs"]');
    expect(section).toBeTruthy();
    expect(section.textContent).toContain('Presets');
    expect(section.textContent).toContain('Saved');
    expect(dlg().querySelector('[data-testid="preset-activate-0"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="preset-activate-1"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="preset-activate-2"]')).toBeTruthy();
    expect(dlg().querySelector('[data-testid="preset-activate-3"]')).toBeTruthy();
  });

  it('presets are unnamed and ordered highest→lowest devThreshold', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    const rows = [...dlg().querySelectorAll('[data-testid^="preset-row-"]')];
    expect(rows.length).toBe(4);
    const summaries = rows.map((r) => r.querySelector('.lib-summary')!.textContent);
    expect(summaries[0]).toContain('dev10');
    expect(summaries[3]).toContain('dev2');
    // no display names — the row label is the param summary
    expect(dlg().querySelectorAll('.lib-row .lib-name').length).toBe(0);
  });

  it('preset + calls store.activateConfig with the preset config', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const spy = jest.spyOn(store, 'activateConfig');
    openSettings(fixture);
    dlg().querySelector('[data-testid="preset-activate-0"]').click();
    expect(spy).toHaveBeenCalled();
    const arg = spy.mock.calls[0][0];
    expect(arg.devThreshold).toBe(LARGE_CONFIG.devThreshold);
    expect(arg.leftDepth).toBe(LARGE_CONFIG.leftDepth);
  });

  it('opens the dialog by loading the config library', async () => {
    const { fixture, service } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(libraryDocs()),
    );
    fixture.detectChanges();
    expect(service.loadConfigs).not.toHaveBeenCalled();
    openSettings(fixture);
    expect(service.loadConfigs).toHaveBeenCalledTimes(1);
  });

  it('lists saved singles under Presets with names and param-summary fallback', async () => {
    const { fixture } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(libraryDocs()),
    );
    fixture.detectChanges();
    openSettings(fixture);
    const row0 = dlg().querySelector('[data-testid="saved-preset-row-p-12-40-40"]');
    expect(row0.textContent).toContain('Wide');
    const row1 = dlg().querySelector('[data-testid="saved-preset-row-p-4-6-6"]');
    expect(row1.textContent).toContain('4'); // param summary fallback — no name
  });

  it('param summary distinguishes flag-differing docs (paramsId covers them)', async () => {
    const docs = [
      makeConfigDoc(undefined, { ...LARGE_CONFIG, showTriggerDots: true }, 'p-trig-y'),
      makeConfigDoc(undefined, { ...LARGE_CONFIG, showTriggerDots: false }, 'p-trig-n'),
    ];
    const { fixture } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(docs),
    );
    fixture.detectChanges();
    openSettings(fixture);
    const rowY = dlg().querySelector('[data-testid="saved-preset-row-p-trig-y"]').textContent;
    const rowN = dlg().querySelector('[data-testid="saved-preset-row-p-trig-n"]').textContent;
    expect(rowY).toContain('trigY');
    expect(rowN).toContain('trigN');
    expect(rowY).not.toBe(rowN);
  });

  it('saved + activates the doc config; saved × deletes it from the library', async () => {
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(libraryDocs()),
    );
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const activateSpy = jest.spyOn(store, 'activateConfig');
    const deleteSpy = jest.spyOn(store, 'deleteSavedConfig');
    openSettings(fixture);
    dlg().querySelector('[data-testid="saved-preset-activate-p-4-6-6"]').click();
    expect(activateSpy).toHaveBeenCalled();
    expect((activateSpy.mock.calls[0][0] as ZigZagConfig).devThreshold).toBe(4);
    dlg().querySelector('[data-testid="saved-delete-p-12-40-40"]').click();
    expect(deleteSpy).toHaveBeenCalledWith('p-12-40-40');
  });

  it('saved ✎ opens an inline rename input; commit calls renameSavedConfig', async () => {
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(libraryDocs()),
    );
    fixture.detectChanges();
    const spy = jest.spyOn(store, 'renameSavedConfig');
    openSettings(fixture);
    dlg().querySelector('[data-testid="saved-rename-p-12-40-40"]').click();
    fixture.detectChanges();
    const input = dlg().querySelector('[data-testid="saved-rename-input-p-12-40-40"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    input.value = 'Wide zigzag';
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ paramsId: 'p-12-40-40' }), 'Wide zigzag');
  });

  it('blank rename input clears the name → row falls back to the param summary', async () => {
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(libraryDocs()),
    );
    fixture.detectChanges();
    const spy = jest.spyOn(store, 'renameSavedConfig');
    openSettings(fixture);
    dlg().querySelector('[data-testid="saved-rename-p-12-40-40"]').click();
    fixture.detectChanges();
    const input = dlg().querySelector('[data-testid="saved-rename-input-p-12-40-40"]') as HTMLInputElement;
    input.value = '   ';
    input.dispatchEvent(new Event('blur'));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ paramsId: 'p-12-40-40' }), undefined);
  });

  it('set docs render in Saved sets with an N×cfg badge; + applies the whole set', async () => {
    const setDoc: SwingConfigDoc = {
      id: 'set-x',
      paramsId: 'set-x',
      userId: 'u',
      name: 'My set',
      configs: [LARGE_CONFIG, { ...SMALL_CONFIG, lineColor: '#111' }],
      savedAt: '2026-01-01T00:00:00Z',
    };
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService([setDoc]),
    );
    store.setSymbol('AAPL');
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelector('[data-testid="saved-set-badge-set-x"]').textContent).toContain('2');
    expect(dlg().querySelector('[data-testid="saved-row-set-x"]').textContent).toContain('My set');
    // Singles stay out of the sets group — this row is not under Presets.
    expect(dlg().querySelector('[data-testid="saved-preset-row-set-x"]')).toBeNull();
    dlg().querySelector('[data-testid="saved-activate-set-x"]').click();
    expect(store.configs().length).toBe(2);
    expect(store.configs()[0].devThreshold).toBe(LARGE_CONFIG.devThreshold);
  });

  it('Active header exposes Save set / Clone all / Clear', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const saveSpy = jest.spyOn(store, 'saveActiveSet');
    const cloneSpy = jest.spyOn(store, 'cloneAllConfigs');
    const clearSpy = jest.spyOn(store, 'clearActiveConfigs');
    openSettings(fixture);
    dlg().querySelector('[data-testid="save-set-btn"]').click();
    expect(saveSpy).toHaveBeenCalled();
    dlg().querySelector('[data-testid="clone-all-btn"]').click();
    expect(cloneSpy).toHaveBeenCalled();
    dlg().querySelector('[data-testid="clear-all-btn"]').click();
    expect(clearSpy).toHaveBeenCalled();
  });

  it('each active row has an on/off checkbox that toggles the runtime flag', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const spy = jest.spyOn(store, 'toggleActiveConfig');
    openSettings(fixture);
    const cb = dlg().querySelector('[data-testid="param-enabled-1"]') as HTMLInputElement;
    expect(cb.checked).toBe(true);
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
    expect(spy).toHaveBeenCalledWith(1);
    fixture.detectChanges();
    expect(dlg().querySelector('[data-testid="active-row-1"]')!.classList.contains('disabled')).toBe(true);
  });

  it('disabling a config removes its zigzag indicator from chartConfig', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const chartComp = fixture.debugElement.query((el: any) => el.nativeElement.classList?.contains('mock-flex-chart'));
    expect(chartComp.componentInstance.config.indicators.length).toBe(2);
    store.toggleActiveConfig(1);
    fixture.detectChanges();
    const inds = chartComp.componentInstance.config.indicators;
    expect(inds.length).toBe(1);
    expect(inds[0].id).toBe('st-zigzag-0'); // index-stable id survives the filter
  });

  it('active rows expose clone and remove actions', async () => {
    const { fixture, store } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    const cloneSpy = jest.spyOn(store, 'cloneConfig');
    const removeSpy = jest.spyOn(store, 'removeActiveConfig');
    openSettings(fixture);
    dlg().querySelector('[data-testid="clone-config-btn-0"]').click();
    expect(cloneSpy).toHaveBeenCalledWith(0);
    dlg().querySelector('[data-testid="remove-config-btn-1"]').click();
    expect(removeSpy).toHaveBeenCalledWith(1);
  });

  it('surfaces store.error inside the dialog — the page banner sits behind the overlay', async () => {
    const { fixture, store, service } = await setupPage();
    store.setSymbol('AAPL');
    fixture.detectChanges();
    service.saveConfig.mockReturnValue(throwError(() => new Error('denied')));
    openSettings(fixture);
    dlg().querySelector('[data-testid="save-config-btn-0"]').click();
    expect(dlg().querySelector('[data-testid="dialog-error"]').textContent).toContain('denied');
  });

  it('shows an empty-state when the library is empty', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    openSettings(fixture);
    expect(dlg().querySelector('[data-testid="library-empty"]')).toBeTruthy();
  });
});


describe('SwingAnalysisPageComponent — symbol nav', () => {
  it('renders prev/next, current symbol, and position in the nav sequence', async () => {
    const { fixture } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), ['AAPL', 'MSFT', 'QQQ']);
    fixture.detectChanges();

    expect((fixture.nativeElement.querySelector('[data-testid="nav-picker"]') as HTMLInputElement).value).toBe('QQQ');
    // Sorted sequence [AAPL, MSFT, QQQ] — QQQ is last.
    expect(fixture.nativeElement.querySelector('[data-testid="nav-position"]').textContent).toContain('3 of 3');
  });

  it('next/prev step through the sequence and wrap at the ends', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), ['AAPL', 'MSFT', 'QQQ']);
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
      makeBars(40), undefined, mockSwingAnalysisService(),
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
      makeBars(40), undefined, mockSwingAnalysisService(),
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
});

// =============================================================================
// Symbol picker — permanent autocomplete in the nav row
// =============================================================================

describe('SwingAnalysisPageComponent — symbol picker', () => {
  const PROFILES: StSymbolProfile[] = [
    { symbol: 'AAPL', enabled: true, createdAt: '', name: 'Apple Inc.' },
    { symbol: 'MSFT', enabled: true, createdAt: '', name: 'Microsoft Corp.' },
    { symbol: 'TSLA', enabled: true, createdAt: '', name: 'Tesla Inc.' },
  ];
  const UNIVERSE = ['AAPL', 'MSFT', 'QQQ', 'TSLA'];

  function picker(fixture: ComponentFixture<SwingAnalysisPageComponent>): HTMLInputElement {
    return fixture.nativeElement.querySelector('[data-testid="nav-picker"]');
  }
  function overlayOptions(): HTMLElement[] {
    return Array.from(document.querySelectorAll('mat-option')) as HTMLElement[];
  }
  async function openAndType(fixture: ComponentFixture<SwingAnalysisPageComponent>, text: string): Promise<void> {
    const input = picker(fixture);
    input.dispatchEvent(new Event('focusin'));
    input.value = text;
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();
  }

  it('shows the current symbol in the picker input', async () => {
    const { fixture } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE);
    fixture.detectChanges();
    expect(picker(fixture).value).toBe('QQQ');
  });

  it('filters options by ticker AND company name', async () => {
    const { fixture } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE, {}, PROFILES);
    fixture.detectChanges();
    await openAndType(fixture, 'tesla');
    const opts = overlayOptions();
    expect(opts.length).toBe(1);
    expect(opts[0].textContent).toContain('TSLA');
    expect(opts[0].textContent).toContain('Tesla Inc.');
  });

  it('selecting a dropdown option commits the symbol', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE, {}, PROFILES);
    fixture.detectChanges();
    await openAndType(fixture, 'tesla');
    (overlayOptions()[0] as HTMLElement).click();
    fixture.detectChanges();
    expect(store.symbol()).toBe('TSLA');
    expect(picker(fixture).value).toBe('TSLA');
  });

  it('Enter on an exact tracked ticker commits', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE, {}, PROFILES);
    fixture.detectChanges();
    const input = picker(fixture);
    input.value = 'msft';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(store.symbol()).toBe('MSFT');
  });

  it('Enter on a unique company-name match commits that option', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE, {}, PROFILES);
    fixture.detectChanges();
    const input = picker(fixture);
    input.value = 'tesla';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(store.symbol()).toBe('TSLA');
  });

  it('untracked input reverts on Enter — never navigates', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE, {}, PROFILES);
    fixture.detectChanges();
    const input = picker(fixture);
    input.value = 'SCAM';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(store.symbol()).toBe('QQQ');
    expect(picker(fixture).value).toBe('QQQ');
  });

  it('Escape reverts to the current symbol', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE, {}, PROFILES);
    fixture.detectChanges();
    const input = picker(fixture);
    input.value = 'tesla';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(store.symbol()).toBe('QQQ');
    expect(picker(fixture).value).toBe('QQQ');
  });

  it('Enter honors a keyboard-highlighted option over the typed text', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE, {}, PROFILES);
    fixture.detectChanges();
    await openAndType(fixture, 'msft');
    const input = picker(fixture);
    // ArrowDown highlights the first filtered option; Enter should commit
    // it via optionSelected — the typed query must not win.
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
    fixture.detectChanges();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    fixture.detectChanges();
    expect(store.symbol()).toBe('MSFT');
  });

  it('blur without a selection reverts to the current symbol', async () => {
    const { fixture, store } = await setupPage(makeBars(40), undefined, mockSwingAnalysisService(), UNIVERSE, {}, PROFILES);
    fixture.detectChanges();
    const input = picker(fixture);
    input.value = 'garbage';
    input.dispatchEvent(new Event('input'));
    input.dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(store.symbol()).toBe('QQQ');
    expect(picker(fixture).value).toBe('QQQ');
  });

  it('is disabled while the tracked universe is empty', async () => {
    const { fixture } = await setupPage();
    fixture.detectChanges();
    expect(picker(fixture).disabled).toBe(true);
  });
});

// =============================================================================
// Company info strip — header metadata bound to the profile map
// =============================================================================

describe('SwingAnalysisPageComponent — company info strip', () => {
  const PROFILES: StSymbolProfile[] = [
    { symbol: 'AAPL', enabled: true, createdAt: '', name: 'Apple Inc.', sector: 'Technology' },
    { symbol: 'MSFT', enabled: true, createdAt: '', name: 'Microsoft Corp.', sector: 'Technology' },
    { symbol: 'QQQ', enabled: true, createdAt: '', name: 'Invesco QQQ Trust' },
  ];

  it('shows the current symbol profile in the header and updates on setSymbol', async () => {
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(),
      ['AAPL', 'MSFT', 'QQQ'], {}, PROFILES,
    );
    fixture.detectChanges();

    const strip = () => (fixture.nativeElement.querySelector('[data-testid="company-info"]') as HTMLElement).textContent ?? '';
    expect(strip()).toContain('QQQ — Invesco QQQ Trust');

    store.setSymbol('MSFT');
    fixture.detectChanges();
    expect(strip()).toContain('MSFT — Microsoft Corp.');
    expect(strip()).toContain('Technology');
  });

  it('shows ticker + dashes for a tracked symbol with no synced profile', async () => {
    const { fixture, store } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(),
      ['AAPL', 'MSFT', 'NEWCO', 'QQQ'], {}, PROFILES,
    );
    fixture.detectChanges();

    store.setSymbol('NEWCO');
    fixture.detectChanges();
    const t = fixture.nativeElement.querySelector('[data-testid="company-info"]').textContent;
    expect(t).toContain('NEWCO');
    expect(t).not.toContain('Apple');
    expect(t).toContain('—');
  });

  it('watchlist filter renders catalog groups and includes user lists dynamically', async () => {
    const { fixture } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(), ['QQQ'],
      { 'my-picks': ['QQQ'] },
    );
    fixture.detectChanges();

    const select = fixture.nativeElement.querySelector('[data-testid="nav-filter"]') as HTMLSelectElement;
    const groups = Array.from(select.querySelectorAll('optgroup'));
    expect(groups.map((group) => group.label)).toEqual(['Triage', 'My lists']);
    const values = Array.from(select.querySelectorAll('option')).map((o) => (o as HTMLOptionElement).value);
    expect(values).toEqual(['ALL', 'NEW', 'PRIMARY', 'SECONDARY', 'NEUTRAL', 'AVOID', 'HIDE', 'NO_MEMBERSHIP', 'MONITOR', 'my-picks']);
    expect(select.textContent).toContain('Not triaged');
    expect(select.textContent).toContain('my-picks');
  });

  it('renders the watchlist chip row bound to the current symbol', async () => {
    const { fixture } = await setupPage(
      makeBars(40), undefined, mockSwingAnalysisService(), ['QQQ'],
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
      makeBars(40), undefined, mockSwingAnalysisService(), ['QQQ'], { 'PRIMARY': [] },
    );
    fixture.detectChanges();
    const listStore = TestBed.inject(SymbolListStore);

    const chip = fixture.nativeElement.querySelector(
      '[data-testid="nav-list-actions"] button.primary',
    ) as HTMLButtonElement;
    chip.click();
    expect(listStore.toggleSymbolInList).toHaveBeenCalledWith('QQQ', 'PRIMARY');
  });

  it('loads symbol lists on mount when cold', async () => {
    await setupPage();
    const listStore = TestBed.inject(SymbolListStore);
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
    const { fixture, store } = await setupPage(makeBars(40), chart, mockSwingAnalysisService(), ['AAPL', 'BAD', 'QQQ']);
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
