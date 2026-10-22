/**
 * ScannerComponent spec (#1098/#1140) — the scanner page shell.
 *
 * Store is mocked at the boundary with plain signals (the page only
 * reads signals + calls methods). Covers: picker + blurb, Run/Evaluate
 * delegation, busy/progress, rows + tracked badge + dynamic recipe
 * columns + percent rescaling + sort, shown-of-matched status,
 * truncated/capped warning, empty-vs-error distinction, inline error,
 * and the AUTH reauth card.
 */
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';

import { ScannerComponent } from './scanner.component';
import { ScannerStore, type ScannerError } from '../../stores/scanner.store';
import { RobinhoodMcpObservationService } from '../../../../core/robinhood-mcp/robinhood-mcp-observation.service';
import { ToolExecutionErrorCategory } from '@robinhood-mcp/contracts';
import {
  SCANNER_RECIPES,
  type ScannerRecipe,
} from '../../scanner/scanner-recipes';
import type { ScanRow } from '../../utils/scanner-rows.util';
import type { CompareResult } from '../../utils/scanner-compare.util';
import type { CurationProposal } from '@st/scanner';
import type { StoredProposal } from '../../services/scanner.service';

const PRUNE_RECIPE = SCANNER_RECIPES.find((r) => r.supportsPrune)!; // quality-mega
const SCAN_RECIPE = SCANNER_RECIPES.find((r) => !r.supportsPrune)!;

function proposal(over: Partial<CurationProposal> = {}): CurationProposal {
  return {
    recipeId: PRUNE_RECIPE.id,
    ranAt: '2026-10-21T14:30:00Z',
    universeSize: 3,
    matchedCount: 2,
    truncated: false,
    addCandidates: [],
    dropCandidates: [],
    deadSymbols: [],
    noDataSymbols: [],
    ...over,
  };
}

function row(over: Partial<ScanRow> = {}): ScanRow {
  return {
    symbol: 'AAPL',
    name: 'Apple Inc',
    instrumentId: 'iid-aapl',
    instrumentType: 'stock',
    values: { 'Return on equity': '0.25', 'Net profit margin': '0.30' },
    tracked: false,
    ...over,
  };
}

function compare(over: Partial<CompareResult> = {}): CompareResult {
  return {
    rows: [],
    buckets: {
      addCandidates: [],
      dropCandidates: [],
      deadSymbols: [],
      noDataSymbols: [],
    },
    unevaluated: [],
    dropDetail: {},
    truncated: false,
    ...over,
  };
}

describe('ScannerComponent', () => {
  let fixture: ComponentFixture<ScannerComponent>;
  let storeMock: {
    recipes: ReturnType<typeof signal<readonly ScannerRecipe[]>>;
    activeRecipeId: ReturnType<typeof signal<string | null>>;
    activeRecipe: ReturnType<typeof signal<ScannerRecipe | null>>;
    running: ReturnType<typeof signal<boolean>>;
    rows: ReturnType<typeof signal<ScanRow[]>>;
    compare: ReturnType<typeof signal<CompareResult | null>>;
    matchedCount: ReturnType<typeof signal<number | null>>;
    runKind: ReturnType<typeof signal<'scan' | 'eval' | null>>;
    columnLookup: ReturnType<typeof signal<ReadonlyMap<string, string> | null>>;
    evaluating: ReturnType<typeof signal<{ done: number; total: number } | null>>;
    error: ReturnType<typeof signal<ScannerError | null>>;
    busy: ReturnType<typeof signal<boolean>>;
    requiresReauth: ReturnType<typeof signal<boolean>>;
    canEvaluateTracked: ReturnType<typeof signal<boolean>>;
    proposals: ReturnType<typeof signal<StoredProposal[]>>;
    proposalsLoading: ReturnType<typeof signal<boolean>>;
    proposalOpen: ReturnType<typeof signal<StoredProposal | null>>;
    selectRecipe: jest.Mock;
    runScan: jest.Mock;
    evaluateTracked: jest.Mock;
    loadProposals: jest.Mock;
    openProposal: jest.Mock;
    closeProposal: jest.Mock;
    clearError: jest.Mock;
  };
  let mcpMock: { reauthenticate: jest.Mock };

  function el(selector: string): HTMLElement | null {
    return fixture.nativeElement.querySelector(selector);
  }

  function els(selector: string): HTMLElement[] {
    return [...fixture.nativeElement.querySelectorAll(selector)];
  }

  beforeEach(async () => {
    storeMock = {
      recipes: signal(SCANNER_RECIPES),
      activeRecipeId: signal<string | null>(PRUNE_RECIPE.id),
      activeRecipe: signal<ScannerRecipe | null>(PRUNE_RECIPE),
      running: signal(false),
      rows: signal<ScanRow[]>([]),
      compare: signal<CompareResult | null>(null),
      matchedCount: signal<number | null>(null),
      runKind: signal<'scan' | 'eval' | null>(null),
      columnLookup: signal<ReadonlyMap<string, string> | null>(null),
      evaluating: signal<{ done: number; total: number } | null>(null),
      error: signal<ScannerError | null>(null),
      busy: signal(false),
      requiresReauth: signal(false),
      canEvaluateTracked: signal(true),
      proposals: signal<StoredProposal[]>([]),
      proposalsLoading: signal(false),
      proposalOpen: signal<StoredProposal | null>(null),
      selectRecipe: jest.fn(),
      runScan: jest.fn(),
      evaluateTracked: jest.fn(),
      loadProposals: jest.fn(),
      openProposal: jest.fn(),
      closeProposal: jest.fn(),
      clearError: jest.fn(),
    };
    mcpMock = { reauthenticate: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [ScannerComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        { provide: ScannerStore, useValue: storeMock },
        { provide: RobinhoodMcpObservationService, useValue: mcpMock },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ScannerComponent);
  });

  // ── picker + blurb ────────────────────────────────────────────────

  it('picker carries the catalog and binds the active recipe; blurb renders', () => {
    fixture.detectChanges();
    const select = fixture.debugElement.query(By.directive(MatSelect))
      .componentInstance as MatSelect;
    expect(select.options.length).toBe(SCANNER_RECIPES.length);
    expect(select.value).toBe(PRUNE_RECIPE.id);
    expect(el('.recipe-blurb')?.textContent).toContain(PRUNE_RECIPE.blurb);
  });

  it('selecting a recipe delegates to selectRecipe', () => {
    fixture.detectChanges();
    const select = fixture.debugElement.query(By.directive(MatSelect))
      .componentInstance as MatSelect;
    select.selectionChange.emit({ value: 'high-52w', source: select });
    expect(storeMock.selectRecipe).toHaveBeenCalledWith('high-52w');
  });

  // ── actions ────────────────────────────────────────────────────────

  it('Run delegates to store.runScan', () => {
    fixture.detectChanges();
    (el('button') as HTMLButtonElement).click();
    expect(storeMock.runScan).toHaveBeenCalledTimes(1);
  });

  it('Evaluate tracked delegates when the recipe supports prune', () => {
    fixture.detectChanges();
    const btn = els('button').find((b) => b.textContent?.includes('Evaluate tracked'));
    expect(btn).toBeTruthy();
    btn!.click();
    expect(storeMock.evaluateTracked).toHaveBeenCalledTimes(1);
  });

  it('hides Evaluate tracked for recipes without prune support', () => {
    storeMock.canEvaluateTracked.set(false);
    storeMock.activeRecipe.set(SCAN_RECIPE);
    fixture.detectChanges();
    expect(
      els('button').some((b) => b.textContent?.includes('Evaluate tracked')),
    ).toBe(false);
  });

  it('disables actions while busy', () => {
    storeMock.busy.set(true);
    fixture.detectChanges();
    const run = el('button') as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    const evalBtn = els('button').find((b) =>
      b.textContent?.includes('Evaluate tracked'),
    ) as HTMLButtonElement;
    expect(evalBtn.disabled).toBe(true);
  });

  // ── busy / progress ────────────────────────────────────────────────

  it('shows the running label during a scan', () => {
    storeMock.busy.set(true);
    fixture.detectChanges();
    expect(el('.progress-line')?.textContent).toContain('Running scan');
  });

  it('shows eval progress during evaluateTracked', () => {
    storeMock.busy.set(true);
    storeMock.evaluating.set({ done: 3, total: 14 });
    fixture.detectChanges();
    expect(el('.progress-line')?.textContent).toContain('3/14');
  });

  // ── rows + columns + badges ────────────────────────────────────────

  it('renders rows with tracked badges and dynamic recipe columns', () => {
    const rows = [
      row({ tracked: true }),
      row({ symbol: 'MSFT', name: 'Microsoft', values: { 'Return on equity': '0.19' } }),
    ];
    storeMock.rows.set(rows);
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    const bodyRows = els('tbody tr');
    expect(bodyRows.length).toBe(2);
    expect(bodyRows[0].textContent).toContain('AAPL');
    expect(bodyRows[0].textContent).toContain('Apple Inc');
    expect(bodyRows[0].querySelector('.badge')?.textContent?.trim()).toBe('tracked');
    expect(bodyRows[1].querySelector('.badge')?.textContent?.trim()).toBe('new');
    // ROE is percent-scaled + lookup-renamed: 0.25 → '25.0%'
    expect(bodyRows[0].textContent).toContain('25.0%');
    // headers are the recipe's own column display_names
    const headers = els('thead th').map((h) => h.textContent?.trim());
    expect(headers).toContain('ROE');
    expect(headers).toContain('Market cap');
  });

  it('resolves cells through the store lookup when a run provided one', () => {
    // The response-derived lookup wins over the recipe's static map —
    // a backend-canonicalized column name the recipe didn't predict
    // still renders instead of '—'.
    storeMock.columnLookup.set(new Map([['ROE', 'ROE backend name']]));
    const rows = [row({ values: { 'ROE backend name': '0.42' } })];
    storeMock.rows.set(rows);
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    expect(els('tbody tr')[0].textContent).toContain('42.0%');
  });

  it('sorts rows per the recipe sort, missing metrics last', () => {
    const rows = [
      row({ symbol: 'LOW', values: { 'Return on equity': '0.15' } }),
      row({ symbol: 'BLANK', values: {} }),
      row({ symbol: 'HIGH', values: { 'Return on equity': '0.40' } }),
    ];
    storeMock.rows.set(rows);
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    const symbols = els('tbody td.symbol').map((td) => td.textContent?.trim());
    // quality-mega sorts ROE desc; BLANK sinks to the end
    expect(symbols).toEqual(['HIGH', 'LOW', 'BLANK']);
  });

  // ── status line + truncation ───────────────────────────────────────

  it('status line shows shown-of-matched', () => {
    const rows = [row()];
    storeMock.rows.set(rows);
    storeMock.matchedCount.set(47);
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    expect(el('.status-line')?.textContent).toContain('1 shown of 47 matched');
  });

  it('eval runs label the count rows·matched (display rows exceed passers)', () => {
    const rows = [row(), row({ symbol: 'MSFT' })];
    storeMock.rows.set(rows);
    storeMock.matchedCount.set(1);
    storeMock.runKind.set('eval');
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    // 2 display rows (coverage∪matched), 1 screen passer — "2 shown of
    // 1 matched" would read self-contradictory; "evaluated" would
    // overcount the universe (dead/chunk-failed symbols aren't rows).
    expect(el('.status-line')?.textContent).toContain('2 rows · 1 matched');
  });

  it('missing cells render the — placeholder', () => {
    const rows = [row({ values: {} })];
    storeMock.rows.set(rows);
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    expect(els('tbody tr')[0].textContent).toContain('—');
  });

  it('duplicate tickers dedupe first-wins on a normalized key', () => {
    const rows = [
      row({ symbol: 'AAPL', name: 'first' }),
      row({ symbol: 'aapl ', name: 'dup' }),
      row({ symbol: 'MSFT' }),
    ];
    storeMock.rows.set(rows);
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    const trs = els('tbody tr');
    expect(trs.length).toBe(2);
    expect(trs[0].textContent).toContain('first');
  });

  it('a drifted non-string cell renders instead of crashing the table', () => {
    const rows = [
      row({ values: { EPS: 42 as unknown as string } }),
    ];
    storeMock.rows.set(rows);
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    expect(els('tbody tr')[0].textContent).toContain('42');
  });

  it('truncated compare warns the results are capped', () => {
    const rows = [row()];
    storeMock.rows.set(rows);
    storeMock.matchedCount.set(400);
    storeMock.compare.set(compare({ rows, truncated: true }));
    fixture.detectChanges();
    const line = el('.status-line');
    expect(line?.textContent).toContain("doesn't cover all matches");
    expect(line?.classList.contains('truncated')).toBe(true);
  });

  // ── empty vs error ─────────────────────────────────────────────────

  it('empty compare renders a no-matches block, not an error', () => {
    storeMock.compare.set(compare());
    storeMock.matchedCount.set(0);
    fixture.detectChanges();
    expect(el('.empty-state')?.textContent).toContain('No matching symbols');
    expect(el('.error-banner')).toBeNull();
  });

  it('renders an inline error banner for non-AUTH errors', () => {
    storeMock.error.set({ message: 'preview_scan failed', category: null });
    fixture.detectChanges();
    expect(el('.error-banner')?.textContent).toContain('preview_scan failed');
    // no reauth affordance for a plain failure
    expect(el('.reauth-banner')).toBeNull();
  });

  // ── AUTH reauth card ───────────────────────────────────────────────

  it('AUTH-category errors render the reauth banner instead of inline text', () => {
    storeMock.error.set({
      message: 'session expired',
      category: ToolExecutionErrorCategory.AUTH,
    });
    storeMock.requiresReauth.set(true);
    fixture.detectChanges();
    const banner = el('.reauth-banner');
    expect(banner?.textContent).toContain('Robinhood session expired');
    expect(banner?.textContent).not.toContain('preview_scan');
  });

  it('Re-authorize calls reauthenticate and clears the error on success', async () => {
    mcpMock.reauthenticate.mockResolvedValue({ success: true });
    storeMock.error.set({
      message: 'session expired',
      category: ToolExecutionErrorCategory.AUTH,
    });
    storeMock.requiresReauth.set(true);
    fixture.detectChanges();
    const btn = els('button').find((b) => b.textContent?.includes('Re-authorize'));
    btn!.click();
    await new Promise<void>((r) => setTimeout(r, 0));
    expect(mcpMock.reauthenticate).toHaveBeenCalledTimes(1);
    expect(storeMock.clearError).toHaveBeenCalledTimes(1);
  });

  // ── #1141 — compare panel + proposal history ─────────────────────

  it('loads proposal history on init', () => {
    fixture.detectChanges();
    expect(storeMock.loadProposals).toHaveBeenCalledTimes(1);
  });

  it('the live compare renders the panel with bucket sections', () => {
    const rows = [row()];
    storeMock.rows.set(rows);
    storeMock.compare.set(
      compare({ rows, buckets: { ...compare().buckets, addCandidates: ['AAPL'] } }),
    );
    fixture.detectChanges();
    const panel = el('app-scanner-compare-panel');
    expect(panel?.textContent).toContain('Add');
  });

  it('a bucket chip focuses the matching table row and scrolls it', async () => {
    const scroll = jest.fn();
    const orig = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const rows = [row()];
      storeMock.rows.set(rows);
      storeMock.compare.set(
        compare({ rows, buckets: { ...compare().buckets, addCandidates: ['AAPL'] } }),
      );
      fixture.detectChanges();
      (el('.bucket-add .bucket-head') as HTMLButtonElement).click();
      fixture.detectChanges();
      (el('.sym-chip') as HTMLButtonElement).click();
      fixture.detectChanges();
      const tr = el('tr[data-symbol="AAPL"]');
      expect(tr?.classList.contains('focused')).toBe(true);
      // scrollIntoView is scheduled via setTimeout — flush the macrotask.
      await new Promise<void>((r) => setTimeout(r, 0));
      expect(scroll).toHaveBeenCalled();
    } finally {
      Element.prototype.scrollIntoView = orig;
    }
  });

  it('clears the focused row when the compare changes', () => {
    const rows = [row()];
    storeMock.rows.set(rows);
    storeMock.compare.set(
      compare({ rows, buckets: { ...compare().buckets, addCandidates: ['AAPL'] } }),
    );
    fixture.detectChanges();
    (el('.bucket-add .bucket-head') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el('.sym-chip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el('tr.focused')).not.toBeNull();
    // A superseding run lands a new compare — the stale focus must
    // clear even though AAPL is still in the table.
    storeMock.compare.set(compare({ rows }));
    fixture.detectChanges();
    expect(el('tr.focused')).toBeNull();
  });

  it('history renders ranAt · recipe title · bucket counts; click opens', () => {
    storeMock.proposals.set([
      {
        id: 'p1',
        proposal: proposal({ addCandidates: ['X'], dropCandidates: ['Y'] }),
      },
    ]);
    fixture.detectChanges();
    const row = el('.history-row')!;
    expect(row.textContent).toContain('Oct 21');
    expect(row.textContent).toContain(PRUNE_RECIPE.title);
    expect(row.textContent).toContain('+1');
    expect(row.textContent).toContain('−1');
    (row as HTMLButtonElement).click();
    expect(storeMock.openProposal).toHaveBeenCalledWith('p1');
  });

  it('an opened proposal renders read-only with meta; close delegates', () => {
    storeMock.proposalOpen.set({
      id: 'p1',
      proposal: proposal({ universeSize: 150, matchedCount: 12, truncated: true }),
    });
    fixture.detectChanges();
    const detail = el('.proposal-detail');
    expect(detail?.textContent).toContain('read-only');
    expect(detail?.textContent).toContain('universe 150 · 12 matched · capped');
    (el('.close-btn') as HTMLButtonElement).click();
    expect(storeMock.closeProposal).toHaveBeenCalledTimes(1);
  });

  it('a proposal chip does not throw when its symbol is absent from the table', () => {
    storeMock.proposalOpen.set({
      id: 'p1',
      proposal: proposal({ dropCandidates: ['GHOST'] }),
    });
    storeMock.rows.set([row()]);
    storeMock.compare.set(compare({ rows: [row()] }));
    fixture.detectChanges();
    (el('.proposal-detail .bucket-drop .bucket-head') as HTMLButtonElement).click();
    fixture.detectChanges();
    (el('.proposal-detail .sym-chip') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el('tr.focused')).toBeNull();
  });
});
