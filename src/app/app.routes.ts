import { Routes } from '@angular/router';

export const APP_ROUTES: Routes = [
    {path: '', loadChildren: () => import('./core/core-routes')},

  { path: '**', redirectTo: '/', pathMatch:'full'},
];