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
}
