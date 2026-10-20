/**
 * RunDashboardComponent spec (#762) — run-dashboard navigation targets the
 * promoted trading/gallery route: 'Review Latest Signals' and the runs-table
 * row action both land there.
 */
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';

import { DashboardComponent } from './dashboard.component';
import { StStore } from '../../stores/st.store';
import { DashboardStore } from '../../stores/dashboard.store';
import { GroupStore } from '../../stores/group.store';
import { UiStateService } from '../../../../core/services/ui-state.service';
import { OverviewService } from '../../services/overview.service';
import { StRun } from '../../services/types';
import { AppRoutes } from '../../../../core/common/interfaces';

describe('DashboardComponent (run dashboard)', () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let router: Router;

  let stStoreMock: {
    loadData: jest.Mock;
    refreshStatus: jest.Mock;
    triggerManualRun: jest.Mock;
    triggerBarsBackfill: jest.Mock;
    status: ReturnType<typeof signal<null>>;
    latestCompletedRun: ReturnType<typeof signal<{ id: string; marketDate: string } | null>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    runs: ReturnType<typeof signal<never[]>>;
  };
  let uiStoreMock: Record<string, unknown>;
  let groupStoreMock: { setActiveRun: jest.Mock };

  beforeEach(async () => {
    stStoreMock = {
      loadData: jest.fn(),
      refreshStatus: jest.fn(),
      triggerManualRun: jest.fn(),
      triggerBarsBackfill: jest.fn(),
      status: signal(null),
      latestCompletedRun: signal<{ id: string; marketDate: string } | null>(null),
      isLoading: signal(false),
      runs: signal<never[]>([]),
    };
    uiStoreMock = {
      triggerFilter: signal(''),
      dateFilter: signal(''),
      statusFilter: signal(''),
      selectedRun: signal(null),
      filteredRuns: signal([]),
      selectedRunId: signal(null),
      setTriggerFilter: jest.fn(),
      setDateFilter: jest.fn(),
      setStatusFilter: jest.fn(),
      selectRun: jest.fn(),
    };
    groupStoreMock = { setActiveRun: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: StStore, useValue: stStoreMock },
        { provide: GroupStore, useValue: groupStoreMock },
        { provide: UiStateService, useValue: { setFullscreen: jest.fn() } },
        { provide: OverviewService, useValue: { triggerOverviewSync: jest.fn().mockReturnValue(of({ enqueued: 0, skipped: 0, total: 0 })) } },
      ],
    })
      .overrideComponent(DashboardComponent, {
        set: { providers: [{ provide: DashboardStore, useValue: uiStoreMock }] },
      })
      .compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
  });

  it("'Review Latest Signals' navigates to trading/gallery with run seeding", () => {
    stStoreMock.latestCompletedRun.set({ id: 'run-9', marketDate: '2026-10-16' });
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    const btn = (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.review-latest-btn')!;
    expect(btn.textContent).toContain('Review Latest Signals');
    btn.click();

    expect(groupStoreMock.setActiveRun).toHaveBeenCalledWith('run-9', '2026-10-16');
    expect(navSpy).toHaveBeenCalledWith(['/' + AppRoutes.GALLERY]);
  });

  it("'Review Latest Signals' navigates without run seeding when no completed run exists", () => {
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.review-latest-btn')!
      .click();

    expect(groupStoreMock.setActiveRun).not.toHaveBeenCalled();
    expect(navSpy).toHaveBeenCalledWith(['/' + AppRoutes.GALLERY]);
  });

  it('runs-table row action navigates to trading/gallery for the selected run', () => {
    const run: StRun = { id: 'run-7', status: 'SUCCESS', startedAt: '2026-10-15T00:00:00Z', marketDate: '2026-10-15' };
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture.componentInstance.onRunSelected(run);

    expect(uiStoreMock.selectRun).toHaveBeenCalledWith('run-7');
    expect(groupStoreMock.setActiveRun).toHaveBeenCalledWith('run-7', '2026-10-15');
    expect(navSpy).toHaveBeenCalledWith(['/' + AppRoutes.GALLERY]);
  });
});
