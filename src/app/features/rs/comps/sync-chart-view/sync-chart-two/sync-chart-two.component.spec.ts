import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SyncChartTwoComponent } from './sync-chart-two.component';

describe('SyncChartTwoComponent', () => {
  let component: SyncChartTwoComponent;
  let fixture: ComponentFixture<SyncChartTwoComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyncChartTwoComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SyncChartTwoComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
