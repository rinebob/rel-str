import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RsChartComponent } from './rs-chart.component';
import { CHART_CONFIGS } from '../../../shared/constants/rs.constants';

describe('RsChartComponent', () => {
  let component: RsChartComponent;
  let fixture: ComponentFixture<RsChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RsChartComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RsChartComponent);
    fixture.componentRef.setInput('name', 'test');
    fixture.componentRef.setInput('chartData', []);
    fixture.componentRef.setInput('baselineData', []);
    fixture.componentRef.setInput('rsData', []);
    fixture.componentRef.setInput('config', CHART_CONFIGS[0]);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
