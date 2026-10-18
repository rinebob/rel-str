/**
 * @topic #984 — ST Firestore Reorg
 *
 * Small Firestore helpers shared by the canonical writers (#1002 tickets,
 * #1004 position groups) and the migration scripts — single copy so the
 * error-code sniff and the ordered set-union don't drift apart.
 */

/** Firestore's ALREADY_EXISTS — the create()-collision signal used for
 *  deterministic-id idempotency and seq allocation. */
export function isAlreadyExists(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  return code === 6 || code === 'already-exists' || code === 'ALREADY_EXISTS';
}

/** Ordered set-union — existing order preserved, unseen ids appended. */
export function unionIds(existing: string[], incoming?: string[]): string[] {
  if (!incoming?.length) return existing;
  const seen = new Set(existing);
  return [...existing, ...incoming.filter((id) => !seen.has(id))];
}
