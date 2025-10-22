import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StockListSelectorComponent } from './stock-list-selector.component';

describe('StockListSelectorComponent', () => {
  let component: StockListSelectorComponent;
  let fixture: ComponentFixture<StockListSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StockListSelectorComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(StockListSelectorComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
