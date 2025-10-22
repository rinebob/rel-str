import { ComponentFixture, TestBed } from '@angular/core/testing';

import { StockListFormComponent } from './stock-list-form.component';

describe('StockListFormComponent', () => {
  let component: StockListFormComponent;
  let fixture: ComponentFixture<StockListFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StockListFormComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(StockListFormComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
