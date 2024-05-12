import { Route } from "@angular/router";
import { CoreComponent } from "./core.component";
import { HomeComponent } from "./comps/home/home.component";

 export default[
    { path: '', component: CoreComponent,
        children: [
            {path: '', component: HomeComponent},
            {path: 'documentation', 
                loadComponent: () => import('./comps/documentation/documentation.component')
                .then(mod => mod.DocumentationComponent),
            },
            {path: 'signup', 
                loadComponent: () => import('./comps/signup/signup.component')
                .then(mod => mod.SignupComponent),
            },
            {path: 'contact', 
                loadComponent: () => import('./comps/contact/contact.component')
                .then(mod => mod.ContactComponent),
            },
            {path: 'login', 
                loadComponent: () => import('./comps/login/login.component')
                .then(mod => mod.LoginComponent),
            },

            // TODO: Add route guards to check login status on each navigation
            // NOTE: If new features are added in addition to rel-str, these routes will be extracted to an 'rs-routes.ts' file
            // and this will be replaced with a parent route 'rs' which will load these routes as child routes
            {path: 'dashboard', 
                loadComponent: () => import('../features/rs/comps/dashboard/dashboard.component')
                .then(mod => mod.DashboardComponent),
            },
            {path: 'chart', 
                loadComponent: () => import('../features/rs/comps/chart/chart.component')
                .then(mod => mod.ChartComponent),
            },
            {path: 'history', 
                loadComponent: () => import('../features/rs/comps/history/history.component')
                .then(mod => mod.HistoryComponent),
            },
        ]
    },
    { path: '**', redirectTo: '/', pathMatch:'full'},
 ] satisfies Route[];