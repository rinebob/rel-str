/**
 * ScannerComponent page-filter spec (#1098/#1305) — the All/New/Tracked
 * tri-state. Split from scanner.component.spec.ts (file-size guideline):
 * the filter block carries its own fixtures (wireResultRow, successRun,
 * filterPills) and adds the tracked-universe readiness gate (pills
 * disabled until the universe resolves or while it is failed — review
 * finding M1: a filtered count against an absent set is silently wrong).
 *
 * Store is mocked at the boundary with plain signals; `trackedStatus`
 * drives the readiness gate the specs exercise directly.
 */
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { DsToastService } from '../../../../shared/ds/ds-toast.service';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ScannerComponent } from './scanner.component';
import {
  ScannerStore,
  type RecipeRunState,
  type ScannerError,
} from '../../stores/scanner.store';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { SCANNER_RECIPES } from '../../scanner/scanner-recipes';
import type { ScanResultRow } from '@robinhood-mcp/contracts';

const idleRun = (): RecipeRunState => ({
  status: 'idle',
  result: null,
  ranAt: null,
  errorKind: null,
});

const idleRuns = (): Record<string, RecipeRunState> =>
  Object.fromEntries(SCANNER_RECIPES.map((r) => [r.id, idleRun()]));

/** Wire-row factory — produces ScanResultRow (the RH wire shape), NOT
 *  the page's ScanRow (wireRowToScanRow's product). */
const wireResultRow = (
  ticker: string,
  columns: Record<string, string> = {},
): ScanResultRow => ({
  ticker,
  instrument_id: `iid-${ticker.toLowerCase()}`,
  instrument_type: 'EQUITY',
  columns,
});

const successRun = (
  results: ScanResultRow[],
  totalItems = results.length,
): RecipeRunState => ({
  status: 'success',
  result: { total_items: totalItems, results },
  ranAt: '2026-10-22T14:30:00Z',
  errorKind: null,
});

describe('ScannerComponent page filter (#1305 All/New/Tracked)', () => {
  let fixture: ComponentFixture<ScannerComponent>;
  let storeMock: {
    recipes: ReturnType<typeof signal<typeof SCANNER_RECIPES>>;
    runs: ReturnType<typeof signal<Record<string, RecipeRunState>>>;
    authFailed: ReturnType<typeof signal<boolean>>;
    runsLoading: ReturnType<typeof signal<boolean>>;
    requiresReauth: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<ScannerError | null>>;
    runAllRecipes: jest.Mock;
    refreshRecipe: jest.Mock;
    clearError: jest.Mock;
  };
  let symbolListsMock: {
    trackedSymbols: ReturnType<typeof signal<string[]>>;
    trackedStatus: ReturnType<
      typeof signal<'idle' | 'loading' | 'ready' | 'error'>
    >;
    loadTrackedSymbols: jest.Mock;
  };
  let mcpMock: { reauthenticate: jest.Mock };
  let snackBarMock: { open: jest.Mock };

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function els(selector: string): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll(selector)];
  }

  const filterPills = () => els('[data-testid^="filter-"]');
  const railCount = (i: number) =>
    els('.rail-item')[i].querySelector('.rail-count')!.textContent;
  const railTickers = (i: number) =>
    els('.rail-item')[i].querySelector('.rail-tickers')!.textContent;

  beforeEach(async () => {
    storeMock = {
      recipes: signal(SCANNER_RECIPES),
      runs: signal(idleRuns()),
      authFailed: signal(false),
      runsLoading: signal(false),
      requiresReauth: signal(false),
      error: signal<ScannerError | null>(null),
      runAllRecipes: jest.fn(),
      refreshRecipe: jest.fn(),
      clearError: jest.fn(),
    };
    symbolListsMock = {
      trackedSymbols: signal<string[]>([]),
      trackedStatus: signal<'idle' | 'loading' | 'ready' | 'error'>('ready'),
      loadTrackedSymbols: jest.fn().mockResolvedValue(['AAPL']),
    };
    mcpMock = { reauthenticate: jest.fn() };
    snackBarMock = { open: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [ScannerComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: ScannerStore, useValue: storeMock },
        { provide: SymbolListStore, useValue: symbolListsMock },
        { provide: RobinhoodMcpObservationService, useValue: mcpMock },
        { provide: DsToastService, useValue: snackBarMock },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ScannerComponent);
  });

  it('header renders a tri-state All/New/Tracked control; all is the active default', () => {
    fixture.detectChanges();
    const pills = filterPills();
    expect(pills.map((p) => p.textContent!.trim())).toEqual([
      'All',
      'New',
      'Tracked',
    ]);
    expect(pills[0].getAttribute('aria-pressed')).toBe('true');
    expect(pills[1].getAttribute('aria-pressed')).toBe('false');
    expect(pills[2].getAttribute('aria-pressed')).toBe('false');
  });

  it('new filters rail counts + tickers to untracked rows; tracked inverts; all restores', () => {
    symbolListsMock.trackedSymbols.set(['AAA', 'BBB']);
    const runs = idleRuns();
    runs[SCANNER_RECIPES[0].id] = successRun(
      [wireResultRow('AAA'), wireResultRow('BBB'), wireResultRow('NEWX')],
      9,
    );
    storeMock.runs.set(runs);
    fixture.detectChanges();
    expect(railCount(0)).toBe('3 / 9');

    filterPills()[1].click();
    fixture.detectChanges();
    expect(railCount(0)).toBe('1 / 9');
    expect(railTickers(0)).toBe('NEWX');
    expect(filterPills()[1].getAttribute('aria-pressed')).toBe('true');

    filterPills()[2].click();
    fixture.detectChanges();
    expect(railCount(0)).toBe('2 / 9');
    expect(railTickers(0)).toContain('AAA');
    expect(railTickers(0)).not.toContain('NEWX');

    filterPills()[0].click();
    fixture.detectChanges();
    expect(railCount(0)).toBe('3 / 9');
  });

  it("the selected recipe's table receives the filter — new hides tracked rows", () => {
    symbolListsMock.trackedSymbols.set(['AAA', 'BBB']);
    const runs = idleRuns();
    runs[SCANNER_RECIPES[0].id] = successRun([
      wireResultRow('AAA'),
      wireResultRow('BBB'),
      wireResultRow('NEWX'),
    ]);
    storeMock.runs.set(runs);
    fixture.detectChanges();

    filterPills()[1].click();
    fixture.detectChanges();
    const table = el('app-scanner-recipe-table')!;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(table.querySelector('td.symbol')!.textContent).toBe('NEWX');
  });

  it('a new-mode recipe with zero untracked hits shows the empty state, not a crash', () => {
    symbolListsMock.trackedSymbols.set(['AAA', 'BBB']);
    const runs = idleRuns();
    runs[SCANNER_RECIPES[0].id] = successRun([
      wireResultRow('AAA'),
      wireResultRow('BBB'),
    ]);
    storeMock.runs.set(runs);
    fixture.detectChanges();

    filterPills()[1].click();
    fixture.detectChanges();
    expect(railCount(0)).toBe('0 / 2');
    expect(el('.table-empty')!.textContent).toContain('No matching symbols');
  });

  it('the filter survives switching the rail selection', () => {
    symbolListsMock.trackedSymbols.set(['AAA']);
    const runs = idleRuns();
    runs[SCANNER_RECIPES[0].id] = successRun([
      wireResultRow('AAA'),
      wireResultRow('NEWX'),
    ]);
    runs[SCANNER_RECIPES[1].id] = successRun([
      wireResultRow('AAA'),
      wireResultRow('NEWY'),
    ]);
    storeMock.runs.set(runs);
    fixture.detectChanges();

    filterPills()[1].click();
    fixture.detectChanges();
    els('.rail-item')[1].click();
    fixture.detectChanges();

    const table = el('app-scanner-recipe-table')!;
    expect(table.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(table.querySelector('td.symbol')!.textContent).toBe('NEWY');
    expect(filterPills()[1].getAttribute('aria-pressed')).toBe('true');
  });

  it('a filtered rail count carries a title qualifying N against the universe total', () => {
    symbolListsMock.trackedSymbols.set(['AAA', 'BBB']);
    const runs = idleRuns();
    runs[SCANNER_RECIPES[0].id] = successRun(
      [wireResultRow('AAA'), wireResultRow('BBB'), wireResultRow('NEWX')],
      900,
    );
    storeMock.runs.set(runs);
    fixture.detectChanges();

    filterPills()[1].click();
    fixture.detectChanges();
    const countEl = els('.rail-item')[0].querySelector('.rail-count')!;
    expect(countEl.textContent).toBe('1 / 900');
    expect(countEl.getAttribute('title')).toContain('1 of 900 scan hits');
  });

  // ── tracked-universe readiness gate (review M1) ───────────────────

  it('New/Tracked pills stay disabled while the tracked universe is loading', () => {
    symbolListsMock.trackedStatus.set('loading');
    fixture.detectChanges();
    const pills = filterPills() as HTMLButtonElement[];
    expect(pills[0].disabled).toBe(false); // All never needs the universe
    expect(pills[1].disabled).toBe(true);
    expect(pills[2].disabled).toBe(true);

    symbolListsMock.trackedStatus.set('ready');
    fixture.detectChanges();
    expect((filterPills() as HTMLButtonElement[])[1].disabled).toBe(false);
  });

  it('New/Tracked pills stay disabled after a tracked-universe load failure', () => {
    symbolListsMock.trackedStatus.set('error');
    fixture.detectChanges();
    const pills = filterPills() as HTMLButtonElement[];
    expect(pills[0].disabled).toBe(false);
    expect(pills[1].disabled).toBe(true);
    expect(pills[2].disabled).toBe(true);
    // And an all-mode scoreboard still renders — the filter refusing is
    // not the page failing.
    expect(el('[data-testid="run-all"]')).not.toBeNull();
  });
});
