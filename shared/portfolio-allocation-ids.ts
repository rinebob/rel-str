/**
 * Portfolio-allocation collection names and document ID builders
 * (Blueprint #581 / task #583).
 *
 * Layout (PRD #578, namespaced under a single `portfolio` root — the
 * anchor-doc pattern approved for `paper-trading`): one root collection
 * groups the domain, each kind occupies its own `items` subcollection with
 * composite doc ids so a single query enumerates an account's data.
 *
 *   portfolio/buckets/items/{accountNumber}_{slug}
 *   portfolio/attributions/items/{accountNumber}_{instrumentId}
 *
 * The Cash bucket is a derived view (account value − Σ bucket exposures) and
 * is never stored; bucket docs only ever hold real strategy groups.
 *
 * ID contract:
 *  - A bucket id is minted ONCE at creation from the name slug. Renaming a
 *    bucket updates `name` only — the id NEVER changes, so
 *    `PositionAttribution.bucketId` and audit `fromBucketId`/`toBucketId`
 *    references stay intact (PRD: rename preserves attributions).
 *  - Slug generation is deterministic and lossy: distinct display names can
 *    alias to the same slug (`"CSP Wheel"`, `"csp-wheel"`, `"CSP:Wheel"` →
 *    `csp-wheel`). Creation MUST check doc existence first and surface a
 *    name-conflict to the user — this builder never disambiguates.
 *  - `accountNumber` is restricted to `[A-Za-z0-9]+` (RH account numbers) so
 *    the `_` separator is unambiguous.
 *  - Bucket names compare by `bucketSlug(name)` — see AllocationBucket for
 *    the full uniqueness/retirement contract. Retiring or renaming never
 *    frees a doc id, so a slug once minted is occupied permanently.
 */

/** Collection PATH of AllocationBucket docs under the `portfolio` root. */
export const PORTFOLIO_BUCKETS_COLLECTION = 'portfolio/buckets/items';

/** Collection PATH of PositionAttribution docs under the `portfolio` root. */
export const PORTFOLIO_ATTRIBUTIONS_COLLECTION = 'portfolio/attributions/items';

const ACCOUNT_NUMBER_RE = /^[A-Za-z0-9]+$/;

function requireAccountNumber(accountNumber: string): void {
  if (!ACCOUNT_NUMBER_RE.test(accountNumber)) {
    throw new Error(`invalid account number for id: ${JSON.stringify(accountNumber)}`);
  }
}

/**
 * Normalize a bucket display name to its id slug: lowercase, ASCII-alphanumeric
 * runs kept, everything else (including non-ASCII letters) collapses to single
 * hyphens, edges trimmed. Throws when nothing survives.
 */
export function bucketSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!slug) {
    throw new Error(`bucket name produces an empty slug: ${JSON.stringify(name)}`);
  }
  return slug;
}

/**
 * Bucket doc id: `{accountNumber}_{slugifiedName}`. Minted at creation only —
 * renames do not re-derive the id. Caller is responsible for the existence
 * check (distinct names may alias to the same slug).
 */
export function buildBucketId(accountNumber: string, name: string): string {
  requireAccountNumber(accountNumber);
  return `${accountNumber}_${bucketSlug(name)}`;
}

/**
 * Attribution doc id: `{accountNumber}_{instrumentId}`. instrumentId must be
 * non-empty and contain no `/` (Firestore path-segment hazard).
 */
export function buildAttributionId(accountNumber: string, instrumentId: string): string {
  requireAccountNumber(accountNumber);
  if (!instrumentId.trim() || instrumentId.includes('/')) {
    throw new Error(`invalid instrument id for attribution id: ${JSON.stringify(instrumentId)}`);
  }
  return `${accountNumber}_${instrumentId}`;
}
