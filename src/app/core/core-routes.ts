/** @topic #108 — Options Position Strategy Engine | @topic #137 — Strategy Builder UI */
import { Route } from "@angular/router";
import { CoreComponent } from "./core.component";
import { HomeComponent } from "./comps/home/home.component";
import { AppRoutes } from "./common/interfaces";
import { PAGE_INFO } from "./common/constants";
import { authGuard } from './auth/auth.guard';

 export default[
    { path: '', component: CoreComponent,
        children: [
            {path: '', 
                redirectTo: AppRoutes.PORTFOLIO_DASHBOARD, pathMatch: 'full',
            },
            // Group roots — parents of the canonical prefixed trees (#660).
            {path: 'signals',
                redirectTo: AppRoutes.RUN_DASHBOARD, pathMatch: 'full',
            },
            {path: 'options',
                redirectTo: AppRoutes.OPTION_CHAIN, pathMatch: 'full',
            },
            {path: AppRoutes.DOCUMENTATION, 
                title: PAGE_INFO[AppRoutes.DOCUMENTATION].title,
                loadComponent: () => import('./comps/documentation/documentation.component')
                .then(mod => mod.DocumentationComponent),
            },
            {path: AppRoutes.SIGNUP, 
                title: PAGE_INFO[AppRoutes.SIGNUP].title,
                loadComponent: () => import('./comps/signup/signup.component')
                .then(mod => mod.SignupComponent),
            },
            {path: AppRoutes.CONTACT, 
                title: PAGE_INFO[AppRoutes.CONTACT].title,
                loadComponent: () => import('./comps/contact/contact.component')
                .then(mod => mod.ContactComponent),
            },
            {path: AppRoutes.LOGIN, 
                title: PAGE_INFO[AppRoutes.LOGIN].title,
                loadComponent: () => import('./comps/login/login.component')
                .then(mod => mod.LoginComponent),
            },

            // NOTE: Protect actual feature routes, not redirect routes
            {path: AppRoutes.DASHBOARD, 
                title: PAGE_INFO[AppRoutes.DASHBOARD].title,
                loadComponent: () => import('../features/dashboard/dashboard.component')
                .then(mod => mod.DashboardComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.DASHBOARD_V2, 
                title: PAGE_INFO[AppRoutes.DASHBOARD_V2].title,
                loadComponent: () => import('../features/dashboard-v2/dashboard-v2.component')
                .then(mod => mod.DashboardV2Component),
                canActivate: [authGuard],
            },
            {path: AppRoutes.DASHBOARD_V3, 
                title: PAGE_INFO[AppRoutes.DASHBOARD_V3].title,
                loadComponent: () => import('../features/dashboard-v3/dashboard-v3.component')
                .then(mod => mod.DashboardV3Component),
                canActivate: [authGuard],
            },
            {path: AppRoutes.DECISION_BOARD, 
                title: PAGE_INFO[AppRoutes.DECISION_BOARD].title,
                loadComponent: () => import('../features/decision-board/decision-board.view')
                .then(mod => mod.DecisionBoardViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.CHART, 
                redirectTo: AppRoutes.SYNC_CHART, pathMatch: 'full',
                // Do not apply canActivate to redirect routes
            },
            {path: AppRoutes.SYNC_CHART, 
                title: PAGE_INFO[AppRoutes.SYNC_CHART].title,
                loadComponent: () => import('../features/sync-chart-view/sync-chart-view.component')
                .then(mod => mod.SyncChartViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.RS_CHART,
                title: PAGE_INFO[AppRoutes.RS_CHART].title,
                loadComponent: () => import('../features/rs-chart-view/rs-chart-view.component')
                .then(mod => mod.RsChartViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.RS_TABLE,
                title: PAGE_INFO[AppRoutes.RS_TABLE].title,
                loadComponent: () => import('../features/rs-table/rs-table.component')
                .then(mod => mod.RsTableComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.POSITIONS_VIEW,
                title: PAGE_INFO[AppRoutes.POSITIONS_VIEW].title,
                loadComponent: () => import('../features/positions-view/positions-view.component')
                .then(mod => mod.PositionsViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.PORTFOLIO_DASHBOARD,
                title: PAGE_INFO[AppRoutes.PORTFOLIO_DASHBOARD].title,
                loadComponent: () => import('../features/portfolio-dashboard/portfolio-dashboard.component')
                .then(mod => mod.PortfolioDashboardComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.PORTFOLIO_ALLOCATION,
                title: PAGE_INFO[AppRoutes.PORTFOLIO_ALLOCATION].title,
                loadComponent: () => import('../features/portfolio-dashboard/allocation-page.component')
                .then(mod => mod.AllocationPageComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.TRADE_JOURNAL,
                title: PAGE_INFO[AppRoutes.TRADE_JOURNAL].title,
                loadComponent: () => import('../features/trade-journal/trade-journal.view')
                .then(mod => mod.TradeJournalViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.HEATMAP_VIEW,
                title: PAGE_INFO[AppRoutes.HEATMAP_VIEW].title,
                loadComponent: () => import('../features/heatmap-view/heatmap-view.component')
                .then(mod => mod.HeatmapViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.HEATMAP_CHART,
                title: PAGE_INFO[AppRoutes.HEATMAP_CHART].title,
                loadComponent: () => import('../features/heatmap-chart/heatmap-chart-view.component')
                .then(mod => mod.HeatmapChartViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.HISTORY, 
                title: PAGE_INFO[AppRoutes.HISTORY].title,
                loadComponent: () => import('../features/history/history.component')
                .then(mod => mod.HistoryComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.RUN_DASHBOARD,
                title: PAGE_INFO[AppRoutes.RUN_DASHBOARD].title,
                loadComponent: () => import('../features/savant-trader/pages/run-dashboard/dashboard.component')
                .then(mod => mod.DashboardComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.CHART_REVIEW,
                title: PAGE_INFO[AppRoutes.CHART_REVIEW].title,
                loadComponent: () => import('../features/savant-trader/pages/chart-review/chart-review.component')
                .then(mod => mod.ChartReviewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.SIGNAL_REVIEW,
                title: PAGE_INFO[AppRoutes.SIGNAL_REVIEW].title,
                loadComponent: () => import('../features/savant-trader/pages/signal-review/signal-review.component')
                .then(mod => mod.SignalReviewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.SIGNAL_ORDER,
                title: PAGE_INFO[AppRoutes.SIGNAL_ORDER].title,
                loadComponent: () => import('../features/savant-trader/pages/signal-order/order.component')
                .then(mod => mod.OrderComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.SIGNAL_ACTION_REPORT,
                title: PAGE_INFO[AppRoutes.SIGNAL_ACTION_REPORT].title,
                loadComponent: () => import('../features/savant-trader/pages/signal-action-report/triage-report.component')
                .then(mod => mod.TriageReportComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.RH_ACCOUNT_INQUIRY,
                title: PAGE_INFO[AppRoutes.RH_ACCOUNT_INQUIRY].title,
                loadComponent: () => import('../features/savant-trader/pages/rh-account-inquiry/observation-dashboard.component')
                .then(mod => mod.ObservationDashboardComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.STRATEGY_BACKTEST,
                title: PAGE_INFO[AppRoutes.STRATEGY_BACKTEST].title,
                loadComponent: () => import('../features/savant-trader/backtest/pages/backtest-dashboard/backtest-dashboard.component')
                .then(mod => mod.BacktestDashboardComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.SIGNAL_HISTORY,
                title: PAGE_INFO[AppRoutes.SIGNAL_HISTORY].title,
                loadComponent: () => import('../features/savant-trader/pages/signal-history/signal-history.component')
                .then(mod => mod.SignalHistoryComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.OPTION_CHART,
                title: PAGE_INFO[AppRoutes.OPTION_CHART].title,
                loadComponent: () => import('../features/savant-trader/pages/option-chart/option-chart.component')
                .then(mod => mod.OptionChartComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.SPREAD_CHART,
                title: PAGE_INFO[AppRoutes.SPREAD_CHART].title,
                loadComponent: () => import('../features/savant-trader/pages/spread-chart/spread-chart-page.component')
                .then(mod => mod.SpreadChartPageComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.OPTIONS_STRATEGY_DASHBOARD,
                title: PAGE_INFO[AppRoutes.OPTIONS_STRATEGY_DASHBOARD].title,
                loadComponent: () => import('../features/savant-trader/pages/options-strategy-dashboard/options-strategy-dashboard.component')
                .then(mod => mod.OptionsStrategyDashboardComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.STRATEGY_BUILDER,
                title: PAGE_INFO[AppRoutes.STRATEGY_BUILDER].title,
                loadComponent: () => import('../features/savant-trader/pages/strategy-builder/strategy-builder.component')
                .then(mod => mod.StrategyBuilderComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.PAPER_TRADING,
                title: PAGE_INFO[AppRoutes.PAPER_TRADING].title,
                loadComponent: () => import('../features/savant-trader/pages/paper-trading/paper-trading.component')
                .then(mod => mod.PaperTradingComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.OPTION_CHAIN_PCT_CHANGE,
                title: PAGE_INFO[AppRoutes.OPTION_CHAIN_PCT_CHANGE].title,
                loadComponent: () => import('../features/savant-trader/pages/option-chain-pct-change/option-chain-pct-change.component')
                .then(mod => mod.OptionChainPctChangeComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.OPTION_CHAIN,
                title: PAGE_INFO[AppRoutes.OPTION_CHAIN].title,
                loadComponent: () => import('../features/savant-trader/pages/option-chain/option-chain.component')
                .then(mod => mod.OptionChainComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.SWING_ANALYSIS,
                title: PAGE_INFO[AppRoutes.SWING_ANALYSIS].title,
                loadComponent: () => import('../features/savant-trader/swing-analysis/swing-analysis-page.component')
                .then(mod => mod.SwingAnalysisPageComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.FLEX_CHART_SANDBOX,
                title: PAGE_INFO[AppRoutes.FLEX_CHART_SANDBOX].title,
                loadComponent: () => import('../features/savant-trader/pages/flex-chart-sandbox/flex-chart-sandbox.component')
                .then(mod => mod.FlexChartSandboxComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.DEV_GALLERY,
                title: PAGE_INFO[AppRoutes.DEV_GALLERY].title,
                loadComponent: () => import('../features/savant-trader/pages/gallery-view/gallery-view.component')
                .then(mod => mod.GalleryViewComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.SCREENSHOT_DEV,
                title: PAGE_INFO[AppRoutes.SCREENSHOT_DEV].title,
                loadComponent: () => import('../features/dev-screenshot/dev-screenshot.component')
                .then(mod => mod.DevScreenshotComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.TOPIC_VIEWER,
                title: PAGE_INFO[AppRoutes.TOPIC_VIEWER].title,
                loadComponent: () => import('../features/topic-viewer/topic-viewer-page.component')
                .then(mod => mod.TopicViewerPageComponent),
                canActivate: [authGuard],
            },
            {path: AppRoutes.LOGOUT, redirectTo: '/', pathMatch: 'full'},
        ]
    },
    { path: '**', redirectTo: '/', pathMatch:'full'},
 ] satisfies Route[];