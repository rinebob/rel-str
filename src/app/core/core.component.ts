import { ChangeDetectionStrategy, Component, inject, ViewChild } from '@angular/core';
import { Router, RouterModule, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';

import { NavItem } from './common/interfaces';
import { HeaderComponent } from './comps/header/header.component';
import { SidenavMenuComponent } from './comps/sidenav-menu/sidenav-menu.component';

@Component({
	selector: 'rs-core',
	standalone: true,
	imports: [RouterOutlet, MatButtonModule, MatIconModule, MatSidenavModule, HeaderComponent, SidenavMenuComponent, RouterModule],
	templateUrl: './core.component.html',
	styleUrl: './core.component.scss',
	changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoreComponent {
	//TODO: convert to signal ViewChild
	@ViewChild('sidenav', { static: false }) sidenav!: MatSidenav;

    router = inject(Router);

	public ngOnInit() {}

	handleOpenSidenav() {
		console.log('c hOS handle open sidenav called');
		this.sidenav.open();
	}

	handleCloseSidenav() {
		console.log('c hCS handle close sidenav called');
		this.sidenav.close();
	}

	handleNavigation(navItem: NavItem) {
		console.log('c hN handle navigation called. navItem: ', navItem);
        this.router.navigate([navItem.href]);
        this.sidenav.close();
	}
}
