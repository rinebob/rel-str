import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ApplicationConfig } from '@angular/core';
import { PreloadAllModules, provideRouter, withPreloading } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { APP_ROUTES } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth, connectAuthEmulator } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';
import { getPerformance, providePerformance } from '@angular/fire/performance';
import { connectStorageEmulator, getStorage, provideStorage } from '@angular/fire/storage';
import { setPersistence, browserLocalPersistence } from 'firebase/auth';

import { environment } from '../environments/environment';

import { registerLicense } from '@syncfusion/ej2-base';
import { SYNC_FUSION_LICENSE_KEY } from '../secrets/syncfusion-license';

registerLicense(SYNC_FUSION_LICENSE_KEY);

function isLocalHost(host: string): boolean {
    const h = (host || '').toLowerCase();
    return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0' || h.startsWith('192.168.');
}

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(APP_ROUTES, withPreloading(PreloadAllModules)),
        provideAnimationsAsync(),
        provideHttpClient(),

        // IMPORTANT: Initialize Firebase app BEFORE other AngularFire providers
        provideFirebaseApp(() => initializeApp(environment.firebase)),

        provideAuth(() => {
            const auth = getAuth();
            const useEmu = (environment as any)?.useEmulators === true || isLocalHost(location.hostname);
            if (useEmu) {
                // Auth emulator default port is 9100 per emulator config
                connectAuthEmulator(auth, 'http://127.0.0.1:9100', { disableWarnings: true });
                (window as any).__EMULATORS__ = { ...(window as any).__EMULATORS__, auth: true };
            }
            // Persist user across reloads
            setPersistence(auth, browserLocalPersistence).catch((e) => {
                console.warn('[Auth] setPersistence failed; falling back to default session persistence', e);
            });
            return auth;
        }),
        provideFirestore(() => {
            const firestore = getFirestore();
            const useEmu = (environment as any)?.useEmulators === true || isLocalHost(location.hostname);
            console.log('[Firestore] useEmulators:', useEmu, 'environment.useEmulators:', (environment as any)?.useEmulators, 'isLocalHost:', isLocalHost(location.hostname));
            if (useEmu) {
                // Firestore emulator is running on 127.0.0.1:8088 per emulator output
                console.log('[Firestore] Connecting to emulator at 127.0.0.1:8088');
                connectFirestoreEmulator(firestore, '127.0.0.1', 8088);
                (window as any).__EMULATORS__ = { ...(window as any).__EMULATORS__, firestore: true };
                console.log('[Firestore] Connected to emulator, __EMULATORS__:', (window as any).__EMULATORS__);
            } else {
                console.log('[Firestore] Using production Firestore');
            }
            return firestore;
        }),
        provideFunctions(() => {
            const functions = getFunctions(undefined as any, 'us-central1');
            const useEmu = (environment as any)?.useEmulators === true || isLocalHost(location.hostname);
            if (useEmu) {
                // Functions emulator; prefer 'localhost' to avoid CORS preflight issues with 127.0.0.1
                connectFunctionsEmulator(functions, 'localhost', 5002);
                (window as any).__EMULATORS__ = { ...(window as any).__EMULATORS__, functions: true };
                console.debug('[Functions] Connected to emulator at http://localhost:5002 (region us-central1)');
            }
            return functions;
        }),
        providePerformance(() => getPerformance()),
        provideStorage(() => {
            const storage = getStorage();
            const useEmu = (environment as any)?.useEmulators === true || isLocalHost(location.hostname);
            if (useEmu) {
                // Storage emulator is running on 127.0.0.1:9200 per emulator output
                connectStorageEmulator(storage, '127.0.0.1', 9200);
                (window as any).__EMULATORS__ = { ...(window as any).__EMULATORS__, storage: true };
            }
            return storage;
        }),
    ],
};
