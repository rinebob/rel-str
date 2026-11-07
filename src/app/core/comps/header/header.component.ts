import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthStore } from '../../auth/auth.store';
import { AppRoutes } from '../../common/interfaces';
import { PageIdentityService } from '../../services/page-identity.service';
import { ThemeService } from '../../services/theme.service';
import { UiStateService } from '../../services/ui-state.service';

@Component({
    selector: 'rs-header',
    imports: [],
    templateUrl: './header.component.html',
    styleUrl: './header.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    // Document click dismisses the avatar menu — the ds-menu convention;
    // the trigger + panel stop propagation so they don't self-close.
    host: { '(document:click)': 'avatarMenuOpen.set(false)' }
})
export class HeaderComponent {

    openSidenav = output<void>();
    /** New Order — CoreComponent wires this to ManualOrderService.open()
     *  (#1191). The header stays presentation-thin: emit only. */
    newOrder = output<void>();

    private readonly auth = inject(AuthStore);
    private readonly router = inject(Router);
    readonly uiState = inject(UiStateService);
    /** App theme authority (#1207) — the header toggle delegates to it. */
    readonly theme = inject(ThemeService);

    // Auth-facing signals
    readonly user = this.auth.user;
    readonly isAuthenticated = this.auth.isAuthenticated;
    readonly loading = this.auth.loading;

    /** Avatar initials (#1448) — first+last word of displayName; a
     *  single-word name or an email-only user falls back to the first
     *  two characters. Spread keeps surrogate pairs intact so an emoji
     *  name can't render a lone half. */
    readonly initials = computed(() => {
        const u = this.user();
        const name = (u?.displayName ?? '').trim();
        if (name) {
            const words = name.split(/\s+/).map((w) => [...w]);
            return (words.length > 1
                ? words[0][0] + words[words.length - 1][0]
                : words[0].slice(0, 2).join('')
            ).toUpperCase();
        }
        return [...(u?.email ?? '')].slice(0, 2).join('').toUpperCase() || '?';
    });

    /** Identity for the avatar's aria-label/tooltip — never leaks the
     *  literal 'null'/'undefined' into the string. */
    readonly userLabel = computed(
        () => this.user()?.displayName || this.user()?.email || 'Account',
    );

    /** Avatar menu (#1448) — Account → portfolio dashboard, Logout →
     *  signOut. ds-menu convention: signal open state, document click
     *  dismisses. */
    readonly avatarMenuOpen = signal(false);

    toggleAvatarMenu(event: Event): void {
        event.stopPropagation();
        this.avatarMenuOpen.update((v) => !v);
    }

    onAccount(): void {
        this.avatarMenuOpen.set(false);
        void this.router.navigate([`/${AppRoutes.PORTFOLIO_DASHBOARD}`]);
    }

    /** Current page identity (#853) — resolved by PageIdentityService and
     *  shared with CoreComponent's fullscreen reveal chip (#854). */
    readonly pageInfo = inject(PageIdentityService).pageInfo;

    handleMenuOpen() {
        this.openSidenav.emit();
    }
    
    async onLogin() {
        await this.router.navigate([`/${AppRoutes.LOGIN}`]);
    }

    async onSignup() {
        await this.router.navigate([`/${AppRoutes.SIGNUP}`]);
    }

    async onSignOut() {
        this.avatarMenuOpen.set(false);
        await this.auth.signOut();
    }
}
