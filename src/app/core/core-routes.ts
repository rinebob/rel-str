import { Route } from "@angular/router";
import { CoreComponent } from "./core.component";
import { HomeComponent } from "./comps/home/home.component";
import { AppRoutes } from "./common/interfaces";
import { authGuard } from './auth/auth.guard';

 export default[
    { path: '', component: CoreComponent,
        children: [
            {path: '', 
                redirectTo: AppRoutes.POSITIONS_VIEW, pathMatch: 'full',
            },
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

            // NOTE: Protect actual feature routes, not redirect routes
            {path: AppRoutes.DASHBOARD, 
                loadComponent: () => import('../features/dashboard/dashboard.component')
                .then(mod => mod.DashboardComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.DASHBOARD_V2, 
                loadComponent: () => import('../features/dashboard-v2/dashboard-v2.component')
                .then(mod => mod.DashboardV2Component),
                canActivate: [authGuard],
            },
            {path: AppRoutes.DECISION_BOARD, 
                loadComponent: () => import('../features/decision-board/decision-board.view')
                .then(mod => mod.DecisionBoardViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.CHART, 
                redirectTo: AppRoutes.SYNC_CHART, pathMatch: 'full',
                // Do not apply canActivate to redirect routes
            },
            {path: AppRoutes.SYNC_CHART, 
                loadComponent: () => import('../features/sync-chart-view/sync-chart-view.component')
                .then(mod => mod.SyncChartViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.RS_TABLE,
                loadComponent: () => import('../features/rs-table/rs-table.component')
                .then(mod => mod.RsTableComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.POSITIONS_VIEW,
                loadComponent: () => import('../features/positions-view/positions-view.component')
                .then(mod => mod.PositionsViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.HISTORY, 
                loadComponent: () => import('../features/history/history.component')
                .then(mod => mod.HistoryComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.LOGOUT, redirectTo: '/', pathMatch: 'full'},
        ]
    },
    { path: '**', redirectTo: '/', pathMatch:'full'},
 ] satisfies Route[];