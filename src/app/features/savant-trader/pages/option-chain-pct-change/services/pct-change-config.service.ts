/**
 * Pct Change Config Service — Firestore persistence for saved pct-change configs.
 *
 * Reads and writes saved configs under
 * `configs/option-chain-pct-change/configs/{configId}`.
 *
 * No user-scoping — this is a single-user app. Security rules allow
 * authenticated CRUD on the leaf docs.
 */
import { Injectable, inject } from '@angular/core';
import {
  Firestore,
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
} from '@angular/fire/firestore';
import { Observable, from } from 'rxjs';
import { map } from 'rxjs/operators';

import type { PctChangeConfigDoc } from '@shared/pct-change-config-contracts';

const CONFIGS_ROOT = 'configs';
const FEATURE_DOC = 'option-chain-pct-change';
const CONFIGS_SUBCOLLECTION = 'configs';

/** Config doc with its Firestore id attached. */
export interface PctChangeConfigWithId extends PctChangeConfigDoc {
  id: string;
}

@Injectable({ providedIn: 'root' })
export class PctChangeConfigService {
  private readonly firestore = inject(Firestore);

  /** Load all saved configs (one-shot). */
  loadConfigs(): Observable<PctChangeConfigWithId[]> {
    const coll = collection(
      this.firestore,
      CONFIGS_ROOT,
      FEATURE_DOC,
      CONFIGS_SUBCOLLECTION,
    );
    return from(getDocs(coll)).pipe(
      map((snap) =>
        snap.docs.map((d) => ({
          ...(d.data() as PctChangeConfigDoc),
          id: d.id,
        })),
      ),
    );
  }

  /** Save (or overwrite) a config document. The `id` field is used as the doc id. */
  saveConfig(config: PctChangeConfigWithId): Observable<void> {
    const { id, ...payload } = config;
    return from(
      setDoc(
        doc(
          this.firestore,
          CONFIGS_ROOT,
          FEATURE_DOC,
          CONFIGS_SUBCOLLECTION,
          id,
        ),
        payload,
      ),
    );
  }

  /** Delete a config document by id. */
  deleteConfig(configId: string): Observable<void> {
    return from(
      deleteDoc(
        doc(
          this.firestore,
          CONFIGS_ROOT,
          FEATURE_DOC,
          CONFIGS_SUBCOLLECTION,
          configId,
        ),
      ),
    );
  }
}
