import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import { ChartToolbarComponent } from './chart-toolbar.component';
import { BarsInterval } from '../../../../core/models/partner.types';
import { ChartLayout } from '../../../../core/services/ui-state.service';
import type { ChartRange } from '../../../shared/components/flex-chart/flex-chart.types';

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
    fixture.componentRef.setInput('selectedRange', '50');
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
    const btn = fixture.debugElement.query(By.css('.log-scale-pill'));
    expect(btn).toBeTruthy();
    expect(btn.nativeElement.textContent).toContain('Log Y-axis');
    expect(btn.nativeElement.getAttribute('aria-pressed')).toBe('true');
    expect(btn.nativeElement.classList.contains('active')).toBe(true);
  });

  it('renders the Log Y-axis toggle in the off state when logScale is false', () => {
    fixture.componentRef.setInput('logScale', false);
    fixture.detectChanges();

    const btn = fixture.debugElement.query(By.css('.log-scale-pill'));
    expect(btn.nativeElement.getAttribute('aria-pressed')).toBe('false');
    expect(btn.nativeElement.querySelector('.dse-icon')!.textContent!.trim()).toBe('power_off');
    expect(btn.nativeElement.classList.contains('active')).toBe(false);
  });

  it('emits logScaleToggle when the Log Y-axis button is clicked', () => {
    const spy = jest.spyOn(component.logScaleToggle, 'emit');
    const btn = fixture.debugElement.query(By.css('.log-scale-pill'));
    btn.nativeElement.click();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('range pill group renders exactly 25 50 100 6M 1Y 5Y All — Recent is gone', () => {
    const root = fixture.nativeElement as HTMLElement;
    const group = root.querySelectorAll('.pill-group.flat')[1];
    const labels = Array.from(group.querySelectorAll<HTMLButtonElement>('.pill'))
      .map((b) => b.textContent?.trim());
    expect(labels).toEqual(['25', '50', '100', '6M', '1Y', '5Y', 'All']);
  });

  it('active pill follows the selectedRange input; clicks emit rangeChange with the token', () => {
    const root = fixture.nativeElement as HTMLElement;
    const group = root.querySelectorAll('.pill-group.flat')[1];
    const pills = Array.from(group.querySelectorAll<HTMLButtonElement>('.pill'));
    const byLabel = (t: string) => pills.find((b) => b.textContent?.trim() === t);

    // selectedRange input is '50' in beforeEach — its pill is lit.
    expect(byLabel('50')?.classList.contains('active')).toBe(true);
    expect(byLabel('25')?.classList.contains('active')).toBe(false);

    // Input parity: every union member has a matching pill.
    fixture.componentRef.setInput('selectedRange', '25');
    fixture.detectChanges();
    expect(byLabel('25')?.classList.contains('active')).toBe(true);
    expect(byLabel('50')?.classList.contains('active')).toBe(false);

    const emitted: ChartRange[] = [];
    component.rangeChange.subscribe((v) => emitted.push(v));
    byLabel('100')?.click();
    expect(emitted).toEqual(['100']);
  });
});
