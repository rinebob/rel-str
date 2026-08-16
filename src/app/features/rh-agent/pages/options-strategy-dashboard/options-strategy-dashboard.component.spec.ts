/**
 * Component tests for OptionsStrategyDashboardComponent — verifies
 * loading/error/empty states, table rendering, and store interaction
 * with a mocked store.
 */

jest.mock('@angular/fire/functions', () => ({
  Functions: class {},
  httpsCallable: jest.fn(),
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
}));
jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal, ɵresolveComponentResources } from '@angular/core';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

import { OptionsStrategyDashboardComponent } from './options-strategy-dashboard.component';
import { OptionsStrategyDashboardStore } from '../../stores/options-strategy-dashboard.store';
import type {
  Position,
  StrategyStats,
  EquityCurvePoint,
} from '../../services/options-strategy.types';
import { OptionsPositionStatus } from '../../services/options-strategy.types';

// ── Resolve external templateUrl/styleUrl from disk ──────────────────────────

const componentDir = __dirname;

beforeAll(async () => {
  await ɵresolveComponentResources(async (url: string) => {
    const text = readFileSync(resolve(componentDir, url), 'utf-8');
    return { text: async () => text };
  });
});

// ── Mock store factory ───────────────────────────────────────────────────────

function createMockStore(overrides: Record<string, any> = {}) {
  const openPositions = signal<Position[]>(overrides.openPositions ?? []);
  const closedPositions = signal<Position[]>(overrides.closedPositions ?? []);
  const equityCurve = signal<EquityCurvePoint[]>(overrides.equityCurve ?? []);
  const stats = signal<StrategyStats | null>(overrides.stats ?? null);
  const selectedInstanceId = signal<string | null>(overrides.selectedInstanceId ?? null);
  const isLoading = signal(overrides.isLoading ?? false);
  const isLoadingPositions = signal(overrides.isLoadingPositions ?? false);
  const isLoadingEquityCurve = signal(overrides.isLoadingEquityCurve ?? false);
  const error = signal<string | null>(overrides.error ?? null);
  const isEmpty = signal(overrides.isEmpty ?? true);
  const openCount = signal(overrides.openCount ?? 0);
  const closedCount = signal(overrides.closedCount ?? 0);
  const maxDrawdown = signal(overrides.maxDrawdown ?? 0);
  const availableInstances = signal<string[]>(overrides.availableInstances ?? []);

  return {
    openPositions,
    closedPositions,
    equityCurve,
    stats,
    selectedInstanceId,
    isLoading,
    isLoadingPositions,
    isLoadingEquityCurve,
    error,
    isEmpty,
    openCount,
    closedCount,
    maxDrawdown,
    availableInstances,
    loadAll: jest.fn(),
    loadPositions: jest.fn(),
    loadEquityCurve: jest.fn(),
    selectInstance: jest.fn(),
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const openPos: Position = {
  id: 'p1',
  instanceId: 'QQQM-WHEEL',
  symbol: 'QQQM',
  status: OptionsPositionStatus.OPEN,
  premiumCollected: 50,
  capitalRequired: 10000,
  openDate: '2026-01-01',
  currentValue: 30,
  currentValueAsOf: '2026-01-05',
  unrealizedPnl: 20,
};

const closedPos: Position = {
  id: 'p2',
  instanceId: 'QQQM-WHEEL',
  symbol: 'QQQM',
  status: OptionsPositionStatus.EXPIRED_WORTHLESS,
  premiumCollected: 75,
  capitalRequired: 12000,
  openDate: '2025-12-01',
  currentValue: 0,
  currentValueAsOf: '2025-12-20',
  unrealizedPnl: 0,
};

const points: EquityCurvePoint[] = [
  { date: '2026-01-01', cumulativePnl: 0 },
  { date: '2026-01-02', cumulativePnl: 50 },
];

const stats: StrategyStats = {
  scope: 'ALL',
  totalPremiumCollected: 150,
  totalRealizedPnl: 75,
  totalUnrealizedPnl: 45,
  openPositionCount: 1,
  closedPositionCount: 1,
  assignedCount: 0,
  expiredWorthlessCount: 1,
  maxDrawdown: 30,
  lastUpdated: '2026-01-03',
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe('OptionsStrategyDashboardComponent', () => {
  let fixture: ComponentFixture<OptionsStrategyDashboardComponent>;
  let component: OptionsStrategyDashboardComponent;
  let mockStore: ReturnType<typeof createMockStore>;

  async function configureWithStore(storeOverrides: Record<string, any> = {}) {
    mockStore = createMockStore(storeOverrides);

    await TestBed.configureTestingModule({
      imports: [OptionsStrategyDashboardComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OptionsStrategyDashboardStore, useValue: mockStore },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OptionsStrategyDashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('creates the component', async () => {
    await configureWithStore();
    expect(component).toBeTruthy();
  });

  it('calls store.loadAll() on init', async () => {
    await configureWithStore();
    expect(mockStore.loadAll).toHaveBeenCalled();
  });

  it('shows loading spinner when isLoading is true', async () => {
    await configureWithStore({ isLoading: true });
    const spinner = fixture.nativeElement.querySelector('mat-spinner');
    expect(spinner).toBeTruthy();
  });

  it('shows error banner when error is set', async () => {
    await configureWithStore({ error: 'Something went wrong' });
    const banner = fixture.nativeElement.querySelector('.error-banner');
    expect(banner?.textContent).toContain('Something went wrong');
  });

  it('shows empty state when no data exists', async () => {
    await configureWithStore({ isEmpty: true });
    const emptyState = fixture.nativeElement.querySelector('.empty-state');
    expect(emptyState).toBeTruthy();
  });

  it('renders stats strip when data is loaded', async () => {
    await configureWithStore({
      isEmpty: false,
      openCount: 1,
      closedCount: 1,
      maxDrawdown: 30,
      stats,
    });
    const statCards = fixture.nativeElement.querySelectorAll('.stat-card');
    expect(statCards.length).toBe(3);
    expect(statCards[0].textContent).toContain('Open Positions');
    expect(statCards[1].textContent).toContain('Closed Positions');
    expect(statCards[2].textContent).toContain('Max Drawdown');
  });

  it('renders open positions in the open table', async () => {
    await configureWithStore({
      isEmpty: false,
      openPositions: [openPos],
      closedPositions: [],
    });
    const tables = fixture.nativeElement.querySelectorAll('.positions-table');
    const openRows = tables[0].querySelectorAll('tbody tr');
    expect(openRows.length).toBe(1);
    expect(openRows[0].textContent).toContain('QQQM');
    expect(openRows[0].textContent).toContain('$50.00');
  });

  it('renders closed positions in the closed table', async () => {
    await configureWithStore({
      isEmpty: false,
      openPositions: [],
      closedPositions: [closedPos],
    });
    const tables = fixture.nativeElement.querySelectorAll('.positions-table');
    const closedRows = tables[0].querySelectorAll('tbody tr');
    expect(closedRows.length).toBe(1);
    expect(closedRows[0].textContent).toContain('Expired Worthless');
  });

  it('shows empty table message when open positions is empty but data exists', async () => {
    await configureWithStore({
      isEmpty: false,
      openPositions: [],
      closedPositions: [closedPos],
      equityCurve: points,
    });
    const messages = fixture.nativeElement.querySelectorAll('.empty-table-message');
    expect(messages[0]?.textContent).toContain('No open positions');
  });

  it('calls store.selectInstance when scope toggle button is clicked', async () => {
    await configureWithStore({
      isEmpty: false,
      selectedInstanceId: null,
      availableInstances: ['QQQM-WHEEL'],
    });
    const buttons = fixture.nativeElement.querySelectorAll('.scope-toggle button');
    // buttons[0] = Combined, buttons[1] = QQQM-WHEEL (dynamic)
    buttons[1].click();
    expect(mockStore.selectInstance).toHaveBeenCalledWith('QQQM-WHEEL');
  });
});
