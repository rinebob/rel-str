/**
 * Position Attribution Service — `portfolio/attributions/items`
 * (Blueprint #582 / task #586).
 *
 * One doc per {account, instrument}; `bucketId` + append-only `history`
 * (AttributionEvent — null fromBucketId = initial assignment). Absence of
 * a doc = Unassigned (derived view, never stored).
 *
 * Multi-leg atomicity: attributions carrying the same `linkKey` (parent
 * orderId) move as one group — assigning/moving any leg applies the same
 * event to every member, so a spread can never split across buckets.
 *
 * Every doc carries `userId`; list queries constrain `userId == uid`.
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
  where,
  DocumentData,
} from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { requireUserId } from '../savant-trader/services/firestore-helpers';
import {
  BucketStatus,
  type AllocationBucket,
  type AttributionEvent,
  type PositionAttribution,
} from '@portfolio-allocation/contracts';
import {
  PORTFOLIO_ATTRIBUTIONS_COLLECTION,
  PORTFOLIO_BUCKETS_COLLECTION,
  buildAttributionId,
  bucketSlug,
} from '@portfolio-allocation/ids';

@Injectable({ providedIn: 'root' })
export class PositionAttributionService {
  private readonly firestore = inject(Firestore);
  private readonly auth = inject(Auth);
  private readonly injector = inject(EnvironmentInjector);

  /** Live stream of the caller's attributions for one account. */
  watchAttributions$(accountNumber: string): Observable<PositionAttribution[]> {
    return requireUserId(this.auth, this.injector).pipe(
      switchMap((userId) =>
        new Observable<PositionAttribution[]>((subscriber) => {
          const sub = runInInjectionContext(this.injector, () => {
            const coll = collection(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION);
            const q = query(
              coll,
              where('userId', '==', userId),
              where('accountNumber', '==', accountNumber),
            );
            return collectionSnapshots(q)
              .pipe(map((docs) => docs.map((d) => d.data() as PositionAttribution)))
              .subscribe(subscriber);
          });
          return () => sub.unsubscribe();
        }),
      ),
    );
  }

  /** One-shot read of the caller's attributions for one account. */
  listAttributions$(accountNumber: string): Observable<PositionAttribution[]> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        runInInjectionContext(this.injector, async () => {
          const coll = collection(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION);
          const q = query(
            coll,
            where('userId', '==', userId),
            where('accountNumber', '==', accountNumber),
          );
          const snap = await getDocs(q);
          return snap.docs.map((d) => d.data() as PositionAttribution);
        }),
      ),
    );
  }

  /**
   * Attribute a position (and, if it's linked, its whole group) to a
   * bucket — covers both `assign` (new doc, fromBucketId null) and `move`
   * (existing doc, from → to). Throws when the target bucket is missing,
   * RETIRED, or belongs to a different account.
   *
   * Group scope: every doc sharing the member's `linkKey` (parent orderId)
   * moves together — a seeded spread can never split across buckets. A leg
   * without a doc has no recorded linkKey; pass `linkKey` to stamp/join
   * it (an existing linkKey on the doc always wins).
   */
  attribute$(
    accountNumber: string,
    instrumentId: string,
    toBucketId: string,
    linkKey?: string,
  ): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        runInInjectionContext(this.injector, async () => {
          // Group membership is read OUTSIDE the transaction (membership is
          // discovered via linkKey; Firestore txns require all reads before
          // writes, and a query can't re-probe membership mid-txn on this
          // SDK surface). Single-user writes make the race window narrow —
          // each member doc is still re-read inside the txn, so per-doc
          // history stays correct even if a sibling is missed.
          const existing = await this.readAttributions(userId, accountNumber);
          const selfId = buildAttributionId(accountNumber, instrumentId);
          const self = existing.find((a) => a.id === selfId);
          // An existing linkKey wins over the caller-supplied one — the
          // recorded group is authoritative.
          const effectiveLinkKey = self?.linkKey ?? linkKey;
          const group = effectiveLinkKey
            ? existing.filter((a) => a.linkKey === effectiveLinkKey)
            : [];

          const bucketRef = doc(this.firestore, PORTFOLIO_BUCKETS_COLLECTION, toBucketId);
          // memberId → instrumentId for doc construction on the new-doc path.
          const members = new Map(group.map((a) => [a.id, a.instrumentId]));
          members.set(selfId, instrumentId);

          await runTransaction(this.firestore, async (txn) => {
            // Pass 1 — ALL reads first (Firestore txns forbid reads after
            // a write has been issued; interleaved get/set throws).
            const bucket = await txn.get(bucketRef);
            if (!bucket.exists()
              || (bucket.data() as AllocationBucket).status !== BucketStatus.ACTIVE) {
              throw new Error(`Target bucket '${toBucketId}' is missing or retired`);
            }
            const bucketData = bucket.data() as AllocationBucket;
            if (bucketData.accountNumber !== accountNumber) {
              throw new Error(`Bucket '${toBucketId}' belongs to a different account`);
            }

            const snaps = new Map<string, PositionAttribution | undefined>();
            for (const id of members.keys()) {
              const ref = doc(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION, id);
              const snap = await txn.get(ref);
              snaps.set(id, snap.exists() ? (snap.data() as PositionAttribution) : undefined);
            }

            // Pass 2 — writes only.
            const now = new Date().toISOString();
            for (const [id, memberInstrument] of members) {
              const current = snaps.get(id);
              // Skip only when there's genuinely nothing to write — a doc
              // already at target but missing the group key must still be
              // stamped, else it silently stays outside the group.
              const wantsLink = current?.linkKey ?? effectiveLinkKey;
              if (current?.bucketId === toBucketId && current?.linkKey === wantsLink) {
                continue;
              }
              const event: AttributionEvent = {
                fromBucketId: current?.bucketId ?? null,
                toBucketId,
                at: now,
              };
              const effectiveLink = wantsLink;
              // A pure linkKey-stamp (already at target) still appends a
              // from→to event — identity move, honest trail.
              const next: PositionAttribution = {
                id,
                userId,
                accountNumber,
                instrumentId: current?.instrumentId ?? memberInstrument,
                bucketId: toBucketId,
                ...(effectiveLink ? { linkKey: effectiveLink } : {}),
                history: [...(current?.history ?? []), event],
                createdAt: current?.createdAt ?? now,
                updatedAt: now,
              };
              const ref = doc(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION, id);
              txn.set(ref, next as unknown as DocumentData);
            }
          });
        }),
      ),
    );
  }

  /**
   * Bulk form of attribute$ — ONE read + ONE txn for the whole selection
   * (the per-item path re-queries attributions each call; N items = N
   * reads + N txns, which is why bulk assign felt slow). Group expansion
   * unions every item's linkKey members into a single write set, so
   * selecting one leg still moves the whole linked order.
   */
  attributeMany$(
    accountNumber: string,
    items: { instrumentId: string; linkKey?: string }[],
    toBucketId: string,
  ): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        runInInjectionContext(this.injector, async () => {
          const existing = await this.readAttributions(userId, accountNumber);
          // Union of every item's group — an existing linkKey on the doc
          // always wins over the caller-supplied one.
          const members = new Map<string, string>();
          for (const item of items) {
            const selfId = buildAttributionId(accountNumber, item.instrumentId);
            const self = existing.find((a) => a.id === selfId);
            const link = self?.linkKey ?? item.linkKey;
            for (const a of link ? existing.filter((x) => x.linkKey === link) : []) {
              members.set(a.id, a.instrumentId);
            }
            members.set(selfId, item.instrumentId);
          }

          const bucketRef = doc(this.firestore, PORTFOLIO_BUCKETS_COLLECTION, toBucketId);
          await runTransaction(this.firestore, async (txn) => {
            const bucket = await txn.get(bucketRef);
            if (!bucket.exists()
              || (bucket.data() as AllocationBucket).status !== BucketStatus.ACTIVE) {
              throw new Error(`Target bucket '${toBucketId}' is missing or retired`);
            }
            const bucketData = bucket.data() as AllocationBucket;
            if (bucketData.accountNumber !== accountNumber) {
              throw new Error(`Bucket '${toBucketId}' belongs to a different account`);
            }

            const snaps = new Map<string, PositionAttribution | undefined>();
            for (const id of members.keys()) {
              const ref = doc(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION, id);
              const snap = await txn.get(ref);
              snaps.set(id, snap.exists() ? (snap.data() as PositionAttribution) : undefined);
            }

            const now = new Date().toISOString();
            for (const [id, memberInstrument] of members) {
              const current = snaps.get(id);
              const item = items.find((i) => buildAttributionId(accountNumber, i.instrumentId) === id);
              const wantsLink = current?.linkKey ?? item?.linkKey;
              if (current?.bucketId === toBucketId && current?.linkKey === wantsLink) {
                continue;
              }
              const next: PositionAttribution = {
                id,
                userId,
                accountNumber,
                instrumentId: current?.instrumentId ?? memberInstrument,
                bucketId: toBucketId,
                ...(wantsLink ? { linkKey: wantsLink } : {}),
                history: [...(current?.history ?? []),
                  { fromBucketId: current?.bucketId ?? null, toBucketId, at: now }],
                createdAt: current?.createdAt ?? now,
                updatedAt: now,
              };
              txn.set(doc(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION, id),
                next as unknown as DocumentData);
            }
          });
        }),
      ),
    );
  }

  /**
   * Bulk unassign — same group-union semantics, one txn deletes every
   * attribution doc (group members included).
   */
  unassignMany$(accountNumber: string, instrumentIds: string[]): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        runInInjectionContext(this.injector, async () => {
          const existing = await this.readAttributions(userId, accountNumber);
          const ids = new Set<string>();
          for (const instrumentId of instrumentIds) {
            const selfId = buildAttributionId(accountNumber, instrumentId);
            const self = existing.find((a) => a.id === selfId);
            for (const a of self?.linkKey
              ? existing.filter((x) => x.linkKey === self.linkKey)
              : []) {
              ids.add(a.id);
            }
            ids.add(selfId);
          }
          await runTransaction(this.firestore, async (txn) => {
            for (const id of ids) {
              txn.delete(doc(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION, id));
            }
          });
        }),
      ),
    );
  }

  /**
   * Remove a position's attribution → lands back in Unassigned (absence of
   * a doc IS the Unassigned encoding, so this deletes — the audit history
   * inside the doc is discarded; group-aware: linked legs unassign as one).
   */
  unassign$(accountNumber: string, instrumentId: string): Observable<void> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        runInInjectionContext(this.injector, async () => {
          const existing = await this.readAttributions(userId, accountNumber);
          const self = existing.find((a) => a.id === buildAttributionId(accountNumber, instrumentId));
          const group = self?.linkKey
            ? existing.filter((a) => a.linkKey === self.linkKey)
            : [];
          const ids = new Set(group.map((a) => a.id));
          ids.add(buildAttributionId(accountNumber, instrumentId));

          await runTransaction(this.firestore, async (txn) => {
            for (const id of ids) {
              txn.delete(doc(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION, id));
            }
          });
        }),
      ),
    );
  }

  /**
   * Seed attribution from an order ticket's strategyName — resolves the
   * ACTIVE bucket in this account whose name slug equals the strategy
   * name's slug. 0 or >1 matches → no-op (position stays Unassigned).
   * `linkKey` = the order id → seeds the multi-leg group so later
   * post-hoc moves stay atomic.
   */
  seedFromTicket$(
    accountNumber: string,
    instrumentId: string,
    strategyName: string | undefined,
    linkKey?: string,
  ): Observable<PositionAttribution | null> {
    return requireUserId(this.auth, this.injector).pipe(
      take(1),
      switchMap((userId) =>
        runInInjectionContext(this.injector, async () => {
          let slug: string;
          try {
            slug = bucketSlug(strategyName ?? '');
          } catch {
            return null; // un-slugifiable name → 0-match → Unassigned
          }

          const buckets = await this.readBuckets(userId, accountNumber);
          const matches = buckets.filter((b) => {
            if (b.status !== BucketStatus.ACTIVE) return false;
            try {
              return bucketSlug(b.name) === slug;
            } catch {
              return false; // corrupt stored name → treat as non-match
            }
          });
          if (matches.length !== 1) return null; // 0 or ambiguous → Unassigned

          const bucketId = matches[0].id;
          const id = buildAttributionId(accountNumber, instrumentId);
          const now = new Date().toISOString();
          const ref = doc(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION, id);
          const attr: PositionAttribution = {
            id,
            userId,
            accountNumber,
            instrumentId,
            bucketId,
            ...(linkKey ? { linkKey } : {}),
            history: [{ fromBucketId: null, toBucketId: bucketId, at: now }],
            createdAt: now,
            updatedAt: now,
          };
          let wrote = false;
          await runTransaction(this.firestore, async (txn) => {
            wrote = false; // txn callbacks can re-run — reset per attempt
            const snap = await txn.get(ref);
            if (snap.exists()) return; // already attributed — don't rewrite
            // Re-verify the bucket is still ACTIVE inside the txn — the
            // slug match was computed from a pre-txn read.
            const bucketSnap = await txn.get(
              doc(this.firestore, PORTFOLIO_BUCKETS_COLLECTION, bucketId));
            const bucket = bucketSnap.data() as AllocationBucket | undefined;
            if (!bucketSnap.exists() || bucket?.status !== BucketStatus.ACTIVE) return;
            wrote = true;
            txn.set(ref, attr as unknown as DocumentData);
          });
          return wrote ? attr : null;
        }),
      ),
    );
  }

  private async readAttributions(userId: string, accountNumber: string): Promise<PositionAttribution[]> {
    const coll = collection(this.firestore, PORTFOLIO_ATTRIBUTIONS_COLLECTION);
    const q = query(coll, where('userId', '==', userId), where('accountNumber', '==', accountNumber));
    const snap = await getDocs(q);
    // Carry the snapshot id — the doc's `id` field is authoritative only
    // if writers stayed honest; the path is the truth.
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as PositionAttribution);
  }

  private async readBuckets(userId: string, accountNumber: string): Promise<AllocationBucket[]> {
    const coll = collection(this.firestore, PORTFOLIO_BUCKETS_COLLECTION);
    const q = query(coll, where('userId', '==', userId), where('accountNumber', '==', accountNumber));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as AllocationBucket);
  }
}
