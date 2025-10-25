import { Injectable, computed, inject, signal } from '@angular/core';
import { Auth, GoogleAuthProvider, User, signInWithEmailAndPassword, createUserWithEmailAndPassword, signInWithPopup, signOut, user as afUser } from '@angular/fire/auth';
import { Firestore, doc, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { toSignal } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';
import { AppRoutes } from '../common/interfaces';

export type AuthError = { code: string; message: string } | null;

@Injectable({ providedIn: 'root' })
export class AuthStore {
  private readonly auth = inject(Auth);
  private readonly db = inject(Firestore);
  private readonly router = inject(Router);

  private readonly _loading = signal(false);
  private readonly _error = signal<AuthError>(null);

  // Stream current user and convert to a signal (no extra deps)
  private readonly user$ = afUser(this.auth);
  readonly user = toSignal<User | null>(this.user$, { initialValue: null });

  readonly isAuthenticated = computed(() => !!this.user());
  readonly loading = computed(() => this._loading());
  readonly error = computed(() => this._error());

  // Ensure minimal users/{uid} doc exists
  private async ensureUserDoc(u: User): Promise<void> {
    const ref = doc(this.db, `users/${u.uid}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        displayName: u.displayName ?? null,
        email: u.email ?? null,
        photoURL: u.photoURL ?? null,
        dev: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      // Minimal touch update to track last seen
      await setDoc(
        ref,
        {
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  }

  async signInWithEmail(email: string, password: string): Promise<User | null> {
    this._error.set(null);
    this._loading.set(true);
    try {
      const cred = await signInWithEmailAndPassword(this.auth, email, password);
      await this.ensureUserDoc(cred.user);
      // Reason: Navigate to the new default view after successful login
      await this.router.navigate([`/${AppRoutes.DASHBOARD_V2}`]);
      return cred.user;
    } catch (e: any) {
      this._error.set({ code: e.code ?? 'auth/unknown', message: e.message ?? 'Unknown error' });
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  async signUpWithEmail(email: string, password: string, displayName?: string): Promise<User | null> {
    this._error.set(null);
    this._loading.set(true);
    try {
      const cred = await createUserWithEmailAndPassword(this.auth, email, password);
      // Optionally update profile displayName here if needed.
      await this.ensureUserDoc(cred.user);
      await this.router.navigate([`/${AppRoutes.DASHBOARD_V2}`]);
      return cred.user;
    } catch (e: any) {
      this._error.set({ code: e.code ?? 'auth/unknown', message: e.message ?? 'Unknown error' });
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  async signInWithGoogle(): Promise<User | null> {
    this._error.set(null);
    this._loading.set(true);
    try {
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(this.auth, provider);
      await this.ensureUserDoc(cred.user);
      await this.router.navigate([`/${AppRoutes.DASHBOARD_V2}`]);
      return cred.user;
    } catch (e: any) {
      this._error.set({ code: e.code ?? 'auth/unknown', message: e.message ?? 'Unknown error' });
      return null;
    } finally {
      this._loading.set(false);
    }
  }

  async signOut(): Promise<void> {
    this._error.set(null);
    this._loading.set(true);
    try {
      await signOut(this.auth);
      await this.router.navigate([`/${AppRoutes.LOGIN}`]);
    } catch (e: any) {
      this._error.set({ code: e.code ?? 'auth/unknown', message: e.message ?? 'Unknown error' });
    } finally {
      this._loading.set(false);
    }
  }
}
