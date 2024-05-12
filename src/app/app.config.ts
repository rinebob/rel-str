import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';

import { APP_ROUTES } from './app.routes';
import { provideClientHydration } from '@angular/platform-browser';


// NOTE: This is only used when server side rendering is enabled in main.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(APP_ROUTES), 
    provideClientHydration()
  ]
};
