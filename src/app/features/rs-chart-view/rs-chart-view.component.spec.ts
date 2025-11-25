import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RsChartViewComponent } from './rs-chart-view.component';

describe('RsChartViewComponent', () => {
  let component: RsChartViewComponent;
  let fixture: ComponentFixture<RsChartViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RsChartViewComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(RsChartViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
