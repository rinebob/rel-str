/**
 * @topic #137 — Strategy Builder UI
 *
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

import { Collection } from '../../../core/common/constants';
import type { StrategyInstanceConfig } from '@options-strategy-engine/contracts';
import { LifecycleState } from '@options-strategy-engine/contracts';
import { generateInstanceId } from '../../../../../shared/strategy-instance-id';

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
  loadInstances$(): Observable<StrategyInstanceConfig[]> {
    try {
      const uid = this.requireUserId();
      const ref = collection(this.firestore, Collection.OPTIONS_STRATEGY_INSTANCES);
      const q = query(ref, where('userId', '==', uid));
      return collectionData(q, { idField: 'id' }).pipe(
        map((docs) => {
          const instances = docs as StrategyInstanceConfig[];
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
  async createInstance(config: Omit<StrategyInstanceConfig, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<void> {
    const uid = this.requireUserId();
    const now = new Date();
    const id = generateInstanceId(now, config.symbol, config.phases, config.frequency);
    const ref = doc(this.firestore, `${Collection.OPTIONS_STRATEGY_INSTANCES}/${id}`);

    await setDoc(ref, {
      ...config,
      userId: uid,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  /** Merge partial changes into an existing strategy instance. */
  async updateInstance(id: string, changes: Partial<StrategyInstanceConfig>): Promise<void> {
    const uid = this.requireUserId();
    const ref = doc(this.firestore, `${Collection.OPTIONS_STRATEGY_INSTANCES}/${id}`);

    await updateDoc(ref, {
      ...changes,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Soft-delete an instance by marking it STOPPED and recording the deletion time. */
  async deleteInstance(id: string): Promise<void> {
    const uid = this.requireUserId();
    const ref = doc(this.firestore, `${Collection.OPTIONS_STRATEGY_INSTANCES}/${id}`);

    await updateDoc(ref, {
      lifecycleState: LifecycleState.STOPPED,
      deletedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  }

  /** Update only the lifecycle state of an instance. */
  async setLifecycleState(id: string, state: LifecycleState): Promise<void> {
    const uid = this.requireUserId();
    const ref = doc(this.firestore, `${Collection.OPTIONS_STRATEGY_INSTANCES}/${id}`);

    await updateDoc(ref, {
      lifecycleState: state,
      updatedAt: new Date().toISOString(),
    });
  }
}
