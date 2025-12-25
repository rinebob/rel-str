import { NavItem } from "./interfaces";

export const NAV_MENU_ITEMS: NavItem[] = [
    {
        name: 'documentation',
        text: 'documentation',
        href: 'documentation',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    {
        name: 'contact',
        text: 'contact',
        href: 'contact',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    {
        name: 'signup',
        text: 'signup',
        href: 'signup',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    {
        name: 'login',
        text: 'login',
        href: 'login',
        mobileOnly: false,
        external: true,
        target: '_self',
    },
    {
        name: 'dashboard',
        text: 'dashboard',
        href: 'dashboard',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'dashboard-v2',
        text: 'dashboard-v2',
        href: 'dashboard-v2',
        mobileOnly: false,
        external: false,
        target: '_self',
    },  
    {
        name: 'decision-board',
        text: 'decision board',
        href: 'decision-board',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'positions',
        text: 'positions',
        href: 'positions-view',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'trade-journal',
        text: 'trade journal',
        href: 'trade-journal',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'rs-chart',
        text: 'rs-chart',
        href: 'rs-chart',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'sync-chart',
        text: 'sync-chart',
        href: 'sync-chart',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'rs-table',
        text: 'rs-table',
        href: 'rs-table',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'history',
        text: 'history',
        href: 'history',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    {
        name: 'logout',
        text: 'logout',
        href: '',
        mobileOnly: false,
        external: false,
        target: '_self',
    },
    // {
    //     name: 'chart',
    //     text: '',
    //     href: '/',
    //     mobileOnly: false,
    //     target: '_self',
    // },
    // {
    //     name: '',
    //     text: '',
    //     target: '',
    //     mobileOnly: false,
    //     children: [
    //         {
    //             name: '',
    //             text: '',
    //             href: '',
    //             target: '_self',
    //         },
    //
    // ]
]

export const NUM_HEATMAP_MIDPOINTS = 11;

// =============================
// Firebase/Firestore constants
// =============================

/** Canonical callable function names used by the FE. */
export enum CallableName {
  GET_TRACKED_SYMBOLS = 'getTrackedSymbols',
  VALIDATE_AND_REGISTER_PAIRS = 'validateAndRegisterPairs',
  UNREGISTER_PAIRS = 'unregisterPairs',
  // RsSignalHistory
  GET_PAIR_SIGNALS = 'getPairSignals',
  GET_DAILY_SIGNALS = 'getDailySignals',
  GET_PNL_SUMMARY = 'getPnLSummary',
  UPDATE_POSITION_ACTUALS = 'updatePositionActuals',
  /** Diagnose and optionally auto-fix missing pair-day RS entries */
  DIAGNOSE_PAIR_DAYS = 'diagnosePairDays',
  /** RS chart: daily OHLCV bars via SavantAPI */
  GET_PAIR_DAILY_BARS = 'getPairDailyBars',
}

/** Top-level Firestore collections used by the FE. */
export enum Collection {
  TRACKED_SYMBOLS = 'tracked-symbols',
  PAIR_REGISTRY = 'pair-registry',
  PAIRS_DATA = 'pairs-data',
  USERS = 'users',
  ADMIN = 'admin',
  APP = 'app',
  POSITIONS = 'positions',
}

/** Known subcollection names under a user document. */
export enum Subcollection {
  LISTS = 'lists',
  REFRESH_STATUS = 'refresh-status',
  ITEMS = 'items',
}

/** Bucket document ids used under certain root collections (e.g., positions/open). */
export enum BucketDocId {
  OPEN = 'open',
}

/** Helper to produce the lists collection path for a user. */
export const userListsPath = (uid: string) => `${Collection.USERS}/${uid}/${Subcollection.LISTS}`;