import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SyncChartViewComponent } from './sync-chart-view.component';

describe('SyncChartViewComponent', () => {
  let component: SyncChartViewComponent;
  let fixture: ComponentFixture<SyncChartViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyncChartViewComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SyncChartViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
