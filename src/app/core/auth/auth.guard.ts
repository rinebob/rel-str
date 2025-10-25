import { inject } from '@angular/core';
import { Router, UrlTree } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { onAuthStateChanged } from 'firebase/auth';

export const authGuard = (): Promise<boolean | UrlTree> => {
  const router = inject(Router);
  const auth = inject(Auth);

  return new Promise((resolve) => {
    const unsub = onAuthStateChanged(auth, (u) => {
      try {
        resolve(u ? true : (router.parseUrl('/login') as UrlTree));
      } finally {
        unsub();
      }
    });
  });
};
