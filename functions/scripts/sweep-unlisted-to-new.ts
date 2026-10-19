/**
 * Sweep Unlisted Symbols → NEW — one-time inbox backfill.
 *
 * Scans the tracked-symbol universe (savant-trader/data/symbols) and files
 * every symbol that belongs to no EXCLUSIVE list into the user's
 * NEW inbox list. Exclusive keys are the triage buckets (NEW/PRIMARY/
 * SECONDARY/NEUTRAL/AVOID/HIDE); MONITOR and user lists are nonexclusive —
 * membership there does not count as triaged.
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
  ST_SYMBOL_LISTS_ROOT,
} from '../src/common/st-collections';

const EXCLUSIVE_KEYS = new Set(['NEW', 'PRIMARY', 'SECONDARY', 'NEUTRAL', 'AVOID', 'HIDE']);
const NEW_KEY = 'NEW';
const NEW_SYSTEM_META = { key: NEW_KEY, label: 'New symbols', order: -1, role: 'exclusive', hidden: false };

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const uidArg = args.includes('--uid') ? args[args.indexOf('--uid') + 1] : undefined;

/** Registry key for a list doc: `key` field when stamped, else the bare doc id (legacy). */
function listKey(docId: string, data: FirebaseFirestore.DocumentData): string {
  return typeof data['key'] === 'string' ? data['key'] : docId;
}

async function main(): Promise<void> {
  console.log(`=== Sweep Unlisted → ${NEW_KEY} (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===\n`);

  const [symbolsSnap, listsSnap] = await Promise.all([
    db.collection(ST_SYMBOLS_COLLECTION).get(),
    db.collection(ST_SYMBOL_LISTS_COLLECTION).get(),
  ]);

  // Universe: doc id is the symbol.
  const universe = new Set(symbolsSnap.docs.map((d) => d.id.toUpperCase()));

  // Membership: union of symbols[] across EXCLUSIVE list docs only.
  const exclusiveMembership = new Set<string>();
  const newDocCandidates: FirebaseFirestore.QueryDocumentSnapshot[] = [];
  const uids = new Set<string>();
  for (const d of listsSnap.docs) {
    const data = d.data();
    if (typeof data['userId'] === 'string') uids.add(data['userId']);
    const key = listKey(d.id, data);
    if (key === NEW_KEY) newDocCandidates.push(d);
    if (!EXCLUSIVE_KEYS.has(key)) continue;
    const members = Array.isArray(data['symbols']) ? (data['symbols'] as string[]) : [];
    for (const s of members) exclusiveMembership.add(String(s).toUpperCase());
  }

  const unlisted = [...universe].filter((s) => !exclusiveMembership.has(s)).sort();

  console.log(`Universe:        ${universe.size} symbols`);
  console.log(`List docs:       ${listsSnap.size} (${exclusiveMembership.size} symbols in exclusive lists)`);
  console.log(`Unlisted → NEW:  ${unlisted.length}`);
  if (unlisted.length) console.log(`  ${unlisted.join(' ')}\n`);

  if (!APPLY || unlisted.length === 0) {
    if (!APPLY) console.log('Dry-run only — rerun with --apply to write.');
    return;
  }

  // Target doc: --uid forces {uid}_NEW; otherwise reuse an existing NEW doc
  // (prefer a uid-scoped one over a bare legacy id); else mint {uid}_NEW
  // when exactly one uid exists across the list docs.
  let targetId: string;
  if (uidArg) {
    targetId = `${uidArg}_${NEW_KEY}`;
  } else if (newDocCandidates.length > 0) {
    const scoped = newDocCandidates.find((d) => d.data()['userId']);
    targetId = (scoped ?? newDocCandidates[0]).id;
  } else if (uids.size === 1) {
    targetId = `${[...uids][0]}_${NEW_KEY}`;
  } else {
    throw new Error(`Cannot resolve NEW doc — ${uids.size} distinct userIds in lists; pass --uid.`);
  }

  const targetRef = db.collection(ST_SYMBOL_LISTS_COLLECTION).doc(targetId);
  const existing = await targetRef.get();
  const userId = uidArg ?? existing.data()?.['userId'] ?? [...uids][0];

  // #1008 soak: dual-write legacy + st-symbol-lists in one batch — FE
  // still reads legacy, BE reads canonical.
  const doc = {
    ...(existing.exists ? {} : NEW_SYSTEM_META),
    key: NEW_KEY,
    symbols: FieldValue.arrayUnion(...unlisted),
    userId,
    updatedAt: FieldValue.serverTimestamp(),
    ...(existing.exists ? {} : { createdAt: FieldValue.serverTimestamp() }),
  };
  const batch = db.batch();
  batch.set(targetRef, doc, { merge: true });
  batch.set(db.collection(ST_SYMBOL_LISTS_ROOT).doc(targetId), doc, { merge: true });
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
