import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';

import { TriageReportComponent } from './triage-report.component';
import { OccurrenceDecisionService } from '../../services/occurrence-decision.service';
import { UiStateService } from '../../../../core/services/ui-state.service';

describe('TriageReportComponent', () => {
  let fixture: ComponentFixture<TriageReportComponent>;
  let uiStateMock: { setFullscreen: jest.Mock; fullscreen: ReturnType<typeof signal<boolean>>; toggleFullscreen: jest.Mock };

  beforeEach(async () => {
    uiStateMock = { setFullscreen: jest.fn(), fullscreen: signal(true), toggleFullscreen: jest.fn() };

    await TestBed.configureTestingModule({
      imports: [TriageReportComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: UiStateService, useValue: uiStateMock },
        {
          provide: OccurrenceDecisionService,
          useValue: { loadDecisionsForDateRange: jest.fn().mockReturnValue(of([])) },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TriageReportComponent);
    fixture.detectChanges();
  });

  it('enters fullscreen on init', () => {
    expect(uiStateMock.setFullscreen).toHaveBeenCalledWith(true);
  });

  it('resets fullscreen on destroy', () => {
    uiStateMock.setFullscreen.mockClear();
    fixture.destroy();
    expect(uiStateMock.setFullscreen).toHaveBeenCalledWith(false);
  });
});
