import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';

import { RsChartViewComponent } from './rs-chart-view.component';

describe('RsChartViewComponent', () => {
  let component: RsChartViewComponent;
  let fixture: ComponentFixture<RsChartViewComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RsChartViewComponent],
      providers: [{ provide: Firestore, useValue: {} }, { provide: Auth, useValue: {} }, { provide: Functions, useValue: {} }],
    }).compileComponents();

    fixture = TestBed.createComponent(RsChartViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
