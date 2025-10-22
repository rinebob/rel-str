import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DashboardV2Component } from './dashboard-v2.component';

describe('DashboardV2Component', () => {
  let component: DashboardV2Component;
  let fixture: ComponentFixture<DashboardV2Component>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardV2Component]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(DashboardV2Component);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it(`should have the 'rel-str' title`, () => {
    const fixture = TestBed.createComponent(DashboardV2Component);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('rel-str');
  });

  it('should render without crashing', () => {
    const fixture = TestBed.createComponent(DashboardV2Component);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled).toBeTruthy();
  });
});
