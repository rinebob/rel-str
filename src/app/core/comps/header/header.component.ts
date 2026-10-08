import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { AuthStore } from '../../auth/auth.store';
import { AppRoutes } from '../../common/interfaces';
import { PageIdentityService } from '../../services/page-identity.service';
import { UiStateService } from '../../services/ui-state.service';

@Component({
    selector: 'rs-header',
    imports: [MatIconModule, MatButtonModule],
    templateUrl: './header.component.html',
    styleUrl: './header.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush
})
export class HeaderComponent {

    openSidenav = output<void>();

    private readonly auth = inject(AuthStore);
    private readonly router = inject(Router);
    readonly uiState = inject(UiStateService);

    // Auth-facing signals
    readonly user = this.auth.user;
    readonly isAuthenticated = this.auth.isAuthenticated;
    readonly loading = this.auth.loading;

    /** Current page identity (#853) — resolved by PageIdentityService and
     *  shared with CoreComponent's fullscreen reveal chip (#854). */
    readonly pageInfo = inject(PageIdentityService).pageInfo;

    handleMenuOpen() {
        // console.log('nH hMO handle menu open called');
        this.openSidenav.emit();
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
