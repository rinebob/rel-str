/// <reference types="jest" />
/**
 * ChartViewComponent — the chart-view page (#1232/#1256): merged toolbar,
 * symbol pane, and SignalDetailComponent with showToolbar=false. Trade is
 * the manual-order path (no run gating); viewed symbols dim session-locally.
 */
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
  doc: jest.fn((_fs: unknown, ...parts: string[]) => ({ parts })),
  getDoc: jest.fn(),
  collection: jest.fn(),
  collectionData: jest.fn(),
  setDoc: jest.fn(),
  getDocs: jest.fn(),
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  Component,
  EventEmitter,
  Input,
  Output,
  provideZonelessChangeDetection,
  signal,
} from '@angular/core';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';

import { ChartViewComponent } from './chart-view.component';
import { ChartViewToolbarComponent } from '../../components/chart-view-toolbar/chart-view-toolbar.component';
import { SignalListComponent } from '../../components/signal-list/signal-list.component';
import { SignalDetailComponent } from '../../components/signal-detail/signal-detail.component';
import { ChartViewViewportService } from '../../services/chart-view-viewport.service';
import { ChartToolbarStateService } from '../../services/chart-toolbar-state.service';
import { SymbolListStore } from '../../stores/symbol-list.store';
import { LatestRunStore } from '../../stores/latest-run.store';
import { OrderTicketStore } from '../../stores/order-ticket.store';
import { ManualOrderService } from '../../services/manual-order.service';
import { UiStateService, ChartLayout } from '../../../../core/services/ui-state.service';
import { AppRoutes } from '../../../../core/common/interfaces';
import { ST_SYMBOLS_ROOT } from '@st/collections';
import { NO_MEMBERSHIP } from '../../common/constants';
import {
  InstrumentType,
  OrderSource,
  OrderTicketStatus,
  type EquityOrderTicket,
} from '../../services/order-ticket.types';
import type { SymbolListFilter } from '../../common/constants';
import type { SymbolListDef } from '../../common/symbol-list-defs';
import type { RhSelectOption, RhSelectOptionGroup } from '../../components/rh-select-menu/rh-select-menu.component';
import type { ScanLatestRun } from '@st/scanner';
import { scanRow, scanRun } from '../../testing/scan-fixtures';
import type { ScanRowMeta } from '../../utils/scanner-rows.util';

// NOTE: mock children use @Input()/@Output() decorators, NOT signal
// input()/output() — signal-based fields in a spec-local component class
// silently break jest.mock hoisting under jest-preset-angular (the factory
// never registers, so mocked modules resolve to the real implementations).
@Component({ selector: 'app-chart-view-toolbar', standalone: true, template: '' })
class MockToolbarComponent {
  @Input() activeList!: SymbolListFilter;
  @Input() scanOptions: RhSelectOption<SymbolListFilter>[] = [];
  @Input() newOnly = true;
  @Input() listGroups: RhSelectOptionGroup<SymbolListFilter>[] = [];
  @Input() symbol: string | null = null;
  @Input() companyName: string | null = null;
  @Input() tracked = false;
  @Input() listCatalog: SymbolListDef[] = [];
  @Input() symbolIndex = -1;
  @Input() symbolCount = 0;
  @Input() orderCount = 0;
  @Output() listChange = new EventEmitter<SymbolListFilter>();
  @Output() scanChange = new EventEmitter<SymbolListFilter>();
  @Output() newOnlyChange = new EventEmitter<boolean>();
  @Output() trade = new EventEmitter<void>();
  @Output() goToOrder = new EventEmitter<void>();
  @Output() addToTracked = new EventEmitter<void>();
  @Output() loadSymbol = new EventEmitter<string>();
  @Output() toggleList = new EventEmitter<{ symbol: string; listKey: string }>();
  @Output() prevSymbol = new EventEmitter<void>();
  @Output() nextSymbol = new EventEmitter<void>();
}

@Component({ selector: 'app-signal-list', standalone: true, template: '' })
class MockSignalListComponent {
  @Input() selectedSymbol: string | null = null;
  @Input() manualSymbol: string | null = null;
  @Input() symbols: string[] = [];
  @Input() newSymbols: string[] = [];
  @Input() dimmedSymbols: ReadonlySet<string> = new Set();
  @Input() rowMeta: Record<string, ScanRowMeta> = {};
  @Output() symbolSelected = new EventEmitter<string>();
}

@Component({ selector: 'app-signal-detail', standalone: true, template: '' })
class MockSignalDetailComponent {
  @Input() manualSymbol: string | null = null;
  @Input() listCatalog: SymbolListDef[] = [];
  @Input() showToolbar = true;
}

function ticket(id: string, status: OrderTicketStatus): EquityOrderTicket {
  return {
    id, refId: `ref-${id}`, source: OrderSource.MANUAL, status,
    accountNumber: 'acct', side: 'buy', orderType: 'market',
    timeInForce: 'gfd', marketHours: 'regular_hours',
    createdAt: '2026-01-01', updatedAt: '2026-01-01',
    instrumentType: InstrumentType.EQUITY, symbol: 'AAPL',
  };
}

describe('ChartViewComponent', () => {
  let fixture: ComponentFixture<ChartViewComponent>;
  let component: ChartViewComponent;
  let toolbar: MockToolbarComponent;

  const listCatalog = signal<SymbolListDef[]>([
    { key: 'PRIMARY', label: 'Primary', order: 0, role: 'exclusive', hidden: false, symbols: ['AAPL', 'MSFT'] },
    { key: 'SECONDARY', label: 'Secondary', order: 1, role: 'exclusive', hidden: false, symbols: [] },
  ]);
  const trackedSymbols = signal<string[]>(['AAPL', 'MSFT']);
  const profilesBySymbol = signal(new Map<string, { name?: string }>());
  const tickets = signal<Record<string, EquityOrderTicket>>({});

  const symbolListStore = {
    catalog: listCatalog,
    byKey: () => new Map(listCatalog().map((d) => [d.key, d])),
    symbolLists: () => Object.fromEntries(listCatalog().map((d) => [d.key, d.symbols])),
    untriagedSymbols: signal<string[]>([]),
    trackedSymbols,
    profilesBySymbol,
    filterOptionGroups: signal<RhSelectOptionGroup<SymbolListFilter>[]>([]),
    loadSymbolLists: jest.fn(),
    loadTrackedSymbols: jest.fn().mockResolvedValue([]),
    loadProfiles: jest.fn().mockResolvedValue([]),
    toggleSymbolInList: jest.fn(),
  };
  const ticketStore = { tickets, loadTickets: jest.fn() };
  const latestRuns = signal(new Map<string, ScanLatestRun>());
  const scanOptions = signal<RhSelectOption<SymbolListFilter>[]>([]);
  const latestRunStore = {
    latestRuns,
    scanOptions,
    rowsFor: jest.fn((recipeId: string) => latestRuns().get(recipeId)?.rows ?? []),
    loadLatestRuns: jest.fn(),
  };
  const manualOrderService = { open: jest.fn().mockResolvedValue(undefined) };
  const snackBar = { open: jest.fn() };
  const router = { navigate: jest.fn().mockResolvedValue(true) };
  const uiState = {
    chartLayout: signal(ChartLayout.TRIPLE),
    fullscreen: signal(false),
    sidebarCollapsed: signal(false),
    toggleSidebar: jest.fn(),
    setFullscreen: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    listCatalog.set([
      { key: 'PRIMARY', label: 'Primary', order: 0, role: 'exclusive', hidden: false, symbols: ['AAPL', 'MSFT'] },
      { key: 'SECONDARY', label: 'Secondary', order: 1, role: 'exclusive', hidden: false, symbols: [] },
    ]);
    trackedSymbols.set(['AAPL', 'MSFT']);
    tickets.set({});
    profilesBySymbol.set(new Map());
    latestRuns.set(new Map());
    scanOptions.set([]);
    uiState.fullscreen.set(false);
    (getDoc as jest.Mock).mockResolvedValue({
      exists: () => true,
      data: () => ({ name: 'Apple Inc.' }),
    });

    await TestBed.configureTestingModule({
      imports: [ChartViewComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: SymbolListStore, useValue: symbolListStore },
        { provide: LatestRunStore, useValue: latestRunStore },
        { provide: OrderTicketStore, useValue: ticketStore },
        { provide: ManualOrderService, useValue: manualOrderService },
        { provide: MatSnackBar, useValue: snackBar },
        { provide: Router, useValue: router },
        { provide: UiStateService, useValue: uiState },
        { provide: Firestore, useValue: {} },
      ],
    })
      .overrideComponent(ChartViewComponent, {
        remove: { imports: [ChartViewToolbarComponent, SignalListComponent, SignalDetailComponent] },
        add: { imports: [MockToolbarComponent, MockSignalListComponent, MockSignalDetailComponent] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ChartViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    toolbar = fixture.debugElement.query(By.directive(MockToolbarComponent)).componentInstance;
  });

  it('provides ChartToolbarStateService at page scope and renders the detail with showToolbar=false', () => {
    const detail = fixture.debugElement.query(By.directive(MockSignalDetailComponent)).componentInstance;
    expect(detail.showToolbar).toBe(false);
    // Page-scoped: not resolvable from the root injector, but the toolbar
    // and detail children share the single page-provided instance.
    expect(() => TestBed.inject(ChartToolbarStateService)).toThrow();
    const toolbarState = fixture.debugElement
      .query(By.directive(MockToolbarComponent))
      .injector.get(ChartToolbarStateService);
    const detailState = fixture.debugElement
      .query(By.directive(MockSignalDetailComponent))
      .injector.get(ChartToolbarStateService);
    expect(toolbarState).toBe(detailState);
  });

  it('auto-selects the first viewport symbol; selection dims the row', () => {
    // PRIMARY isn't the default — switch the source to it via the toolbar emit.
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('AAPL');

    toolbar.prevSymbol.emit(); // no-op at index 0
    toolbar.nextSymbol.emit();
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('MSFT');
    expect(component.viewedSymbols().has('AAPL')).toBe(true);
    expect(component.viewedSymbols().has('MSFT')).toBe(true);
  });

  it('Trade calls manualOrderService.open(symbol) with no run gating', async () => {
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    toolbar.trade.emit();
    expect(manualOrderService.open).toHaveBeenCalledWith('AAPL');
  });

  it('Order pill navigates to the order page; count reflects non-terminal tickets', () => {
    tickets.set({ t1: ticket('t1', OrderTicketStatus.STAGED), t2: ticket('t2', OrderTicketStatus.FILLED) });
    fixture.detectChanges();
    expect(toolbar.orderCount).toBe(1);
    toolbar.goToOrder.emit();
    expect(router.navigate).toHaveBeenCalledWith(['/' + AppRoutes.SIGNAL_ORDER]);
  });

  it('Add to tracked is a coming-soon snackbar — no service call', () => {
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    toolbar.addToTracked.emit();
    expect(snackBar.open).toHaveBeenCalled();
  });

  it('symbol input + Load drives the manual path', () => {
    toolbar.loadSymbol.emit('nvda');
    fixture.detectChanges();
    expect(component.manualSymbol()).toBe('NVDA');
    const detail = fixture.debugElement.query(By.directive(MockSignalDetailComponent)).componentInstance;
    expect(detail.manualSymbol).toBe('NVDA');
  });

  it('pane selection clears a loaded manual symbol (no stale fallback)', () => {
    toolbar.loadSymbol.emit('XYZ');
    fixture.detectChanges();
    const list = fixture.debugElement.query(By.directive(MockSignalListComponent)).componentInstance;
    list.symbolSelected.emit('AAPL');
    fixture.detectChanges();
    expect(component.manualSymbol()).toBeNull();
    expect(component.selectedSymbol()).toBe('AAPL');
  });

  it('next with a manual symbol loaded returns to list mode at pane head', () => {
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    toolbar.loadSymbol.emit('XYZ');
    fixture.detectChanges();
    expect(component.activeSymbol()).toBe('XYZ');
    toolbar.nextSymbol.emit();
    fixture.detectChanges();
    expect(component.manualSymbol()).toBeNull();
    expect(component.selectedSymbol()).toBe('AAPL');
  });

  it('resolves the company name via the symbol doc lookup', async () => {
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();
    // Pin the Firestore path contract — the mock accepts anything.
    expect(doc).toHaveBeenCalledWith(expect.anything(), ST_SYMBOLS_ROOT, 'AAPL');
    expect(getDoc).toHaveBeenCalled();
    expect(component.selectedSymbolName()).toBe('Apple Inc.');
  });

  it('untracked symbols show no filing chips; tracked symbols do', () => {
    toolbar.loadSymbol.emit('XYZ');
    fixture.detectChanges();
    expect(toolbar.tracked).toBe(false);
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('AAPL');
    expect(toolbar.tracked).toBe(true);
  });

  it('filing the selected symbol out of the active list advances the queue', () => {
    // The real store has NO optimistic update — the catalog must stay
    // unchanged through the write so advanceQueue sees the pre-echo
    // viewport. The earlier version mutated inside the mock, which fed
    // advanceQueue a post-echo viewport (idx=-1 → select(undefined)) and
    // let the auto-select effect deliver the expected symbol by accident.
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('AAPL');
    toolbar.toggleList.emit({ symbol: 'AAPL', listKey: 'SECONDARY' });
    fixture.detectChanges();
    expect(symbolListStore.toggleSymbolInList).toHaveBeenCalledWith('AAPL', 'SECONDARY');
    // Pre-echo: the advance already happened — 'MSFT' is the neighbor.
    expect(component.selectedSymbol()).toBe('MSFT');
    // Echo arrives: PRIMARY now holds only MSFT; selection stays valid.
    listCatalog.set([
      { key: 'PRIMARY', label: 'Primary', order: 0, role: 'exclusive', hidden: false, symbols: ['MSFT'] },
      { key: 'SECONDARY', label: 'Secondary', order: 1, role: 'exclusive', hidden: false, symbols: ['AAPL'] },
    ]);
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('MSFT');
  });

  it('filing a symbol already gone from the viewport hits the idx=-1 guard', () => {
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('AAPL');
    // An external snapshot shrinks PRIMARY before the file-out write —
    // the selected symbol is no longer in the viewport (idx === -1).
    // Without the guard, advanceQueue would select(undefined). Emitting
    // before the next flush exercises the guard synchronously — if the
    // escape effect ran first it would advance/clear the selection and
    // the advanceQueue path would never be reached.
    listCatalog.set([
      { key: 'PRIMARY', label: 'Primary', order: 0, role: 'exclusive', hidden: false, symbols: ['MSFT'] },
      { key: 'SECONDARY', label: 'Secondary', order: 1, role: 'exclusive', hidden: false, symbols: [] },
    ]);
    expect(component.viewportSymbols()).toEqual(['MSFT']);
    toolbar.toggleList.emit({ symbol: 'AAPL', listKey: 'SECONDARY' });
    fixture.detectChanges();
    // Selection cleared → auto-select legitimately picks the pane head.
    expect(component.selectedSymbol()).toBe('MSFT');
    expect([...component.viewedSymbols()]).not.toContain(undefined);
  });

  it('list change clears selection and manual symbol', () => {
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('AAPL');
    toolbar.loadSymbol.emit('XYZ');
    fixture.detectChanges();
    toolbar.listChange.emit(NO_MEMBERSHIP);
    fixture.detectChanges();
    expect(component.manualSymbol()).toBeNull();
    expect(component.selectedSymbol()).toBeNull();
  });

  it('ngOnInit warms the latest-run cache so the Scan dropdown has options (#1258)', () => {
    expect(latestRunStore.loadLatestRuns).toHaveBeenCalled();
  });

  it('the Scan dropdown gets the store options; scanChange drives the single source slot (#1258)', () => {
    const options: RhSelectOption<SymbolListFilter>[] = [
      { value: 'scan:gainers', label: 'Gainers · ran 14:00' },
    ];
    scanOptions.set(options);
    latestRuns.set(new Map([['gainers', scanRun('gainers', ['NEW1'])]]));
    fixture.detectChanges();
    expect(toolbar.scanOptions).toBe(options);
    expect(toolbar.newOnly).toBe(true);

    toolbar.scanChange.emit('scan:gainers');
    fixture.detectChanges();
    expect(component.activeList()).toBe('scan:gainers');
    expect(component.viewportSymbols()).toEqual(['NEW1']);

    // A list pick afterwards leaves exactly one active source.
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    expect(component.activeList()).toBe('PRIMARY');
  });

  it('New-only hides tracked scan rows; hiding the selection advances to its dropped-index neighbor (#1258)', () => {
    latestRuns.set(new Map([['gainers', scanRun('gainers', ['NEW1', 'NEW2', 'AAPL', 'NEW3'])]]));
    toolbar.scanChange.emit('scan:gainers');
    fixture.detectChanges();
    // AAPL is tracked — New-only (default on) filters it; NEW1 auto-selects.
    expect(component.viewportSymbols()).toEqual(['NEW1', 'NEW2', 'NEW3']);
    expect(component.selectedSymbol()).toBe('NEW1');

    // Toggle off → the tracked row appears at its scan-order slot; select it.
    toolbar.newOnlyChange.emit(false);
    fixture.detectChanges();
    expect(component.viewportSymbols()).toEqual(['NEW1', 'NEW2', 'AAPL', 'NEW3']);
    const list = fixture.debugElement.query(By.directive(MockSignalListComponent)).componentInstance;
    list.symbolSelected.emit('AAPL');
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('AAPL');

    // Toggle back on → AAPL escapes at index 2; the guard advances to the
    // survivor at that index (NEW3), not the pane head — advanceQueue
    // semantics, keeping the user's place mid-pane.
    toolbar.newOnlyChange.emit(true);
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('NEW3');
  });

  it('untracked scan rows reach the list as NEW-chip symbols (#1258)', () => {
    latestRuns.set(new Map([['gainers', scanRun('gainers', ['NEW1', 'AAPL', 'NEW2'])]]));
    toolbar.scanChange.emit('scan:gainers');
    toolbar.newOnlyChange.emit(false); // tracked row back in the pane
    fixture.detectChanges();
    const list = fixture.debugElement.query(By.directive(MockSignalListComponent)).componentInstance;
    expect(list.newSymbols).toEqual(['NEW1', 'NEW2']);
    // List sources have no untracked rows — no chips.
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();
    expect(list.newSymbols).toEqual([]);
  });

  it('the escape guard clears the selection when the viewport empties (#1258)', () => {
    latestRuns.set(new Map([['gainers', scanRun('gainers', ['NEW1'])]]));
    toolbar.scanChange.emit('scan:gainers');
    fixture.detectChanges();
    expect(component.selectedSymbol()).toBe('NEW1');

    // The cache doc shrinks to nothing (a fresher run, a stale page) —
    // no survivor to advance to: clear, and auto-select stays out of an
    // empty pane.
    latestRuns.set(new Map([['gainers', scanRun('gainers', [])]]));
    fixture.detectChanges();
    expect(component.viewportSymbols()).toEqual([]);
    expect(component.selectedSymbol()).toBeNull();
  });

  it('paneRowMeta — scan rows: wire Name beats st-symbols; the profile map fills gaps; sort column is the detail (#1313)', () => {
    latestRuns.set(
      new Map([
        [
          'near-52w-high',
          scanRun('near-52w-high', [
            scanRow('ACME', { Name: 'Acme Corp', 'Range pos': '0.975' }),
            scanRow('WIDGET', { 'Range pos': '0.951' }),
            scanRow('GHOST'),
          ]),
        ],
      ]),
    );
    profilesBySymbol.set(
      new Map([
        // The scan's own 'Name' wins over the st-symbols profile name.
        ['ACME', { name: 'Acme Industries LLC' }],
        ['WIDGET', { name: 'Widget Inc' }],
      ]),
    );
    toolbar.scanChange.emit('scan:near-52w-high');
    fixture.detectChanges();

    expect(component.paneRowMeta()).toEqual({
      ACME: { name: 'Acme Corp', detail: 'Range pos: 97.5%' },
      WIDGET: { name: 'Widget Inc', detail: 'Range pos: 95.1%' },
      // GHOST — nothing resolvable anywhere: no entry (ticker-only row).
    });

    const list = fixture.debugElement.query(By.directive(MockSignalListComponent)).componentInstance;
    expect(list.rowMeta['ACME'].name).toBe('Acme Corp');
  });

  it('paneRowMeta — list sources resolve st-symbols names only, no detail (#1313)', () => {
    profilesBySymbol.set(new Map([['AAPL', { name: 'Apple Inc.' }]]));
    toolbar.listChange.emit('PRIMARY');
    fixture.detectChanges();

    expect(component.paneRowMeta()).toEqual({ AAPL: { name: 'Apple Inc.' } });
    expect(symbolListStore.loadProfiles).toHaveBeenCalled();
  });
});
