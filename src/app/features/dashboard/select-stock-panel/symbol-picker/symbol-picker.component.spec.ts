import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

import { SymbolPickerComponent } from './symbol-picker.component';

describe('SymbolPickerComponent', () => {
  let component: SymbolPickerComponent;
  let fixture: ComponentFixture<SymbolPickerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SymbolPickerComponent],
      providers: [{ provide: Firestore, useValue: {} }, { provide: Auth, useValue: {} }, { provide: Functions, useValue: {} }]
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
