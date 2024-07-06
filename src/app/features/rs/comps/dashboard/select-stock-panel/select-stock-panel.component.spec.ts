import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SelectStockPanelComponent } from './select-stock-panel.component';

describe('SelectStockPanelComponent', () => {
  let component: SelectStockPanelComponent;
  let fixture: ComponentFixture<SelectStockPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectStockPanelComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(SelectStockPanelComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
