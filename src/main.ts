import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { AppComponent } from './app/app.component';
import { provideRouter } from '@angular/router';
import { APP_ROUTES } from './app/app.routes';

// FOR SERVER SIDE RENDERING
// bootstrapApplication(AppComponent, appConfig)
//   .catch((err) => console.error(err));

// SSR NOTE: in angular.json, remove development.ssr = false and prerender=false for ssr

bootstrapApplication(AppComponent, {
    providers: [
        provideRouter(APP_ROUTES),

    ]
})
.catch((err) => console.error(err));

