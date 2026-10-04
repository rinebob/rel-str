// PROTOTYPE — throwaway mock data for the "Today" surface variants.
// Not wired to any store/service; numbers are illustrative, not real.
import { AppRoutes } from '../../core/common/interfaces';

export interface TodayMock {
  positions: { total: number; needingAction: number; intradayAlerts: string[] };
  signalFunnel: { raw: number; watchlist: number; timeframe: number; direction: number; actionable: number };
  decisions: { live: number; paper: number; decline: number; pending: number };
  orders: { queued: number; submittedToday: number; fillsToday: number };
  weekly: { strategyAnalysisDue: string; resultsReviewDue: string };
}

export const MOCK_TODAY: TodayMock = {
  positions: {
    total: 11,
    needingAction: 3,
    intradayAlerts: ['AAPL stop within 2% of fill', 'MSFT calendar expires in 9d'],
  },
  signalFunnel: { raw: 187, watchlist: 64, timeframe: 23, direction: 14, actionable: 9 },
  decisions: { live: 4, paper: 3, decline: 6, pending: 2 },
  orders: { queued: 4, submittedToday: 0, fillsToday: 0 },
  weekly: { strategyAnalysisDue: 'Fri', resultsReviewDue: 'Fri' },
};

export interface SurfaceLink {
  label: string;
  route: string;
}

export const SURFACES = {
  portfolio: { label: 'Portfolio Dashboard', route: '/' + AppRoutes.PORTFOLIO_DASHBOARD } as SurfaceLink,
  signalReview: { label: 'Signal Review', route: '/' + AppRoutes.SIGNAL_REVIEW } as SurfaceLink,
  chartReview: { label: 'Chart Review', route: '/' + AppRoutes.CHART_REVIEW } as SurfaceLink,
  signalOrder: { label: 'Signal Order', route: '/' + AppRoutes.SIGNAL_ORDER } as SurfaceLink,
  paperTrading: { label: 'Paper Trading', route: '/' + AppRoutes.PAPER_TRADING } as SurfaceLink,
  runDashboard: { label: 'Run Dashboard', route: '/' + AppRoutes.RUN_DASHBOARD } as SurfaceLink,
};
