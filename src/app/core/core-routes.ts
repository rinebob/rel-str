import { Route } from "@angular/router";
import { CoreComponent } from "./core.component";
import { HomeComponent } from "./comps/home/home.component";
import { AppRoutes } from "./common/interfaces";

 export default[
    { path: '', component: CoreComponent,
        children: [
            {path: '', component: HomeComponent},
            {path: AppRoutes.DOCUMENTATION, 
                loadComponent: () => import('./comps/documentation/documentation.component')
                .then(mod => mod.DocumentationComponent),
            },
            {path: AppRoutes.SIGNUP, 
                loadComponent: () => import('./comps/signup/signup.component')
                .then(mod => mod.SignupComponent),
            },
            {path: AppRoutes.CONTACT, 
                loadComponent: () => import('./comps/contact/contact.component')
                .then(mod => mod.ContactComponent),
            },
            {path: AppRoutes.LOGIN, 
                loadComponent: () => import('./comps/login/login.component')
                .then(mod => mod.LoginComponent),
            },

            // TODO: Add route guards to check login status on each navigation
            // NOTE: If new features are added in addition to rel-str, these routes will be extracted to an 'rs-routes.ts' file
            // and this will be replaced with a parent route 'rs' which will load these routes as child routes
            {path: AppRoutes.DASHBOARD, 
                loadComponent: () => import('../features/dashboard/dashboard.component')
                .then(mod => mod.DashboardComponent),
            },
            {path: AppRoutes.DASHBOARD_V2, 
                loadComponent: () => import('../features/dashboard-v2/dashboard-v2.component')
                .then(mod => mod.DashboardV2Component),
            },
            {path: AppRoutes.CHART, 
                redirectTo: AppRoutes.SYNC_CHART, pathMatch: 'full',
            },
            {path: AppRoutes.SYNC_CHART, 
                loadComponent: () => import('../features/sync-chart-view/sync-chart-view.component')
                .then(mod => mod.SyncChartViewComponent),
            },
            {path: AppRoutes.RS_TABLE,
                loadComponent: () => import('../features/rs-table/rs-table.component')
                .then(mod => mod.RsTableComponent),
            },
            {path: AppRoutes.HISTORY, 
                loadComponent: () => import('../features/history/history.component')
                .then(mod => mod.HistoryComponent),
            },
            {path: AppRoutes.LOGOUT, redirectTo: '/', pathMatch: 'full'},
        ]
    },
    { path: '**', redirectTo: '/', pathMatch:'full'},
 ] satisfies Route[];