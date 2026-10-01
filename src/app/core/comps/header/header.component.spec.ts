import { ComponentFixture, TestBed } from '@angular/core/testing';
import { computed, signal, WritableSignal } from '@angular/core';
import { Router } from '@angular/router';
import { User } from '@angular/fire/auth';

import { HeaderComponent } from './header.component';
import { AuthStore } from '../../auth/auth.store';
import { UiStateService } from '../../services/ui-state.service';

describe('HeaderComponent', () => {
  let component: HeaderComponent;
  let fixture: ComponentFixture<HeaderComponent>;
  let user: WritableSignal<User | null>;
  let loading: WritableSignal<boolean>;
  let authStore: { signOut: jest.Mock };
  let router: { navigate: jest.Mock };
  let uiState: UiStateService;

  const el = () => fixture.nativeElement as HTMLElement;

  beforeEach(async () => {
    user = signal<User | null>(null);
    loading = signal(false);
    authStore = { signOut: jest.fn().mockResolvedValue(undefined) };
    router = { navigate: jest.fn().mockResolvedValue(true) };

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
