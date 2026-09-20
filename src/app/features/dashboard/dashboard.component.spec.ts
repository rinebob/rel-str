import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { of } from 'rxjs';

import { DashboardComponent } from './dashboard.component';
import { RelStrDbService } from '../services/rel-str-db.service';
import { RsDataService } from '../services/rs-data.service';

// Smoke-test the component without Firebase: explicitly-defined members win;
// `$`-suffixed methods return `of([])`, other methods return `Promise.resolve([])`
// (matching this codebase's Observable-suffix convention). Accessing the mock
// as a property yields a function, so misuse fails loudly rather than silently
// patching wrong-typed values into store state.
const autoServiceMock = (sync: Record<string, unknown> = {}) =>
  new Proxy(sync as Record<string | symbol, unknown>, {
    get: (t, p) => {
      if (p in t) return t[p];
      if (p === 'then' || p === 'catch' || p === 'finally') return undefined;
      return typeof p === 'string' && p.endsWith('$') ? () => of([]) : () => Promise.resolve([]);
    },
  });

describe('DashboardComponent', () => {
  let component: DashboardComponent;
  let fixture: ComponentFixture<DashboardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        { provide: Firestore, useValue: {} },
        { provide: Auth, useValue: {} },
        { provide: Functions, useValue: {} },
        {
          provide: RelStrDbService,
          useValue: autoServiceMock({
            getSupportedSymbolsList: () => [],
            getSupportedPairsList: () => [],
          }),
        },
        { provide: RsDataService, useValue: autoServiceMock() },
      ],
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it(`should have the 'rel-str' title`, () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('rel-str');
  });

  it('should render the dashboard shell', () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.children.length).toBeGreaterThan(0);
  });
});
