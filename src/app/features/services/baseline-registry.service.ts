import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { map, shareReplay } from 'rxjs/operators';
import type { Observable } from 'rxjs';

import type { BaselineMeta } from '../dashboard-v3/store/dashboard-v3.store';

interface PairsRegistryBaselinePair {
    baseline: string;
    target: string;
}

interface PairsRegistry {
    version: string;
    baselines: string[];
    pairs: PairsRegistryBaselinePair[];
}

@Injectable({ providedIn: 'root' })
export class BaselineRegistryService {

    private readonly http = inject(HttpClient);

    private readonly registry$: Observable<PairsRegistry> = this.http
        .get<PairsRegistry>('assets/holdings/pairs-registry.mvp.json')
        .pipe(shareReplay(1));

    getBaselines$(): Observable<BaselineMeta[]> {
        return this.registry$.pipe(
            map(registry => {
                const seen = new Set<string>();
                const ordered: string[] = [];

                for (const id of registry.baselines ?? []) {
                    if (!seen.has(id)) {
                        seen.add(id);
                        ordered.push(id);
                    }
                }

                // Fallback: ensure any baselines referenced in pairs are included
                for (const pair of registry.pairs ?? []) {
                    const id = pair.baseline;
                    if (!seen.has(id)) {
                        seen.add(id);
                        ordered.push(id);
                    }
                }

                return ordered.map(id => ({
                    id,
                    label: id,
                    type: 'index',
                } satisfies BaselineMeta));
            }),
        );
    }

    getBaselineUniverses$(): Observable<Record<string, string[]>> {
        return this.registry$.pipe(
            map(registry => {
                const universes: Record<string, string[]> = {};

                for (const pair of registry.pairs ?? []) {
                    const key = pair.baseline;
                    const symbol = `${pair.baseline}-${pair.target}`;
                    if (!universes[key]) {
                        universes[key] = [];
                    }
                    universes[key].push(symbol);
                }

                // Ensure all baselines have an entry, even if empty
                for (const id of registry.baselines ?? []) {
                    if (!universes[id]) {
                        universes[id] = [];
                    }
                }

                return universes;
            }),
        );
    }
}

// placeholder; will be replaced via patch
