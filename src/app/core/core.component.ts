import { ChangeDetectionStrategy, Component, inject, ViewChild } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';

import { NavItem } from './common/interfaces';
import { HeaderComponent } from './comps/header/header.component';
import { SidenavMenuComponent } from './comps/sidenav-menu/sidenav-menu.component';
import { PageIdentityService } from './services/page-identity.service';
import { UiStateService } from './services/ui-state.service';
import { ManualOrderService } from '../features/savant-trader/services/manual-order.service';

@Component({
    selector: 'rs-core',
    imports: [RouterOutlet, MatButtonModule, MatIconModule, MatSidenavModule, MatTooltipModule, HeaderComponent, SidenavMenuComponent],
    templateUrl: './core.component.html',
    styleUrls: ['./core.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class CoreComponent {
	//TODO: convert to signal ViewChild
	@ViewChild('sidenav', { static: false }) sidenav!: MatSidenav;

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
		this.sidenav.open();
	}

	handleCloseSidenav() {
		this.sidenav.close();
	}

	handleNavigation(navItem: NavItem) {
        this.router.navigate([navItem.href]);
        this.sidenav.close();
	}

	onNewOrder() {
		void this.manualOrders.open();
	}
}
