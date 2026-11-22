/**
 * ScannerComponent spec (#1098/#1199) — the auto-run overview page.
 *
 * Store is mocked at the boundary with plain signals (the page only
 * reads signals + calls methods). Covers: init wiring (runAllRecipes +
 * loadTrackedSymbols + 15-min interval arm/clear), the rail + detail
 * body (scoreboard rail → selected recipe's table), the Run all gate +
 * last-refresh readout, per-table refresh delegation, and the AUTH
 * reauth banner on authFailed.
 */
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { DatePipe } from '@angular/common';

import { ScannerComponent } from './scanner.component';
import { ScannerRecipeTableComponent } from './scanner-recipe-table.component';
import {
  ScannerStore,
  type RecipeRunState,
  type ScannerError,
} from '../../stores/scanner.store';
import { SymbolListStore } from '../../stores/symbol-list.store';
import type { SymbolListDef } from '../../common/symbol-list-defs';
import type {
  PreviewScanResult,
  ScanResultRow,
} from '@robinhood-mcp/contracts';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { SCANNER_RECIPES } from '../../scanner/scanner-recipes';

// Literal — pins the PRD's 15-min contract (a cadence change must fail
// this spec, so it deliberately does NOT import the component const).
const REFRESH_MS = 15 * 60 * 1000;

const idleRun = (): RecipeRunState => ({
  status: 'idle',
  result: null,
  ranAt: null,
  errorKind: null,
  error: null,
});

const idleRuns = (): Record<string, RecipeRunState> =>
  Object.fromEntries(SCANNER_RECIPES.map((r) => [r.id, idleRun()]));

describe('ScannerComponent (#1199 auto-run overview)', () => {
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
    byRole: ReturnType<
      typeof signal<{ exclusive: SymbolListDef[]; nonexclusive: SymbolListDef[] }>
    >;
    symbolListsLoading: ReturnType<typeof signal<boolean>>;
    loadTrackedSymbols: jest.Mock;
    loadSymbolLists: jest.Mock;
    toggleSymbolInList: jest.Mock;
  };
  let mcpMock: { reauthenticate: jest.Mock };

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function els(selector: string): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll(selector)];
  }

  function tables(): ScannerRecipeTableComponent[] {
    return fixture.debugElement
      .queryAll(By.directive(ScannerRecipeTableComponent))
      .map((d) => d.componentInstance as ScannerRecipeTableComponent);
  }

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
      byRole: signal({ exclusive: [] as SymbolListDef[], nonexclusive: [] as SymbolListDef[] }),
      symbolListsLoading: signal(false),
      loadTrackedSymbols: jest.fn().mockResolvedValue(['AAPL']),
      loadSymbolLists: jest.fn(),
      toggleSymbolInList: jest.fn(),
    };
    mcpMock = { reauthenticate: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [ScannerComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: ScannerStore, useValue: storeMock },
        { provide: SymbolListStore, useValue: symbolListsMock },
        { provide: RobinhoodMcpObservationService, useValue: mcpMock },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ScannerComponent);
  });

  // ── init + interval lifecycle ─────────────────────────────────────

  it('ngOnInit runs all recipes and loads the tracked universe', () => {
    fixture.detectChanges();
    expect(storeMock.runAllRecipes).toHaveBeenCalledTimes(1);
    expect(symbolListsMock.loadTrackedSymbols).toHaveBeenCalledTimes(1);
  });

  it('arms the 15-minute refresh interval — each tick re-fires the wave', () => {
    jest.useFakeTimers();
    try {
      fixture.detectChanges();
      expect(storeMock.runAllRecipes).toHaveBeenCalledTimes(1);
      jest.advanceTimersByTime(REFRESH_MS);
      expect(storeMock.runAllRecipes).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(REFRESH_MS);
      expect(storeMock.runAllRecipes).toHaveBeenCalledTimes(3);
    } finally {
      jest.useRealTimers();
    }
  });

  it('ngOnDestroy clears the interval — no new waves arm off-page', () => {
    jest.useFakeTimers();
    try {
      fixture.detectChanges();
      fixture.destroy();
      jest.advanceTimersByTime(REFRESH_MS * 3);
      expect(storeMock.runAllRecipes).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  // ── rail + detail ─────────────────────────────────────────────────

  it('renders a rail item per catalog recipe, in catalog order', () => {
    fixture.detectChanges();
    const ids = els('.rail-item').map((b) => b.getAttribute('data-recipe'));
    expect(ids).toEqual(SCANNER_RECIPES.map((r) => r.id));
  });

  it('detail shows the first recipe by default; clicking a rail item swaps the table', () => {
    fixture.detectChanges();
    expect(tables().length).toBe(1);
    expect(tables()[0].recipe().id).toBe(SCANNER_RECIPES[0].id);

    els('.rail-item')[2].click();
    fixture.detectChanges();
    expect(tables().length).toBe(1);
    expect(tables()[0].recipe().id).toBe(SCANNER_RECIPES[2].id);
    expect(els('.rail-item')[2].classList.contains('selected')).toBe(true);
  });

  it('the detail pane owns the table — its .table-scroll is the page scroll region', () => {
    fixture.detectChanges();
    const detail = el('.detail')!;
    expect(detail.parentElement!.classList.contains('scanner-main')).toBe(true);
    expect(el('app-scanner-recipe-table')!.parentElement).toBe(detail);
    // Structural pin: the vertical scrollbar lives in the table's
    // .table-scroll (sticky thead), not on the page.
    expect(el('.scanner-main')!.parentElement).toBe(el('.content-column'));
  });

  it('rail entries carry scoreboard state — status dot, count, baseline top tickers', () => {
    const recipe = SCANNER_RECIPES[0];
    const col = recipe.sort?.column ?? 'M';
    const dir = recipe.sort?.direction ?? 'desc';
    const [first, second] = dir === 'desc' ? ['AAA', 'BBB'] : ['BBB', 'AAA'];
    const runs = idleRuns();
    runs[recipe.id] = {
      status: 'success',
      result: {
        total_items: 9,
        results: [
          {
            ticker: 'BBB',
            instrument_id: 'i2',
            instrument_type: 'stock',
            columns: { [col]: '1' },
          },
          {
            ticker: 'AAA',
            instrument_id: 'i1',
            instrument_type: 'stock',
            columns: { [col]: '2' },
          },
        ],
      },
      ranAt: '2026-10-22T14:30:00Z',
      errorKind: null,
      error: null,
    };
    runs[SCANNER_RECIPES[1].id] = { ...idleRun(), status: 'loading' };
    runs[SCANNER_RECIPES[2].id] = {
      ...idleRun(),
      status: 'error',
      errorKind: 'other',
    };
    storeMock.runs.set(runs);
    fixture.detectChanges();

    const items = els('.rail-item');
    expect(items[0].querySelector('.dot')!.className).toContain(
      'status-success',
    );
    expect(items[0].querySelector('.rail-count')!.textContent).toBe('2 / 9');
    expect(items[0].querySelector('.rail-tickers')!.textContent).toBe(
      `${first} · ${second}`,
    );
    expect(items[1].querySelector('.dot')!.className).toContain(
      'status-loading',
    );
    expect(items[2].querySelector('.dot')!.className).toContain(
      'status-error',
    );
  });

  it('the detail table binds the selected run, the tracked set, and refreshRecipe', () => {
    const runs = idleRuns();
    runs[SCANNER_RECIPES[0].id] = {
      status: 'success',
      result: { total_items: 0, results: [] },
      ranAt: '2026-10-22T14:30:00Z',
      errorKind: null,
      error: null,
    };
    storeMock.runs.set(runs);
    symbolListsMock.trackedSymbols.set(['aapl']);
    fixture.detectChanges();

    const t = tables()[0];
    expect(t.run().status).toBe('success');
    expect(t.tracked()).toEqual(new Set(['aapl']));

    t.refresh.emit();
    expect(storeMock.refreshRecipe).toHaveBeenCalledWith(
      SCANNER_RECIPES[0].id,
    );

    // Live propagation: a post-init runs update reaches the table's input.
    runs[SCANNER_RECIPES[0].id] = { ...idleRun(), status: 'loading' };
    storeMock.runs.set({ ...runs });
    fixture.detectChanges();
    expect(tables()[0].run().status).toBe('loading');
  });

  it('a failed selected recipe shows an error note, not a blank pane; Retry delegates', () => {
    const runs = idleRuns();
    runs[SCANNER_RECIPES[0].id] = {
      ...idleRun(),
      status: 'error',
      errorKind: 'other',
      error: 'client id not allowed',
    };
    storeMock.runs.set(runs);
    fixture.detectChanges();

    expect(tables()).toEqual([]);
    const note = el('.detail-error')!;
    expect(note.textContent).toContain(SCANNER_RECIPES[0].title);
    expect(note.textContent).toContain('client id not allowed');

    (el('[data-testid="retry-selected"]') as HTMLButtonElement).click();
    expect(storeMock.refreshRecipe).toHaveBeenCalledWith(
      SCANNER_RECIPES[0].id,
    );
  });

  // ── header ────────────────────────────────────────────────────────

  it('Run all re-fires runAllRecipes; the button disables while runsLoading', () => {
    fixture.detectChanges();
    const btn = el('[data-testid="run-all"]') as HTMLButtonElement;
    btn.click();
    expect(storeMock.runAllRecipes).toHaveBeenCalledTimes(2);

    storeMock.runsLoading.set(true);
    fixture.detectChanges();
    expect(btn.disabled).toBe(true);
    storeMock.runsLoading.set(false);
    fixture.detectChanges();
    expect(btn.disabled).toBe(false);
  });

  it('shows the last-refresh time from the max ranAt across runs', () => {
    const earlier = '2026-10-22T14:30:00Z';
    const later = '2026-10-22T15:45:00Z';
    const runs = idleRuns();
    runs[SCANNER_RECIPES[0].id] = {
      ...idleRun(),
      status: 'success',
      ranAt: earlier,
    };
    runs[SCANNER_RECIPES[1].id] = {
      ...idleRun(),
      status: 'success',
      ranAt: later,
    };
    storeMock.runs.set(runs);
    fixture.detectChanges();

    const expected = new DatePipe('en-US').transform(
      new Date(later),
      'h:mm a',
    );
    expect(el('.last-refresh')!.textContent).toContain(expected!);
  });

  it('hides the last-refresh readout until any run lands', () => {
    fixture.detectChanges();
    expect(el('.last-refresh')).toBeNull();
  });

  it('an all-error wave still leaves a functional page — header, Run all, err rail, no table bodies', () => {
    const runs = idleRuns();
    for (const r of SCANNER_RECIPES) {
      runs[r.id] = { ...idleRun(), status: 'error', errorKind: 'other' };
    }
    storeMock.runs.set(runs);
    fixture.detectChanges();
    expect(el('[data-testid="run-all"]')).not.toBeNull();
    expect(el('.reauth-banner')).toBeNull();
    expect(els('table')).toEqual([]);
    expect(els('.rail-item .dot.status-error')).toHaveLength(
      SCANNER_RECIPES.length,
    );
    expect(el('.detail-error')).not.toBeNull();
  });

  // ── auth banner ───────────────────────────────────────────────────

  it('authFailed renders the reauth banner; successful reauth re-fires the wave', async () => {
    fixture.detectChanges();
    expect(el('.reauth-banner')).toBeNull();

    mcpMock.reauthenticate.mockResolvedValue({ success: true });
    storeMock.authFailed.set(true);
    fixture.detectChanges();
    expect(el('.reauth-banner')).not.toBeNull();

    const btn = el('.reauth-banner button') as HTMLButtonElement;
    btn.click();
    await fixture.whenStable();
    expect(mcpMock.reauthenticate).toHaveBeenCalled();
    expect(storeMock.clearError).toHaveBeenCalled();
    // errorKind clears per-recipe only on relaunch — a successful reauth
    // must re-arm the wave or the banner would linger until the next tick.
    expect(storeMock.runAllRecipes).toHaveBeenCalledTimes(2); // init + reauth
  });

  it('requiresReauth also surfaces the banner (single-run channel)', () => {
    storeMock.requiresReauth.set(true);
    fixture.detectChanges();
    expect(el('.reauth-banner')).not.toBeNull();
  });

  // ── retired surface ───────────────────────────────────────────────

  it('the single-run surface is gone — picker, Run/Evaluate, compare, history', () => {
    fixture.detectChanges();
    expect(el('select.dse-select')).toBeNull();
    expect(el('app-scanner-compare-panel')).toBeNull();
    expect(el('.history')).toBeNull();
    const labels = els('button').map((b) => b.textContent!.trim());
    expect(labels).not.toContain('Run');
    expect(labels).not.toContain('Evaluate tracked');
  });

  describe('row list menu + chip wiring (#1306)', () => {
    const EXCLUSIVE: SymbolListDef[] = [
      { key: 'NEW', label: 'New', order: 0, role: 'exclusive', hidden: false, symbols: [] },
      { key: 'PRIMARY', label: 'Primary', order: 1, role: 'exclusive', hidden: false, symbols: [' aapl '] },
      { key: 'HIDE', label: 'Hide', order: 5, role: 'exclusive', hidden: false, symbols: [] },
    ];
    const NONEXCLUSIVE: SymbolListDef[] = [
      { key: 'MONITOR', label: 'Monitor', order: 6, role: 'nonexclusive', hidden: false, symbols: ['AAPL'] },
    ];
    const wireRow = (ticker: string): ScanResultRow => ({
      ticker,
      instrument_id: `iid-${ticker.toLowerCase()}`,
      instrument_type: 'EQUITY',
      columns: {},
    });
    const successRun = (results: ScanResultRow[]): RecipeRunState => ({
      status: 'success',
      result: {
        total_items: results.length,
        results,
        sorted_by: 'Last desc',
      } as PreviewScanResult,
      ranAt: '2026-10-22T14:30:00Z',
      errorKind: null,
      error: null,
    });
    const mountWithAapl = () => {
      storeMock.runs.set({
        ...idleRuns(),
        // Catalog-first recipe is the default rail selection.
        [SCANNER_RECIPES[0].id]: successRun([wireRow('AAPL')]),
      });
      fixture.detectChanges();
    };

    it('calls loadSymbolLists() on init so the chip and menu have the live catalog', () => {
      fixture.detectChanges();
      expect(symbolListsMock.loadSymbolLists).toHaveBeenCalled();
    });

    it('builds the membership map from exclusive defs only — normalized keys, chip renders in the row', () => {
      symbolListsMock.byRole.set({ exclusive: EXCLUSIVE, nonexclusive: NONEXCLUSIVE });
      mountWithAapl();
      const t = tables()[0];
      // ' aapl ' (whitespace + case) normalizes to 'AAPL' — one policy.
      expect(t.listMembership().get('AAPL')).toBe('PRIMARY');
      // NONEXCLUSIVE defs contribute nothing — MONITOR carries AAPL too.
      expect(t.listDefs()).toEqual(EXCLUSIVE);
      const chip = el('.list-chip');
      expect(chip?.textContent!.trim()).toBe('PRIMARY');
    });

    it('menu pick routes {symbol, listKey} to toggleSymbolInList', () => {
      symbolListsMock.byRole.set({ exclusive: EXCLUSIVE, nonexclusive: NONEXCLUSIVE });
      mountWithAapl();
      el('[data-testid="list-btn"]')!.click();
      fixture.detectChanges();
      const items = els('.list-menu .menu-item .menu-label').map(
        (i) => i.textContent!.trim(),
      );
      expect(items).toEqual(['New', 'Primary', 'Hide']); // exclusive only
      els('.list-menu .menu-item')[1].click(); // Primary — the checked list
      expect(symbolListsMock.toggleSymbolInList).toHaveBeenCalledWith(
        'AAPL',
        'PRIMARY',
      );
    });

    it('a different-list pick also routes through toggleSymbolInList (the move decision is the store\'s)', () => {
      symbolListsMock.byRole.set({ exclusive: EXCLUSIVE, nonexclusive: NONEXCLUSIVE });
      mountWithAapl();
      el('[data-testid="list-btn"]')!.click();
      fixture.detectChanges();
      els('.list-menu .menu-item')[2].click(); // Hide
      expect(symbolListsMock.toggleSymbolInList).toHaveBeenCalledWith(
        'AAPL',
        'HIDE',
      );
    });
  });
});
