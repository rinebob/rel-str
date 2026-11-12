import { Component, ChangeDetectionStrategy, computed, output, inject, signal } from '@angular/core';

import { NAV_SECTIONS, SIGNED_OUT_SECTIONS } from '../../common/constants';
import { NavItem } from '../../common/interfaces';
import { AuthStore } from '../../auth/auth.store';
import { PageIdentityService } from '../../services/page-identity.service';

@Component({
    selector: 'rs-sidenav-menu',
    imports: [],
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
    private readonly pageIdentity = inject(PageIdentityService);

    /** Sections rendered for the current auth state — the full journey
     *  nav signed in, auth actions only signed out (#701). */
    readonly sections = computed(() =>
        this.isAuthenticated() ? NAV_SECTIONS : SIGNED_OUT_SECTIONS,
    );

    /** ds-menu submenu open state — keyed by parent item name, one at a time. */
    readonly openSubmenu = signal<string | null>(null);
    /** Fixed-position anchor for the open flyout — set on open from the
     *  trigger's rect, clamped to the viewport. */
    readonly submenuPos = signal<{ top: number; left: number } | null>(null);

    /** Submenu trigger click — toggle this item's fly-out panel. */
    toggleSubmenu(item: NavItem, event: Event): void {
        event.stopPropagation();
        if (this.openSubmenu() === item.name) {
            this.openSubmenu.set(null);
        } else {
            this.positionSubmenu(item, event.currentTarget as HTMLElement);
            this.openSubmenu.set(item.name);
        }
    }

    /** Hover opens the flyout — no click required. */
    openSubmenuAt(item: NavItem, event: MouseEvent): void {
        this.cancelSubmenuClose();
        const trigger = (event.currentTarget as HTMLElement)
            .querySelector('.nav-submenu-trigger') ?? event.currentTarget as HTMLElement;
        this.positionSubmenu(item, trigger as HTMLElement);
        this.openSubmenu.set(item.name);
    }

    /** Close is deferred so the cursor can cross the gap between the
     *  trigger and the flyout (the menu sits right of the drawer edge,
     *  outside the host's box). */
    private closeTimer: ReturnType<typeof setTimeout> | null = null;

    scheduleSubmenuClose(): void {
        this.closeTimer = setTimeout(() => this.openSubmenu.set(null), 250);
    }

    cancelSubmenuClose(): void {
        if (this.closeTimer) clearTimeout(this.closeTimer);
        this.closeTimer = null;
    }

    /** Anchor the flyout right of the trigger, clamped so its bottom
     *  never leaves the viewport. Position is absolute relative to the
     *  submenu host (fixed positioning doesn't work inside mat-drawer's
     *  transformed containing block), so the viewport-clamped top is
     *  converted into a host-relative offset. */
    private positionSubmenu(item: NavItem, el: HTMLElement): void {
        const host = (el.closest('.nav-submenu-host') as HTMLElement) ?? el;
        const r = el.getBoundingClientRect();
        const hostR = host.getBoundingClientRect();
        const estHeight = (item.children?.length ?? 0) * 32 + 16;
        const viewportTop = Math.min(
            Math.max(8, r.top),
            Math.max(8, window.innerHeight - estHeight - 8),
        );
        // Right of the drawer edge — hostR.width only reaches the inner
        // content edge (inside the container's 30px right padding).
        const drawer = host.closest('mat-drawer, mat-sidenav') as HTMLElement;
        const left = drawer
            ? drawer.getBoundingClientRect().right - hostR.left + 4
            : hostR.width;
        this.submenuPos.set({ top: viewportTop - hostR.top, left });
    }

    /** Current-route highlight — exact match only ('portfolio' must not
     *  light up on '/portfolio/allocation'). A submenu trigger is active
     *  when any child route is. */
    isActive(item: NavItem): boolean {
        const url = this.pageIdentity.url();
        const hrefs = item.children?.length
            ? item.children.map((c) => c.href)
            : [item.href];
        return hrefs.some((h) => h && url === '/' + h);
    }

    handleCloseSidenav() {
        this.closeSidenav.emit();
    }

    handleNavigation(navItem: NavItem) {
        this.navigate.emit(navItem);
    }
}
