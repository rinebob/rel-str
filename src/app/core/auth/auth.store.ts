import { computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { User } from '@angular/fire/auth';
import { patchState, signalStore, withComputed, withHooks, withMethods, withProps, withState } from '@ngrx/signals';

import { AuthService } from './auth.service';
import { AppRoutes } from '../common/interfaces';

export type AuthError = { code: string; message: string } | null;

export type AuthState = {
  user: User | null;
  loading: boolean;
  error: AuthError;
};

const initialState: AuthState = {
  user: null,
  loading: false,
  error: null,
};

export const AuthStore = signalStore(
  { providedIn: 'root' },
  withState<AuthState>(initialState),
  withComputed((store) => ({
    isAuthenticated: computed(() => !!store.user()),
  })),
  // Expose observables for UI consumption
  withProps((store) => ({
    user$: toObservable(store.user),
    isAuthenticated$: toObservable(store.isAuthenticated),
  })),
  withMethods((store, auth = inject(AuthService), router = inject(Router)) => ({
    async signInWithEmail(email: string, password: string): Promise<User | null> {
      patchState(store, { loading: true, error: null });
      try {
        const u = await auth.signInWithEmail(email, password);
        patchState(store, { user: u });
        await router.navigate([`/${AppRoutes.DASHBOARD_V2}`]);
        return u;
      } catch (e: any) {
        patchState(store, { error: { code: e?.code ?? 'auth/unknown', message: e?.message ?? 'Unknown error' } });
        return null;
      } finally {
        patchState(store, { loading: false });
      }
    },

    async signUpWithEmail(email: string, password: string, displayName?: string): Promise<User | null> {
      patchState(store, { loading: true, error: null });
      try {
        const u = await auth.signUpWithEmail(email, password);
        patchState(store, { user: u });
        await router.navigate([`/${AppRoutes.DASHBOARD_V2}`]);
        return u;
      } catch (e: any) {
        patchState(store, { error: { code: e?.code ?? 'auth/unknown', message: e?.message ?? 'Unknown error' } });
        return null;
      } finally {
        patchState(store, { loading: false });
      }
    },

    async signInWithGoogle(): Promise<User | null> {
      patchState(store, { loading: true, error: null });
      try {
        const u = await auth.signInWithGoogle();
        patchState(store, { user: u });
        await router.navigate([`/${AppRoutes.DASHBOARD_V2}`]);
        return u;
      } catch (e: any) {
        patchState(store, { error: { code: e?.code ?? 'auth/unknown', message: e?.message ?? 'Unknown error' } });
        return null;
      } finally {
        patchState(store, { loading: false });
      }
    },

    async signOut(): Promise<void> {
      patchState(store, { loading: true, error: null });
      try {
        await auth.signOut();
        patchState(store, { user: null });
        await router.navigate([`/${AppRoutes.LOGIN}`]);
      } catch (e: any) {
        patchState(store, { error: { code: e?.code ?? 'auth/unknown', message: e?.message ?? 'Unknown error' } });
      } finally {
        patchState(store, { loading: false });
      }
    },
  })),
  withHooks({
    onInit(store) {
      // Keep state.user in sync with Firebase user
      const auth = inject(AuthService);
      const sub = auth.user$.subscribe((u) => {
        patchState(store, { user: u });
        console.debug('[Auth] user changed', u?.email || null);
      });
      return () => sub.unsubscribe();
    },
  })
);
