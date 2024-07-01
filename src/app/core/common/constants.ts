import { AppRoutes, AuthLevel, ButtonMetadata, NavItem } from "./interfaces";


export const APP_SIDENAV_BUTTONS: ButtonMetadata[] = [
    // Externally visible routes
    {url: AppRoutes.LOGIN, text: 'login'},
    {url: AppRoutes.LOGOUT, text: 'logout'},
    {url: AppRoutes.DOCUMENTATION, text: 'documentation', authLevel: AuthLevel.UNKNOWN},
    {url: AppRoutes.CONTACT, text: 'contact', authLevel: AuthLevel.UNKNOWN},
    {url: AppRoutes.SIGNUP, text: 'signup', authLevel: AuthLevel.UNKNOWN},
    // {url: AppRoutes.BLOG, text: 'blog', authLevel: AuthLevel.UNKNOWN},

    // Interal only routes
    {url: AppRoutes.DASHBOARD, text: 'dashboard', authLevel: AuthLevel.USER},
    {url: AppRoutes.CHART, text: 'chart', authLevel: AuthLevel.USER},
    {url: AppRoutes.HISTORY, text: 'history', authLevel: AuthLevel.USER},
];

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
        name: 'chart',
        text: 'chart',
        href: 'chart',
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

]