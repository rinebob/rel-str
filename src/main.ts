import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

// FOR SERVER SIDE RENDERING
// bootstrapApplication(AppComponent, appConfig)
//   .catch((err) => console.error(err));

// SSR NOTE: in angular.json, remove development.ssr = false and prerender=false to reactivate ssr

bootstrapApplication(AppComponent, appConfig)
.catch((err) => console.error(err));

