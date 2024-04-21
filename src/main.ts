import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';

// FOR SERVER SIDE RENDERING
// bootstrapApplication(AppComponent, appConfig)
//   .catch((err) => console.error(err));

// SSR NOTE: in angular.json, remove development.ssr = false and prerender=false for ssr

bootstrapApplication(AppComponent)
.catch((err) => console.error(err));

