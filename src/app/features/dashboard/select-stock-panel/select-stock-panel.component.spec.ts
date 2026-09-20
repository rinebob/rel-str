import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

import { SelectStockPanelComponent } from './select-stock-panel.component';

describe('SelectStockPanelComponent', () => {
  let component: SelectStockPanelComponent;
  let fixture: ComponentFixture<SelectStockPanelComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SelectStockPanelComponent],
      providers: [{ provide: Firestore, useValue: {} }, { provide: Auth, useValue: {} }, { provide: Functions, useValue: {} }]
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
