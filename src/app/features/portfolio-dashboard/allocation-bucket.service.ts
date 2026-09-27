/**
 * Allocation Bucket Service — Firestore CRUD on
 * `portfolio/buckets/items` (Blueprint #582 / task #586).
 *
 * Doc id = `{accountNumber}_{bucketSlug(name)}`, minted once and FROZEN —
 * renames update `name` only. Because slug-derived ids are never freed
 * (retired docs keep their id forever), a create or rename conflict is
 * provable in a transaction by reading the candidate doc id — no
 * collection scan needed.
 *
 * Every doc carries `userId`; rules scope all access to it, so all list
 * queries constrain `userId == uid`.
 */
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import {
  Firestore,
  collection,
  collectionSnapshots,
  doc,
  getDocs,
  query,
  runTransaction,
  updateDoc,
  where,
  DocumentData,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { requireUserId } from '../savant-trader/services/firestore-helpers';
import { BucketStatus, type AllocationBucket } from '@portfolio-allocation/contracts';
import { PORTFOLIO_BUCKETS_COLLECTION, buildBucketId } from '@portfolio-allocation/ids';

@Injectable({ providedIn: 'root' })
export class AllocationBucketService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /** Live stream of the caller's buckets for one account. */
  watchBuckets$(accountNumber: string): Observable<AllocationBucket[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) =>
        new Observable<AllocationBucket[]>((subscriber) => {
          const sub = runInInjectionContext(this.injector, () => {
            const coll = collection(this.firestore, PORTFOLIO_BUCKETS_COLLECTION);
            const q = query(
              coll,
              where('userId', '==', userId),
              where('accountNumber', '==', accountNumber),
            );
            return collectionSnapshots(q)
              .pipe(map((docs) => docs.map((d) => d.data() as AllocationBucket)))
              .subscribe(subscriber);
          });
          return () => sub.unsubscribe();
        }),
      ),
    );
  }

  /** One-shot read of the caller's buckets for one account. */
  listBuckets$(accountNumber: string): Observable<AllocationBucket[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        runInInjectionContext(this.injector, async () => {
          const coll = collection(this.firestore, PORTFOLIO_BUCKETS_COLLECTION);
          const q = query(
            coll,
            where('userId', '==', userId),
            where('accountNumber', '==', accountNumber),
          );
          const snap = await getDocs(q);
          return snap.docs.map((d) => d.data() as AllocationBucket);
        }),
      ),
    );
  }

  /**
   * Create a bucket. Throws `Bucket name conflict` if the
   * `{account}_{slug}` doc id already exists — covers same-name, slug
   * alias, and previously-minted (renamed-away / retired) names, since
   * occupied ids are never freed.
   */
  createBucket$(accountNumber: string, name: string, targetPct: number): Observable<AllocationBucket> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        runInInjectionContext(this.injector, async () => {
          if (!Number.isFinite(targetPct)) {
            throw new Error(`Invalid targetPct: ${targetPct}`);
          }
          const id = buildBucketId(accountNumber, name); // throws on un-slugifiable name
          const now = new Date().toISOString();
          const bucket: AllocationBucket = {
            id,
            userId,
            accountNumber,
            name: name.trim(),
            targetPct,
            status: BucketStatus.ACTIVE,
            createdAt: now,
            updatedAt: now,
          };
          const ref = doc(this.firestore, PORTFOLIO_BUCKETS_COLLECTION, id);
          await runTransaction(this.firestore, async (txn) => {
            const existing = await txn.get(ref);
            if (existing.exists()) {
              throw new Error(`Bucket name conflict: '${name.trim()}' is already in use`);
            }
            txn.set(ref, bucket as unknown as DocumentData);
          });
          return bucket;
        }),
      ),
    );
  }

  /** Update the funding target. */
  updateTargetPct$(bucketId: string, targetPct: number): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        runInInjectionContext(this.injector, () => {
          if (!Number.isFinite(targetPct)) {
            throw new Error(`Invalid targetPct: ${targetPct}`);
          }
          return updateDoc(
            doc(this.firestore, PORTFOLIO_BUCKETS_COLLECTION, bucketId),
            { targetPct, updatedAt: new Date().toISOString() },
          );
        }),
      ),
    );
  }

  /**
   * Rename a bucket — `name` only; the id stays the creation-minted slug.
   * Throws `Bucket name conflict` when another bucket already occupies the
   * new name's slug id (retired and renamed-away slugs stay occupied).
   */
  renameBucket$(bucket: AllocationBucket, newName: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        runInInjectionContext(this.injector, async () => {
          await runTransaction(this.firestore, async (txn) => {
            const currentRef = doc(this.firestore, PORTFOLIO_BUCKETS_COLLECTION, bucket.id);
            const current = await txn.get(currentRef);
            if (!current.exists()) {
              throw new Error(`Bucket '${bucket.id}' does not exist`);
            }
            // Probe with the doc's own accountNumber — the caller-supplied
            // object could be stale/wrong, which would scope the conflict
            // check to the wrong account's id-space.
            const stored = current.data() as AllocationBucket;
            const newId = buildBucketId(stored.accountNumber, newName); // throws on un-slugifiable
            if (newId !== bucket.id) {
              const newRef = doc(this.firestore, PORTFOLIO_BUCKETS_COLLECTION, newId);
              const occupied = await txn.get(newRef);
              if (occupied.exists()) {
                throw new Error(`Bucket name conflict: '${newName.trim()}' is already in use`);
              }
            }
            txn.update(currentRef, {
              name: newName.trim(),
              updatedAt: new Date().toISOString(),
            });
          });
        }),
      ),
      map(() => undefined),
    );
  }

  /** Retire a bucket — keeps the doc (history references stay valid);
   *  retired buckets reject new attributions and never ticket-match. */
  retireBucket$(bucketId: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap(() =>
        runInInjectionContext(this.injector, () =>
          updateDoc(
            doc(this.firestore, PORTFOLIO_BUCKETS_COLLECTION, bucketId),
            { status: BucketStatus.RETIRED, updatedAt: new Date().toISOString() },
          ),
        ),
      ),
    );
  }
}
