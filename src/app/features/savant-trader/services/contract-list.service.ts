/**
 * Contract list service (#1361).
 *
 * Injectable seam over `st-options-contract-lists` for the picker session:
 * single-doc reads (`getList$`) for `?list=` nav + chooser selection, and a
 * recent-docs query (`recentLists$`) for the chooser's flat list. Mirrors
 * the `OptionsReplayRunsService` posture — runInInjectionContext +
 * collectionData/docData + the shared replay-doc converter.
 *
 * `recentLists$` uses a single-field `generatedAt desc` orderBy (no
 * composite index) and filters client-side: `status === 'success'` AND a
 * `pickDocMeta` — a success doc without pick provenance is not a usable
 * list. Symbol sorting/filtering is the chooser's job, not the query's.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Firestore, collection, collectionData, doc, docData, query, orderBy, limit } from '@angular/fire/firestore';
import { Observable, from, map } from 'rxjs';

import { ST_OPTIONS_CONTRACT_LISTS_ROOT } from '@st/collections';
import type { OptionsContractListUi } from '../backtest/common/options-replay.types';
import { convertOptionsContractListDoc } from '../backtest/services/options-replay-firestore-converter';

@Injectable({
  providedIn: 'root',
})
export class ContractListService {
  private readonly firestore = inject(Firestore);
  private readonly injector = inject(EnvironmentInjector);

  /** Read one list doc by id — `null` when the doc doesn't exist. Status
   *  is NOT filtered here: the caller needs the doc's status to name the
   *  error (missing vs failed vs no pickDocMeta). */
  getList$(docId: string): Observable<OptionsContractListUi | null> {
    return from(runInInjectionContext(this.injector, () => {
      const ref = doc(this.firestore, ST_OPTIONS_CONTRACT_LISTS_ROOT, docId);
      return docData(ref) as Observable<Record<string, unknown> | undefined>;
    })).pipe(
      map((d) => (d ? convertOptionsContractListDoc(docId, d) : null)),
    );
  }

  /** Recent list docs, newest first — success + pickDocMeta only. */
  recentLists$(count = 50): Observable<OptionsContractListUi[]> {
    return from(runInInjectionContext(this.injector, () => {
      const listsRef = collection(this.firestore, ST_OPTIONS_CONTRACT_LISTS_ROOT);
      const listsQuery = query(listsRef, orderBy('generatedAt', 'desc'), limit(count));
      return collectionData(listsQuery, { idField: 'listId' }) as Observable<Record<string, unknown>[]>;
    })).pipe(
      map((docs) =>
        docs
          .map((d) => convertOptionsContractListDoc(String(d['listId'] ?? d['id']), d))
          .filter((l) => l.status === 'success' && l.pickDocMeta != null),
      ),
    );
  }
}
