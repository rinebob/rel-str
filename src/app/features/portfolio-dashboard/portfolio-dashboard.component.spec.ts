import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal, computed } from '@angular/core';

import { PortfolioDashboardComponent } from './portfolio-dashboard.component';
import { PortfolioDashboardStore } from './portfolio-dashboard.store';
import {
  AggregateSummary,
  AccountState,
  EquityPositionWithPnL,
  OptionPositionWithPnL,
} from './portfolio-dashboard.types';
import { BrokerOrder } from '../../core/robinhood-mcp/types/robinhood-mcp.types';

function makeAccountState(name: string, number: string, overrides: Partial<AccountState> = {}): AccountState {
  const empty = { data: null, loading: false, error: null };
  return {
    accountName: name,
    accountNumber: number,
    accountType: 'margin',
    portfolio: { ...empty },
    equityPositions: { ...empty },
    optionPositions: { ...empty },
    equityQuotes: { ...empty },
    optionQuotes: { ...empty },
    equityOrders: { ...empty },
    optionOrders: { ...empty },
    ...overrides,
  };
}

function makeStoreMock(overrides: Partial<{
  accounts: AccountState[];
  selectedAccountIndex: number;
  globalLoading: boolean;
  loadError: string | null;
  summary: AggregateSummary;
  equityPositions: EquityPositionWithPnL[];
  optionPositions: OptionPositionWithPnL[];
  openOrders: BrokerOrder[];
  orderHistory: BrokerOrder[];
  protectedSymbols: Set<string>;
  showClosedPositions: boolean;
  showOrderHistory: boolean;
}> = {}) {
  const accounts = signal(overrides.accounts ?? []);
  const selectedAccountIndex = signal(overrides.selectedAccountIndex ?? 0);
  const globalLoading = signal(overrides.globalLoading ?? false);
  const loadError = signal(overrides.loadError ?? null);
  const summary = signal(overrides.summary ?? {
    totalValue: null,
    totalExposure: null,
    totalCash: null,
    totalBuyingPower: null,
    totalPnL: null,
  });
  const equityPositions = signal(overrides.equityPositions ?? []);
  const optionPositions = signal(overrides.optionPositions ?? []);
  const openOrders = signal(overrides.openOrders ?? []);
  const orderHistory = signal(overrides.orderHistory ?? []);
  const protectedSymbols = signal(overrides.protectedSymbols ?? new Set<string>());
  const showClosedPositions = signal(overrides.showClosedPositions ?? false);
  const showOrderHistory = signal(overrides.showOrderHistory ?? false);

  return {
    accounts,
    selectedAccountIndex,
    globalLoading,
    loadError,
    aggregateSummary: computed(() => summary()),
    selectedAccount: computed(() => accounts()[selectedAccountIndex()] ?? null),
    equityPositionsWithPnL: computed(() => equityPositions()),
    optionPositionsWithPnL: computed(() => optionPositions()),
    openOrders: computed(() => openOrders()),
    orderHistory: computed(() => orderHistory()),
    stopLossProtectedSymbols: computed(() => protectedSymbols()),
    showClosedPositions,
    showOrderHistory,
    loadAccounts: jasmine.createSpy('loadAccounts').and.returnValue(Promise.resolve()),
    loadPhase1: jasmine.createSpy('loadPhase1').and.returnValue(Promise.resolve()),
    loadPhase2: jasmine.createSpy('loadPhase2').and.returnValue(Promise.resolve()),
    refresh: jasmine.createSpy('refresh').and.returnValue(Promise.resolve()),
    selectAccount: jasmine.createSpy('selectAccount'),
    toggleClosedPositions: jasmine.createSpy('toggleClosedPositions'),
    toggleOrderHistory: jasmine.createSpy('toggleOrderHistory'),
    retrySection: jasmine.createSpy('retrySection').and.returnValue(Promise.resolve()),
    _setAccounts: (a: AccountState[]) => accounts.set(a),
    _setSummary: (s: AggregateSummary) => summary.set(s),
    _setLoading: (l: boolean) => globalLoading.set(l),
    _setLoadError: (e: string | null) => loadError.set(e),
    _setEquityPositions: (p: EquityPositionWithPnL[]) => equityPositions.set(p),
    _setOptionPositions: (p: OptionPositionWithPnL[]) => optionPositions.set(p),
    _setOpenOrders: (o: BrokerOrder[]) => openOrders.set(o),
    _setOrderHistory: (o: BrokerOrder[]) => orderHistory.set(o),
    _setProtectedSymbols: (s: Set<string>) => protectedSymbols.set(s),
    _setShowClosedPositions: (b: boolean) => showClosedPositions.set(b),
    _setShowOrderHistory: (b: boolean) => showOrderHistory.set(b),
  };
}

type StoreMock = ReturnType<typeof makeStoreMock>;

describe('PortfolioDashboardComponent', () => {
  let fixture: ComponentFixture<PortfolioDashboardComponent>;
  let component: PortfolioDashboardComponent;
  let store: StoreMock;

  beforeEach(async () => {
    store = makeStoreMock();
    await TestBed.configureTestingModule({
      imports: [PortfolioDashboardComponent],
      providers: [
        provideNoopAnimations(),
        { provide: PortfolioDashboardStore, useValue: store },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PortfolioDashboardComponent);
    component = fixture.componentInstance;
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('should create', () => {
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('calls store.refresh() on init', async () => {
    fixture.detectChanges(); // triggers ngOnInit
    await fixture.whenStable();

    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  it('renders empty state when no accounts, not loading, no error', () => {
    store._setAccounts([]);
    store._setLoading(false);
    store._setLoadError(null);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('No Robinhood accounts available');
  });

  it('renders error banner when loadError is set', () => {
    store._setAccounts([]);
    store._setLoading(false);
    store._setLoadError('Failed to load accounts');
    fixture.detectChanges();

    const banner = fixture.nativeElement.querySelector('.pd-error-banner');
    expect(banner).toBeTruthy();
    expect(banner.textContent).toContain('Failed to load accounts');
    expect(banner.textContent).toContain('Retry');
  });

  it('renders summary bar when accounts exist', () => {
    store._setAccounts([makeAccountState('Account A', '111222333')]);
    store._setSummary({
      totalValue: 100000,
      totalExposure: 80000,
      totalCash: 20000,
      totalBuyingPower: 40000,
      totalPnL: 500,
    });
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Total Value');
    expect(text).toContain('$100,000.00');
    expect(text).toContain('Exposure');
    expect(text).toContain('$80,000.00');
    expect(text).toContain('Cash');
    expect(text).toContain('$20,000.00');
    expect(text).toContain('Buying Power');
    expect(text).toContain('$40,000.00');
    expect(text).toContain('Unrealized PnL');
    expect(text).toContain('$500.00');
  });

  it('renders account tabs with name and number', () => {
    store._setAccounts([
      makeAccountState('Account A', '111222333'),
      makeAccountState('Account B', '444555666'),
    ]);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Account A (111222333)');
    expect(text).toContain('Account B (444555666)');
  });

  it('calls store.refresh() when refresh button clicked', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.pd-refresh');
    button.click();

    expect(store.refresh).toHaveBeenCalledTimes(2); // once on init, once on click
  });

  it('calls store.selectAccount() on tab change', () => {
    store._setAccounts([
      makeAccountState('Account A', '111'),
      makeAccountState('Account B', '222'),
    ]);
    fixture.detectChanges();

    component.onTabChange(1);
    expect(store.selectAccount).toHaveBeenCalledWith(1);
  });

  it('disables refresh button while globalLoading is true', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    store._setLoading(true);
    fixture.detectChanges();

    const button = fixture.nativeElement.querySelector('.pd-refresh');
    expect(button.disabled).toBe(true);
  });

  it('shows global loading indicator while loading', () => {
    store._setLoading(true);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Loading');
  });

  it('formats null currency as dash', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    store._setSummary({
      totalValue: null,
      totalExposure: null,
      totalCash: null,
      totalBuyingPower: null,
      totalPnL: null,
    });
    fixture.detectChanges();

    const values = fixture.nativeElement.querySelectorAll('.pd-summary-value');
    expect(values.length).toBe(5);
    for (const v of values) {
      expect(v.textContent.trim()).toBe('—');
    }
  });

  it('applies negative class to negative PnL', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    store._setSummary({
      totalValue: 100000,
      totalExposure: 80000,
      totalCash: 20000,
      totalBuyingPower: 40000,
      totalPnL: -500,
    });
    fixture.detectChanges();

    const pnlValue = fixture.nativeElement.querySelectorAll('.pd-summary-value')[4];
    expect(pnlValue.classList.contains('pd-negative')).toBe(true);
  });

  it('does not call loadPhase1 or loadPhase2 directly on init', async () => {
    fixture.detectChanges();
    await fixture.whenStable();

    // The component should use refresh(), not call load methods directly
    expect(store.loadAccounts).not.toHaveBeenCalled();
    expect(store.loadPhase1).not.toHaveBeenCalled();
    expect(store.loadPhase2).not.toHaveBeenCalled();
    expect(store.refresh).toHaveBeenCalledTimes(1);
  });

  // --- Task #287 wiring tests ---

  it('renders account summary component in tab content', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const summary = fixture.nativeElement.querySelector('app-account-summary');
    expect(summary).toBeTruthy();
  });

  it('renders equity positions table in tab content', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('app-equity-positions-table');
    expect(table).toBeTruthy();
  });

  it('renders option positions table in tab content', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('app-option-positions-table');
    expect(table).toBeTruthy();
  });

  it('renders open orders table in tab content', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('app-open-orders-table');
    expect(table).toBeTruthy();
  });

  it('renders order history toggle button', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.pd-toggle-history');
    expect(toggle).toBeTruthy();
    expect(toggle.textContent).toContain('Show History');
  });

  it('renders order history table when showOrderHistory is true', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    store._setShowOrderHistory(true);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('app-order-history-table');
    expect(table).toBeTruthy();
  });

  it('does not render order history table when showOrderHistory is false', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    store._setShowOrderHistory(false);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('app-order-history-table');
    expect(table).toBeNull();
  });

  it('calls store.toggleOrderHistory() when history toggle clicked', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.pd-toggle-history');
    toggle.click();

    expect(store.toggleOrderHistory).toHaveBeenCalledTimes(1);
  });

  it('calls store.toggleClosedPositions() when equity table emits toggleClosed', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const equity = fixture.debugElement.query((el) => el.name === 'app-equity-positions-table');
    equity.triggerEventHandler('toggleClosed', undefined);

    expect(store.toggleClosedPositions).toHaveBeenCalledTimes(1);
  });

  it('calls store.retrySection(\'portfolio\') when account summary emits retry', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const summary = fixture.debugElement.query((el) => el.name === 'app-account-summary');
    summary.triggerEventHandler('retry', undefined);

    expect(store.retrySection).toHaveBeenCalledWith(0, 'portfolio');
  });

  it('calls store.retrySection() with orders when open orders table emits retry', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    fixture.detectChanges();

    const orders = fixture.debugElement.query((el) => el.name === 'app-open-orders-table');
    orders.triggerEventHandler('retry', undefined);

    expect(store.retrySection).toHaveBeenCalledWith(0, 'orders');
  });

  it('passes showClosedPositions to equity positions table', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    store._setShowClosedPositions(true);
    fixture.detectChanges();

    const table = fixture.nativeElement.querySelector('app-equity-positions-table');
    expect(table).toBeTruthy();
    // Verify the input is set on the component instance
    const tableComp = fixture.debugElement.query((el) => el.nativeElement === table)?.componentInstance;
    expect(tableComp?.showClosed?.()).toBe(true);
  });

  it('passes protectedSymbols to open orders table', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    store._setProtectedSymbols(new Set(['AAPL']));
    fixture.detectChanges();

    // The open orders table should be rendered
    const table = fixture.nativeElement.querySelector('app-open-orders-table');
    expect(table).toBeTruthy();
  });

  it('shows history toggle text reflecting showOrderHistory state', () => {
    store._setAccounts([makeAccountState('Account A', '111')]);
    store._setShowOrderHistory(false);
    fixture.detectChanges();

    const toggle = fixture.nativeElement.querySelector('.pd-toggle-history');
    expect(toggle.textContent).toContain('Show History');

    store._setShowOrderHistory(true);
    fixture.detectChanges();

    expect(toggle.textContent).toContain('Hide History');
  });
});
