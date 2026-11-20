/**
 * #1566 — one-shot purge of stale legacy stats rollup docs in
 * `st-paper-trading/stats/items`.
 *
 * The legacy stats writers (`runStatsPass`, `incrementStatsOnOpen`) wrote
 * `stats-ALL` and `stats-{unprefixed-instanceId}` docs. Both writers and
 * the legacy read path were retired in #1565, but the docs they left
 * behind still enumerate through `listStats` — surfacing as ghost scopes
 * on the paper dashboard. A doc is canonical iff its scope (the id minus
 * the `stats-` prefix) satisfies `isCanonicalStatsScope` — `all` or a
 * `{inst,var,cohort,sig,sym,sigtype,dir,sector,ind,captier,sigstatus,src}-`
 * prefix. Everything else is a delete candidate.
 *
 * ⚠ Run `--apply` ONLY after the #1565 deploy removes the legacy
 * readers — the deployed `getStrategyEquityCurve` still reads the
 * legacy docs until then; deleting early blanks the combined view.
 *
 * Post-apply the script re-enumerates the items collection and fails
 * non-zero if any non-canonical doc id remains — the same set
 * `getPaperStats` (no scope) surfaces.
 *
 * Canonical-prefixed ghost docs (e.g. `stats-inst-verify-*` left by a
 * crashed verify run, or a canonical scope whose trades were all
 * deleted) are KEPT by design — this removes only the legacy-id forms.
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/purge-legacy-stats-docs-1566.ts              # dry-run: list candidates
 *   npx tsx scripts/purge-legacy-stats-docs-1566.ts --apply      # delete + verify
 *   npx tsx scripts/purge-legacy-stats-docs-1566.ts --apply --max 50   # cap deletions (rerun to continue)
 *
 * Prerequisites:
 *   - ADC with prod Firestore access (same as other scripts).
 *   - Do NOT set FUNCTIONS_EMULATOR=true.
 */
import { db } from '../src/firebase-admin-init';
import { StPaperTradingKind, stPaperTradingItemsPath } from '../../shared/st-collections';
import { isCanonicalStatsScope } from '../../shared/paper-trading-ids';

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');

// `--max N` and `--max=N` both accepted — a bare `--apply --max=50`
// must not silently become an unbounded delete.
const maxIdx = args.findIndex((a) => a === '--max' || a.startsWith('--max='));
const maxArg =
  maxIdx === -1
    ? Infinity
    : args[maxIdx].startsWith('--max=')
      ? Number(args[maxIdx].slice('--max='.length))
      : Number(args[maxIdx + 1]);

if (maxIdx !== -1 && (!Number.isFinite(maxArg) || maxArg <= 0)) {
  console.error(`--max must be a positive number, got '${args[maxIdx]}'`);
  process.exit(1);
}

const BATCH = 400;
const STATS_ITEMS = stPaperTradingItemsPath(StPaperTradingKind.STATS);

/** Doc id → scope. Doc ids are `stats-{scope}`; a non-`stats-` id is
 *  treated as its own scope — still classified, and only kept if it
 *  coincidentally reads canonical (safe direction: keep ≠ delete). */
const scopeOf = (docId: string) =>
  docId.startsWith('stats-') ? docId.slice('stats-'.length) : docId;

async function census() {
  const snap = await db.collection(STATS_ITEMS).get();
  const stale = snap.docs.filter((d) => !isCanonicalStatsScope(scopeOf(d.id)));
  return { total: snap.size, stale };
}

async function main(): Promise<void> {
  console.log(`=== Purge legacy stats docs (${APPLY ? 'APPLY' : 'DRY-RUN'}) ===`);
  console.log(`collection: ${STATS_ITEMS}\n`);

  const { total, stale } = await census();
  console.log(`${total} stats docs — ${stale.length} stale:`);
  for (const d of stale) {
    const data = d.data() as { openTradeCount?: number; closedTradeCount?: number };
    console.log(
      `  ${d.id}  open=${data.openTradeCount ?? '?'} closed=${data.closedTradeCount ?? '?'}`,
    );
  }

  if (stale.length === 0) {
    console.log('\nNothing to do — every stats doc is canonical.');
    return;
  }
  if (!APPLY) {
    console.log('\nDry-run only — rerun with --apply to delete.');
    return;
  }

  // ── apply — batch deletes under the cap, then re-enumerate ──
  let deleted = 0;
  const targets = stale.slice(0, maxArg);
  for (let i = 0; i < targets.length; i += BATCH) {
    const batch = db.batch();
    for (const d of targets.slice(i, i + BATCH)) batch.delete(d.ref);
    await batch.commit();
    deleted += Math.min(BATCH, targets.length - i);
    console.log(`deleted ${deleted}/${targets.length}`);
  }

  // A capped run leaves the untargeted remainder — expected, not a
  // failure. Anything beyond that is a real miss.
  const after = await census();
  const unexpected = after.stale.length - (stale.length - targets.length);
  if (unexpected > 0) {
    console.error(`\nFAILED — ${unexpected} non-canonical docs remain that were targeted:`);
    after.stale.forEach((d) => console.error(`  ${d.id}`));
    process.exit(1);
  }
  if (after.stale.length > 0) {
    console.log(`\nDone — ${deleted} deleted; ${after.stale.length} remain under the --max cap (rerun --apply to continue).`);
  } else {
    console.log(`\nDone — ${deleted} deleted; all ${after.total} remaining docs canonical.`);
  }
}

main().catch((err) => {
  console.error('purge crashed:', err);
  process.exit(1);
});
