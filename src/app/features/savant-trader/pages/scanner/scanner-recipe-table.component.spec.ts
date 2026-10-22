/**
 * ScannerRecipeTableComponent spec (#1098/#1197) — the dumb per-recipe
 * table for the auto-run overview. Inputs: recipe + per-recipe run state
 * + tracked set. Output: refresh. Covers header metadata, loading/error
 * visibility, all wire fields as columns, percent/blank formatting,
 * tracked badge, dedupe, and the click-cycle multi-sort.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';

import { ScannerRecipeTableComponent } from './scanner-recipe-table.component';
import type { RecipeRunState } from '../../stores/scanner.store';
import {
  SCANNER_RECIPES,
  type ScannerRecipe,
} from '../../scanner/scanner-recipes';
import type {
  PreviewScanResult,
  ScanResultRow,
} from '@robinhood-mcp/contracts';

const GAINERS = SCANNER_RECIPES.find((r) => r.id === 'gainers')!;
const QUALITY = SCANNER_RECIPES.find((r) => r.id === 'quality-mega')!;

const wireRow = (
  ticker: string,
  columns: Record<string, string> = {},
): ScanResultRow => ({
  ticker,
  instrument_id: `iid-${ticker.toLowerCase()}`,
  instrument_type: 'EQUITY',
  columns,
});

const result = (
  results: ScanResultRow[],
  over: Partial<PreviewScanResult> = {},
): PreviewScanResult => ({
  total_items: results.length,
  results,
  sorted_by: 'Last desc',
  ...over,
});

const run = (over: Partial<RecipeRunState> = {}): RecipeRunState => ({
  status: 'success',
  result: null,
  ranAt: '2026-10-21T14:30:00Z',
  errorKind: null,
  ...over,
});

describe('ScannerRecipeTableComponent', () => {
  let fixture: ComponentFixture<ScannerRecipeTableComponent>;

  function mount(
    recipe: ScannerRecipe,
    r: RecipeRunState,
    tracked: ReadonlySet<string> = new Set(),
  ): void {
    fixture = TestBed.createComponent(ScannerRecipeTableComponent);
    fixture.componentRef.setInput('recipe', recipe);
    fixture.componentRef.setInput('run', r);
    fixture.componentRef.setInput('tracked', tracked);
    fixture.detectChanges();
  }

  const el = () => fixture.nativeElement as HTMLElement;
  const headerCells = () => el().querySelectorAll('th');
  const bodyRows = () => el().querySelectorAll('tbody tr');
  const cellText = (tr: Element, idx: number) =>
    tr.querySelectorAll('td')[idx]?.textContent?.trim();
  /** Header label without the sort-indicator child (robust vs a label
   *  that legitimately ends in digits/arrows). */
  const headLabel = (h: Element) =>
    h.textContent!.replace(
      h.querySelector('.sort-indicator')?.textContent ?? '',
      '',
    ).trim();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ScannerRecipeTableComponent],
      providers: [provideZonelessChangeDetection(), provideNoopAnimations()],
    }).compileComponents();
  });

  it('renders the recipe header: title, blurb, N of M, sorted_by, ran-at', () => {
    mount(
      GAINERS,
      run({ result: result([wireRow('AAPL')], { total_items: 350 }) }),
    );
    const head = el().querySelector('.recipe-head')!;
    expect(head.textContent).toContain('Daily Gainers');
    expect(head.textContent).toContain('Positive % change');
    expect(head.textContent).toContain('1 of 350');
    expect(head.textContent).toContain('Last desc');
    // Timezone-robust — the date pipe renders local time.
    expect(head.querySelector('.ran-at')?.textContent).toMatch(
      /\d{1,2}:\d{2}\s?(AM|PM)/,
    );
  });

  it('refresh button emits (refresh)', () => {
    mount(GAINERS, run({ result: result([wireRow('AAPL')]) }));
    let fired = 0;
    fixture.componentInstance.refresh.subscribe(() => fired++);
    el().querySelector<HTMLButtonElement>('.refresh-btn')!.click();
    expect(fired).toBe(1);
  });

  it('loading state shows a spinner block, not the table', () => {
    mount(GAINERS, run({ status: 'loading', result: null, ranAt: null }));
    expect(el().querySelector('.table-loading')).not.toBeNull();
    expect(el().querySelector('table')).toBeNull();
  });

  it('idle (pre-launch, staggered queue) shows a queued block, not a bare header', () => {
    mount(GAINERS, run({ status: 'idle', result: null, ranAt: null }));
    expect(el().querySelector('.table-loading')?.textContent).toContain('Queued');
    expect(el().querySelector('table')).toBeNull();
  });

  it('refresh-in-flight keeps the prior table — no spinner collapse', () => {
    // Pins the disclosed deviation from IMPL §3's literal "loading →
    // spinner block, no table": a refresh with an existing result keeps
    // the rows visible (a collapse on a 9-table page loses scroll state).
    mount(
      GAINERS,
      run({ status: 'loading', result: result([wireRow('AAPL')]) }),
    );
    expect(el().querySelector('.table-loading')).toBeNull();
    expect(el().querySelector('tbody tr')).not.toBeNull();
  });

  it('error state renders nothing — the failed recipe is silently skipped', () => {
    mount(GAINERS, run({ status: 'error', errorKind: 'other' }));
    expect(el().querySelector('.recipe-table')).toBeNull();
  });

  it('columns: badge + ticker + instrument_id + instrument_type + declared columns', () => {
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('AAPL', { '% Change': '0.05', 'Net change': '2.10' }),
        ]),
      }),
    );
    const heads = Array.from(headerCells()).map(headLabel);
    expect(heads[0]).toBe('Tracked');
    expect(heads.slice(1, 4)).toEqual(['Symbol', 'instrument_id', 'instrument_type']);
    expect(heads.slice(4)).toEqual(['% Change', 'Net change']);
    const tr = bodyRows()[0];
    expect(cellText(tr, 1)).toBe('AAPL');
    expect(cellText(tr, 2)).toBe('iid-aapl');
    expect(cellText(tr, 3)).toBe('EQUITY');
    expect(cellText(tr, 4)).toBe('5.0%'); // percentColumns rescale
    expect(cellText(tr, 5)).toBe('2.10');
  });

  it('extra response keys not declared by the recipe render as trailing columns', () => {
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('AAPL', { '% Change': '0.05', Name: 'Apple Inc', Last: '210' }),
        ]),
      }),
    );
    const heads = Array.from(headerCells()).map(headLabel);
    expect(heads).toContain('Name');
    expect(heads).toContain('Last');
    const tr = bodyRows()[0];
    expect(cellText(tr, heads.indexOf('Name'))).toBe('Apple Inc');
  });

  it("the default 'Symbol' wire column doesn't render a duplicate trailing column", () => {
    // Live rows always carry Symbol/Name/Last/Volume/Asset type in
    // columns — 'Symbol' collides with the fixed column and must be
    // suppressed from extras (other defaults like 'Name' still render).
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('AAPL', {
            Symbol: 'AAPL',
            Name: 'Apple Inc',
            Last: '210',
            '% Change': '0.05',
            'Net change': '2',
          }),
        ]),
      }),
    );
    const heads = Array.from(headerCells()).map(headLabel);
    expect(heads.filter((h) => h === 'Symbol')).toHaveLength(1);
    expect(heads).toContain('Name'); // non-colliding extras still render
  });

  it('tracked badge marks members of the tracked set', () => {
    mount(
      GAINERS,
      run({
        result: result([wireRow('AAPL'), wireRow('ZZZZ')]),
      }),
      new Set(['AAPL']),
    );
    const [a, b] = Array.from(bodyRows());
    expect(a.querySelector('.badge.tracked')?.textContent?.trim()).toBe('tracked');
    expect(b.querySelector('.badge:not(.tracked)')?.textContent?.trim()).toBe('new');
  });

  it('canonical column rename still resolves the declared column (quality ROE → Return on equity)', () => {
    mount(
      QUALITY,
      run({
        result: result([
          wireRow('AAPL', { 'Return on equity': '0.25', 'Net profit margin': '0.30' }),
        ]),
      }),
    );
    const heads = Array.from(headerCells()).map(headLabel);
    const roeIdx = heads.indexOf('ROE');
    expect(roeIdx).toBeGreaterThan(-1);
    // The wire key isn't ALSO rendered as an extra column.
    expect(heads.filter((h) => h === 'Return on equity')).toHaveLength(0);
    expect(cellText(bodyRows()[0], roeIdx)).toBe('25.0%');
  });

  it('blank cells render —; non-string wire values render via String()', () => {
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('AAPL', {
            '% Change': '',
            'Net change': 42 as unknown as string,
          }),
        ]),
      }),
    );
    const tr = bodyRows()[0];
    const heads = Array.from(headerCells()).map(headLabel);
    expect(cellText(tr, heads.indexOf('% Change'))).toBe('—');
    expect(cellText(tr, heads.indexOf('Net change'))).toBe('42');
  });

  it('success with zero rows renders the empty state, not nothing', () => {
    mount(GAINERS, run({ result: result([]) }));
    expect(el().querySelector('.recipe-table')).not.toBeNull();
    expect(el().querySelector('.table-empty')).not.toBeNull();
  });

  it('success with a null result (interface permits it) renders the empty state', () => {
    mount(GAINERS, run()); // factory default: success + result: null
    expect(el().querySelector('.table-empty')).not.toBeNull();
    expect(el().querySelector('table')).toBeNull();
  });

  it('text columns are not right-aligned — num class only on numeric columns', () => {
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('AAPL', { Name: 'Apple Inc', '% Change': '0.05' }),
        ]),
      }),
    );
    const heads = Array.from(headerCells());
    const nameIdx = heads.findIndex((h) => headLabel(h) === 'Name');
    const pctIdx = heads.findIndex((h) => headLabel(h) === '% Change');
    expect(heads[nameIdx].classList.contains('num')).toBe(false);
    expect(heads[pctIdx].classList.contains('num')).toBe(true);
    const tds = Array.from(bodyRows()[0].querySelectorAll('td'));
    expect(tds[nameIdx].classList.contains('num')).toBe(false);
    expect(tds[pctIdx].classList.contains('num')).toBe(true);
  });

  it('dedupes rows by normalized ticker — first wins (NG0955)', () => {
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('AAPL', { '% Change': '0.05' }),
          wireRow('aapl ', { '% Change': '0.99' }),
        ]),
      }),
    );
    expect(bodyRows()).toHaveLength(1);
    const heads = Array.from(headerCells()).map(headLabel);
    expect(cellText(bodyRows()[0], heads.indexOf('% Change'))).toBe('5.0%');
    // Header count reflects rendered rows, not raw wire results.
    expect(el().querySelector('.count')?.textContent).toContain('1 of 2');
  });

  it('a hidden declared column (visible:false) does not leak into extras', () => {
    // hidden-columns-still-compute wire contract — a drifted recipe with
    // a hidden column must not re-render its key as a trailing extra.
    const recipe: ScannerRecipe = {
      id: 'synthetic',
      title: 'Synthetic',
      blurb: '',
      filters: [],
      columns: [
        { display_name: 'Shown' },
        { display_name: 'Hidden', visible: false },
      ],
      sort: { column: 'Shown', direction: 'asc' },
    };
    mount(
      recipe,
      run({ result: result([wireRow('AAPL', { Shown: '1', Hidden: '9' })]) }),
    );
    const heads = Array.from(headerCells()).map(headLabel);
    expect(heads).toContain('Shown');
    expect(heads).not.toContain('Hidden');
  });

  it('seeds the sort chain from the recipe-declared sort (gainers % Change desc)', () => {
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('AAA', { '% Change': '0.02', 'Net change': '1' }),
          wireRow('BBB', { '% Change': '0.10', 'Net change': '5' }),
        ]),
      }),
    );
    const symbols = Array.from(bodyRows()).map((tr) => cellText(tr, 1));
    expect(symbols).toEqual(['BBB', 'AAA']); // 10% desc before 2%
    const inds = Array.from(el().querySelectorAll('.sort-indicator')).map(
      (s) => s.textContent!.trim(),
    );
    expect(inds).toEqual(['1↓']);
  });

  it('the Tracked badge column is sortable — new symbols group first asc', () => {
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('ZZZ', { '% Change': '0.05', 'Net change': '2' }),
          wireRow('AAA', { '% Change': '0.05', 'Net change': '1' }),
        ]),
      }),
      new Set(['ZZZ']),
    );
    const trackedTh = Array.from(headerCells()).find((h) =>
      h.textContent!.includes('Tracked'),
    )!;
    (trackedTh as HTMLElement).click();
    fixture.detectChanges();
    const symbols = Array.from(bodyRows()).map((tr) => cellText(tr, 1));
    expect(symbols).toEqual(['AAA', 'ZZZ']); // new (0) before tracked (1)
  });

  it('click-cycles sort: desc seed → removed → asc; second column joins as tiebreak', () => {
    mount(
      GAINERS,
      run({
        result: result([
          wireRow('AAA', { '% Change': '0.02', 'Net change': '1' }),
          wireRow('BBB', { '% Change': '0.10', 'Net change': '5' }),
          wireRow('CCC', { '% Change': '0.10', 'Net change': '2' }),
        ]),
      }),
    );
    const heads = Array.from(headerCells());
    const pct = heads.findIndex((h) => h.textContent!.includes('% Change'));
    const net = heads.findIndex((h) => h.textContent!.includes('Net change'));
    const symbols = () =>
      Array.from(bodyRows()).map((tr) => cellText(tr, 1));

    // Seeded with the recipe's % Change desc.
    expect(symbols()).toEqual(['BBB', 'CCC', 'AAA']); // 10%×2 first, insertion tie
    expect(el().querySelectorAll('.sort-indicator')).toHaveLength(1);

    (heads[net] as HTMLElement).click(); // Net change joins as #2 asc
    fixture.detectChanges();
    expect(el().querySelectorAll('.sort-indicator')).toHaveLength(2);
    // % Change desc ties BBB/CCC — Net change asc breaks it (2 < 5).
    expect(symbols()).toEqual(['CCC', 'BBB', 'AAA']);

    (heads[pct] as HTMLElement).click(); // desc → removed — only Net change asc
    fixture.detectChanges();
    expect(symbols()).toEqual(['AAA', 'CCC', 'BBB']); // 1 < 2 < 5

    (heads[pct] as HTMLElement).click(); // % Change re-joins asc as #2 — net decides anyway
    fixture.detectChanges();
    expect(symbols()).toEqual(['AAA', 'CCC', 'BBB']);
    expect(el().querySelectorAll('.sort-indicator')).toHaveLength(2);
  });

  it('sorted headers show numbered priority badges (seed + clicks)', () => {
    mount(GAINERS, run({ result: result([wireRow('AAPL', { '% Change': '0.05', 'Net change': '2' })]) }));
    const heads = Array.from(el().querySelectorAll('th')) as HTMLElement[];
    heads.find((h) => h.textContent!.includes('Symbol'))!.click();
    heads.find((h) => h.textContent!.includes('Net change'))!.click();
    fixture.detectChanges();
    const inds = Array.from(el().querySelectorAll('.sort-indicator')).map(
      (s) => s.textContent!.trim(),
    );
    // DOM order is column order: Symbol(2) → % Change seed(1) → Net(3).
    expect(inds).toEqual(['2↑', '1↓', '3↑']);
  });
});
