import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

import { StockListSelectorComponent } from './stock-list-selector.component';

describe('StockListSelectorComponent', () => {
  let component: StockListSelectorComponent;
  let fixture: ComponentFixture<StockListSelectorComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [StockListSelectorComponent],
      providers: [{ provide: Firestore, useValue: {} }, { provide: Auth, useValue: {} }, { provide: Functions, useValue: {} }]
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
