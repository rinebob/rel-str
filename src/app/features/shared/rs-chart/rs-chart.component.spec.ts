import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RsChartComponent } from './rs-chart.component';

describe('RsChartComponent', () => {
  let component: RsChartComponent;
  let fixture: ComponentFixture<RsChartComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RsChartComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(RsChartComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
