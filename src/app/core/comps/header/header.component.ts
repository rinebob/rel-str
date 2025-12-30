import { UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatButtonModule } from '@angular/material/button';

import { NAV_MENU_ITEMS } from '../../common/constants';
import { AuthStore } from '../../auth/auth.store';
import { AppRoutes } from '../../common/interfaces';
import { RefreshTimeComponent } from './refresh-time/refresh-time.component';
import { SelectStockDialogService } from '../../../features/select-stock/select-stock-dialog.service';

@Component({
    selector: 'rs-header',
    imports: [MatIconModule, MatMenuModule, MatButtonModule, RouterModule, UpperCasePipe, RefreshTimeComponent],
    templateUrl: './header.component.html',
    styleUrl: './header.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent {

    openSidenav = output<boolean>();

    private readonly auth = inject(AuthStore);
    private readonly selectStockDialog = inject(SelectStockDialogService);
    router = inject(Router);

    readonly NAV_MENU_ITEMS = NAV_MENU_ITEMS;

    // Auth-facing signals
    readonly user = this.auth.user;
    readonly isAuthenticated = this.auth.isAuthenticated;
    readonly loading = this.auth.loading;

    globalTopnavMenuCssClass = 'global-topnav-menu-css';

    handleTopnavMenuOpen() {
        // console.log('lP hTMO handle global topnav menu open called');
    }

    handleMenuOpen() {
        // console.log('nH hMO handle menu open called');
        this.openSidenav.emit(true);
    }
    
    handleOpenSymbols() {
        this.selectStockDialog.open();
    }

    handleNavigation(href: string) {
        // console.log('nH hN handle navigation called. href: ', href);
        this.router.navigate([href]);

    }

    async onLogin() {
        await this.router.navigate([`/${AppRoutes.LOGIN}`]);
    }

    async onSignup() {
        await this.router.navigate([`/${AppRoutes.SIGNUP}`]);
    }

    async onSignOut() {
        await this.auth.signOut();
    }
}
