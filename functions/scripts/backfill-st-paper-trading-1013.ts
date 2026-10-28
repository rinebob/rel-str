/**
 * #1013 — straggler backfill: `paper-trading/{kind}/items` →
 * `st-paper-trading/{kind}/items` for doc ids missing on the canonical
 * side (verbatim copy — #1007 renamed the path, not the shape).
 *
 * The #1007 migration + dual-write cutover left ~583 raw-quote docs
 * canonical-less (post-cutover legacy writes); the #1013 parity relay
 * lists them. This copies missing ids only — existing canonical docs are
 * never overwritten (rerunnable, no-op when parity holds).
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/backfill-st-paper-trading-1013.ts           # dry-run counts
 *   npx tsx scripts/backfill-st-paper-trading-1013.ts --apply   # write
 *
 * Prerequisites: ADC with prod Firestore access; do NOT set
 * FUNCTIONS_EMULATOR=true.
 */
import { db } from '../src/firebase-admin-init';
import { PaperTradingKind } from '@paper-trading/contracts';
import { paperTradingItemsPath } from '@paper-trading/ids';
import { stPaperTradingItemsPath } from '../src/common/st-collections';

const KINDS = [
  PaperTradingKind.ACCOUNT,
  PaperTradingKind.TRADE,
  PaperTradingKind.STATS,
  PaperTradingKind.RAW_QUOTE,
];

const APPLY = process.argv.includes('--apply');
const BATCH = 400;

async function main() {
  let totalMissing = 0;
  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) { await batch.commit(); batch = db.batch(); pending = 0; }
  };

  for (const kind of KINDS) {
    const legacyPath = paperTradingItemsPath(kind);
    const canonPath = stPaperTradingItemsPath(kind);
    const [legacySnap, canonSnap] = await Promise.all([
      db.collection(legacyPath).get(),
      db.collection(canonPath).select().get(),
    ]);
    const canonIds = new Set(canonSnap.docs.map((d) => d.id));
    const missing = legacySnap.docs.filter((d) => !canonIds.has(d.id));
    totalMissing += missing.length;
    console.log(`${kind}: legacy=${legacySnap.size} canonical=${canonSnap.size} missing=${missing.length}`);

    if (APPLY) {
      for (const d of missing) {
        batch.set(db.doc(`${canonPath}/${d.id}`), d.data());
        if (++pending >= BATCH) await flush();
      }
    }
  }
  await flush();
  console.log(
    `\n${APPLY ? 'Copied' : 'Would copy'} ${totalMissing} doc(s)` +
      (APPLY ? '' : ' — dry-run; pass --apply to write'),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
