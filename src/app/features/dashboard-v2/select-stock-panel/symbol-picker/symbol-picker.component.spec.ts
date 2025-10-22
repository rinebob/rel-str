import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SymbolPickerComponent } from './symbol-picker.component';

describe('SymbolPickerComponent', () => {
  let component: SymbolPickerComponent;
  let fixture: ComponentFixture<SymbolPickerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SymbolPickerComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(SymbolPickerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
