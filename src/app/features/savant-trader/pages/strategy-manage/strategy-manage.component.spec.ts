/**
 * Component tests for StrategyManageComponent — Paper | Real tabs bound
 * to the store's mode partition over a sortable/filterable instance
 * table with the open-position join cell and start/stop row actions
 * (F2/#1546). The store is mocked so the seam is the component's public
 * surface.
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
import { of } from 'rxjs';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { StrategyManageComponent } from './strategy-manage.component';
import { ManageCreateInstanceComponent } from './manage-create-instance.component';
import { ManageCreateStrategyComponent } from './manage-create-strategy.component';
import { ManageResultsDialogComponent } from './manage-results-dialog.component';
import { StrategyManageStore } from '../../stores/strategy-manage.store';
import { DsDialogService } from '../../../../shared/ds/ds-dialog';
import { MANAGE_VARIANTS } from '@manage/variant-catalog';
import type { ManageInstance } from '@manage/instance-contracts';
import { OptionsPositionStatus, type Position } from '../../services/options-strategy.types';

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
    openPositionsByInstance: signal<Record<string, Position[]>>(
      overrides.openPositionsByInstance ?? {},
    ),
    isLoading: signal(overrides.isLoading ?? false),
    error: signal<string | null>(overrides.error ?? null),
    load: jest.fn(),
    toggleRunState: jest.fn(),
    clearError: jest.fn(),
  };
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'POS-1',
    instanceId: 'QQQ-CDS-30-50-40-ALL',
    symbol: 'QQQ',
    status: OptionsPositionStatus.OPEN,
    premiumCollected: 120,
    capitalRequired: 5000,
    openDate: '2026-11-15',
    currentValue: 110,
    currentValueAsOf: '2026-11-17',
    unrealizedPnl: 10,
    ...overrides,
  };
}

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
  let mockDialog: { open: jest.Mock };

  async function setup(overrides: Record<string, any> = {}) {
    mockStore = createMockStore(overrides);
    mockDialog = { open: jest.fn().mockReturnValue({ afterClosed: () => of() }) };
    await TestBed.configureTestingModule({
      imports: [StrategyManageComponent],
      providers: [
        provideNoopAnimations(),
        { provide: StrategyManageStore, useValue: mockStore },
        { provide: DsDialogService, useValue: mockDialog },
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

  it('opens the Create New Instance dialog from the header button', async () => {
    await setup();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector<HTMLButtonElement>(
      '[data-testid="create-instance-btn"]',
    );
    expect(btn).toBeTruthy();

    btn!.click();
    expect(mockDialog.open).toHaveBeenCalledWith(ManageCreateInstanceComponent);
  });

  it('opens the Create New Strategy dialog from the header button', async () => {
    await setup();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const btn = el.querySelector<HTMLButtonElement>(
      '[data-testid="create-strategy-btn"]',
    );
    expect(btn).toBeTruthy();

    btn!.click();
    expect(mockDialog.open).toHaveBeenCalledWith(ManageCreateStrategyComponent);
  });

  it('opens the results dialog for the row instance', async () => {
    const inst = makeInstance();
    await setup({ instances: [inst], paperInstances: [inst] });
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('[data-testid="results-btn"]');
    expect(btn).toBeTruthy();

    btn!.click();
    expect(mockDialog.open).toHaveBeenCalledWith(
      ManageResultsDialogComponent,
      { data: { instance: inst } },
    );
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
    expect(rows[0].textContent).toContain('call debit spread 30 50-40');
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

  it('renders the full column set', async () => {
    await setup({ paperInstances: [makeInstance()], instances: [makeInstance()] });
    fixture.detectChanges();
    const headers = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.instances-table thead th'),
    ).map((h) => h.textContent?.trim());
    expect(headers).toEqual([
      'Instance ID', 'Symbol', 'Variant', 'Stop Type', 'Trigger',
      'Run State', 'Open Position', 'Created', 'Actions',
    ]);
  });

  it('renders stop type, trigger, and created date in the row', async () => {
    const inst = makeInstance({ stopType: 'ALL', trigger: 'signal', createdAt: '2026-11-05T00:00:00Z' });
    await setup({ paperInstances: [inst], instances: [inst] });
    fixture.detectChanges();
    const row = (fixture.nativeElement as HTMLElement).querySelector('.instances-table tbody tr')!;
    expect(row.textContent).toContain('ALL');
    expect(row.textContent).toContain('signal');
    expect(row.textContent).toContain('2026-11-05');
  });

  it('shows Yes with the position status when a position is open', async () => {
    const inst = makeInstance();
    await setup({
      paperInstances: [inst],
      instances: [inst],
      openPositionsByInstance: { [inst.id]: [makePosition()] },
    });
    fixture.detectChanges();
    const cell = (fixture.nativeElement as HTMLElement).querySelector(
      '.instances-table tbody tr .position-cell',
    )!;
    expect(cell.textContent).toContain('Yes');
    expect(cell.textContent).toContain('Open');
    expect(cell.textContent).not.toContain('OPEN');
  });

  it('maps non-OPEN statuses through the shared label map', async () => {
    const inst = makeInstance();
    await setup({
      paperInstances: [inst],
      instances: [inst],
      openPositionsByInstance: {
        [inst.id]: [makePosition({ status: OptionsPositionStatus.ASSIGNED_HOLDING_SHARES })],
      },
    });
    fixture.detectChanges();
    const cell = (fixture.nativeElement as HTMLElement).querySelector(
      '.instances-table tbody tr .position-cell',
    )!;
    expect(cell.textContent).toContain('Assigned');
  });

  it('lists each distinct status when several positions join', async () => {
    const inst = makeInstance();
    await setup({
      paperInstances: [inst],
      instances: [inst],
      openPositionsByInstance: {
        [inst.id]: [
          makePosition(),
          makePosition({ id: 'POS-2', status: OptionsPositionStatus.COVERED_CALL_OPEN }),
        ],
      },
    });
    fixture.detectChanges();
    const cell = (fixture.nativeElement as HTMLElement).querySelector(
      '.instances-table tbody tr .position-cell',
    )!;
    expect(cell.textContent).toContain('Open / Covered Call Open');
  });

  it('shows the count when several open positions join one instance', async () => {
    const inst = makeInstance();
    await setup({
      paperInstances: [inst],
      instances: [inst],
      openPositionsByInstance: {
        [inst.id]: [makePosition(), makePosition({ id: 'POS-2' })],
      },
    });
    fixture.detectChanges();
    const cell = (fixture.nativeElement as HTMLElement).querySelector(
      '.instances-table tbody tr .position-cell',
    )!;
    expect(cell.textContent).toContain('×2');
  });

  it('renders Waiting for an ACTIVE instance with no open position', async () => {
    const inst = makeInstance({ runState: 'ACTIVE' });
    await setup({ paperInstances: [inst], instances: [inst] });
    fixture.detectChanges();
    const cell = (fixture.nativeElement as HTMLElement).querySelector(
      '.instances-table tbody tr .position-cell',
    )!;
    expect(cell.textContent).toContain('Waiting');
  });

  it('renders No for a non-ACTIVE instance with no open position', async () => {
    const inst = makeInstance({ runState: 'STOPPED' });
    await setup({ paperInstances: [inst], instances: [inst] });
    fixture.detectChanges();
    const cell = (fixture.nativeElement as HTMLElement).querySelector(
      '.instances-table tbody tr .position-cell',
    )!;
    expect(cell.textContent?.trim()).toBe('No');
  });

  it('sorts by symbol when the Symbol header is clicked', async () => {
    const a = makeInstance({ id: 'A', symbol: 'AAA' });
    const q = makeInstance({ id: 'Q', symbol: 'QQQ' });
    await setup({ paperInstances: [q, a], instances: [q, a] });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const symbolTh = Array.from(el.querySelectorAll<HTMLElement>('.instances-table th'))
      .find((h) => h.textContent?.includes('Symbol'))!;

    symbolTh.click();
    fixture.detectChanges();
    let ids = Array.from(el.querySelectorAll('.instances-table tbody tr td:first-child'))
      .map((c) => c.textContent?.trim());
    expect(ids).toEqual(['A', 'Q']);

    symbolTh.click();
    fixture.detectChanges();
    ids = Array.from(el.querySelectorAll('.instances-table tbody tr td:first-child'))
      .map((c) => c.textContent?.trim());
    expect(ids).toEqual(['Q', 'A']);
  });

  it('filters rows by the text filter on symbol', async () => {
    const a = makeInstance({ id: 'A', symbol: 'AAA' });
    const q = makeInstance({ id: 'Q', symbol: 'QQQ' });
    await setup({ paperInstances: [q, a], instances: [q, a] });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const input = el.querySelector<HTMLInputElement>('.filter-input')!;

    input.value = 'qqq';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    const rows = el.querySelectorAll('.instances-table tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('QQQ');
  });

  it('filters rows by run state', async () => {
    const active = makeInstance({ id: 'A', runState: 'ACTIVE' });
    const stopped = makeInstance({ id: 'S', runState: 'STOPPED' });
    await setup({ paperInstances: [active, stopped], instances: [active, stopped] });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector<HTMLSelectElement>('.runstate-filter')!;

    select.value = 'ACTIVE';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const rows = el.querySelectorAll('.instances-table tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('A');
  });

  it('filters rows by open-position presence', async () => {
    const withPos = makeInstance({ id: 'P' });
    const flat = makeInstance({ id: 'F' });
    await setup({
      paperInstances: [withPos, flat],
      instances: [withPos, flat],
      openPositionsByInstance: { P: [makePosition({ instanceId: 'P' })] },
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector<HTMLSelectElement>('.position-filter')!;

    select.value = 'open';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    const rows = el.querySelectorAll('.instances-table tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('P');
  });

  it('distinguishes waiting from flat in the position filter', async () => {
    const activeFlat = makeInstance({ id: 'W', runState: 'ACTIVE' });
    const stoppedFlat = makeInstance({ id: 'F', runState: 'STOPPED' });
    await setup({
      paperInstances: [activeFlat, stoppedFlat],
      instances: [activeFlat, stoppedFlat],
    });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector<HTMLSelectElement>('.position-filter')!;

    select.value = 'waiting';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    let rows = el.querySelectorAll('.instances-table tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('W');

    select.value = 'flat';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    rows = el.querySelectorAll('.instances-table tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('F');
  });

  it('calls store.toggleRunState when the start/stop action is clicked', async () => {
    const inst = makeInstance({ runState: 'UNSTARTED' });
    await setup({ paperInstances: [inst], instances: [inst] });
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.runstate-btn')!;

    btn.click();
    expect(mockStore.toggleRunState).toHaveBeenCalledWith(inst);
  });

  it('disables the start/stop action for real-mode rows', async () => {
    const real = makeInstance({ id: 'R', mode: 'real', stopType: 'T8' });
    await setup({ realInstances: [real], instances: [real] });
    fixture.detectChanges();
    (fixture.nativeElement as HTMLElement)
      .querySelectorAll<HTMLElement>('.tab-bar .tab')[1].click();
    fixture.detectChanges();

    const btn = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.runstate-btn')!;
    expect(btn.disabled).toBe(true);
  });

  it('says "match the active filters" when filters hide every row', async () => {
    const inst = makeInstance();
    await setup({ paperInstances: [inst], instances: [inst] });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const select = el.querySelector<HTMLSelectElement>('.runstate-filter')!;

    select.value = 'ACTIVE';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();

    expect(el.querySelector('.empty-state')?.textContent).toContain(
      'No instances match the active filters',
    );
  });

  it('calls store.clearError when the banner dismiss button is clicked', async () => {
    await setup({ error: 'Failed to update run state' });
    fixture.detectChanges();
    const btn = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.error-banner .icon-btn')!;

    btn.click();
    expect(mockStore.clearError).toHaveBeenCalled();
  });
});
