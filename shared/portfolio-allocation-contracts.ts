/**
 * Portfolio-allocation contracts (Blueprint #581 / task #583).
 *
 * An **Allocation Bucket** is a named strategy group scoped to ONE Robinhood
 * account: it owns a funding target (`targetPct` of the account's current
 * live value) and aggregates every live position attributed to it. Buckets
 * contain live trades only — never paper. See CONTEXT.md for the term and
 * `docs/topics/576-portfolio/` for the PRD/IMPL.
 *
 *   `shared/portfolio-allocation-ids.ts` — collection names + id builders
 *   (including the freeze-at-creation / rename contract).
 */

import type { EquityCurvePoint } from './common';

/** Bucket lifecycle. RETIRED keeps history but rejects new attributions —
 *  enforced by writers, declared here so every consumer agrees on the
 *  terminality rule. */
export enum BucketStatus {
  ACTIVE = 'ACTIVE',
  RETIRED = 'RETIRED',
}

/**
 * A named strategy group owning a funding target for one RH account.
 *
 * `id` is frozen at creation (a slug of the original name — see
 * `buildBucketId`). Renaming updates `name` only; the id — and therefore
 * every `PositionAttribution.bucketId` / audit reference — is preserved.
 * A retired bucket keeps its doc forever, so its slug stays occupied.
 *
 * Name normalization: buckets compare names by `bucketSlug(name)` —
 * case/whitespace/punctuation all fold into the same slug, so slug
 * equality is the single uniqueness check.
 *
 * Writer rules (create and rename both run their check + write in one
 * transaction):
 *  - create: fails if the `{account}_{slug}` doc already exists — this
 *    covers same-name, slug-alias, and renamed-away/retired-name reuse in
 *    one check, since occupied ids are never freed.
 *  - rename: fails if any OTHER bucket's `bucketSlug(name)` equals the new
 *    name's slug.
 *
 * The order ticket's bucket picker stores the bucket doc `id` on the
 * ticket (`bucketId`) — attribution seeding at fill resolves by id, not
 * by name. Rename/create to an un-slugifiable name IS a validation
 * failure (throws — the UI surfaces it), since a bucket must have a
 * usable name.
 * RETIRED buckets never match and never receive new attributions
 * (`toBucketId` may not reference one); existing attributions pointing at
 * a retired bucket stay valid — its history is preserved.
 */
export interface AllocationBucket {
  /** Composite id `{accountNumber}_{slug}` — frozen at creation. */
  id: string;
  /** Owner uid — Firestore rules scope all reads/writes to this field;
   *  list queries must filter `userId == uid` (rules cannot evaluate
   *  `resource` on queries). */
  userId: string;
  accountNumber: string;
  /** Strategy group name — display + order-ticket attribution key. */
  name: string;
  /** Percent of the account's allocation basis (broker-reported cash) this
   *  bucket may hold. Expected 0–100; the sum across buckets may exceed
   *  100 (warn-only drift state — never blocks order submission). */
  targetPct: number;
  status: BucketStatus;
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

/**
 * One audit entry per attribution change. `fromBucketId` is null on the
 * first attribution of an instrument — whether post-hoc assignment or a
 * fill-time seed from an order ticket.
 */
export interface AttributionEvent {
  fromBucketId: string | null;
  toBucketId: string;
  /** ISO timestamp of the change. */
  at: string;
}

/**
 * Per-position attribution: a bucket owns the instrument's full activity in
 * that account, including its order history. Moving a position appends an
 * AttributionEvent; analytics always recompute from the current bucketId.
 *
 * `history` is append-only, contiguous, and always non-empty — the doc is
 * only created when an attribution occurs, so its first event is the
 * initial assignment (`fromBucketId: null`). Every event continues the
 * chain (`history[i].fromBucketId === history[i-1].toBucketId`), and
 * `history[history.length - 1].toBucketId === bucketId` — the tail is the
 * current attribution. Writers must update `bucketId` and append in one
 * write. Positions with NO attribution doc are Unassigned — "Unassigned"
 * is the absence of a record, not a sentinel bucketId.
 */
export interface PositionAttribution {
  /** Composite id `{accountNumber}_{instrumentId}` — see buildAttributionId. */
  id: string;
  /** Owner uid — same rule-scoping contract as AllocationBucket.userId. */
  userId: string;
  accountNumber: string;
  instrumentId: string;
  bucketId: string;
  /**
   * Optional multi-leg grouping key — the parent `orderId` shared by every
   * leg of a spread order. Attributions that share a `linkKey` move as a
   * UNIT: a post-hoc bucket move on any leg applies atomically to all legs
   * carrying the key in the same account (a split leg would read as a
   * naked short/long in the receiving bucket and poison its P&L). The
   * unit bound is keyed legs — a leg with no attribution doc has no
   * recorded group membership until seeded or assigned with `linkKey`.
   * Absent for single-leg positions. Writers set it at seed/assign time
   * from the originating order; it never changes.
   */
  linkKey?: string;
  /** Audit trail — append-only, ordered oldest → newest. */
  history: AttributionEvent[];
  /** ISO timestamps. */
  createdAt: string;
  updatedAt: string;
}

/**
 * Computed per-bucket rollup — never persisted; produced client-side from
 * live positions + attributed order history via `computeBucketStats`
 * (`shared/portfolio-allocation-utils.ts`).
 */
export interface BucketStats {
  bucketId: string;
  /** GROSS deployed capital — Σ|marketValue|. Drift/targets compare
   *  against this, so short liabilities count toward allocation. */
  exposure: number;
  /** SIGNED position value — Σ marketValue. The reconciliation value:
   *  Σ netValue over buckets + Unassigned + Cash === account value. */
  netValue: number;
  targetDollars: number;
  /** exposure − targetDollars; positive = over target. */
  drift: number;
  realizedPnl: number;
  unrealizedPnl: number;
  openCount: number;
  closedCount: number;
  /** ISO timestamp of the live data this rollup was computed from — the
   *  as-of label the page must display (PRD Technical Context). */
  asOf: string;
  /** Cumulative P&L from attributed orders over time (approximation — no
   *  historical marks available; see PRD Technical Context). */
  equityCurve: EquityCurvePoint[];
}
