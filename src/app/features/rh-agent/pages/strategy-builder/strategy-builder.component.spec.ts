/**
 * @topic #137 — Strategy Builder UI (opened 2026-08-16)
 *
 * Component tests for StrategyBuilderComponent — verifies list rendering,
 * empty/loading/error states, lifecycle badges, action button dispatch, and
 * navigation. The store is mocked so the seam is the component's public
 * surface (template + store method calls).
 */

jest.mock('@angular/fire/auth', () => ({
  Auth: class {},
}));
jest.mock('@angular/fire/firestore', () => ({
  Firestore: class {},
}));

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal, ɵresolveComponentResources } from '@angular/core';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { Router } from '@angular/router';

import { StrategyBuilderComponent } from './strategy-builder.component';
import { StrategyBuilderStore } from '../../stores/strategy-builder.store';
import { AppRoutes } from '../../../../core/common/interfaces';
import { OptionType, PositionSpreadType, StrategyFrequency } from '@options/common';
import { TradeSide } from '@common';
import {
  ExitPolicy,
  LifecycleState,
  type StrategyInstanceConfig,
} from '@options-strategy-engine/contracts';

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
  const instances = signal<StrategyInstanceConfig[]>(overrides.instances ?? []);
  const isLoading = signal(overrides.isLoading ?? false);
  const error = signal<string | null>(overrides.error ?? null);
  const selectedInstance = signal<StrategyInstanceConfig | null>(overrides.selectedInstance ?? null);

  return {
    instances,
    isLoading,
    error,
    selectedInstance,
    activeInstances: signal<StrategyInstanceConfig[]>(overrides.activeInstances ?? []),
    pausedInstances: signal<StrategyInstanceConfig[]>(overrides.pausedInstances ?? []),
    stoppedInstances: signal<StrategyInstanceConfig[]>(overrides.stoppedInstances ?? []),
    load: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    toggleLifecycle: jest.fn(),
    selectForEdit: jest.fn(),
    clearSelection: jest.fn(),
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeInstance(overrides: Partial<StrategyInstanceConfig> = {}): StrategyInstanceConfig {
  return {
    id: '250816-QQQM-CSP-020-28-D',
    symbol: 'QQQM',
    optionType: OptionType.PUT,
    side: TradeSide.SHORT,
    targetDelta: 0.2,
    dteMin: 21,
    dteMax: 30,
    phases: [
      {
        spreadType: PositionSpreadType.CASH_SECURED_PUT,
        targetDelta: 0.2,
        dteMin: 21,
        dteMax: 30,
      },
    ],
    frequency: StrategyFrequency.DAILY,
    openTimePT: '12:00',
    exitPolicies: [{ policy: ExitPolicy.HOLD_TO_EXPIRATION }],
    lifecycleState: LifecycleState.ACTIVE,
    userId: 'test-user',
    createdAt: '2025-08-16T00:00:00Z',
    updatedAt: '2025-08-16T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StrategyBuilderComponent', () => {
  let fixture: ComponentFixture<StrategyBuilderComponent>;
  let component: StrategyBuilderComponent;
  let mockStore: ReturnType<typeof createMockStore>;
  let mockRouter: { navigate: jest.Mock };

  async function configureWithStore(storeOverrides: Record<string, any> = {}) {
    mockStore = createMockStore(storeOverrides);
    mockRouter = { navigate: jest.fn().mockResolvedValue(true) };

    await TestBed.configureTestingModule({
      imports: [StrategyBuilderComponent],
      providers: [
        provideNoopAnimations(),
        { provide: StrategyBuilderStore, useValue: mockStore },
        { provide: Router, useValue: mockRouter },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(StrategyBuilderComponent);
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

  it('calls store.load() on init', async () => {
    await configureWithStore();
    expect(mockStore.load).toHaveBeenCalled();
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

  it('shows empty state when no instances exist', async () => {
    await configureWithStore({ instances: [] });
    const emptyState = fixture.nativeElement.querySelector('.empty-state');
    expect(emptyState).toBeTruthy();
  });

  it('renders instance rows with expected columns', async () => {
    const instance = makeInstance();
    await configureWithStore({ instances: [instance] });
    const rows = fixture.nativeElement.querySelectorAll('.instances-table tbody tr');
    expect(rows.length).toBe(1);
    const cells = rows[0].querySelectorAll('td');
    // Columns: Instance ID, Symbol, Spread Type, Frequency, Lifecycle, Exit Policies, Actions
    expect(cells[0].textContent).toContain('250816-QQQM-CSP-020-28-D');
    expect(cells[1].textContent).toContain('QQQM');
    expect(cells[2].textContent).toContain('CASH_SECURED_PUT');
    expect(cells[3].textContent).toContain('DAILY');
    expect(cells[4].textContent).toContain('ACTIVE');
    expect(cells[5].textContent).toContain('HOLD_TO_EXPIRATION');
  });

  it('renders em-dash for spread type when phases array is empty', async () => {
    const instance = makeInstance({ phases: [] as any });
    await configureWithStore({ instances: [instance] });
    const cells = fixture.nativeElement.querySelectorAll('.instances-table tbody tr td');
    expect(cells[2].textContent).toContain('—');
  });

  it('renders empty string for exit policies when array is empty', async () => {
    const instance = makeInstance({ exitPolicies: [] });
    await configureWithStore({ instances: [instance] });
    const cells = fixture.nativeElement.querySelectorAll('.instances-table tbody tr td');
    expect(cells[5].textContent.trim()).toBe('');
  });

  it('applies lifecycle badge class based on state', async () => {
    await configureWithStore({
      instances: [
        makeInstance({ id: 'a1', lifecycleState: LifecycleState.ACTIVE }),
        makeInstance({ id: 'p1', lifecycleState: LifecycleState.PAUSED }),
        makeInstance({ id: 's1', lifecycleState: LifecycleState.STOPPED }),
      ],
    });
    const badges = fixture.nativeElement.querySelectorAll('.lifecycle-badge');
    expect(badges.length).toBe(3);
    expect(badges[0].classList.contains('active')).toBe(true);
    expect(badges[1].classList.contains('paused')).toBe(true);
    expect(badges[2].classList.contains('stopped')).toBe(true);
  });

  it('renders "Create New Strategy" button', async () => {
    await configureWithStore();
    const btn = fixture.nativeElement.querySelector('.create-btn');
    expect(btn?.textContent).toContain('Create New Strategy');
  });

  it('navigates to the new form when "Create New Strategy" is clicked', async () => {
    await configureWithStore();
    const btn = fixture.nativeElement.querySelector('.create-btn');
    btn.click();
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/' + AppRoutes.STRATEGY_BUILDER, 'new']);
  });

  it('calls store.selectForEdit and navigates when Edit is clicked', async () => {
    const instance = makeInstance({ id: 'inst-1' });
    await configureWithStore({ instances: [instance] });
    const editBtn = fixture.nativeElement.querySelector('.edit-btn');
    editBtn.click();
    expect(mockStore.selectForEdit).toHaveBeenCalledWith(instance);
    expect(mockRouter.navigate).toHaveBeenCalledWith(['/' + AppRoutes.STRATEGY_BUILDER, 'edit', 'inst-1']);
  });

  it('calls store.toggleLifecycle when Toggle Lifecycle is clicked', async () => {
    const instance = makeInstance({ id: 'inst-1' });
    await configureWithStore({ instances: [instance] });
    const toggleBtn = fixture.nativeElement.querySelector('.toggle-lifecycle-btn');
    toggleBtn.click();
    expect(mockStore.toggleLifecycle).toHaveBeenCalledWith('inst-1');
  });

  it('calls store.remove when Delete is clicked', async () => {
    const instance = makeInstance({ id: 'inst-1' });
    await configureWithStore({ instances: [instance] });
    const deleteBtn = fixture.nativeElement.querySelector('.delete-btn');
    deleteBtn.click();
    expect(mockStore.remove).toHaveBeenCalledWith('inst-1');
  });

  it('navigates to dashboard with instance query param when "View in Dashboard" is clicked', async () => {
    const instance = makeInstance({ id: 'inst-1' });
    await configureWithStore({ instances: [instance] });
    const viewBtn = fixture.nativeElement.querySelector('.view-dashboard-btn');
    viewBtn.click();
    expect(mockRouter.navigate).toHaveBeenCalledWith(
      ['/' + AppRoutes.OPTIONS_STRATEGY_DASHBOARD],
      { queryParams: { instance: 'inst-1' } },
    );
  });
});
