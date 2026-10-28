/// <reference types="jest" />
/**
 * ChartViewToolbarComponent — the merged page-top toolbar for chart-view
 * (#1232/#1256). Scan + list source dropdowns, indicator menu, symbol
 * identity, chart controls, and the right action group — bound to the
 * page-scoped ChartToolbarStateService.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { By } from '@angular/platform-browser';

import { IndicatorMenuComponent } from '../indicator-menu/indicator-menu.component';
import { LogScalePillComponent } from '../log-scale-pill/log-scale-pill.component';

import { ChartViewToolbarComponent } from './chart-view-toolbar.component';
import { ChartToolbarStateService } from '../../services/chart-toolbar-state.service';
import { UiStateService, ChartLayout } from '../../../../core/services/ui-state.service';
import { BarsInterval } from '../../../../core/models/partner.types';
import { NO_MEMBERSHIP } from '../../common/constants';
import { RhSelectMenuComponent } from '../rh-select-menu/rh-select-menu.component';
import type { RhSelectOption, RhSelectOptionGroup } from '../rh-select-menu/rh-select-menu.component';
import type { SymbolListFilter } from '../../common/constants';
import type { SymbolListDef } from '../../common/symbol-list-defs';

const LIST_GROUPS: RhSelectOptionGroup<SymbolListFilter>[] = [
  {
    label: 'Triage',
    options: [
      { value: 'PRIMARY', label: 'Primary' },
      { value: NO_MEMBERSHIP, label: 'Not triaged' },
    ],
  },
];

const CATALOG: SymbolListDef[] = [
  { key: 'PRIMARY', label: 'Primary', order: 0, role: 'exclusive', hidden: false, symbols: ['AAPL'] },
];

const SCAN_OPTIONS: RhSelectOption<SymbolListFilter>[] = [
  { value: 'scan:quality-large', label: 'Quality Large · ran 14:03' },
  { value: 'scan:gainers', label: 'Gainers · ran 14:00' },
];

describe('ChartViewToolbarComponent', () => {
  let fixture: ComponentFixture<ChartViewToolbarComponent>;
  let component: ChartViewToolbarComponent;
  let toolbarState: ChartToolbarStateService;

  const mockUiState = {
    chartLayout: signal(ChartLayout.TRIPLE),
    fullscreen: signal(false),
    toggleChartLayout: jest.fn(),
    toggleFullscreen: jest.fn(),
  };

  beforeEach(async () => {
    mockUiState.chartLayout.set(ChartLayout.TRIPLE);
    await TestBed.configureTestingModule({
      imports: [ChartViewToolbarComponent],
      providers: [
        provideZonelessChangeDetection(),
        ChartToolbarStateService,
        { provide: UiStateService, useValue: mockUiState },
      ],
    }).compileComponents();

    toolbarState = TestBed.inject(ChartToolbarStateService);
    fixture = TestBed.createComponent(ChartViewToolbarComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('activeList', 'ALL');
    fixture.componentRef.setInput('listGroups', LIST_GROUPS);
    fixture.detectChanges();
  });

  const el = (): HTMLElement => fixture.nativeElement;
  const pill = (text: string): HTMLButtonElement | null =>
    Array.from(el().querySelectorAll<HTMLButtonElement>('.pill'))
      .find((b) => b.textContent?.trim() === text) ?? null;
  const menuByLabel = (label: string): RhSelectMenuComponent<SymbolListFilter> =>
    fixture.debugElement
      .queryAll(By.directive(RhSelectMenuComponent))
      .map((d) => d.componentInstance as RhSelectMenuComponent<SymbolListFilter>)
      .find((m) => m.label() === label)!;
  const scanMenu = (): RhSelectMenuComponent<SymbolListFilter> => menuByLabel('Scan');
  const listMenu = (): RhSelectMenuComponent<SymbolListFilter> => menuByLabel('List');

  it('renders controls in spec order: scan | list | indicators | symbol | chart controls | right group', () => {
    fixture.componentRef.setInput('symbol', 'AAPL');
    fixture.componentRef.setInput('tracked', true);
    fixture.componentRef.setInput('listCatalog', CATALOG);
    fixture.detectChanges();

    // Collect DOM order via TreeWalker of tagged landmarks.
    const landmarks: string[] = [];
    const walker = document.createTreeWalker(el(), NodeFilter.SHOW_ELEMENT);
    const wanted = new Map<Element, string>();
    for (const [name, sel] of [
      ['scan', 'app-rh-select-menu.scan-menu'],
      ['list', 'app-rh-select-menu.list-menu'],
      ['indicators', 'app-indicator-menu'],
      ['symbol', '.symbol-block'],
      ['controls', '.chart-controls'],
      ['chips', 'app-symbol-list-actions'],
      ['right', '.right-group'],
    ] as const) {
      const node = el().querySelector(sel);
      if (!node) throw new Error(`missing landmark ${sel}`);
      wanted.set(node, name);
    }
    let node = walker.nextNode();
    while (node) {
      if (wanted.has(node as Element)) landmarks.push(wanted.get(node as Element)!);
      node = walker.nextNode();
    }
    expect(landmarks).toEqual(['scan', 'list', 'indicators', 'symbol', 'controls', 'chips', 'right']);
  });

  it('renders no review-header elements — back/history/observation/reason are gone', () => {
    expect(el().querySelector('.back-btn')).toBeNull();
    expect(el().querySelector('.history-btn')).toBeNull();
    expect(el().querySelector('.observation-btn')).toBeNull();
    expect(el().querySelector('.reason')).toBeNull();
    expect(el().querySelector('app-run-metrics-strip')).toBeNull();
  });

  it('scan dropdown is live — `—` clear option leads the cache options and the active scan is bound (#1258)', () => {
    fixture.componentRef.setInput('scanOptions', SCAN_OPTIONS);
    fixture.componentRef.setInput('activeList', 'scan:gainers');
    fixture.detectChanges();
    const menu = scanMenu();
    expect(menu.disabled()).toBe(false);
    expect(menu.value()).toBe('scan:gainers');
    expect(menu.options()).toEqual([{ value: '—', label: '—' }, ...SCAN_OPTIONS]);
  });

  it('neither trigger renders blank — `—` on Scan under a list source, `All` on List under a scan (#1258)', () => {
    fixture.componentRef.setInput('scanOptions', SCAN_OPTIONS);
    fixture.componentRef.setInput('activeList', 'PRIMARY');
    fixture.detectChanges();
    expect(scanMenu().value()).toBe('—');
    expect(scanMenu().activeLabel()).toBe('—');
    expect(listMenu().value()).toBe('PRIMARY');

    fixture.componentRef.setInput('activeList', 'scan:gainers');
    fixture.detectChanges();
    expect(scanMenu().value()).toBe('scan:gainers');
    expect(listMenu().value()).toBe('ALL');
    expect(listMenu().activeLabel()).toBe('All');
  });

  it('picking a scan emits scanChange; `—` clears an active scan back to ALL but is a no-op on list sources (#1258)', () => {
    const picked: SymbolListFilter[] = [];
    component.scanChange.subscribe((v) => picked.push(v));
    const menu = scanMenu();
    menu.valueChange.emit('scan:quality-large');
    fixture.componentRef.setInput('activeList', 'scan:quality-large');
    fixture.detectChanges();
    menu.valueChange.emit('—');
    expect(picked).toEqual(['scan:quality-large', 'ALL']);
    // `—` shown as the idle display on a list source must not emit —
    // clearing a source that isn't set would silently reset the list.
    picked.length = 0;
    fixture.componentRef.setInput('activeList', 'PRIMARY');
    fixture.detectChanges();
    menu.valueChange.emit('—');
    expect(picked).toEqual([]);
  });

  it('the Scan menu is disabled when no cache docs exist (#1258)', () => {
    fixture.componentRef.setInput('scanOptions', []);
    fixture.detectChanges();
    expect(scanMenu().disabled()).toBe(true);
    expect(scanMenu().value()).toBe('—');
  });

  it('an active scan whose cache doc disappeared still resolves a label and keeps the `—` escape (#1258)', () => {
    fixture.componentRef.setInput('scanOptions', []);
    fixture.componentRef.setInput('activeList', 'scan:ghost');
    fixture.detectChanges();
    // The raw key is appended as a fallback option — no blank trigger —
    // and the menu stays enabled so `—` can clear the dead source
    // (the List menu works too, but the user shouldn't have to know that).
    const menu = scanMenu();
    expect(menu.value()).toBe('scan:ghost');
    expect(menu.activeLabel()).toBe('scan:ghost');
    expect(menu.disabled()).toBe(false);
    const cleared: SymbolListFilter[] = [];
    component.scanChange.subscribe((v) => cleared.push(v));
    menu.valueChange.emit('—');
    expect(cleared).toEqual(['ALL']);
  });

  it('the New-only pill is enabled + active on scan sources and emits newOnlyChange (#1258)', () => {
    fixture.componentRef.setInput('activeList', 'scan:gainers');
    fixture.componentRef.setInput('newOnly', true);
    fixture.detectChanges();
    const btn = el().querySelector<HTMLButtonElement>('.new-only-pill')!;
    expect(btn.disabled).toBe(false);
    expect(btn.classList.contains('active')).toBe(true);
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    const emitted: boolean[] = [];
    component.newOnlyChange.subscribe((v) => emitted.push(v));
    btn.click();
    expect(emitted).toEqual([false]);
  });

  it('the New-only pill is inert + inactive on list sources (#1258)', () => {
    fixture.componentRef.setInput('activeList', 'ALL');
    fixture.componentRef.setInput('newOnly', true);
    fixture.detectChanges();
    const btn = el().querySelector<HTMLButtonElement>('.new-only-pill')!;
    expect(btn.disabled).toBe(true);
    expect(btn.classList.contains('active')).toBe(false);
    expect(btn.getAttribute('aria-pressed')).toBe('false');
  });

  it('list dropdown emits the picked filter', () => {
    const picked: SymbolListFilter[] = [];
    component.listChange.subscribe((v) => picked.push(v));
    (el().querySelector('app-rh-select-menu.list-menu button') as HTMLButtonElement).click();
    fixture.detectChanges();
    const item = Array.from(document.querySelectorAll<HTMLElement>('.mat-mdc-menu-item'))
      .find((i) => i.textContent?.includes('Primary'));
    item?.click();
    expect(picked).toEqual(['PRIMARY']);
  });

  it('D/W/M pills write the service; interval state drives active styling', () => {
    pill('W')?.click();
    fixture.detectChanges();
    expect(toolbarState.selectedInterval()).toBe(BarsInterval.WEEKLY);
    expect(pill('W')?.classList.contains('active')).toBe(true);
  });

  it('indicator menu toggles apply through the service', () => {
    const spy = jest.spyOn(toolbarState, 'applyIndicatorToggle');
    const menu = fixture.debugElement.query(By.directive(IndicatorMenuComponent));
    menu.componentInstance.toggle.emit(['some-id']);
    expect(spy).toHaveBeenCalledWith(['some-id']);
  });

  it('chart controls write through: range pills, zoom, log scale, layout, fullscreen', () => {
    pill('1Y')?.click();
    expect(toolbarState.selectedRange()).toBe('1y');

    // Direct icon-button children of .chart-controls: zoom, layout, fullscreen.
    const [zoom, layout, fullscreen] = Array.from(
      el().querySelectorAll<HTMLButtonElement>('.chart-controls > button.icon-btn'),
    );
    const zoomSpy = jest.spyOn(toolbarState, 'toggleZoomToolbar');
    zoom.click();
    expect(zoomSpy).toHaveBeenCalled();
    layout.click();
    expect(mockUiState.toggleChartLayout).toHaveBeenCalled();
    fullscreen.click();
    expect(mockUiState.toggleFullscreen).toHaveBeenCalled();

    const logSpy = jest.spyOn(toolbarState, 'toggleLogScale');
    fixture.debugElement.query(By.directive(LogScalePillComponent)).componentInstance.toggle.emit();
    expect(logSpy).toHaveBeenCalled();
  });

  it('Enter in the symbol input emits loadSymbol', () => {
    const loaded: string[] = [];
    component.loadSymbol.subscribe((s) => loaded.push(s));
    const input = el().querySelector<HTMLInputElement>('.symbol-field')!;
    input.value = 'nvda';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    expect(loaded).toEqual(['nvda']);
  });

  it('Trade emits only when a symbol is selected', () => {
    const emitted: number[] = [];
    component.trade.subscribe(() => emitted.push(1));
    const btn = el().querySelector('.trade-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    btn.click();
    expect(emitted.length).toBe(0);
    fixture.componentRef.setInput('symbol', 'AAPL');
    fixture.detectChanges();
    btn.click();
    expect(emitted.length).toBe(1);
  });

  it('Order pill is gated on count only and emits goToOrder', () => {
    const emitted: number[] = [];
    component.goToOrder.subscribe(() => emitted.push(1));
    const btn = el().querySelector('.order-queue-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fixture.componentRef.setInput('orderCount', 2);
    fixture.detectChanges();
    expect(btn.disabled).toBe(false);
    btn.click();
    expect(emitted.length).toBe(1);
    expect(btn.textContent).toContain('2');
  });

  it('Add emits addToTracked; Load emits the typed symbol', () => {
    const added: number[] = [];
    const loaded: string[] = [];
    component.addToTracked.subscribe(() => added.push(1));
    component.loadSymbol.subscribe((s) => loaded.push(s));
    fixture.componentRef.setInput('symbol', 'AAPL');
    fixture.detectChanges();
    (el().querySelector('.add-btn') as HTMLButtonElement).click();
    expect(added.length).toBe(1);

    const input = el().querySelector<HTMLInputElement>('.symbol-field')!;
    input.value = 'nvda';
    (el().querySelector('.load-btn') as HTMLButtonElement).click();
    expect(loaded).toEqual(['nvda']);
  });

  it('prev/next nav emits; filing chips render only for tracked symbols', () => {
    const nav: string[] = [];
    component.prevSymbol.subscribe(() => nav.push('prev'));
    component.nextSymbol.subscribe(() => nav.push('next'));
    fixture.componentRef.setInput('symbol', 'AAPL');
    fixture.componentRef.setInput('symbolIndex', 1);
    fixture.componentRef.setInput('symbolCount', 3);
    fixture.detectChanges();

    const [prev, next] = Array.from(el().querySelectorAll<HTMLButtonElement>('.nav-btn'));
    prev.click(); next.click();
    expect(nav).toEqual(['prev', 'next']);
    // &nbsp; renders as   — normalize before asserting.
    const navText = el().querySelector('.nav-position')?.textContent?.replace(/ /g, ' ');
    expect(navText).toBe('2 / 3');

    // Chips hidden for untracked symbols, shown when tracked.
    fixture.componentRef.setInput('listCatalog', CATALOG);
    fixture.componentRef.setInput('tracked', false);
    fixture.detectChanges();
    expect(el().querySelector('app-symbol-list-actions')).toBeNull();
    fixture.componentRef.setInput('tracked', true);
    fixture.detectChanges();
    expect(el().querySelector('app-symbol-list-actions')).toBeTruthy();
  });
});
