import { ChangeDetectionStrategy, Component, HostListener, inject, signal } from '@angular/core';
import { CdkTrapFocus } from '@angular/cdk/a11y';
import { Router, RouterOutlet } from '@angular/router';


import { NavItem } from './common/interfaces';
import { HeaderComponent } from './comps/header/header.component';
import { SidenavMenuComponent } from './comps/sidenav-menu/sidenav-menu.component';
import { PageIdentityService } from './services/page-identity.service';
import { UiStateService } from './services/ui-state.service';
import { ManualOrderService } from '../features/savant-trader/services/manual-order.service';

@Component({
    selector: 'rs-core',
    imports: [RouterOutlet, HeaderComponent, SidenavMenuComponent, CdkTrapFocus],
    templateUrl: './core.component.html',
    styleUrls: ['./core.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CoreComponent {
	readonly sidenavOpen = signal(false);

    private readonly router = inject(Router);
    readonly ui = inject(UiStateService);

    /** Deliberate core→feature seam (#1191): the header is global, the
     *  order surface is feature-scoped. A second consumer would earn an
     *  InjectionToken indirection; one call site doesn't. */
    private readonly manualOrders = inject(ManualOrderService);

    /** Page identity for the fullscreen reveal chip (#854) — fullscreen
     *  unmounts rs-header, so the chip carries the only in-app identity. */
    readonly pageInfo = inject(PageIdentityService).pageInfo;

	handleOpenSidenav() {
		this.sidenavOpen.set(true);
	}

	handleCloseSidenav() {
		this.sidenavOpen.set(false);
	}

	@HostListener('document:keydown.escape')
	onEscape() {
		this.handleCloseSidenav();
	}

	handleNavigation(navItem: NavItem) {
        this.router.navigate([navItem.href]);
        this.handleCloseSidenav();
	}

	onNewOrder() {
		void this.manualOrders.open();
	}
}
