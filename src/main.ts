import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

import { registerLicense } from '@syncfusion/ej2-base';
import { SYNC_FUSION_LICENSE_KEY } from './secrets/secrets';

// Registering Syncfusion<sup style="font-size:70%">&reg;</sup> license key
registerLicense(SYNC_FUSION_LICENSE_KEY);

// FOR SERVER SIDE RENDERING
// bootstrapApplication(AppComponent, appConfig)
//   .catch((err) => console.error(err));

// SSR NOTE: in angular.json, remove development.ssr = false and prerender=false to reactivate ssr

bootstrapApplication(AppComponent, appConfig)
.catch((err) => console.error(err));

