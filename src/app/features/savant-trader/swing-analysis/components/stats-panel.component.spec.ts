import { Component, Input, provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StatsPanelComponent, StatsSets } from './stats-panel.component';
import type { SwingStats } from '../../../shared/components/flex-chart/indicators/st-zigzag.types';

function makeStats(overrides: Partial<SwingStats> = {}): SwingStats {
  return {
    up: {
      count: 3,
      magnitudePercent: { mean: 10, median: 10, stdDev: 1, min: 8, max: 12, p10: 8, p25: 9, p50: 10, p75: 11, p90: 12 },
      magnitudeAbsolute: { mean: 10, median: 10, stdDev: 1, min: 8, max: 12, p10: 8, p25: 9, p50: 10, p75: 11, p90: 12 },
      duration: { mean: 5, median: 5, stdDev: 1, min: 4, max: 6, p10: 4, p25: 4, p50: 5, p75: 6, p90: 6 },
      magnitudeHistogram: { bins: [{ label: '8-9', count: 1, lower: 8, upper: 9 }, { label: '9-10', count: 1, lower: 9, upper: 10 }, { label: '10-11', count: 0, lower: 10, upper: 11 }, { label: '11-12', count: 1, lower: 11, upper: 12 }] },
      durationHistogram: { bins: [{ label: '4-5', count: 1, lower: 4, upper: 5 }, { label: '5-6', count: 2, lower: 5, upper: 6 }] },
    },
    down: {
      count: 2,
      magnitudePercent: { mean: -5, median: -5, stdDev: 1, min: -6, max: -4, p10: -6, p25: -5, p50: -5, p75: -4, p90: -4 },
      magnitudeAbsolute: { mean: 5, median: 5, stdDev: 1, min: 4, max: 6, p10: 4, p25: 4, p50: 5, p75: 6, p90: 6 },
      duration: { mean: 4, median: 4, stdDev: 1, min: 3, max: 5, p10: 3, p25: 3, p50: 4, p75: 5, p90: 5 },
      magnitudeHistogram: { bins: [{ label: '4-5', count: 1, lower: 4, upper: 5 }, { label: '5-6', count: 1, lower: 5, upper: 6 }] },
      durationHistogram: { bins: [{ label: '3-4', count: 1, lower: 3, upper: 4 }, { label: '4-5', count: 1, lower: 4, upper: 5 }] },
    },
    ...overrides,
  };
}

/** Read a stats block's label→value pairs into a Map for precise assertions. */
function readFieldMap(fixture: ComponentFixture<HostComponent>, selector: string): Map<string, string> {
  const block = fixture.nativeElement.querySelector(selector);
  if (!block) throw new Error(`No element found for selector ${selector}`);
  const rows = block.querySelectorAll('.stats-field');
  const map = new Map<string, string>();
  rows.forEach((row: Element) => {
    const label = row.querySelector('.stats-field-label')?.textContent?.trim() ?? '';
    const value = row.querySelector('.stats-field-value')?.textContent?.trim() ?? '';
    map.set(label, value);
  });
  return map;
}

/** Host component that binds inputs via template — needed because jest-preset-angular
 *  doesn't support ComponentRef.setInput() with signal-based input(). (setInput
 *  DOES work on the host's own decorator inputs — used in the revert test.) */
@Component({
  standalone: true,
  imports: [StatsPanelComponent],
  template: `<app-stats-panel [stats]="stats" [statsSets]="statsSets" [loading]="loading" />`,
})
class HostComponent {
  @Input() stats: SwingStats | null = null;
  @Input() statsSets: StatsSets | null = null;
  @Input() loading = false;
}

describe('StatsPanelComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [provideZonelessChangeDetection()],
    }).compileComponents();

    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
  });

  afterEach(() => TestBed.resetTestingModule());

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  it('creates', () => {
    fixture.detectChanges();
    expect(fixture.nativeElement).toBeTruthy();
  });

  it('renders a loading indicator when loading', () => {
    host.loading = true;
    fixture.detectChanges();

    const loading = fixture.nativeElement.querySelector('.stats-panel-loading');
    expect(loading).toBeTruthy();
    expect(loading.textContent).toContain('Computing stats');
  });

  it('renders an empty state when stats are null', () => {
    host.stats = null;
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.stats-panel-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No stats');
  });

  it('renders an empty state when stats have zero swings', () => {
    host.stats = makeStats({
      up: { count: 0, magnitudePercent: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }, magnitudeAbsolute: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }, duration: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }, magnitudeHistogram: { bins: [] }, durationHistogram: { bins: [] } },
      down: { count: 0, magnitudePercent: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }, magnitudeAbsolute: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }, duration: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 }, magnitudeHistogram: { bins: [] }, durationHistogram: { bins: [] } },
    });
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.stats-panel-empty');
    expect(empty).toBeTruthy();
    expect(empty.textContent).toContain('No stats');
  });

  // -------------------------------------------------------------------------
  // Distribution summary
  // -------------------------------------------------------------------------

  it('renders up and down direction sections', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const sections = fixture.nativeElement.querySelectorAll('.stats-direction');
    expect(sections.length).toBe(2);
    expect(sections[0].textContent).toContain('Up');
    expect(sections[1].textContent).toContain('Down');
  });

  it('renders count for each direction', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const upSection = fixture.nativeElement.querySelector('.stats-direction-up');
    expect(upSection.textContent).toContain('3');

    const downSection = fixture.nativeElement.querySelector('.stats-direction-down');
    expect(downSection.textContent).toContain('2');
  });

  it('renders magnitude % distribution summary values for up swings', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const fields = readFieldMap(fixture, '.stats-direction-up .stats-block-magnitude-percent');
    // Up magnitude %: mean 10, median 10, stdDev 1, min 8, max 12, p10 8, p25 9, p50 10, p75 11, p90 12
    expect(fields.get('Mean')).toBe('10.00');
    expect(fields.get('Median')).toBe('10.00');
    expect(fields.get('Std Dev')).toBe('1.00');
    expect(fields.get('Min')).toBe('8.00');
    expect(fields.get('Max')).toBe('12.00');
    expect(fields.get('P10')).toBe('8.00');
    expect(fields.get('P25')).toBe('9.00');
    expect(fields.get('P50')).toBe('10.00');
    expect(fields.get('P75')).toBe('11.00');
    expect(fields.get('P90')).toBe('12.00');
  });

  it('renders magnitude $ distribution summary values for up swings', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const fields = readFieldMap(fixture, '.stats-direction-up .stats-block-magnitude-absolute');
    // Up magnitude $: same numeric values as magnitude %
    expect(fields.get('Mean')).toBe('10.00');
    expect(fields.get('Min')).toBe('8.00');
    expect(fields.get('Max')).toBe('12.00');
  });

  it('renders duration distribution summary values for up swings', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const fields = readFieldMap(fixture, '.stats-direction-up .stats-block-duration');
    // Up duration: mean 5, median 5, stdDev 1, min 4, max 6, p10 4, p25 4, p50 5, p75 6, p90 6
    expect(fields.get('Mean')).toBe('5.0');
    expect(fields.get('Median')).toBe('5.0');
    expect(fields.get('Std Dev')).toBe('1.0');
    expect(fields.get('Min')).toBe('4.0');
    expect(fields.get('Max')).toBe('6.0');
    expect(fields.get('P10')).toBe('4.0');
    expect(fields.get('P25')).toBe('4.0');
    expect(fields.get('P50')).toBe('5.0');
    expect(fields.get('P75')).toBe('6.0');
    expect(fields.get('P90')).toBe('6.0');
  });

  it('renders distribution summary values for down swings', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const fields = readFieldMap(fixture, '.stats-direction-down .stats-block-magnitude-percent');
    // Down magnitude %: mean -5, median -5, stdDev 1, min -6, max -4
    expect(fields.get('Mean')).toBe('-5.00');
    expect(fields.get('Median')).toBe('-5.00');
    expect(fields.get('Std Dev')).toBe('1.00');
    expect(fields.get('Min')).toBe('-6.00');
    expect(fields.get('Max')).toBe('-4.00');
  });

  it('renders all distribution summary field labels (mean, median, stdDev, min, max, percentiles)', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const upSection = fixture.nativeElement.querySelector('.stats-direction-up');
    const magPercentBlock = upSection.querySelector('.stats-block-magnitude-percent');
    const labels = magPercentBlock.querySelectorAll('.stats-field-label');
    const labelTexts: string[] = [];
    labels.forEach((l: Element) => labelTexts.push((l.textContent ?? '').trim()));
    expect(labelTexts).toEqual([
      'Mean', 'Median', 'Std Dev', 'Min', 'Max',
      'P10', 'P25', 'P50', 'P75', 'P90',
    ]);
  });

  // -------------------------------------------------------------------------
  // Histograms
  // -------------------------------------------------------------------------

  it('renders histogram chart containers for each direction', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const charts = fixture.nativeElement.querySelectorAll('.stats-histogram');
    // 2 directions × 2 histograms (magnitude + duration) = 4
    expect(charts.length).toBe(4);
  });

  it('renders Syncfusion ejs-chart for up magnitude histogram', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const upMag = fixture.nativeElement.querySelector('.stats-direction-up .stats-histogram-magnitude');
    const chart = upMag.querySelector('ejs-chart');
    expect(chart).toBeTruthy();
    // e-series is an Angular directive consumed by Syncfusion; verify via debugElement.
    const chartDebug = fixture.debugElement.query((el) => el.nativeElement === chart);
    expect(chartDebug).toBeTruthy();
    // The chart component instance is a Syncfusion ChartComponent.
    expect(chartDebug.componentInstance).toBeTruthy();
  });

  it('renders Syncfusion ejs-chart for up duration histogram', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const upDur = fixture.nativeElement.querySelector('.stats-direction-up .stats-histogram-duration');
    const chart = upDur.querySelector('ejs-chart');
    expect(chart).toBeTruthy();
  });

  it('renders Syncfusion ejs-chart for down magnitude histogram', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const downMag = fixture.nativeElement.querySelector('.stats-direction-down .stats-histogram-magnitude');
    const chart = downMag.querySelector('ejs-chart');
    expect(chart).toBeTruthy();
  });

  it('renders magnitude histogram for up swings', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const upSection = fixture.nativeElement.querySelector('.stats-direction-up');
    const magHistogram = upSection.querySelector('.stats-histogram-magnitude');
    expect(magHistogram).toBeTruthy();
  });

  it('renders duration histogram for up swings', () => {
    host.stats = makeStats();
    fixture.detectChanges();

    const upSection = fixture.nativeElement.querySelector('.stats-direction-up');
    const durationHistogram = upSection.querySelector('.stats-histogram-duration');
    expect(durationHistogram).toBeTruthy();
  });

  it('renders empty magnitude histogram placeholder when bins are empty', () => {
    host.stats = makeStats({
      up: {
        count: 1,
        magnitudePercent: { mean: 10, median: 10, stdDev: 0, min: 10, max: 10, p10: 10, p25: 10, p50: 10, p75: 10, p90: 10 },
        magnitudeAbsolute: { mean: 10, median: 10, stdDev: 0, min: 10, max: 10, p10: 10, p25: 10, p50: 10, p75: 10, p90: 10 },
        duration: { mean: 5, median: 5, stdDev: 0, min: 5, max: 5, p10: 5, p25: 5, p50: 5, p75: 5, p90: 5 },
        magnitudeHistogram: { bins: [] },
        durationHistogram: { bins: [] },
      },
      down: {
        count: 0,
        magnitudePercent: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        magnitudeAbsolute: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        duration: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        magnitudeHistogram: { bins: [] },
        durationHistogram: { bins: [] },
      },
    });
    fixture.detectChanges();

    const upSection = fixture.nativeElement.querySelector('.stats-direction-up');
    const magHistogram = upSection.querySelector('.stats-histogram-magnitude');
    // When bins are empty, a placeholder message should show instead of a chart
    expect(magHistogram.textContent).toContain('No data');
    expect(magHistogram.querySelector('ejs-chart')).toBeFalsy();
  });

  it('renders empty duration histogram placeholder when bins are empty', () => {
    host.stats = makeStats({
      up: {
        count: 1,
        magnitudePercent: { mean: 10, median: 10, stdDev: 0, min: 10, max: 10, p10: 10, p25: 10, p50: 10, p75: 10, p90: 10 },
        magnitudeAbsolute: { mean: 10, median: 10, stdDev: 0, min: 10, max: 10, p10: 10, p25: 10, p50: 10, p75: 10, p90: 10 },
        duration: { mean: 5, median: 5, stdDev: 0, min: 5, max: 5, p10: 5, p25: 5, p50: 5, p75: 5, p90: 5 },
        magnitudeHistogram: { bins: [] },
        durationHistogram: { bins: [] },
      },
      down: {
        count: 0,
        magnitudePercent: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        magnitudeAbsolute: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        duration: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        magnitudeHistogram: { bins: [] },
        durationHistogram: { bins: [] },
      },
    });
    fixture.detectChanges();

    const upSection = fixture.nativeElement.querySelector('.stats-direction-up');
    const durHistogram = upSection.querySelector('.stats-histogram-duration');
    expect(durHistogram.textContent).toContain('No data');
    expect(durHistogram.querySelector('ejs-chart')).toBeFalsy();
  });

  it('formats small magnitude values with enough precision to not look like zero', () => {
    host.stats = makeStats({
      up: {
        count: 1,
        magnitudePercent: { mean: 0.005, median: 0.005, stdDev: 0, min: 0.005, max: 0.005, p10: 0.005, p25: 0.005, p50: 0.005, p75: 0.005, p90: 0.005 },
        magnitudeAbsolute: { mean: 0.005, median: 0.005, stdDev: 0, min: 0.005, max: 0.005, p10: 0.005, p25: 0.005, p50: 0.005, p75: 0.005, p90: 0.005 },
        duration: { mean: 5, median: 5, stdDev: 0, min: 5, max: 5, p10: 5, p25: 5, p50: 5, p75: 5, p90: 5 },
        magnitudeHistogram: { bins: [] },
        durationHistogram: { bins: [] },
      },
      down: {
        count: 0,
        magnitudePercent: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        magnitudeAbsolute: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        duration: { mean: 0, median: 0, stdDev: 0, min: 0, max: 0, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 },
        magnitudeHistogram: { bins: [] },
        durationHistogram: { bins: [] },
      },
    });
    fixture.detectChanges();

    const fields = readFieldMap(fixture, '.stats-direction-up .stats-block-magnitude-percent');
    expect(fields.get('Mean')).toBe('0.0050');
    // A value of 0.005 must not render as "0.00"
    expect(fields.get('Mean')).not.toBe('0.00');
  });

  // -------------------------------------------------------------------------
  // State precedence
  // -------------------------------------------------------------------------

  it('loading state takes precedence over stats', () => {
    host.stats = makeStats();
    host.loading = true;
    fixture.detectChanges();

    const loading = fixture.nativeElement.querySelector('.stats-panel-loading');
    const content = fixture.nativeElement.querySelector('.stats-panel-content');
    expect(loading).toBeTruthy();
    expect(content).toBeFalsy();
  });

  it('empty state takes precedence when stats are null even if loading is false', () => {
    host.stats = null;
    host.loading = false;
    fixture.detectChanges();

    const empty = fixture.nativeElement.querySelector('.stats-panel-empty');
    const content = fixture.nativeElement.querySelector('.stats-panel-content');
    expect(empty).toBeTruthy();
    expect(content).toBeFalsy();
  });

  // =========================================================================
  // Dual mode — Large / Small / All toggle
  // =========================================================================

  /** Stats fixture with distinct counts per set so the active set is identifiable.
   *  Empty histogram bins — ejs-chart is skipped via the bins.length @if gate.
   *  Syncfusion's ngAfterContentChecked crashes in Jest when a chart's
   *  [dataSource] changes after init; histogram rendering is covered by the
   *  single-mode tests above, so dual-mode fixtures bypass charts. */
  function makeStatsWithCounts(upCount: number, downCount: number): SwingStats {
    const s = makeStats();
    s.up.count = upCount;
    s.down.count = downCount;
    s.up.magnitudeHistogram = { bins: [] };
    s.up.durationHistogram = { bins: [] };
    s.down.magnitudeHistogram = { bins: [] };
    s.down.durationHistogram = { bins: [] };
    return s;
  }

  const LARGE_STATS = () => makeStatsWithCounts(3, 2);
  const SMALL_STATS = () => makeStatsWithCounts(10, 7);
  const ALL_STATS = () => makeStatsWithCounts(13, 9);

  function setupDual(): void {
    host.stats = null;
    host.statsSets = [LARGE_STATS(), SMALL_STATS(), ALL_STATS()];
    fixture.detectChanges();
  }

  /** "Up (N)" count rendered in the up-direction section title. */
  const upCountText = () =>
    (fixture.nativeElement.querySelector('.stats-direction-up .stats-direction-title') as HTMLElement)
      ?.textContent?.trim() ?? '';

  it('does not render the toggle in single mode', () => {
    host.stats = makeStats();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.stats-toggle')).toBeNull();
  });

  it('renders the segmented toggle in dual mode', () => {
    setupDual();
    const btns = fixture.nativeElement.querySelectorAll('.stats-toggle-btn');
    expect(btns.length).toBe(3);
    expect(btns[0].textContent.trim()).toBe('Large');
    expect(btns[1].textContent.trim()).toBe('Small');
    expect(btns[2].textContent.trim()).toBe('All');
    expect(btns[0].classList.contains('active')).toBe(true); // Large default
  });

  it('shows large (config 0) stats by default', () => {
    setupDual();
    expect(upCountText()).toBe('Up (3)');
  });

  it('shows small stats when Small is clicked', () => {
    setupDual();
    (fixture.nativeElement.querySelector('[data-testid="stats-mode-small"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(upCountText()).toBe('Up (10)');
    const btns = fixture.nativeElement.querySelectorAll('.stats-toggle-btn');
    expect(btns[1].classList.contains('active')).toBe(true);
    expect(btns[0].classList.contains('active')).toBe(false);
  });

  it('shows combined stats when All is clicked', () => {
    setupDual();
    (fixture.nativeElement.querySelector('[data-testid="stats-mode-all"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(upCountText()).toBe('Up (13)');
  });

  it('switches back to Large after Small', () => {
    setupDual();
    (fixture.nativeElement.querySelector('[data-testid="stats-mode-small"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="stats-mode-large"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(upCountText()).toBe('Up (3)');
  });

  it('keeps the toggle visible when the active set is null', () => {
    host.statsSets = [LARGE_STATS(), null, LARGE_STATS()];
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="stats-mode-small"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    // Small set is null → empty state, but toggle must remain usable.
    expect(fixture.nativeElement.querySelector('.stats-panel-empty')).toBeTruthy();
    const toggle = fixture.nativeElement.querySelector('.stats-toggle');
    expect(toggle).toBeTruthy();
    (fixture.nativeElement.querySelector('[data-testid="stats-mode-large"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(upCountText()).toBe('Up (3)');
  });

  it('reverts to single-mode display when statsSets returns to null', () => {
    setupDual();
    expect(fixture.nativeElement.querySelector('.stats-toggle')).toBeTruthy();

    fixture.componentRef.setInput('statsSets', null);
    fixture.componentRef.setInput('stats', makeStatsWithCounts(5, 4));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.stats-toggle')).toBeNull();
    expect(upCountText()).toBe('Up (5)');
  });

  it('prefers statsSets over stats when both are bound (dual mode)', () => {
    // The page always binds both inputs; statsSets must win in dual mode.
    host.stats = makeStatsWithCounts(99, 98);
    host.statsSets = [LARGE_STATS(), SMALL_STATS(), ALL_STATS()];
    fixture.detectChanges();
    expect(upCountText()).toBe('Up (3)'); // statsSets[0], not stats
  });

  it('remembers statsMode across dual off→on (component-state persistence)', () => {
    setupDual();
    (fixture.nativeElement.querySelector('[data-testid="stats-mode-small"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(upCountText()).toBe('Up (10)');

    // Dual off → on: statsSets goes null then a new array.
    fixture.componentRef.setInput('statsSets', null);
    fixture.detectChanges();
    fixture.componentRef.setInput('statsSets', [LARGE_STATS(), SMALL_STATS(), ALL_STATS()]);
    fixture.detectChanges();
    // statsMode is component state — it survives the off→on transition.
    expect(upCountText()).toBe('Up (10)');
  });
});
