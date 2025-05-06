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
                loadComponent: () => import('../features/rs/comps/dashboard/dashboard.component')
                .then(mod => mod.DashboardComponent),
            },
            {path: AppRoutes.CHART, 
                loadComponent: () => import('../features/rs/comps/chart/chart.component')
                .then(mod => mod.ChartComponent),
            },
            {path: AppRoutes.HISTORY, 
                loadComponent: () => import('../features/rs/comps/history/history.component')
                .then(mod => mod.HistoryComponent),
            },


            // Friendly Chat codelab feature.  Not part of Rel Str app
            // For development/learning only
            // code adapted from firebase codelab 
            // https://firebase.google.com/codelabs/firebase-web#0
            {path: AppRoutes.CHAT, 
                loadComponent: () => import('../features/fc/comps/chat/chat.component')
                .then(mod => mod.ChatComponent),
            },


            {path: AppRoutes.LOGOUT, redirectTo: '/', pathMatch: 'full'},
        ]
    },
    { path: '**', redirectTo: '/', pathMatch:'full'},
 ] satisfies Route[];