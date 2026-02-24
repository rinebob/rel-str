import { Injectable } from '@angular/core';
import type { Observable } from 'rxjs';
import { of } from 'rxjs';

import type { BaselineMeta } from '../dashboard-v3/store/dashboard-v3.store';

// Static baseline list mirroring the baselines array in
// assets/holdings/pairs-registry.mvp.json. This avoids any runtime
// HTTP/asset loading concerns while keeping a single registry
// abstraction for the rest of the app.
const STATIC_BASELINES: BaselineMeta[] = [
    { id: 'QQQ', label: 'QQQ', type: 'index' },
    { id: 'SPY', label: 'SPY', type: 'index' },
    { id: 'XLB', label: 'XLB', type: 'sector' },
    { id: 'XLC', label: 'XLC', type: 'sector' },
    { id: 'XLE', label: 'XLE', type: 'sector' },
    { id: 'XLF', label: 'XLF', type: 'sector' },
    { id: 'XLI', label: 'XLI', type: 'sector' },
    { id: 'XLK', label: 'XLK', type: 'sector' },
    { id: 'XLP', label: 'XLP', type: 'sector' },
    { id: 'XLU', label: 'XLU', type: 'sector' },
    { id: 'XLV', label: 'XLV', type: 'sector' },
    { id: 'XLY', label: 'XLY', type: 'sector' },
    { id: 'XME', label: 'XME', type: 'sector' },
    { id: 'XPH', label: 'XPH', type: 'sector' },
    { id: 'XSD', label: 'XSD', type: 'sector' },
];

@Injectable({ providedIn: 'root' })
export class BaselineRegistryService {

    getBaselines$(): Observable<BaselineMeta[]> {
        return of(STATIC_BASELINES);
    }

    /**
     * Future dynamic source: load baselines from a Firestore doc.
     *
     * For now this is a stub that simply returns the same static
     * baselines used elsewhere. Once the canonical Firestore path and
     * shape are defined, this method can be wired up via the Firestore
     * SDK (e.g. doc().valueChanges().pipe(map(...))).
     */
    getBaselinesFromFirestore$(): Observable<BaselineMeta[]> {
        return of(STATIC_BASELINES);
    }

    getBaselineUniverses$(): Observable<Record<string, string[]>> {
        // For snapshot-driven dashboard v3, the universe for a baseline is
        // derived from the snapshot's pairs list rather than this registry.
        // Keep the method for API compatibility but return an empty map.
        return of({});
    }
}

