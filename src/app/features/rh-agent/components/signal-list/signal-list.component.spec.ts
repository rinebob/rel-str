import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { UiStateService } from '../../../../core/services/ui-state.service';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../../common/rh-agent.constants';
import { RhAgentSignalService } from '../../services/rh-agent-signal.service';
import { RhAgentSignalItem } from '../../services/rh-agent.types';
import { SignalListComponent } from './signal-list.component';

describe('SignalListComponent', () => {
  let fixture: ComponentFixture<SignalListComponent>;
  let component: SignalListComponent;

  const signals: RhAgentSignalItem[] = [
    {
      id: '2026-07-16',
      symbol: 'AAPL',
      barDate: '2026-07-16',
      marketDate: '2026-07-16',
      runId: 'run-daily',
      timeframe: SignalTimeframe.DAILY,
      direction: SignalDirection.LONG,
      signalType: 'DAILY_BREAKOUT',
      status: SignalStatus.CONFIRMED,
      indicators: {},
    },
    {
      id: '2026-07-16',
      symbol: 'AAPL',
      barDate: '2026-07-16',
      marketDate: '2026-07-16',
      runId: 'run-weekly',
      timeframe: SignalTimeframe.WEEKLY,
      direction: SignalDirection.LONG,
      signalType: 'WEEKLY_BREAKOUT',
      status: SignalStatus.CONFIRMED,
      indicators: {},
    },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignalListComponent],
      providers: [
        provideNoopAnimations(),
        {
          provide: RhAgentSignalService,
          useValue: {
            getSymbolSignalHistoryFromHistory: jasmine.createSpy().and.returnValue(of(signals)),
          },
        },
        {
          provide: UiStateService,
          useValue: {
            toggleSidebar: jasmine.createSpy(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SignalListComponent);
    component = fixture.componentInstance;
  });

  it('uses unique row identities for multiple manual-history signals from one symbol', async () => {
    fixture.componentRef.setInput('manualSymbol', 'AAPL');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const trackIds = component.items().map((item) => item.trackId);

    expect(trackIds.length).toBe(2);
    expect(new Set(trackIds).size).toBe(2);
    expect(fixture.nativeElement.querySelectorAll('.signal-item').length).toBe(2);
  });
});
