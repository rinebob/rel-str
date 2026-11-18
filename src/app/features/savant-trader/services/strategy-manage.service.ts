/**
 * @topic #137 — STRAT-MANAGE, Thread #1510 (OpsStrat Manage Page Overhaul)
 * @task #1540 — FE: Route/nav migration to options/strategy/manage + store + table shell
 * @task #1546 — FE: Instance table — setRunState mutation seam; variant
 * presence added to the manage-shape discriminator
 * @task #1547 — FE: Create New Instance dialog — createInstances write seam
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
  runTransaction,
  updateDoc,
  query,
  where,
  type DocumentReference,
} from '@angular/fire/firestore';
import { Observable, throwError, map } from 'rxjs';

import { ST_STRATEGY_INSTANCES_ROOT } from '@st/collections';
import { buildAccountId } from '@paper-trading/ids';
import {
  INSTANCE_RUN_STATES,
  isValidModeStopType,
  type InstanceMode,
  type InstanceRunState,
  type InstanceTrigger,
  type ManageInstance,
  type StopType,
} from '@manage/instance-contracts';
import type { ManageVariant } from '@manage/variant-contracts';

/** Everything the Create New Instance dialog resolves — the service stamps
 *  `id` (doc path), `runState: 'UNSTARTED'`, `userId`, `paperAccountId`, and
 *  the created/updated timestamps. */
export interface CreateManageInstanceInput {
  /** Dedup key — generated via `generateManageInstanceId` by the caller so
   *  the dialog can preview it before commit. */
  id: string;
  /** Registry variant id, or `MANAGE_ADHOC_VARIANT_REF` for session variants. */
  variantRef: string;
  /** Embedded variant snapshot — self-describing per the contract. */
  variant: ManageVariant;
  symbol: string;
  mode: InstanceMode;
  trigger: InstanceTrigger;
  stopType: StopType;
}

/** Filter-submit result (#1605): which input ids were written and which
 *  were left behind because a same-id doc already exists — a same-id doc,
 *  live OR soft-deleted, is restarted via runState, never overwritten. */
export interface CreateInstancesResult {
  created: string[];
  skipped: string[];
}

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

  /** Filter-submit create (#1605): one ManageInstance doc per input whose
   *  id does NOT already exist — existing ids (incl. docs created between
   *  the dialog's preview and the commit) land in `skipped`, never throw
   *  and never get overwritten. Everything still runs inside ONE
   *  transaction — every doc is read before any write (Firestore retries
   *  on contention), so the exists-check and the create stay atomic.
   *  A mode/stop invariant violation is a caller bug, not user input —
   *  it still throws. The instance stream re-emits — callers don't
   *  reload. */
  async createInstances(
    inputs: CreateManageInstanceInput[],
  ): Promise<CreateInstancesResult> {
    const result: CreateInstancesResult = { created: [], skipped: [] };
    if (!inputs.length) return result;
    const uid = this.requireUserId();
    const now = new Date().toISOString();

    const writes: {
      id: string;
      ref: DocumentReference;
      payload: Omit<ManageInstance, 'id'>;
    }[] = [];
    const seen = new Set<string>();
    const intraSkipped: string[] = [];
    for (const input of inputs) {
      if (!isValidModeStopType(input.mode, input.stopType)) {
        throw new Error(
          `mode '${input.mode}' + stopType '${input.stopType}' violates the mode/stop invariant`,
        );
      }
      if (seen.has(input.id)) {
        intraSkipped.push(input.id);
        continue;
      }
      seen.add(input.id);
      writes.push({
        id: input.id,
        ref: doc(this.firestore, `${ST_STRATEGY_INSTANCES_ROOT}/${input.id}`),
        payload: {
          variantRef: input.variantRef,
          variant: input.variant,
          symbol: input.symbol,
          mode: input.mode,
          trigger: input.trigger,
          stopType: input.stopType,
          runState: 'UNSTARTED',
          userId: uid,
          // Real instances bind to a live account at the engine, not here —
          // paperAccountId is contractually required only when mode='paper'.
          ...(input.mode === 'paper' ? { paperAccountId: buildAccountId(uid) } : {}),
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    // Recompute created/skipped inside the callback — Firestore may
    // re-run it on contention, so assignment (not push) keeps a retry
    // idempotent.
    await runTransaction(this.firestore, async (txn) => {
      const snaps = await Promise.all(writes.map((w) => txn.get(w.ref)));
      const created: string[] = [];
      const skipped: string[] = [];
      snaps.forEach((snap, i) => {
        if (snap.exists()) {
          skipped.push(writes[i].id);
        } else {
          txn.set(writes[i].ref, writes[i].payload);
          created.push(writes[i].id);
        }
      });
      result.created = created;
      result.skipped = [...intraSkipped, ...skipped];
    });
    return result;
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
