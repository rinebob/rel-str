import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, computed, signal, WritableSignal } from '@angular/core';
import { provideRouter, Router, Routes, withDisabledInitialNavigation } from '@angular/router';
import { EMPTY } from 'rxjs';
import { User } from '@angular/fire/auth';

import { HeaderComponent } from './header.component';
import { AuthStore } from '../../auth/auth.store';
import { PAGE_INFO } from '../../common/constants';
import { AppRoutes } from '../../common/interfaces';
import { UiStateService } from '../../services/ui-state.service';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let user: WritableSignal<User | null>;
  let loading: WritableSignal<boolean>;
  let authStore: { signOut: jest.Mock };
  let router: { navigate: jest.Mock; events: unknown; routerState: unknown };
  let uiState: UiStateService;

  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    user = signal<User | null>(null);
    loading = signal(false);
    authStore = { signOut: jest.fn().mockResolvedValue(undefined) };
    // The identity zone reads events + routerState for pageInfo; an empty
    // pathFromRoot resolves to no PAGE_INFO key → zone renders empty.
    router = {
      navigate: jest.fn().mockResolvedValue(true),
      events: EMPTY,
      routerState: { snapshot: { root: { pathFromRoot: [] } } },
    };

    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        {
          provide: AuthStore,
          useValue: {
            user,
            isAuthenticated: computed(() => !!user()),
            loading,
            signOut: authStore.signOut,
          },
        },
        { provide: Router, useValue: router },
      ],
    }).compileComponents();

    uiState = TestBed.inject(UiStateService);
    uiState.setFullscreen(false);

    fixture = TestBed.createComponent(HeaderComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('shows the Savant Trader brand', () => {
    expect(el().querySelector('.header-text')?.textContent?.trim()).toBe('Savant Trader');
    expect(el().textContent).not.toContain('Relative Strength Heatmap');
  });

  it('does not render the refresh-time component', () => {
    expect(el().querySelector('rs-refresh-time')).toBeNull();
  });

  it('does not render a symbols/topnav button', () => {
    const icons = Array.from(el().querySelectorAll('mat-icon')).map(i => i.textContent?.trim());
    expect(icons).not.toContain('symbols');
  });

  it('emits openSidenav when the menu button is clicked', () => {
    const spy = jest.fn();
    component.openSidenav.subscribe(spy);
    el().querySelector<HTMLButtonElement>('.menu-button')!.click();
    expect(spy).toHaveBeenCalled();
  });

  it('fullscreen toggle calls uiState.toggleFullscreen', () => {
    const spy = jest.spyOn(uiState, 'toggleFullscreen');
    el().querySelector<HTMLButtonElement>('.fullscreen-toggle')!.click();
    expect(spy).toHaveBeenCalled();
  });

  describe('signed out', () => {
    it('shows Login and Sign up', () => {
      const buttons = Array.from(el().querySelectorAll('button')).map(b => b.textContent?.trim());
      expect(buttons).toContain('Login');
      expect(buttons).toContain('Sign up');
    });

    it('Login navigates to /login', () => {
      const login = Array.from(el().querySelectorAll<HTMLButtonElement>('button'))
        .find(b => b.textContent?.trim() === 'Login')!;
      login.click();
      expect(router.navigate).toHaveBeenCalledWith(['/login']);
    });

    it('Sign up navigates to /signup', () => {
      const signup = Array.from(el().querySelectorAll<HTMLButtonElement>('button'))
        .find(b => b.textContent?.trim() === 'Sign up')!;
      signup.click();
      expect(router.navigate).toHaveBeenCalledWith(['/signup']);
    });
  });

  describe('signed in', () => {
    beforeEach(() => {
      user.set({ displayName: 'Pat', email: 'pat@x.com' } as User);
      fixture.detectChanges();
    });

    it('shows the user label and Logout', () => {
      expect(el().querySelector('.user-label')?.textContent?.trim()).toBe('Pat');
      const buttons = Array.from(el().querySelectorAll('button')).map(b => b.textContent?.trim());
      expect(buttons).toContain('Logout');
      expect(buttons).not.toContain('Login');
    });

    it('Logout calls authStore.signOut', () => {
      const logout = Array.from(el().querySelectorAll<HTMLButtonElement>('button'))
        .find(b => b.textContent?.trim() === 'Logout')!;
      logout.click();
      expect(authStore.signOut).toHaveBeenCalled();
    });
  });
});

// Page-identity zone (#853) — identity resolved from the real Router via
// PAGE_INFO; the stub stands in for the lazy leaf components.
@Component({ standalone: true, template: '' })
class IdentityStubComponent {}

// The '' wrapper mirrors production shape (app.routes '' → core-routes ''
// → leaf) so the pathFromRoot join crosses the same empty segments. The
// `trading/live` children are synthetic fixture structure — prod leaves are
// flat paths; nesting exists only to exercise ancestor inheritance.
const IDENTITY_ROUTES: Routes = [
  {
    path: '',
    children: [
      { path: AppRoutes.LOGIN, component: IdentityStubComponent },
      { path: 'signals', redirectTo: AppRoutes.RUN_DASHBOARD, pathMatch: 'full' },
      { path: AppRoutes.RUN_DASHBOARD, component: IdentityStubComponent },
      { path: AppRoutes.SIGNAL_REVIEW, component: IdentityStubComponent },
      { path: AppRoutes.HEATMAP_CHART, component: IdentityStubComponent },
      {
        path: AppRoutes.SIGNAL_ORDER,
        children: [
          { path: '', component: IdentityStubComponent },
          { path: 'detail', component: IdentityStubComponent },
        ],
      },
      { path: 'unkeyed/path', component: IdentityStubComponent },
    ],
  },
];

describe('HeaderComponent — page identity zone (#853)', () => {
  let fixture: ComponentFixture<HeaderComponent>;
  let router: Router;

  const el = () => fixture.nativeElement as HTMLElement;
  const zone = () => el().querySelector('.page-identity');
  const zoneTitle = () => zone()?.querySelector('.page-title')?.textContent?.trim();
  const zoneIcon = () => zone()?.querySelector('mat-icon')?.textContent?.trim();
  const expectInfo = (route: AppRoutes) => {
    expect(zoneTitle()).toBe(PAGE_INFO[route].title);
    expect(zoneIcon()).toBe(PAGE_INFO[route].icon);
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HeaderComponent],
      providers: [
        // Disabled initial nav avoids NG04002 noise — no '' leaf exists.
        provideRouter(IDENTITY_ROUTES, withDisabledInitialNavigation()),
        {
          provide: AuthStore,
          useValue: {
            user: signal<User | null>(null),
            isAuthenticated: signal(false),
            loading: signal(false),
            signOut: jest.fn(),
          },
        },
      ],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(HeaderComponent);
    fixture.detectChanges();
  });

  it('renders icon + title after navigation and updates across routes', async () => {
    await router.navigateByUrl('/signals/review');
    fixture.detectChanges();
    // One literal pin — expectInfo derives expectations from PAGE_INFO,
    // so a wrong-but-present registry entry would pass without this.
    expect(zoneTitle()).toBe('Signal Review');
    expectInfo(AppRoutes.SIGNAL_REVIEW);

    await router.navigateByUrl('/trading/live');
    fixture.detectChanges();
    expectInfo(AppRoutes.SIGNAL_ORDER);
  });

  it('resolves the parameterized heatmap route to its routeConfig path', async () => {
    await router.navigateByUrl('/heatmap-chart/AAPL/MSFT');
    fixture.detectChanges();
    expectInfo(AppRoutes.HEATMAP_CHART);
  });

  it('resolves a redirect chain to the destination identity', async () => {
    await router.navigateByUrl('/signals');
    fixture.detectChanges();
    expectInfo(AppRoutes.RUN_DASHBOARD);
  });

  it('a nested route with no own key inherits the ancestor identity', async () => {
    await router.navigateByUrl('/trading/live/detail');
    fixture.detectChanges();
    expectInfo(AppRoutes.SIGNAL_ORDER);
  });

  it('an unkeyed path renders an empty zone — no stale identity', async () => {
    await router.navigateByUrl('/signals/review');
    fixture.detectChanges();
    expect(zone()).not.toBeNull();

    await router.navigateByUrl('/unkeyed/path');
    fixture.detectChanges();
    expect(zone()).toBeNull();
  });

  it('renders identity on a public route while signed out', async () => {
    await router.navigateByUrl('/login');
    fixture.detectChanges();
    expectInfo(AppRoutes.LOGIN);
    const buttons = Array.from(el().querySelectorAll('button')).map(b => b.textContent?.trim());
    expect(buttons).toContain('Login');
    expect(buttons).toContain('Sign up');
  });
});
