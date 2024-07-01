import { provideClientHydration } from '@angular/platform-browser';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { ApplicationConfig, importProvidersFrom } from '@angular/core';
import { PreloadAllModules, provideRouter, withPreloading, } from '@angular/router';
import { HttpClientModule, provideHttpClient } from '@angular/common/http';

import { APP_ROUTES } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
        APP_ROUTES,
        withPreloading(PreloadAllModules)
    ),
    importProvidersFrom(HttpClientModule),
    provideClientHydration(),
    provideAnimationsAsync(),
    provideHttpClient(),
  ]
};
