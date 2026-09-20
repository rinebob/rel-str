import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Firestore } from '@angular/fire/firestore';
import { of, Subject } from 'rxjs';
import { signal } from '@angular/core';

import { RunSectionComponent } from './run-section.component';
import { OptionChainPctChangeStore } from '../option-chain-pct-change.store';
import { OptionsContractService } from '../../../services/options-contract.service';
import { PctChangeConfigService } from '../services/pct-change-config.service';
import { LocalBarReadService } from '../../../../../core/services/local-bar-read.service';
import { SwingAnalysisService } from '../../../swing-analysis/swing-analysis.service';
import { SymbolHistoryStore } from '../../../stores/symbol-history.store';
import { OptionType } from '@options-contract/contracts';
import type { SwingCompareRun } from '../utils/swing-compare.utils';
import { makeContractFixture } from '../testing/swing-fixtures';

const run: SwingCompareRun = {
  id: 'r1',
  startDate: '2025-04-01',
  targetDates: ['2025-04-10', '2025-04-15'],
  type: OptionType.CALL,
};

const chainFor = (date: string) => ({
  ok: true,
  data: {
    data: [
      makeContractFixture({
        contractID: 'A',
        mark: date === '2025-04-01' ? '10.00' : '15.00',
      }),
    ],
  },
});

describe('RunSectionComponent', () => {
  let fixture: ComponentFixture<RunSectionComponent>;
  let store: InstanceType<typeof OptionChainPctChangeStore>;
  let ensureSpy: jest.SpyInstance;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RunSectionComponent],
      providers: [
        { provide: OptionsContractService, useValue: { getHistoricalOptionsChain$: jest.fn((_s: string, d: string) => of(chainFor(d))) } },
        { provide: PctChangeConfigService, useValue: { getSavedConfigs$: jest.fn(() => of([])) } },
        { provide: LocalBarReadService, useValue: { getDailyBarsForRange$: jest.fn(() => of([])) } },
        { provide: SwingAnalysisService, useValue: { loadSavedAnalyses: jest.fn(() => of([])) } },
        { provide: SymbolHistoryStore, useValue: { signalHistoryCache: signal({}), loadSignalHistory: jest.fn() } },
        { provide: Firestore, useValue: {} },
        OptionChainPctChangeStore,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(RunSectionComponent);
    store = TestBed.inject(OptionChainPctChangeStore);
    ensureSpy = jest.spyOn(store, 'ensureSnapshots');
    fixture.componentRef.setInput('run', run);
    fixture.componentRef.setInput('index', 0);
    fixture.detectChanges();
  });

  const details = () =>
    fixture.debugElement.query(By.css('[data-testid="run-details"]')).nativeElement as HTMLDetailsElement;

  it('renders the numbered run header', () => {
    expect(fixture.nativeElement.textContent).toContain('Run 1');
    expect(fixture.nativeElement.textContent).toContain('2025-04-01');
    expect(fixture.nativeElement.textContent).toContain('call');
  });

  it('starts collapsed', () => {
    expect(details().open).toBe(false);
  });

  it('calls ensureSnapshots for the run dates on first expand', () => {
    details().open = true;
    details().dispatchEvent(new Event('toggle'));
    expect(ensureSpy).toHaveBeenCalledWith(['2025-04-01', '2025-04-10', '2025-04-15']);
  });

  it('does not fetch on collapse', () => {
    details().open = false;
    details().dispatchEvent(new Event('toggle'));
    expect(ensureSpy).not.toHaveBeenCalled();
  });

  it('renders one pct-change grid per target date once snapshots land', () => {
    details().open = true;
    details().dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    const grids = fixture.debugElement.queryAll(By.css('app-pct-change-grid'));
    expect(grids.length).toBe(2);
    expect(grids[0].componentInstance.grid().targetDate).toBe('2025-04-10');
    expect(grids[1].componentInstance.grid().targetDate).toBe('2025-04-15');
  });

  it('shows a loading hint while snapshots are in flight', () => {
    // Swap the service for a never-resolving pending fetch.
    const pending = new Subject<unknown>();
    const svc = TestBed.inject(OptionsContractService);
    (svc.getHistoricalOptionsChain$ as jest.Mock).mockImplementation(() => pending.asObservable());

    details().open = true;
    details().dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('[data-testid="run-loading"]'))).toBeTruthy();
    expect(fixture.debugElement.queryAll(By.css('app-pct-change-grid')).length).toBe(0);
  });

  it('stops the loading hint once the start snapshot lands (even empty)', () => {
    const svc = TestBed.inject(OptionsContractService);
    (svc.getHistoricalOptionsChain$ as jest.Mock).mockImplementation(() =>
      of({ ok: true, data: { data: [] } }),
    );

    details().open = true;
    details().dispatchEvent(new Event('toggle'));
    fixture.detectChanges();

    // Empty snapshot → grids render with zero cells (skeleton), not a
    // stuck "loading…" — the cache key landing is the ready signal.
    expect(fixture.debugElement.query(By.css('[data-testid="run-loading"]'))).toBeNull();
    expect(fixture.debugElement.queryAll(By.css('app-pct-change-grid')).length).toBe(2);
  });

  it('passes the run scope to child grids for the chart popup', () => {
    details().open = true;
    details().dispatchEvent(new Event('toggle'));
    fixture.detectChanges();
    const grid = fixture.debugElement.query(By.css('app-pct-change-grid'));
    const scope = grid.componentInstance.seriesScope();
    expect(scope).toEqual({
      startDate: '2025-04-01',
      targetDates: ['2025-04-10', '2025-04-15'],
      type: OptionType.CALL,
    });
  });

  it('emits the run id on remove', () => {
    const emitted: string[] = [];
    fixture.componentInstance.removed.subscribe((id: string) => emitted.push(id));
    fixture.debugElement.query(By.css('[data-testid="remove-run-btn"]')).nativeElement.click();
    expect(emitted).toEqual(['r1']);
  });
});
