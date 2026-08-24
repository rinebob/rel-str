import { TestBed } from '@angular/core/testing';
import { AuthStore } from '../../../src/app/core/auth/auth.store';
import type { User } from '@angular/fire/auth';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';
import { Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';

describe('AuthStore', () => {
  let store: InstanceType<typeof AuthStore>;

  const user$ = new BehaviorSubject<User | null>(null);

  const authMock: Partial<Auth> & { _user$: BehaviorSubject<User | null> } = {
    _user$: user$,
    // AngularFire exposes user(auth) => Observable<User|null>; our store uses that.
  } as any;

  const firestoreMock: Partial<Firestore> = {} as any;

  const routerMock = {
    navigate: jest.fn().mockResolvedValue(true),
    parseUrl: jest.fn((x: string) => x),
  } as any as Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AuthStore,
        { provide: Auth, useValue: authMock },
        { provide: Firestore, useValue: firestoreMock },
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

  it('signOut should navigate to root', async () => {
    await store.signOut();
    expect(routerMock.navigate).toHaveBeenCalledWith(['/']);
  });
});
