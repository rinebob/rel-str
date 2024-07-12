import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { PreloadAllModules, provideRouter, withPreloading } from '@angular/router';
import { HttpClientModule, provideHttpClient } from '@angular/common/http';

import { APP_ROUTES } from './app.routes';
import { initializeApp, provideFirebaseApp } from '@angular/fire/app';
import { getAuth, provideAuth } from '@angular/fire/auth';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, provideAppCheck } from '@angular/fire/app-check';
import { getFirestore, provideFirestore } from '@angular/fire/firestore';
import { getFunctions, provideFunctions } from '@angular/fire/functions';
import { getPerformance, providePerformance } from '@angular/fire/performance';
import { getStorage, provideStorage } from '@angular/fire/storage';

import { FIREBASE_CONFIG, REL_STR_RECAPTCHA_KEY } from '../secrets/secrets';

export const appConfig: ApplicationConfig = {
	providers: [
		provideRouter(APP_ROUTES, withPreloading(PreloadAllModules)),
		importProvidersFrom(HttpClientModule),
		provideClientHydration(),
		provideAnimationsAsync(),
		provideHttpClient(),
		provideFirebaseApp(() => initializeApp(FIREBASE_CONFIG)),
		provideAuth(() => getAuth()),
		provideAppCheck(() => {
			// TODO get a reCAPTCHA Enterprise here https://console.cloud.google.com/security/recaptcha?project=_
			const provider = new ReCaptchaEnterpriseProvider(REL_STR_RECAPTCHA_KEY);
			return initializeAppCheck(undefined, { provider, isTokenAutoRefreshEnabled: true });
		}),
		provideFirestore(() => getFirestore()),
		provideFunctions(() => getFunctions()),
		providePerformance(() => getPerformance()),
		provideStorage(() => getStorage()),
	],
};
