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
import type { RhSelectOptionGroup } from '../rh-select-menu/rh-select-menu.component';
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

  it('scan dropdown renders disabled; new-only pill renders disabled', () => {
    const scan = el().querySelector('app-rh-select-menu.scan-menu button') as HTMLButtonElement;
    expect(scan.disabled).toBe(true);
    const newOnly = el().querySelector('.new-only-pill') as HTMLButtonElement;
    expect(newOnly?.disabled).toBe(true);
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
