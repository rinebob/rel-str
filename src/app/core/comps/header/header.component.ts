import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { AuthStore } from '../../auth/auth.store';
import { AppRoutes, PageInfo } from '../../common/interfaces';
import { resolvePageInfo } from '../../common/constants';
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

    /** Re-eval trigger — routerState is mutable, so pageInfo must rerun on
     *  each NavigationEnd rather than on signal deps it can't see. */
    private readonly navigationEnd = toSignal(
        this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)),
    );

    /** Current page identity (#853) — the leaf route's routeConfig.path
     *  segments joined from root, longest-prefix matched against PAGE_INFO
     *  (resolvePageInfo normalizes the root '' segments). Undefined on
     *  unkeyed/wildcard paths → the identity zone renders empty. */
    readonly pageInfo = computed<PageInfo | undefined>(() => {
        this.navigationEnd();
        const root = this.router.routerState.snapshot.root;
        // firstChild is the primary outlet's leaf — no named outlets exist
        // in the app today; revisit if an aux outlet is ever added.
        let leaf = root;
        while (leaf.firstChild) leaf = leaf.firstChild;
        const joined = leaf.pathFromRoot
            .map((s) => s.routeConfig?.path ?? '')
            .join('/');
        return resolvePageInfo(joined);
    });

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
