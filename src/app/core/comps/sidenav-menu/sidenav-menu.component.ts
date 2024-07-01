import { Component, OnInit, ChangeDetectionStrategy, output, inject } from '@angular/core';
import { Router, RouterModule } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';

import { NAV_MENU_ITEMS } from '../../common/constants';
import { NavItem } from '../../common/interfaces';

@Component({
    selector: 'rs-sidenav-menu',
    standalone: true,
    imports: [MatIconModule, RouterModule],
    templateUrl: './sidenav-menu.component.html',
    styleUrl: './sidenav-menu.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SidenavMenuComponent implements OnInit {
    
    closeSidenav = output<void>();
    navigate = output<NavItem>();

    router = inject(Router);

    readonly NAV_MENU_ITEMS = NAV_MENU_ITEMS;
    
    constructor() { }

    ngOnInit() {
    }

    handleCloseSidenav() {
        // console.log('sM hCS handle close sidenav called')
        this.closeSidenav.emit();
    }

    handleNavigation(navItem: NavItem) {
        // console.log('sM hN handle navigation called.  navItem: ', navItem);
        this.navigate.emit(navItem);
    }

    handleTestNavigation(target: string) {
        this.router.navigate([target]);
        this.closeSidenav.emit();
    }
}
