import { Component, ChangeDetectionStrategy, computed, output, inject, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

import { NAV_SECTIONS, SIGNED_OUT_SECTIONS } from '../../common/constants';
import { NavItem } from '../../common/interfaces';
import { AuthStore } from '../../auth/auth.store';

@Component({
    selector: 'rs-sidenav-menu',
    imports: [MatIconModule],
    templateUrl: './sidenav-menu.component.html',
    styleUrl: './sidenav-menu.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { '(document:click)': 'openSubmenu.set(null)' }
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

    /** ds-menu submenu open state — keyed by parent item name, one at a time. */
    readonly openSubmenu = signal<string | null>(null);

    /** Submenu trigger click — toggle this item's fly-out panel. */
    toggleSubmenu(name: string, event: Event): void {
        event.stopPropagation();
        this.openSubmenu.update((k) => (k === name ? null : name));
    }

    handleCloseSidenav() {
        this.closeSidenav.emit();
    }

    handleNavigation(navItem: NavItem) {
        this.navigate.emit(navItem);
    }
}
