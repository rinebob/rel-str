/**
 * Firestore CRUD service for options strategy instances. Direct writes via the
 * Angular Firestore SDK, scoped to the authenticated user's userId.
 */
import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionData,
  doc,
  setDoc,
  updateDoc,
  query,
  where,
} from '@angular/fire/firestore';
import { Observable, throwError, map } from 'rxjs';

import { ST_STRATEGY_INSTANCES_ROOT } from '@st/collections';
import type { StStrategyInstance } from '@st/strategy-instances';
import { LifecycleState } from '@options-strategy-engine/contracts';
import { buildAccountId } from '@paper-trading/ids';
import { generateInstanceId } from '../../../../../shared/strategy-instance-id';

/** Instance payload the form produces — StStrategyInstance minus the fields
 *  this service stamps (id, userId, timestamps, mode, enabled,
 *  paperAccountId, lastFiredAt). */
export type InstanceInput = Omit<
  StStrategyInstance,
  | 'id'
  | 'userId'
  | 'createdAt'
  | 'updatedAt'
  | 'mode'
  | 'enabled'
  | 'paperAccountId'
  | 'lastFiredAt'
>;

const LIFECYCLE_ORDER: Record<LifecycleState, number> = {
  [LifecycleState.ACTIVE]: 0,
  [LifecycleState.PAUSED]: 1,
  [LifecycleState.STOPPED]: 2,
};

@Injectable({ providedIn: 'root' })
export class StrategyBuilderService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);

  private get userId(): string {
    return this.auth.currentUser?.uid ?? '';
  }

  private requireUserId(): string {
    const uid = this.userId;
    if (!uid) throw new Error('Authentication required');
    return uid;
  }

  /** Load all strategy instances for the current user, sorted by lifecycle then created date. */
  loadInstances$(): Observable<StStrategyInstance[]> {
    try {
      const uid = this.requireUserId();
      const ref = collection(this.firestore, ST_STRATEGY_INSTANCES_ROOT);
      const q = query(ref, where('userId', '==', uid));
      return collectionData(q, { idField: 'id' }).pipe(
        map((docs) => {
          const instances = docs as StStrategyInstance[];
          return instances.sort((a, b) => {
            const orderDiff = LIFECYCLE_ORDER[a.lifecycleState] - LIFECYCLE_ORDER[b.lifecycleState];
            if (orderDiff !== 0) return orderDiff;
            return String(b.createdAt).localeCompare(String(a.createdAt));
          });
        }),
      );
    } catch (err) {
      return throwError(() => err);
    }
  }

  /** Create a new strategy instance with an ID generated from the naming convention. */
  async createInstance(config: InstanceInput): Promise<void> {
    const uid = this.requireUserId();
    const now = new Date();
    const id = generateInstanceId(now, config.symbol, config.phases, config.frequency, config.openTimePT);
    const ref = doc(this.firestore, `${ST_STRATEGY_INSTANCES_ROOT}/${id}`);

    const payload: Omit<StStrategyInstance, 'id'> = {
      ...config,
      userId: uid,
      mode: 'paper',
      enabled: true,
      paperAccountId: buildAccountId(uid),
      governingVariant: config.governingVariant ?? 'none',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    await setDoc(ref, payload);
  }

  /** Merge partial changes into an existing strategy instance. */
  async updateInstance(id: string, changes: Partial<InstanceInput>): Promise<void> {
    this.requireUserId();
    const ref = doc(this.firestore, `${ST_STRATEGY_INSTANCES_ROOT}/${id}`);

    await updateDoc(ref, {
      ...changes,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Soft-delete an instance by marking it STOPPED and recording the deletion time. */
  async deleteInstance(id: string): Promise<void> {
    this.requireUserId();
    const ref = doc(this.firestore, `${ST_STRATEGY_INSTANCES_ROOT}/${id}`);

    await updateDoc(ref, {
      lifecycleState: LifecycleState.STOPPED,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  /** Update only the lifecycle state of an instance. */
  async setLifecycleState(id: string, state: LifecycleState): Promise<void> {
    this.requireUserId();
    const ref = doc(this.firestore, `${ST_STRATEGY_INSTANCES_ROOT}/${id}`);

    await updateDoc(ref, {
      lifecycleState: state,
      updatedAt: new Date().toISOString(),
    });
  }
}
