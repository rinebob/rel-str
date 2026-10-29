import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';

import { UiStateService } from '../../../../core/services/ui-state.service';
import { SignalDirection, SignalStatus, SignalTimeframe } from '../../common/constants';
import { SignalService } from '../../services/signal.service';
import { StSignalItem } from '../../services/types';
import { SignalListComponent } from './signal-list.component';

describe('SignalListComponent', () => {
  let fixture: ComponentFixture<SignalListComponent>;
  let component: SignalListComponent;

  const signals: StSignalItem[] = [
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
          provide: SignalService,
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

  it('dimmedSymbols renders viewed rows with the .viewed class (#1232/#1256)', () => {
    fixture.componentRef.setInput('symbols', ['AAPL', 'MSFT', 'TSLA']);
    fixture.componentRef.setInput('dimmedSymbols', new Set(['MSFT']));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.signal-item');
    expect(rows.length).toBe(3);
    expect(rows[0].classList.contains('viewed')).toBe(false);
    expect(rows[1].classList.contains('viewed')).toBe(true);
    expect(rows[2].classList.contains('viewed')).toBe(false);
  });

  it('rowMeta renders company name + detail; unresolvable rows stay ticker-only (#1313)', () => {
    fixture.componentRef.setInput('symbols', ['ACME', 'WIDGET']);
    fixture.componentRef.setInput('rowMeta', {
      ACME: { name: 'Acme Corp', detail: 'Range pos: 97.5%' },
    });
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.signal-item');
    expect(rows[0].querySelector('.row-name')?.textContent.trim()).toBe('Acme Corp');
    expect(rows[0].querySelector('.row-detail')?.textContent.trim()).toBe('Range pos: 97.5%');
    expect(rows[1].querySelector('.row-name')).toBeNull();
    expect(rows[1].querySelector('.row-detail')).toBeNull();
  });
});
