/**
 * @topic #619 — GitHub read-only issue UI (task #1695 / Blueprint #1694)
 *
 * Issue-number → Topic-root map. Persisted as a single Firestore doc per
 * supported repo so `getLifecycleTopicIndex` can emit the whole map
 * inside its response — a digit query then resolves any issue number to
 * its topic without a second network call, and the lazy per-topic fetch
 * stays the only tree read.
 *
 * Doc: `gh-lifecycle-issue-map/{owner}-{repo}` → `{ entries: {<n>: <root>}, updatedAt }`.
 * Maintenance: every `getLifecycleTopicTree` response upserts the fetched
 * subtree and deletes entries that point at this root but no longer sit
 * in it (reparents/deletes self-heal). `resolveLifecycleIssue` upserts
 * resolved chains; the seed script populates it from the monolith walk.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { FieldValue } from 'firebase-admin/firestore';

import type { SupportedRepo } from './config';
import type { LifecycleFetchResult } from './lifecycle-fetch';

export const ISSUE_MAP_COLLECTION = 'gh-lifecycle-issue-map';

export function mapDocId(entry: SupportedRepo): string {
  return `${entry.owner}-${entry.repo}`;
}

/** Every issue number in a fetch result → its topic root number. The
 *  roots map to themselves so a topic's own number resolves without a
 *  special case. */
export function buildTreeIssueMap(data: LifecycleFetchResult): Record<number, number> {
  const map: Record<number, number> = {};
  const seen = new Set<number>();
  for (const root of data.roots) {
    const walk = (n: number): void => {
      if (seen.has(n)) return;
      seen.add(n);
      map[n] = root.number;
      for (const child of data.childrenOf.get(n) ?? []) walk(child.number);
    };
    walk(root.number);
  }
  return map;
}

/** Entries in `stored` that point at `root` but whose number isn't in the
 *  live tree — reparented or deleted issues whose entries would strand
 *  the FE on the wrong topic. The root itself is always in the tree. */
export function staleMapDeletions(
  stored: Record<number, number>,
  liveTreeNumbers: ReadonlySet<number>,
  root: number,
): number[] {
  return Object.keys(stored)
    .map(Number)
    .filter(n => stored[n] === root && !liveTreeNumbers.has(n));
}

/** Parse the nested `entries` field off a doc snapshot — shared by the
 *  plain read and the transactional sync so both coerce identically. */
function parseMapEntries(data: unknown): Record<number, number> {
  const entries = (data as { entries?: unknown } | undefined)?.entries;
  if (!entries || typeof entries !== 'object') return {};
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(entries)) {
    const n = Number(k);
    if (Number.isSafeInteger(n) && Number.isSafeInteger(v)) out[n] = v;
  }
  return out;
}

/** Read the map doc; absent doc or missing entries → `{}`. */
export async function readIssueMap(
  db: Firestore,
  entry: SupportedRepo,
): Promise<Record<number, number>> {
  const snap = await db.collection(ISSUE_MAP_COLLECTION).doc(mapDocId(entry)).get();
  return parseMapEntries(snap.data());
}

/** Upsert entries into the map doc (merge — unrelated roots untouched).
 *  Entries go in a nested `entries` object: set+merge merges nested maps
 *  field-by-field, while dotted top-level keys would be written as
 *  literal field names containing a dot (verified — first seed pass). */
export async function upsertIssueMapEntries(
  db: Firestore,
  entry: SupportedRepo,
  entries: Record<number, number>,
): Promise<void> {
  const keys = Object.keys(entries);
  if (keys.length === 0) return;
  const doc = db.collection(ISSUE_MAP_COLLECTION).doc(mapDocId(entry));
  const nested: Record<string, unknown> = {};
  for (const n of keys) nested[n] = entries[Number(n)];
  await doc.set({ entries: nested, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
}

/** Tree-fetch maintenance: upsert every node → this root, and delete
 *  stored entries that point at this root but aren't in the live tree.
 *  Runs in a transaction — under the concurrent all-topics queue a
 *  stale read could otherwise delete an entry a resolver just wrote;
 *  retries recompute deletes against the latest committed state. A
 *  reparent mid-*fetch* (the GitHub snapshot already stale) can still
 *  write a wrong-root pointer transiently; the next fetch of either
 *  root heals it. Unchanged docs skip the write entirely. */
export async function syncIssueMapFromTree(
  db: Firestore,
  entry: SupportedRepo,
  data: LifecycleFetchResult,
): Promise<void> {
  const root = data.roots[0];
  if (!root) return;
  const liveNumbers = new Set(Object.keys(buildTreeIssueMap(data)).map(Number));
  const doc = db.collection(ISSUE_MAP_COLLECTION).doc(mapDocId(entry));
  await db.runTransaction(async t => {
    const stored = parseMapEntries((await t.get(doc)).data());
    const nested: Record<string, unknown> = {};
    for (const n of liveNumbers) {
      if (stored[n] !== root.number) nested[n] = root.number;
    }
    for (const n of staleMapDeletions(stored, liveNumbers, root.number)) {
      nested[n] = FieldValue.delete();
    }
    if (Object.keys(nested).length === 0) return;
    t.set(doc, { entries: nested, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  });
}
