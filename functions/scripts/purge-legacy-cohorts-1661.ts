/**
 * @topic #984 — ST Firestore Reorg (task #1661)
 *
 * One-shot drain of the legacy `paper-trading` root — the last legacy leg
 * of the paper-trading tree. Cohorts were dual-written to
 * `st-position-groups` since #1004; #1661 cut the code over so the group
 * doc is the only fan-out anchor.
 *
 *   cohort-{YYMMDD}-{SYM}-{NN}   →   {SYM}-{YYMMDD}-grp-{NN}
 *
 * Steps:
 *   1. Enumerate `paper-trading/cohorts/items` — report each doc and its
 *      mapped group id; flag any whose `st-position-groups` doc is absent.
 *   2. Enumerate `st-paper-trading/trades/items` docs carrying `cohortId` —
 *      trades without `positionGroupId` form the backfill set; every
 *      carrying trade loses the deprecated field at apply-time.
 *   3. --apply (refused while any cohort maps to a missing group doc or
 *      any id is unmappable):
 *      a. stamp `positionGroupId` + DELETE `cohortId` on backfill trades;
 *         DELETE `cohortId` on already-stamped trades,
 *      b. delete every cohort doc,
 *      c. delete frozen `stats-cohort-{YYMMDD}-{SYM}-{NN}` scope docs —
 *         the old cohort-id scope format stops recomputing at cutover
 *         (new scopes carry the `grp-{NN}` id),
 *      d. delete any real `paper-trading` anchor docs,
 *      e. re-verify the `paper-trading` root has no remaining anchors.
 *
 * Default is DRY-RUN — pass --apply to mutate. Run ONLY AFTER the deploy
 * that removes the cohort readers/writers lands; otherwise the nightly
 * accept path re-writes the docs.
 *
 *   cd functions
 *   npx tsx scripts/purge-legacy-cohorts-1661.ts          # dry-run
 *   npx tsx scripts/purge-legacy-cohorts-1661.ts --apply
 *
 * Prerequisites: ADC with prod Firestore access; do NOT set
 * FUNCTIONS_EMULATOR=true.
 */
import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../src/firebase-admin-init';
import { cohortIdToGroupId } from '../../shared/paper-trading-ids';

const LEGACY_ROOT = 'paper-trading';
const COHORTS = `${LEGACY_ROOT}/cohorts/items`;
const TRADES = 'st-paper-trading/trades/items';
const GROUPS = 'st-position-groups';
const STATS = 'st-paper-trading/stats/items';
/** Old-format scope docs: `stats-cohort-{YYMMDD}-{SYM}-{NN}` — the scope
 *  builder skipped double-prefixing cohort ids, so the old doc id starts
 *  `stats-cohort-{YYMMDD}-`. New group scopes read
 *  `stats-cohort-{SYM}-{YYMMDD}-grp-{NN}` (grp-suffixed). */
const GHOST_SCOPE_RE = /^stats-cohort-\d{6}-/;
const APPLY = process.argv.includes('--apply');
const BATCH = 400;

async function main() {
  // ── 1. cohort docs → group parity ──────────────────────────────────────
  const cohortSnap = await db.collection(COHORTS).get();
  console.log(`${cohortSnap.size} cohort docs under ${COHORTS}`);
  const groupChecks = await Promise.all(
    cohortSnap.docs.map(async (d) => {
      const gid = cohortIdToGroupId(d.id);
      const snap = gid ? await db.doc(`${GROUPS}/${gid}`).get() : null;
      return {
        id: d.id,
        gid,
        exists: !!snap?.exists,
        memberTradeIds: (snap?.data()?.memberTradeIds as string[] | undefined) ?? [],
      };
    }),
  );
  for (const c of groupChecks) {
    const tag = c.exists ? 'OK  ' : 'WARN';
    console.log(`  ${tag} ${c.id} → ${c.gid ?? '(unmappable)'}${c.exists ? '' : ' — group missing'}`);
  }
  const unmappable = groupChecks.filter((c) => !c.gid);
  const missingGroup = groupChecks.filter((c) => c.gid && !c.exists);

  // ── 2. trades needing the positionGroupId backfill ─────────────────────
  const tradeSnap = await db.collection(TRADES).where('cohortId', '!=', null).get();
  const needs = tradeSnap.docs.filter((d) => {
    const t = d.data() as { cohortId?: string; positionGroupId?: string };
    return t.cohortId && !t.positionGroupId;
  });
  console.log(`${tradeSnap.size} trades carry cohortId — ${needs.length} lack positionGroupId`);
  const unmappableTrades = needs.filter((d) => !cohortIdToGroupId(d.data().cohortId as string));
  if (unmappableTrades.length) {
    console.log(`  WARN ${unmappableTrades.length} trades carry unmappable cohort ids`);
    unmappableTrades.forEach((d) => console.log(`    ${d.id} → ${d.data().cohortId}`));
  }

  // Stamped coverage check: a backfill trade whose target group exists
  // but does NOT list it in memberTradeIds is a membership hole — heal it
  // with arrayUnion at apply-time (#1004 parity verified exactly this).
  const groupByGid = new Map(groupChecks.filter((c) => c.exists).map((c) => [c.gid!, c]));
  const unlisted = needs.filter((d) => {
    const g = groupByGid.get(cohortIdToGroupId(d.data().cohortId as string) ?? '');
    return !!g && !g.memberTradeIds.includes(d.id);
  });
  console.log(`${unlisted.length} backfill trades missing from their group's memberTradeIds`);

  // ── 3. frozen ghost stats scopes (old `cohort-cohort-*` ids) ───────────
  const ghostSnap = await db.collection(STATS).get();
  const ghosts = ghostSnap.docs.filter((d) => GHOST_SCOPE_RE.test(d.id));
  console.log(`${ghosts.length} frozen old-format stats-cohort-{YYMMDD}-* docs (pre-cutover scope ids)`);

  if (!APPLY) {
    console.log('dry-run — pass --apply to backfill + delete');
    process.exit(missingGroup.length + unmappable.length > 0 ? 1 : 0);
  }
  if (unmappable.length || unmappableTrades.length) {
    console.error('unmappable ids present — refusing to mutate; fix ids first');
    process.exit(1);
  }
  if (missingGroup.length) {
    console.error(
      `${missingGroup.length} cohorts map to missing st-position-groups docs — ` +
        'refusing to stamp dangling ids; rebuild the groups first',
    );
    process.exit(1);
  }

  let batch = db.batch();
  let pending = 0;
  const flush = async () => {
    if (pending > 0) { await batch.commit(); batch = db.batch(); pending = 0; }
  };

  // ── 4a. backfill + strip: every cohortId-carrying trade loses the field ─
  let stamped = 0, stripped = 0;
  for (const d of tradeSnap.docs) {
    const hasGroup = !!(d.data() as { positionGroupId?: string }).positionGroupId;
    if (hasGroup) {
      // Already migrated — just strip the deprecated field.
      batch.update(d.ref, { cohortId: FieldValue.delete() });
      stripped++;
    } else {
      const gid = cohortIdToGroupId(d.data().cohortId as string);
      if (!gid) continue;
      batch.update(d.ref, {
        positionGroupId: gid,
        cohortId: FieldValue.delete(),
      });
      stamped++;
    }
    pending++;
    if (pending >= BATCH) await flush();
  }
  await flush();
  console.log(`backfilled positionGroupId on ${stamped} trades; stripped cohortId on ${stamped + stripped} trades`);

  // ── 4a-ii. heal stamped-but-unlisted members into their groups ────────
  let healed = 0;
  for (const d of unlisted) {
    const gid = cohortIdToGroupId(d.data().cohortId as string)!;
    batch.update(db.doc(`${GROUPS}/${gid}`), {
      memberTradeIds: FieldValue.arrayUnion(d.id),
    });
    healed++; pending++;
    if (pending >= BATCH) await flush();
  }
  await flush();
  if (healed) console.log(`added ${healed} stamped trades to their groups' memberTradeIds`);

  // ── 4b. delete the cohort docs + ghost stats scopes ────────────────────
  for (const d of [...cohortSnap.docs, ...ghosts]) {
    batch.delete(d.ref);
    pending++;
    if (pending >= BATCH) await flush();
  }
  await flush();
  console.log(`deleted ${cohortSnap.size} cohort docs + ${ghosts.length} ghost stats docs`);

  // ── 4c. delete any real anchor docs under the legacy root ──────────────
  const anchors = await db.collection(LEGACY_ROOT).listDocuments();
  for (const ref of anchors) {
    await ref.delete();
    console.log(`deleted anchor doc ${ref.path}`);
  }

  // ── 5. verify the paper-trading root is empty ──────────────────────────
  const survivors = await db.collection(COHORTS).limit(1).get();
  const remaining = await db.collection(LEGACY_ROOT).listDocuments();
  console.log(
    survivors.empty && remaining.length === 0
      ? `Done — ${stamped} backfilled, ${stamped + stripped} cohortId fields stripped, ${cohortSnap.size} cohorts + ${ghosts.length} ghosts + ${anchors.length} anchors deleted; paper-trading root is empty.`
      : `STRAGGLERS — cohorts empty=${survivors.empty}, ${remaining.length} anchor docs remain under paper-trading`,
  );
  process.exit(survivors.empty && remaining.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
