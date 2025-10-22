import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ApplicationConfig } from '@angular/core';
import { PreloadAllModules, provideRouter, withPreloading } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { APP_ROUTES } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { connectFunctionsEmulator, getFunctions, provideFunctions } from '@angular/fire/functions';
import { getPerformance, providePerformance } from '@angular/fire/performance';
import { getStorage, provideStorage } from '@angular/fire/storage';

import { environment } from '../environments/environment';

import { registerLicense } from '@syncfusion/ej2-base';
import { SYNC_FUSION_LICENSE_KEY } from '../secrets/syncfusion-license';

registerLicense(SYNC_FUSION_LICENSE_KEY);

export const appConfig: ApplicationConfig = {
    providers: [
        provideRouter(APP_ROUTES, withPreloading(PreloadAllModules)),
        provideAnimationsAsync(),
        provideHttpClient(),

        // IMPORTANT: Initialize Firebase app BEFORE other AngularFire providers
        provideFirebaseApp(() => initializeApp(environment.firebase)),

        provideAuth(() => getAuth()),
        provideFirestore(() => {
            const firestore = getFirestore();
            const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            if (isLocal) {
                // Firestore emulator is running on 127.0.0.1:8088 per emulator output
                connectFirestoreEmulator(firestore, '127.0.0.1', 8088);
            }
            return firestore;
        }),
        provideFunctions(() => {
            const functions = getFunctions();
            const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
            if (isLocal) {
                // Functions emulator is running on 127.0.0.1:5002 per emulator output
                connectFunctionsEmulator(functions, '127.0.0.1', 5002);
            }
            return functions;
        }),
        providePerformance(() => getPerformance()),
        provideStorage(() => getStorage()),
    ],
};
