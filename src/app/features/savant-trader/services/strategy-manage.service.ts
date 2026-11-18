/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1540 — FE: Route/nav migration to options/strategy/manage + store + table shell
 * @task #1546 — FE: Instance table — setRunState mutation seam; variant
 * presence added to the manage-shape discriminator
 *
 * Firestore read service for manage strategy instances. Streams the
 * userId-scoped docs on the shared `st-strategy-instances` root that carry
 * the manage schema — the `runState` field is the discriminator (legacy
 * `StrategyInstanceConfig` docs on the same root carry `lifecycleState`
 * instead, matching the BE reader's discrimination in
 * `manage-instance-reader.ts`).
 */
import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  updateDoc,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, throwError, map } from 'rxjs';

import { ST_STRATEGY_INSTANCES_ROOT } from '@st/collections';
import {
  INSTANCE_RUN_STATES,
  type InstanceRunState,
  type ManageInstance,
} from '@manage/instance-contracts';

@Injectable({ providedIn: 'root' })
export class StrategyManageService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private requireUserId(): string {
    const uid = this.auth.currentUser?.uid ?? '';
    if (!uid) throw new Error('Authentication required');
    return uid;
  }

  /** Stream the current user's manage instances, newest first. The
   *  userId `where` is the only Firestore constraint — the manage-shape
   *  and soft-delete filters run client-side so no composite index is
   *  required. */
  loadInstances$(): Observable<ManageInstance[]> {
    try {
      const uid = this.requireUserId();
      const ref = collection(this.firestore, ST_STRATEGY_INSTANCES_ROOT);
      const q = query(ref, where('userId', '==', uid));
      return collectionData(q, { idField: 'id' }).pipe(
        map((docs) =>
          (docs as ManageInstance[])
            .filter(isLiveManageInstance)
            .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
        ),
      );
    } catch (err) {
      return throwError(() => err);
    }
  }

  /** Set the run state of an instance (start/stop). The instance stream
   *  re-emits automatically — callers don't reload after the write. */
  async setRunState(id: string, runState: InstanceRunState): Promise<void> {
    this.requireUserId();
    const ref = doc(this.firestore, `${ST_STRATEGY_INSTANCES_ROOT}/${id}`);
    await updateDoc(ref, { runState, updatedAt: new Date().toISOString() });
  }
}

/** Manage-shape discriminator: a valid `runState`, an embedded `variant`
 *  snapshot (the table reads `variant.name` unconditionally), and no
 *  soft-delete stamp. The shared `st-strategy-instances` root can carry
 *  malformed docs (console edits, partial writes) — a doc without a
 *  variant would crash change detection downstream, so it drops here. */
function isLiveManageInstance(d: ManageInstance): boolean {
  return (
    INSTANCE_RUN_STATES.includes(d.runState) &&
    typeof d.variant?.name === 'string' &&
    (d.deletedAt === undefined || d.deletedAt === null)
  );
}
