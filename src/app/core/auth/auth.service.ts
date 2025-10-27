import { Injectable, inject } from '@angular/core';
import { Auth, GoogleAuthProvider, User, createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup, signOut, user as afUser } from '@angular/fire/auth';
import { Firestore, doc, getDoc, serverTimestamp, setDoc } from '@angular/fire/firestore';
import { Observable, firstValueFrom } from 'rxjs';

/**
 * AuthService encapsulates all Firebase Auth and Firestore side-effects.
 * It contains no application state; consumers should use AuthStore for state.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly auth = inject(Auth);
  private readonly db = inject(Firestore);

  /** Cold observable of the Firebase user. */
  readonly user$: Observable<User | null> = afUser(this.auth);

  /** Retrieve an ID token for the given user. */
  async getIdToken(u: User): Promise<string> {
    return u.getIdToken();
  }

  /** Ensure a minimal users/{uid} document exists; updates last seen otherwise. */
  async ensureUserDoc(u: User): Promise<void> {
    const ref = doc(this.db, `users/${u.uid}`);

    const write = async () => {
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
        await setDoc(ref, { updatedAt: serverTimestamp() }, { merge: true });
      }
    };

    try {
      await write();
    } catch {
      // Retry once after a short delay (handles rare post-auth rules propagation races)
      await new Promise(res => setTimeout(res, 250));
      await write();
    }
  }

  /** Email/password sign-in. */
  async signInWithEmail(email: string, password: string): Promise<User> {
    const cred = await signInWithEmailAndPassword(this.auth, email, password);
    await this.ensureUserDoc(cred.user);
    return cred.user;
  }

  /** Email/password signup. */
  async signUpWithEmail(email: string, password: string): Promise<User> {
    const cred = await createUserWithEmailAndPassword(this.auth, email, password);
    await this.ensureUserDoc(cred.user);
    return cred.user;
  }

  /** Google sign-in via popup. */
  async signInWithGoogle(): Promise<User> {
    const provider = new GoogleAuthProvider();
    const cred = await signInWithPopup(this.auth, provider);
    await this.ensureUserDoc(cred.user);
    return cred.user;
  }

  /** Sign out the current user. */
  async signOut(): Promise<void> {
    await signOut(this.auth);
  }
}
