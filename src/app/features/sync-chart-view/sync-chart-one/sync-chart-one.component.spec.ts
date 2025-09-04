import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SyncChartOneComponent } from './sync-chart-one.component';

describe('SyncChartOneComponent', () => {
  let component: SyncChartOneComponent;
  let fixture: ComponentFixture<SyncChartOneComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyncChartOneComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SyncChartOneComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
