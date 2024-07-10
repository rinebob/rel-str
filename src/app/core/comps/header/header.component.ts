import { UpperCasePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { NAV_MENU_ITEMS } from '../../common/constants';

@Component({
  selector: 'rs-header',
  standalone: true,
  imports: [MatIconModule, MatMenuModule, RouterModule, UpperCasePipe],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent {

    openSidenav = output<boolean>();

    router = inject(Router);

    readonly NAV_MENU_ITEMS = NAV_MENU_ITEMS;

    globalTopnavMenuCssClass = 'global-topnav-menu-css';

    handleTopnavMenuOpen() {
        // console.log('lP hTMO handle global topnav menu open called');
    }

    handleMenuOpen() {
        // console.log('nH hMO handle menu open called');
        this.openSidenav.emit(true);
    }
    
    handleNavigation(href: string) {
        // console.log('nH hN handle navigation called. href: ', href);
        this.router.navigate([href]);

    }
}
