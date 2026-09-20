import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../../../src/app/core/auth/auth.store';
import { AuthService } from '../../../src/app/core/auth/auth.service';
import type { User } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;

  const user$ = new BehaviorSubject<User | null>(null);

  const authServiceMock = {
    user$: user$.asObservable(),
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithGoogle: jest.fn(),
    signOut: jest.fn().mockResolvedValue(undefined),
  };

  const routerMock = {
    navigate: jest.fn().mockResolvedValue(true),
    parseUrl: jest.fn((x: string) => x),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthStore,
        { provide: AuthService, useValue: authServiceMock },
        { provide: Router, useValue: routerMock },
      ],
    });

    store = TestBed.inject(AuthStore);
  });

  it('should create and start unauthenticated', () => {
    expect(store).toBeTruthy();
    expect(store.isAuthenticated()).toBe(false);
    expect(store.user()).toBeNull();
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('signOut should navigate to login', async () => {
    await store.signOut();
    expect(authServiceMock.signOut).toHaveBeenCalled();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/login']);
  });
});
