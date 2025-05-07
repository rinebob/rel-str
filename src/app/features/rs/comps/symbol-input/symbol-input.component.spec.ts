import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SymbolInputComponent } from './symbol-input.component';

describe('SymbolInputComponent', () => {
  let component: SymbolInputComponent;
  let fixture: ComponentFixture<SymbolInputComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SymbolInputComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(SymbolInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
