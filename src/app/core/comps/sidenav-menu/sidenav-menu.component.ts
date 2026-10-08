import { Component, ChangeDetectionStrategy, computed, output, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

import { NAV_SECTIONS, SIGNED_OUT_SECTIONS } from '../../common/constants';
import { NavItem } from '../../common/interfaces';
import { AuthStore } from '../../auth/auth.store';

@Component({
    selector: 'rs-sidenav-menu',
    imports: [MatIconModule, MatMenuModule],
    templateUrl: './sidenav-menu.component.html',
    styleUrl: './sidenav-menu.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class SidenavMenuComponent {

    closeSidenav = output<void>();
    navigate = output<NavItem>();

    private readonly auth = inject(AuthStore);
    private readonly isAuthenticated = this.auth.isAuthenticated;

    /** Sections rendered for the current auth state — the full journey
     *  nav signed in, auth actions only signed out (#701). */
    readonly sections = computed(() =>
        this.isAuthenticated() ? NAV_SECTIONS : SIGNED_OUT_SECTIONS,
    );

    handleCloseSidenav() {
        this.closeSidenav.emit();
    }

    handleNavigation(navItem: NavItem) {
        this.navigate.emit(navItem);
    }
}
