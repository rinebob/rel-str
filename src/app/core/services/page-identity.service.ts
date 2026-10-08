import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { filter } from 'rxjs';

import { PageInfo } from '../common/interfaces';
import { resolvePageInfo } from '../common/constants';

/** Route-driven page identity (#853) shared between rs-header and
 *  CoreComponent's fullscreen reveal chip (#854) — fullscreen pages unmount
 *  the header, so the chip is their only in-app identity affordance. */
@Injectable({ providedIn: 'root' })
export class PageIdentityService {

    private readonly router = inject(Router);

    // Re-eval trigger — routerState is mutable, so pageInfo must rerun on
    // each NavigationEnd rather than on signal deps it can't see.
    private readonly navigationEnd = toSignal(
        this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd)),
    );

    /** Current page identity — the leaf route's routeConfig.path segments
     *  joined from root, longest-prefix matched against PAGE_INFO
     *  (resolvePageInfo normalizes the root '' segments). Undefined on
     *  unkeyed/wildcard paths → identity renders empty. */
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
}
