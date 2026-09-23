import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { ChartToolbarComponent } from './chart-toolbar.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import { ChartLayout } from '../../../../core/services/ui-state.service';

describe('ChartToolbarComponent', () => {
  let fixture: ComponentFixture<ChartToolbarComponent>;
  let component: ChartToolbarComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ChartToolbarComponent],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    fixture = TestBed.createComponent(ChartToolbarComponent);
    component = fixture.componentRef.instance;

    fixture.componentRef.setInput('selectedInterval', BarsInterval.DAILY);
    fixture.componentRef.setInput('selectedRange', 'recent');
    fixture.componentRef.setInput('showZoomToolbar', false);
    fixture.componentRef.setInput('activeChartInterval', BarsInterval.DAILY);
    fixture.componentRef.setInput('layout', ChartLayout.SINGLE);
    fixture.componentRef.setInput('fullscreen', false);
    fixture.componentRef.setInput('logScale', true);
    fixture.componentRef.setInput('indicatorOptions', []);
    fixture.componentRef.setInput('selectedIndicatorIds', new Set<string>());

    fixture.detectChanges();
  });

  it('renders the Log Y-axis toggle in the Yes state when logScale is true', () => {
    const btn = fixture.debugElement.query(By.css('.log-btn'));
    expect(btn).toBeTruthy();
    expect(btn.nativeElement.textContent).toContain('Log Y-axis');
    expect(btn.nativeElement.textContent).toContain('Yes');
    expect(btn.nativeElement.classList.contains('active')).toBe(true);
  });

  it('renders the Log Y-axis toggle in the No state when logScale is false', () => {
    fixture.componentRef.setInput('logScale', false);
    fixture.detectChanges();

    const btn = fixture.debugElement.query(By.css('.log-btn'));
    expect(btn.nativeElement.textContent).toContain('No');
    expect(btn.nativeElement.classList.contains('active')).toBe(false);
  });

  it('emits logScaleToggle when the Log Y-axis button is clicked', () => {
    const spy = jest.spyOn(component.logScaleToggle, 'emit');
    const btn = fixture.debugElement.query(By.css('.log-btn'));
    btn.nativeElement.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
