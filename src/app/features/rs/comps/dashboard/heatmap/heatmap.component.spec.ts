import { ComponentFixture, TestBed } from '@angular/core/testing';

import { RsHeatmapComponent } from './heatmap.component';

describe('RsHeatmapComponent', () => {
  let component: RsHeatmapComponent;
  let fixture: ComponentFixture<RsHeatmapComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RsHeatmapComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(RsHeatmapComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
