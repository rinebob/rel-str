import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

import { StockListFormComponent } from './stock-list-form.component';

describe('StockListFormComponent', () => {
  let component: StockListFormComponent;
  let fixture: ComponentFixture<StockListFormComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StockListFormComponent],
      providers: [{ provide: Firestore, useValue: {} }, { provide: Auth, useValue: {} }, { provide: Functions, useValue: {} }]
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
