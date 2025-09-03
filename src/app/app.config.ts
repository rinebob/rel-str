import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ApplicationConfig } from '@angular/core';
import { PreloadAllModules, provideRouter, withPreloading } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';

import { APP_ROUTES } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, provideAppCheck } from '@angular/fire/app-check';
import { connectFirestoreEmulator, getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { getPerformance, providePerformance } from '@angular/fire/performance';
import { getStorage, provideStorage } from '@angular/fire/storage';


import { environment } from '../environments/environment';
import { provideMessaging } from '@angular/fire/messaging';
import { getMessaging } from '@angular/fire/messaging';

import { registerLicense } from '@syncfusion/ej2-base';
import { SYNC_FUSION_LICENSE_KEY } from '../secrets/syncfusion-license';

registerLicense(SYNC_FUSION_LICENSE_KEY);

export const appConfig: ApplicationConfig = {
	providers: [
		provideRouter(APP_ROUTES, withPreloading(PreloadAllModules)),
		// provideClientHydration(),
		provideAnimationsAsync(),
		provideHttpClient(),
		provideAuth(() => getAuth()),
		// provideAppCheck(() => {
            // 	// TODO get a reCAPTCHA Enterprise here https://console.cloud.google.com/security/recaptcha?project=_
            // 	const provider = new ReCaptchaEnterpriseProvider(REL_STR_RECAPTCHA_KEY);
            // 	return initializeAppCheck(undefined, { provider, isTokenAutoRefreshEnabled: true });
            // }),
        // provideFirestore(() => getFirestore()),
        provideFirestore(() => {
            const firestore = getFirestore();
            if (location.hostname === 'localhost') {
                connectFirestoreEmulator(firestore, '127.0.0.1', 8080);
            }
            return firestore;
        }),
        provideFunctions(() => getFunctions()),
        providePerformance(() => getPerformance()),
        provideStorage(() => getStorage()), 

        // provideMessaging(() => getMessaging()), 
        provideFirebaseApp(() => initializeApp(environment.firebase)),


	],
};
