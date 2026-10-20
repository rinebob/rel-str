/**
 * Sweep Unlisted Symbols → NEW — one-time inbox backfill (#1011).
 *
 * Scans the tracked-symbol universe and files every symbol that
 * belongs to no EXCLUSIVE list into the user's NEW inbox list.
 * Exclusive keys are the triage buckets (NEW/PRIMARY/SECONDARY/
 * NEUTRAL/AVOID/HIDE); MONITOR and user lists are nonexclusive —
 * membership there does not count as triaged.
 *
 * Both roots are read for membership AND the universe (legacy
 * `savant-trader/data/*` + canonical `st-*`) so drift between roots
 * can't mis-file a symbol. Writes are dual and per-leg: each root's
 * payload is built from that root's own doc state, so a doc existing
 * in only one leg gets meta+createdAt minted there and a union-only
 * update in the other.
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/sweep-unlisted-to-new.ts              # dry-run: print the diff
 *   npx tsx scripts/sweep-unlisted-to-new.ts --apply      # write the NEW doc
 *   npx tsx scripts/sweep-unlisted-to-new.ts --uid <uid>  # force target {uid}_NEW
 *
 * Prerequisites:
 *   - Application Default Credentials with prod Firestore access:
 *       gcloud auth application-default login
 *     or set GOOGLE_APPLICATION_CREDENTIALS to a service account JSON key.
 *   - Do NOT set FUNCTIONS_EMULATOR=true (this targets prod).
 */
import { db, FieldValue } from '../src/firebase-admin-init';
import {
  ST_SYMBOLS_COLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
  ST_SYMBOLS_ROOT,
  ST_SYMBOL_LISTS_ROOT,
} from '../src/common/st-collections';
import {
  buildNewListDoc,
  computeUnlisted,
  enabledSymbolIds,
  listKeyOf,
  NEW_LIST_KEY,
  resolveNewListTarget,
  summarizeListDocs,
} from '../src/common/st-new-list-sweep';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const uidFlagIdx = args.indexOf('--uid');
const uidArg = uidFlagIdx >= 0 ? args[uidFlagIdx + 1] : undefined;
if (uidFlagIdx >= 0 && (uidArg === undefined || !/^\S+$/.test(uidArg) || uidArg.startsWith('--'))) {
  console.error('usage: --uid <uid> requires a non-empty uid value');
  process.exit(1);
}

async function main(): Promise<void> {
  console.log(`=== Sweep Unlisted → ${NEW_LIST_KEY} (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const [legacySyms, canonSyms, legacyLists, canonLists] = await Promise.all([
    db.collection(ST_SYMBOLS_COLLECTION).select('enabled').get(),
    db.collection(ST_SYMBOLS_ROOT).select('enabled').get(),
    db.collection(ST_SYMBOL_LISTS_COLLECTION).get(),
    db.collection(ST_SYMBOL_LISTS_ROOT).get(),
  ]);

  // Universe: doc id is the symbol, union of both roots.
  const universe = enabledSymbolIds([...legacySyms.docs, ...canonSyms.docs]);

  const { members, newDocIds, uids } = summarizeListDocs([
    ...legacyLists.docs,
    ...canonLists.docs,
  ]);
  const unlisted = computeUnlisted(universe, members);

  console.log(`Universe:        ${universe.size} symbols (legacy ${legacySyms.size} + canonical ${canonSyms.size})`);
  console.log(`List docs:       ${legacyLists.size + canonLists.size} (${members.size} symbols in exclusive lists)`);
  console.log(`Unlisted → NEW:  ${unlisted.length}`);
  if (unlisted.length) console.log(`  ${unlisted.join(' ')}\n`);

  if (unlisted.length === 0) {
    console.log(APPLY ? 'Nothing to write.' : 'Dry-run only — rerun with --apply to write.');
    return;
  }

  const targetId = resolveNewListTarget({ uidArg, newDocIds, uids });
  console.log(`Target doc:      ${targetId}`);
  if (!APPLY) {
    console.log('Dry-run only — rerun with --apply to write.');
    return;
  }

  const legacyRef = db.collection(ST_SYMBOL_LISTS_COLLECTION).doc(targetId);
  const canonRef = db.collection(ST_SYMBOL_LISTS_ROOT).doc(targetId);
  const [legacyDoc, canonDoc] = await Promise.all([legacyRef.get(), canonRef.get()]);

  // --uid is a force flag; refusing to repurpose a non-NEW doc keeps it
  // from hijacking `key:'NEW'` onto a user list.
  for (const leg of [legacyDoc, canonDoc]) {
    if (leg.exists && listKeyOf(leg.id, leg.data()!) !== NEW_LIST_KEY) {
      throw new Error(
        `--uid target ${targetId} exists but is not a NEW list (key=${listKeyOf(leg.id, leg.data()!)})`,
      );
    }
  }

  // Owner attribution: --uid → the doc's own userId (either leg) → the
  // target's id prefix (`u1_NEW` owns u1 — better than a cross-uid
  // guess) → a single-uid store. Multi-uid ambiguity stays
  // unattributed rather than stamping a guessed owner (a userId on a
  // shared doc changes who can see it).
  const str = (v: unknown): string | undefined =>
    typeof v === 'string' && v !== '' ? v : undefined;
  const targetPrefixUid = targetId.endsWith(`_${NEW_LIST_KEY}`)
    ? targetId.slice(0, targetId.length - NEW_LIST_KEY.length - 1)
    : undefined;
  const userId =
    uidArg ??
    str(legacyDoc.data()?.['userId']) ??
    str(canonDoc.data()?.['userId']) ??
    targetPrefixUid ??
    (uids.size === 1 ? [...uids][0] : undefined);

  // Both legs are written even though symbolListsMirror will overwrite
  // canonical with the legacy image moments later (soak-window design):
  // where the mirror agrees this is a no-op, and where it's down the
  // canonical leg still lands. Canonical-only divergent members are
  // sacrificed by the mirror either way — they resurface as unlisted.
  const batch = db.batch();
  batch.set(
    legacyRef,
    buildNewListDoc({
      fieldValue: FieldValue,
      existing: legacyDoc.exists ? legacyDoc.data() : undefined,
      unlisted,
      userId,
    }),
    { merge: true },
  );
  batch.set(
    canonRef,
    buildNewListDoc({
      fieldValue: FieldValue,
      existing: canonDoc.exists ? canonDoc.data() : undefined,
      unlisted,
      userId,
    }),
    { merge: true },
  );
  await batch.commit();
  console.log(
    `Wrote ${unlisted.length} symbols to ${ST_SYMBOL_LISTS_COLLECTION}/${targetId}` +
      ` + ${ST_SYMBOL_LISTS_ROOT}/${targetId}`,
  );
}

main().catch((e) => {
  console.error('Sweep failed:', e);
  process.exit(1);
});
