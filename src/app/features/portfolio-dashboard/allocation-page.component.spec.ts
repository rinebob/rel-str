/**
 * AllocationPageComponent — the Allocation Manager page shell (task #588).
 *
 * ACs: route + nav reachable; every account renders a tab, non-agentic
 * flagged; header reconciles value/allocated/cash per selected account;
 * tab switch re-scopes subtabs.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { MatDialog } from '@angular/material/dialog';
import { AllocationPageComponent } from './allocation-page.component';
import { AllocationStore } from './allocation.store';
import type { AccountInfo } from '../../core/robinhood-mcp/types/robinhood-mcp.types';
import type {
  AccountHeader,
  BucketRow,
  PositionRow,
} from './allocation.types';
import CORE_ROUTES from '../../core/core-routes';
import { AppRoutes } from '../../core/common/interfaces';
import { NAV_MENU_ITEMS } from '../../core/common/constants';
import { BucketStatus } from '@portfolio-allocation/contracts';

const ACCT_A = '5AC11111';
const ACCT_B = '9BB22222';

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function account(num: string, agentic = true): AccountInfo {
  return { accountNumber: num, accountName: `Acct ${num}`, accountType: 'margin', agenticAllowed: agentic };
}

function header(over: Partial<AccountHeader> = {}): AccountHeader {
  return {
    accountValue: 10000, allocated: 3500, cash: 4000,
    derivedCash: 6500, cashDiverged: true, unassignedExposure: 500,
    asOf: '2026-09-26T12:00:00Z', ...over,
  };
}

function bucketRow(name: string): BucketRow {
  return {
    kind: 'bucket',
    bucket: {
      id: 'b1', userId: 'u', accountNumber: ACCT_A, name,
      targetPct: 25, status: BucketStatus.ACTIVE,
      createdAt: 'x', updatedAt: 'x',
    },
    stats: {
      bucketId: 'b1', exposure: 1000, netValue: 1000, targetDollars: 1000,
      drift: 0, realizedPnl: 150, unrealizedPnl: 200, openCount: 1,
      closedCount: 0, asOf: 'x', equityCurve: [],
    },
    cash: null,
  };
}

function positionRow(instrumentId: string, bucketName: string): PositionRow {
  return {
    position: { instrumentId, quantity: 10, marketValue: 1000, costBasis: 800 },
    bucketId: bucketName === 'Unassigned' ? null : 'b1',
    bucketName,
  };
}

const ACCT_A_ROWS: PositionRow[] = [positionRow('AAPL', 'Wheel'), positionRow('NVDA', 'Unassigned')];
const ACCT_B_ROWS: PositionRow[] = [positionRow('TSLA', 'Unassigned')];

function mockStore() {
  const idx = signal(0);
  const positionsRows = signal<PositionRow[]>(ACCT_A_ROWS);
  const hdr = signal<AccountHeader | null>(header());
  const bucketRows = signal<BucketRow[]>([
    bucketRow('Wheel'),
    { kind: 'unassigned', bucket: null, stats: null, cash: null },
    { kind: 'cash', bucket: null, stats: null, cash: null },
  ]);
  const selectAccount = jest.fn(async (i: number) => {
    // Re-scope the mock like the real store — selectors reflect the
    // newly selected account's data.
    idx.set(i);
    positionsRows.set(i === 1 ? ACCT_B_ROWS : ACCT_A_ROWS);
    bucketRows.set(i === 1
      ? [bucketRow('Income'), { kind: 'unassigned', bucket: null, stats: null, cash: null }, { kind: 'cash', bucket: null, stats: null, cash: null }]
      : [bucketRow('Wheel'), { kind: 'unassigned', bucket: null, stats: null, cash: null }, { kind: 'cash', bucket: null, stats: null, cash: null }]);
    hdr.set(i === 1 ? header({ accountValue: 5000, allocated: 300, cash: 1000 }) : header());
  });
  return {
    accounts: signal<AccountInfo[]>([account(ACCT_A), account(ACCT_B, false)]),
    selectedAccountIndex: idx,
    loadError: signal<string | null>(null),
    selectedAccount: signal<AccountInfo | null>(account(ACCT_A)),
    bucketRows,
    positionsRows,
    accountHeader: hdr,
    selectedAllocation: signal({
      snapshot: null, positions: [], fills: [], buckets: [], attributions: [],
      asOf: '2026-09-26T12:00:00Z', loading: false, error: null,
    }),
    loadAccounts: jest.fn(async () => undefined),
    selectAccount,
    refresh: jest.fn(async () => undefined),
    createBucket: jest.fn(async () => undefined),
    renameBucket: jest.fn(async () => undefined),
    updateTargetPct: jest.fn(async () => undefined),
    retireBucket: jest.fn(async () => undefined),
    deleteBucket: jest.fn(async () => undefined),
    assignPosition: jest.fn(async () => undefined),
    unassignPosition: jest.fn(async () => undefined),
  };
}

describe('AllocationPageComponent', () => {
  let fixture: ComponentFixture<AllocationPageComponent>;
  let store: ReturnType<typeof mockStore>;

  async function setup() {
    store = mockStore();
    await TestBed.configureTestingModule({
      imports: [AllocationPageComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideNoopAnimations(),
        provideRouter([]),
        { provide: AllocationStore, useValue: store },
        { provide: MatDialog, useValue: { open: jest.fn(() => ({ afterClosed: () => of(undefined) })) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(AllocationPageComponent);
    fixture.detectChanges();
  }

  afterEach(() => TestBed.resetTestingModule());

  it('loads accounts on init', async () => {
    await setup();
    expect(store.loadAccounts).toHaveBeenCalled();
  });

  it('links back to the portfolio dashboard (#777)', async () => {
    await setup();
    const link = fixture.nativeElement.querySelector('[data-testid="back-to-portfolio"]');
    expect(link).toBeTruthy();
    expect(link.getAttribute('href')).toContain('portfolio');
  });

  it('renders one account tab per account — non-agentic flagged', async () => {
    await setup();
    expect(fixture.nativeElement.querySelector(`[data-testid="acct-tab-${ACCT_A}"]`)).toBeTruthy();
    expect(fixture.nativeElement.querySelector(`[data-testid="acct-tab-${ACCT_B}"]`)).toBeTruthy();
    const flag = fixture.nativeElement.querySelector(`[data-testid="non-agentic-flag-${ACCT_B}"]`);
    expect(flag).toBeTruthy();
    expect(flag.textContent).toMatch(/non-agentic|read.?only/i);
    // The agentic account carries NO flag.
    expect(fixture.nativeElement.querySelector(`[data-testid="non-agentic-flag-${ACCT_A}"]`)).toBeNull();
  });

  it('account header shows value / allocated / cash remainder', async () => {
    await setup();
    const hdr = fixture.nativeElement.querySelector('[data-testid="account-header"]');
    expect(hdr.textContent).toContain('10,000');
    expect(hdr.textContent).toContain('3,500');
    expect(hdr.textContent).toContain('4,000');
  });

  it('surfaces the cash-divergence warning when actual vs derived differ', async () => {
    await setup();
    const warn = fixture.nativeElement.querySelector('[data-testid="cash-diverged"]');
    expect(warn).toBeTruthy();
  });

  it('renders Buckets and Positions subtabs inside the account tab', async () => {
    await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="subtab-buckets"]')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('[data-testid="subtab-positions"]')).toBeTruthy();
  });

  it('Buckets tab renders bucket rows incl. Unassigned + Cash pinned last', async () => {
    await setup();
    const rows = Array.from<Element>(
      fixture.nativeElement.querySelectorAll('[data-testid^="bucket-row-"]'),
    ).map((el) => el.textContent);
    expect(rows[0]).toContain('Wheel');
    expect(rows.some((t) => t.includes('Unassigned'))).toBe(true);
    expect(rows[rows.length - 1]).toContain('Cash');
  });

  it('Positions tab renders positions with bucket names', async () => {
    await setup();
    (fixture.nativeElement.querySelector('[data-testid="subtab-positions"]') as HTMLElement)
      .closest('[role="tab"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    const rows = fixture.nativeElement
      .querySelector('.mat-mdc-tab-body-active')
      .querySelectorAll('[data-testid^="position-row-"]');
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('AAPL');
    expect(rows[0].textContent).toContain('Wheel');
    expect(rows[1].textContent).toContain('Unassigned');
  });

  it('switching the account tab re-scopes all subtabs to the new account', async () => {
    await setup();
    const tabLabel = fixture.nativeElement.querySelector(`[data-testid="acct-tab-${ACCT_B}"]`) as HTMLElement;
    tabLabel.closest('[role="tab"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    await flush();
    fixture.detectChanges();
    expect(store.selectAccount).toHaveBeenCalledWith(1);
    // Re-scoped content inside the ACTIVE tab body (visited bodies stay
    // mounted and mirror the selected account — query the active one).
    const active = () => fixture.nativeElement.querySelector('.mat-mdc-tab-body-active');
    expect(active().querySelector('[data-testid="account-header"]').textContent).toContain('5,000');
    const bRows = active().querySelectorAll('[data-testid^="bucket-row-"]');
    expect(bRows[0].textContent).toContain('Income');
    (active().querySelector('[data-testid="subtab-positions"]') as HTMLElement)
      .closest('[role="tab"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    const rows = active().querySelectorAll('[data-testid^="position-row-"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('TSLA');
  });

  it('renders the as-of label from the account header', async () => {
    await setup();
    const asOf = fixture.nativeElement.querySelector('[data-testid="as-of"]');
    expect(asOf?.textContent).toContain('as of');
  });

  it('the Refresh button delegates to store.refresh', async () => {
    await setup();
    (fixture.nativeElement.querySelector('[data-testid="refresh-btn"]') as HTMLElement).click();
    expect(store.refresh).toHaveBeenCalled();
    expect(store.loadAccounts).toHaveBeenCalledTimes(1); // init only
  });

  it('Refresh retries loadAccounts when the account list failed', async () => {
    await setup();
    store.loadError.set('accounts down');
    store.accounts.set([]);
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('[data-testid="refresh-btn"]') as HTMLElement).click();
    expect(store.loadAccounts).toHaveBeenCalledTimes(2); // init + retry
    expect(store.refresh).not.toHaveBeenCalled();
  });

  it('shows a load-error banner when loadAccounts fails', async () => {
    await setup();
    store.loadError.set('accounts down');
    fixture.detectChanges();
    const banner = fixture.nativeElement.querySelector('[data-testid="load-error"]');
    expect(banner?.textContent).toContain('accounts down');
  });
});

describe('Allocation route + nav', () => {
  it('registers a lazy route for the allocation page', async () => {
    const route = CORE_ROUTES[0]?.children?.find(
      (r) => r.path === AppRoutes.PORTFOLIO_ALLOCATION,
    );
    expect(route).toBeTruthy();
    expect(route?.canActivate?.length).toBeGreaterThan(0);
    const mod = await (route!.loadComponent as () => Promise<unknown>)();
    expect(mod).toBeTruthy();
  });

  it('exposes a nav entry alongside the dashboard', () => {
    const nav = NAV_MENU_ITEMS.find((i) => i.href === AppRoutes.PORTFOLIO_ALLOCATION);
    expect(nav).toBeTruthy();
    expect(nav?.text.toLowerCase()).toContain('allocation');
    // and it's adjacent to the dashboard entry
    const dashIdx = NAV_MENU_ITEMS.findIndex((i) => i.href === AppRoutes.PORTFOLIO_DASHBOARD);
    const allocIdx = NAV_MENU_ITEMS.findIndex((i) => i.href === AppRoutes.PORTFOLIO_ALLOCATION);
    expect(Math.abs(allocIdx - dashIdx)).toBe(1);
  });
});
