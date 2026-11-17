/**
 * Component tests for StrategyManageComponent — the F1 page skeleton: Paper |
 * Real tabs bound to the store's mode partition, plus an instance table shell
 * that renders the streamed docs. The store is mocked so the seam is the
 * component's public surface.
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

import { StrategyManageComponent } from './strategy-manage.component';
import { StrategyManageStore } from '../../stores/strategy-manage.store';
import { MANAGE_VARIANTS } from '@manage/variant-catalog';
import type { ManageInstance } from '@manage/instance-contracts';

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
  return {
    instances: signal<ManageInstance[]>(overrides.instances ?? []),
    paperInstances: signal<ManageInstance[]>(overrides.paperInstances ?? []),
    realInstances: signal<ManageInstance[]>(overrides.realInstances ?? []),
    isLoading: signal(overrides.isLoading ?? false),
    error: signal<string | null>(overrides.error ?? null),
    load: jest.fn(),
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeInstance(overrides: Partial<ManageInstance> = {}): ManageInstance {
  return {
    id: 'QQQ-CDS-30-50-40-ALL',
    variantRef: 'cds-30-50-40',
    variant: MANAGE_VARIANTS[0],
    symbol: 'QQQ',
    mode: 'paper',
    trigger: 'daily',
    stopType: 'ALL',
    runState: 'UNSTARTED',
    userId: 'test-user',
    createdAt: '2026-11-01T00:00:00Z',
    updatedAt: '2026-11-01T00:00:00Z',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('StrategyManageComponent', () => {
  let fixture: ComponentFixture<StrategyManageComponent>;
  let component: StrategyManageComponent;
  let mockStore: ReturnType<typeof createMockStore>;

  async function setup(overrides: Record<string, any> = {}) {
    mockStore = createMockStore(overrides);
    await TestBed.configureTestingModule({
      imports: [StrategyManageComponent],
      providers: [
        provideNoopAnimations(),
        { provide: StrategyManageStore, useValue: mockStore },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(StrategyManageComponent);
    component = fixture.componentInstance;
  }

  it('creates the component', async () => {
    await setup();
    fixture.detectChanges();
    expect(component).toBeTruthy();
  });

  it('calls store.load() on init', async () => {
    await setup();
    fixture.detectChanges();
    expect(mockStore.load).toHaveBeenCalled();
  });

  it('shows loading spinner when isLoading is true', async () => {
    await setup({ isLoading: true });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.loading-container')).toBeTruthy();
  });

  it('shows error banner when error is set', async () => {
    await setup({ error: 'Failed to load strategy instances' });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const banner = el.querySelector('.error-banner');
    expect(banner?.textContent).toContain('Failed to load strategy instances');
  });

  it('renders Paper and Real tabs', async () => {
    await setup();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = Array.from(el.querySelectorAll<HTMLElement>('.tab-bar .tab'));
    expect(tabs.map((t) => t.textContent?.trim())).toEqual(['Paper', 'Real']);
  });

  it('renders paper instances in the table shell by default', async () => {
    const paper = makeInstance({ id: 'QQQ-CDS-30-50-40-ALL' });
    await setup({ paperInstances: [paper], instances: [paper] });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const rows = el.querySelectorAll('.instances-table tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('QQQ-CDS-30-50-40-ALL');
    expect(rows[0].textContent).toContain('QQQ');
    expect(rows[0].textContent).toContain('call debit spread 50-40 30');
    expect(rows[0].textContent).toContain('UNSTARTED');
  });

  it('switches to real instances when the Real tab is selected', async () => {
    const paper = makeInstance({ id: 'PAPER-1' });
    const real = makeInstance({
      id: 'REAL-1',
      mode: 'real',
      stopType: 'T8',
    });
    await setup({
      instances: [paper, real],
      paperInstances: [paper],
      realInstances: [real],
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const tabs = el.querySelectorAll<HTMLElement>('.tab-bar .tab');

    tabs[1].click();
    fixture.detectChanges();

    const rows = el.querySelectorAll('.instances-table tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('REAL-1');
    expect(rows[0].textContent).not.toContain('PAPER-1');
  });

  it('shows an empty state when the active tab has no instances', async () => {
    await setup({ instances: [], paperInstances: [] });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.empty-state')?.textContent).toContain(
      'No paper instances',
    );
  });
});
