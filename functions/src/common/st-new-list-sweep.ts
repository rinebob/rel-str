/**
 * st-new-list-sweep — testable core for the NEW-list backfill (#1011).
 *
 * The sweep files every tracked symbol that belongs to no EXCLUSIVE
 * list into `{uid}_NEW`. Exclusive keys are the six triage buckets;
 * MONITOR and user lists are nonexclusive — membership there doesn't
 * count as triaged. Everything here is pure of Firestore IO: the
 * script feeds snapshots in, the core classifies and resolves.
 *
 * Strictly additive by construction: `buildNewListDoc` only ever
 * produces `arrayUnion` member writes under `merge: true` — the sweep
 * has no remove path.
 */
import { DEFAULT_SYMBOL_LIST_NAME } from './st-collections';

/** The six triage buckets — a symbol in any of them is "filed".
 *  Mirrors the FE registry's `role:'exclusive'` SYSTEM_LIST_DEFS; no
 *  shared location for list keys exists today, so the set is pinned
 *  here and in symbol-list-defs.ts. */
export const EXCLUSIVE_LIST_KEYS: ReadonlySet<string> = new Set([
  'NEW',
  'PRIMARY',
  'SECONDARY',
  'NEUTRAL',
  'AVOID',
  'HIDE',
]);

/** The inbox list key — aliases st-collections' canonical constant. */
export const NEW_LIST_KEY = DEFAULT_SYMBOL_LIST_NAME;

/** Meta stamped only when the NEW doc doesn't exist yet. */
export const NEW_LIST_META = {
  key: NEW_LIST_KEY,
  label: 'New symbols',
  order: -1,
  role: 'exclusive',
  hidden: false,
} as const;

/** The slice of a list doc the sweep reads. */
export interface SymbolListDocLike {
  id: string;
  data(): { key?: unknown; name?: unknown; symbols?: unknown; userId?: unknown };
}

/** Registry key for a list doc, in the FE's resolution order:
 *  stamped `key` → legacy `name` → `{userId}_`-prefixed id suffix →
 *  bare doc id. An unstamped `u1_myteam` resolves to `myteam` (a user
 *  list — nonexclusive either way).
 *
 *  Near-parity caveat: the FE registry honors a stamped `key` only on
 *  `{viewerUid}_`-prefixed ids (symbol-list-registry.ts); we honor it
 *  unconditionally. No writer stamps `key` on a non-prefixed id, so
 *  this only diverges on corrupt docs — and honoring `key` here is the
 *  conservative direction (a `key:'NEW'` foreign doc reads as
 *  exclusive, never as unlisted). */
export function listKeyOf(
  docId: string,
  data: { key?: unknown; name?: unknown; userId?: unknown },
): string {
  if (typeof data['key'] === 'string') return data['key'];
  if (typeof data['name'] === 'string') return data['name'];
  const uid = data['userId'];
  if (typeof uid === 'string' && docId.startsWith(`${uid}_`)) {
    return docId.slice(uid.length + 1);
  }
  // An `{anything}_{EXCLUSIVE}` id carries its key in the name — the
  // FE resolves the same way for the matching viewer even when the
  // doc carries no userId field. Without this fallback an unstamped
  // `u1_PRIMARY` reads as a user list and its members get re-filed
  // into NEW (dual membership — the unsafe direction).
  for (const k of EXCLUSIVE_LIST_KEYS) {
    if (docId.endsWith(`_${k}`)) return k;
  }
  return docId;
}

/** Symbols (uppercased) appearing in ANY exclusive list, across every
 *  doc passed in — callers feed both list roots so drift can't
 *  mis-file. */
export function exclusiveMembership(
  docs: readonly SymbolListDocLike[],
): Set<string> {
  const members = new Set<string>();
  for (const doc of docs) {
    const data = doc.data();
    if (!EXCLUSIVE_LIST_KEYS.has(listKeyOf(doc.id, data))) continue;
    const symbols = Array.isArray(data['symbols']) ? data['symbols'] : [];
    for (const s of symbols) members.add(String(s).trim().toUpperCase());
  }
  return members;
}

/** Shared census across a list-doc set — membership, NEW-doc
 *  candidates, and stamped userIds. The sweep script and the verify
 *  audit both consume this so they can't drift. `newDocIds` dedupes by
 *  doc id; a doc mirrored across both roots counts once. */
export function summarizeListDocs(docs: readonly SymbolListDocLike[]): {
  members: Set<string>;
  newDocIds: string[];
  uids: Set<string>;
} {
  const newDocIds = [
    ...new Set(
      docs
        .filter((d) => listKeyOf(d.id, d.data()) === NEW_LIST_KEY)
        .map((d) => d.id),
    ),
  ];
  const uids = new Set(
    docs
      .map((d) => d.data()['userId'])
      .filter((u): u is string => typeof u === 'string'),
  );
  return { members: exclusiveMembership(docs), newDocIds, uids };
}

/** Enabled symbol-doc ids (uppercased) — the sweep's universe. A doc
 *  with `enabled === false` is retired, not tracked; a missing field
 *  counts as enabled (the missed-add direction is safe). Shared by the
 *  script and the verify audit so the universe can't drift. */
export function enabledSymbolIds(
  docs: readonly { id: string; data(): { enabled?: unknown } }[],
): Set<string> {
  return new Set(
    docs
      .filter((d) => d.data()['enabled'] !== false)
      .map((d) => d.id.trim().toUpperCase()),
  );
}

/** Universe symbols with no exclusive membership, sorted. */
export function computeUnlisted(
  universe: ReadonlySet<string>,
  exclusiveMembers: ReadonlySet<string>,
): string[] {
  return [...universe]
    .filter((s) => !exclusiveMembers.has(s))
    .sort();
}

/** Which doc id the unlisted symbols land in.
 *  - `uidArg` (--uid) always wins → `{uid}_NEW`.
 *  - Else the single existing NEW doc.
 *  - Else mint `{uid}_NEW` when exactly one uid exists across lists.
 *  - Ambiguous uids with no NEW doc → error (pass --uid). */
export function resolveNewListTarget(args: {
  uidArg?: string;
  newDocIds: readonly string[];
  uids: ReadonlySet<string>;
}): string {
  const { uidArg, newDocIds, uids } = args;
  if (uidArg) return `${uidArg}_${NEW_LIST_KEY}`;
  if (newDocIds.length > 1) {
    throw new Error(
      `Cannot resolve NEW doc — ${newDocIds.length} NEW docs exist (${newDocIds.join(', ')}); pass --uid.`,
    );
  }
  if (newDocIds.length === 1) return newDocIds[0];
  if (uids.size === 1) return `${[...uids][0]}_${NEW_LIST_KEY}`;
  throw new Error(
    `Cannot resolve NEW doc — ${uids.size} distinct userIds in lists; pass --uid.`,
  );
}

/** FieldValue subset the payload needs — injected so tests record it. */
export interface NewListFieldValue {
  arrayUnion(...elements: unknown[]): unknown;
  serverTimestamp(): unknown;
}

/** The `set(merge)` payload for the NEW doc. `existing` is the leg's
 *  own data (`undefined` when the doc doesn't exist in that leg):
 *  - no doc → full meta + createdAt are minted;
 *  - doc exists fully stamped (key + role) → union + userId + updatedAt
 *    only, existing meta untouched;
 *  - doc exists but lacks stamped `key`/`role` (a `{name}`-era or
 *    suffix-resolved NEW doc) → full meta re-stamped, but NOT
 *    createdAt. Stamping `key` without `role` would flip the FE to
 *    nonexclusive and un-triage the doc's members — meta is all-or-
 *    nothing below the doc level.
 *
 *  `key` itself is emitted unconditionally: it's the load-bearing
 *  stamp that keeps the doc inside `where('key','==','NEW')` scope
 *  queries even on pre-registry docs. `arrayUnion` is what makes the
 *  sweep strictly additive: removed/duplicate members can't be
 *  produced. */
export function buildNewListDoc(args: {
  fieldValue: NewListFieldValue;
  existing: { key?: unknown; role?: unknown; [field: string]: unknown } | undefined;
  unlisted: readonly string[];
  userId: string | undefined;
}): Record<string, unknown> {
  const { fieldValue, existing, unlisted, userId } = args;
  const needsMeta =
    existing === undefined ||
    existing.key === undefined ||
    existing.role === undefined;
  return {
    ...(needsMeta ? NEW_LIST_META : {}),
    key: NEW_LIST_KEY,
    symbols: fieldValue.arrayUnion(...unlisted),
    ...(userId !== undefined ? { userId } : {}),
    updatedAt: fieldValue.serverTimestamp(),
    ...(existing === undefined ? { createdAt: fieldValue.serverTimestamp() } : {}),
  };
}
