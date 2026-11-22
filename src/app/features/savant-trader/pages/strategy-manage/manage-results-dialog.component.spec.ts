import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of, throwError, NEVER } from 'rxjs';

import { ManageResultsDialogComponent } from './manage-results-dialog.component';
import { OptionsStrategyService } from '../../services/options-strategy.service';
import { PaperTradingService } from '../../services/paper-trading.service';
import {
  DS_DIALOG_DATA,
  DsDialogRef,
} from '../../../../shared/ds/ds-dialog';
import { MANAGE_VARIANTS } from '@manage/variant-catalog';
import type { ManageInstance } from '@manage/instance-contracts';
import {
  OptionsPositionStatus,
  type Position,
} from '../../services/options-strategy.types';
import type { PaperStats } from '@paper-trading/contracts';
import { PaperTradingKind } from '@paper-trading/contracts';

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

function makeStats(overrides: Partial<PaperStats> = {}): PaperStats {
  return {
    kind: PaperTradingKind.STATS,
    id: 'stats-inst-QQQ-CDS-30-50-40-ALL',
    createdAt: '2026-11-10T00:00:00Z',
    updatedAt: '2026-11-12T00:00:00Z',
    scope: 'inst-QQQ-CDS-30-50-40-ALL',
    totalRealizedPnl: 125.5,
    totalUnrealizedPnl: -40.25,
    totalPremiumCollected: 750,
    openTradeCount: 1,
    closedTradeCount: 3,
    maxDrawdown: -210.75,
    equityCurve: [
      { date: '2026-11-10', cumulativePnl: 0 },
      { date: '2026-11-11', cumulativePnl: 50 },
      { date: '2026-11-12', cumulativePnl: 85.25 },
    ],
    ...overrides,
  };
}

function makePosition(overrides: Partial<Position> = {}): Position {
  return {
    id: 'pos-1',
    instanceId: 'QQQ-CDS-30-50-40-ALL',
    symbol: 'QQQ',
    status: OptionsPositionStatus.OPEN,
    premiumCollected: 250,
    capitalRequired: 500,
    openDate: '2026-11-11',
    currentValue: 210,
    currentValueAsOf: '2026-11-12',
    unrealizedPnl: 40,
    ...overrides,
  };
}

describe('ManageResultsDialogComponent', () => {
  let fixture: ComponentFixture<ManageResultsDialogComponent>;
  let optionsService: { listStrategyPositions$: jest.Mock };
  let paperService: { getPaperStats$: jest.Mock };
  let dialogRef: { close: jest.Mock };
  const instance = makeInstance();

  async function setup(opts: {
    stats?: PaperStats[];
    statsError?: unknown;
    statsPending?: boolean;
    positions?: Position[];
    positionsError?: unknown;
    positionsPending?: boolean;
  } = {}) {
    optionsService = {
      listStrategyPositions$: jest.fn().mockReturnValue(
        opts.positionsPending
          ? NEVER
          : opts.positionsError
            ? throwError(() => opts.positionsError)
            : of({
                openPositions: opts.positions ?? [makePosition()],
                closedPositions: [],
              }),
      ),
    };
    paperService = {
      getPaperStats$: jest.fn().mockReturnValue(
        opts.statsPending
          ? NEVER
          : opts.statsError
            ? throwError(() => opts.statsError)
            : of({ stats: opts.stats ?? [makeStats()] }),
      ),
    };
    dialogRef = { close: jest.fn() };
    await TestBed.configureTestingModule({
      imports: [ManageResultsDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: OptionsStrategyService, useValue: optionsService },
        { provide: PaperTradingService, useValue: paperService },
        { provide: DS_DIALOG_DATA, useValue: { instance } },
        { provide: DsDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(ManageResultsDialogComponent);
    fixture.detectChanges();
    await new Promise<void>((r) => setTimeout(r, 0));
    fixture.detectChanges();
  }

  it('requests stats scoped to the instance and positions by instanceId', async () => {
    await setup();
    expect(paperService.getPaperStats$).toHaveBeenCalledWith({
      scope: 'inst-QQQ-CDS-30-50-40-ALL',
    });
    expect(optionsService.listStrategyPositions$).toHaveBeenCalledWith({
      instanceId: 'QQQ-CDS-30-50-40-ALL',
    });
  });

  it('renders the stats block', async () => {
    await setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="stat-realized"]')?.textContent).toContain('125.50');
    expect(el.querySelector('[data-testid="stat-unrealized"]')?.textContent).toContain('40.25');
    expect(el.querySelector('[data-testid="stat-open-count"]')?.textContent).toContain('1');
    expect(el.querySelector('[data-testid="stat-closed-count"]')?.textContent).toContain('3');
    expect(el.querySelector('[data-testid="stat-max-dd"]')?.textContent).toContain('210.75');
  });

  it('renders the open-position summary', async () => {
    await setup();
    const rows = fixture.nativeElement.querySelectorAll('[data-testid="position-row"]');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('QQQ');
    expect(rows[0].textContent).toContain('250');
  });

  it('renders the equity sparkline when the curve has points', async () => {
    await setup();
    expect(fixture.nativeElement.querySelector('[data-testid="equity-sparkline"]')).not.toBeNull();
  });

  it('shows the empty-stats state when no stats doc exists', async () => {
    await setup({ stats: [] });
    expect(fixture.nativeElement.querySelector('[data-testid="stats-empty"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="equity-sparkline"]')).toBeNull();
  });

  it('shows the empty-positions state', async () => {
    await setup({ positions: [] });
    expect(fixture.nativeElement.querySelector('[data-testid="positions-empty"]')).not.toBeNull();
  });

  it('shows loading copy — not the empty state — while callables are in flight', async () => {
    await setup({ statsPending: true, positionsPending: true });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="stats-loading"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="positions-loading"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="stats-empty"]')).toBeNull();
    expect(el.querySelector('[data-testid="positions-empty"]')).toBeNull();
  });

  it('tolerates an increment-minted stats doc — no equityCurve or P&L fields', async () => {
    await setup({
      stats: [
        {
          kind: PaperTradingKind.STATS,
          id: 'stats-inst-QQQ-CDS-30-50-40-ALL',
          createdAt: '2026-11-10T00:00:00Z',
          updatedAt: '2026-11-10T00:00:00Z',
          scope: 'inst-QQQ-CDS-30-50-40-ALL',
        } as PaperStats,
      ],
    });
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="stats-block"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="stat-unrealized"]')?.textContent).toContain('—');
    expect(el.querySelector('[data-testid="equity-sparkline"]')).toBeNull();
  });

  it('hides the sparkline for a single-point curve', async () => {
    await setup({
      stats: [makeStats({ equityCurve: [{ date: '2026-11-10', cumulativePnl: 10 }] })],
    });
    expect(fixture.nativeElement.querySelector('[data-testid="equity-sparkline"]')).toBeNull();
  });

  it('renders the sparkline for an all-equal (flat) curve', async () => {
    await setup({
      stats: [
        makeStats({
          equityCurve: [
            { date: '2026-11-10', cumulativePnl: 5 },
            { date: '2026-11-11', cumulativePnl: 5 },
          ],
        }),
      ],
    });
    expect(fixture.nativeElement.querySelector('[data-testid="equity-sparkline"]')).not.toBeNull();
  });

  it('renders premium collected and position status/legs', async () => {
    await setup();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('[data-testid="stat-premium"]')?.textContent).toContain('750.00');
    const row = el.querySelector('[data-testid="position-row"]');
    expect(row?.textContent).toContain('Open');
    expect(row?.textContent).toContain('legs');
  });

  it('shows the stats error state when getPaperStats fails', async () => {
    await setup({ statsError: new Error('boom') });
    expect(fixture.nativeElement.querySelector('[data-testid="stats-error"]')).not.toBeNull();
  });

  it('shows the positions error state when listStrategyPositions fails', async () => {
    await setup({ positionsError: new Error('boom') });
    expect(fixture.nativeElement.querySelector('[data-testid="positions-error"]')).not.toBeNull();
  });

  it('opens the backtest analysis route in a new tab', async () => {
    await setup();
    const openSpy = jest.spyOn(window, 'open').mockImplementation(() => null);
    fixture.nativeElement
      .querySelector('[data-testid="analysis-btn"]')
      .click();
    expect(openSpy).toHaveBeenCalledWith(
      '/options/strategy/backtest/analysis/QQQ-CDS-30-50-40-ALL',
      '_blank',
    );
    openSpy.mockRestore();
  });

  it('closes via the close button', async () => {
    await setup();
    fixture.nativeElement.querySelector('[data-testid="close-btn"]').click();
    expect(dialogRef.close).toHaveBeenCalled();
  });
});
