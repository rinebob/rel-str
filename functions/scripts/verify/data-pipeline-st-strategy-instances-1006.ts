/**
 * Read-only audit for #1006 — verifies `st-strategy-instances` and the
 * options-strategy-instances → canonical migration + repository re-point:
 *
 *   FAIL (drives exit 1):
 *   - canonical doc missing required StStrategyInstance fields:
 *     symbol/optionType/side/non-empty phases/frequency/openTimePT/
 *     exitPolicies/lifecycleState/userId/createdAt/updatedAt +
 *     mode ∈ {live,paper} + enabled boolean (paperAccountId string
 *     required when mode='paper')
 *   - a legacy doc (`options-strategy-instances` OR
 *     `paper-trading/instances/items`) with no canonical counterpart, or a
 *     counterpart whose engine fields diverge at equal `updatedAt` (unequal
 *     timestamps = soak drift → WARN, the newer doc is authoritative)
 *   - daily-analysis divergence: a legacy subcollection doc missing or
 *     content-divergent under the canonical doc; a legacy `latest` not
 *     carried over
 *   - repo seam: listRunnableInstances doesn't return the union (canonical id
 *     missing or legacy-only id dropped), or returns a non-runnable doc
 *
 *   WARN (reported, does not fail):
 *   - canonical doc with no legacy source (a post-migration UI/engine
 *     create — expected once the FE re-points in #1014)
 *   - canonical doc missing daily-analysis/latest when the legacy doc
 *     also lacked it (instance never ran a selection pass)
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-st-strategy-instances-1006.ts
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import { PaperTradingKind, paperTradingItemsPath } from '@paper-trading/ids';
import {
  LEGACY_OPTIONS_STRATEGY_INSTANCES,
  ST_STRATEGY_INSTANCES_ROOT,
} from '../../src/common/st-collections';
import { ST_MODES } from '../../../shared/st-types';
import {
  listRunnableInstances,
  STRATEGY_INSTANCE_DAILY_ANALYSIS_SUBCOLLECTION,
} from '../../src/options-strategy-engine/strategy-instance-repository';
import { LATEST_DAILY_ANALYSIS_DOC_ID } from '../../src/paper-trading/engine/pricing/overnight-simulation-writer';
import { deepEqual } from '../../src/order-tickets/legacy-order-intents';

const LEGACY_ROOT = LEGACY_OPTIONS_STRATEGY_INSTANCES;
const LEGACY_ANCHOR = paperTradingItemsPath(PaperTradingKind.INSTANCE);
const DAILY_ANALYSIS_SUB = STRATEGY_INSTANCE_DAILY_ANALYSIS_SUBCOLLECTION;
const LATEST_DOC = LATEST_DAILY_ANALYSIS_DOC_ID;

const fails: string[] = [];
const warns: string[] = [];

/** Best-effort timestamp on a daily-analysis doc (same contract as the migrator). */
function analysisTimestamp(d: Record<string, unknown>): string | undefined {
  const sim = d.overnightDeltaSimulation as { computedAt?: unknown } | undefined;
  const t = sim?.computedAt ?? d.computedAt ?? d.updatedAt;
  return typeof t === 'string' ? t : undefined;
}

/** ISO string compare — undefined sorts oldest. */
function tsNewer(a: string | undefined, b: string | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a > b;
}

/** Engine-field keys whose values must match legacy → canonical. */
const ENGINE_FIELDS = [
  'symbol', 'optionType', 'side', 'targetDelta', 'dteMin', 'dteMax',
  'phases', 'frequency', 'openTimePT', 'exitPolicies', 'lifecycleState',
  'marketRegime', 'userId', 'governingVariant', 'deltaTolerance',
  'overnightGridRangePct', 'overnightGridStepPct',
] as const;

function checkCanonicalShape(id: string, d: Record<string, unknown>): void {
  const str = (k: string) => typeof d[k] === 'string' && (d[k] as string).length > 0;
  if (!str('symbol')) fails.push(`${id}: missing/empty symbol`);
  if (!str('optionType')) fails.push(`${id}: missing optionType`);
  if (!str('side')) fails.push(`${id}: missing side`);
  if (!Array.isArray(d.phases) || d.phases.length === 0) fails.push(`${id}: malformed phases`);
  if (!str('frequency')) fails.push(`${id}: missing frequency`);
  if (!str('openTimePT')) fails.push(`${id}: missing openTimePT`);
  if (!Array.isArray(d.exitPolicies)) fails.push(`${id}: malformed exitPolicies`);
  if (!str('lifecycleState')) fails.push(`${id}: missing lifecycleState`);
  if (!str('userId')) fails.push(`${id}: missing userId`);
  if (d.createdAt === undefined) fails.push(`${id}: missing createdAt`);
  if (d.updatedAt === undefined) fails.push(`${id}: missing updatedAt`);
  if (!ST_MODES.includes(d.mode as never)) fails.push(`${id}: mode '${String(d.mode)}' ∉ {live,paper}`);
  if (typeof d.enabled !== 'boolean') fails.push(`${id}: enabled not boolean (${String(d.enabled)})`);
  if (d.mode === 'paper' && !str('paperAccountId')) {
    fails.push(`${id}: mode=paper without paperAccountId`);
  }
  if (d.id !== undefined) warns.push(`${id}: doc stores 'id' field — id lives in the path`);
  if (d.kind !== undefined) warns.push(`${id}: doc stores 'kind' — anchor-era discriminator`);
}

async function main(): Promise<void> {
  const [canonSnap, rootSnap, anchorSnap] = await Promise.all([
    db.collection(ST_STRATEGY_INSTANCES_ROOT).get(),
    db.collection(LEGACY_ROOT).get(),
    db.collection(LEGACY_ANCHOR).get(),
  ]);

  const canonById = new Map(canonSnap.docs.map((d) => [d.id, d]));
  const legacyById = new Map(
    [...rootSnap.docs, ...anchorSnap.docs].map((d) => [d.id, d]),
  );

  console.log(
    `audit — canonical ${canonSnap.size} | legacy-root ${rootSnap.size} | ` +
    `anchored ${anchorSnap.size}`,
  );

  // 1. Canonical shape.
  for (const doc of canonSnap.docs) {
    checkCanonicalShape(doc.id, doc.data() as Record<string, unknown>);
  }

  // 2. Legacy → canonical parity + daily-analysis carry-over.
  for (const [id, legacyDoc] of legacyById) {
    const canon = canonById.get(id);
    if (!canon) {
      fails.push(`${id}: legacy doc at ${legacyDoc.ref.path} has no canonical counterpart`);
      continue;
    }
    const legacy = legacyDoc.data() as Record<string, unknown>;
    const canonData = canon.data() as Record<string, unknown>;
    // Soak-window drift: during soak the FE edits the anchor and post-#1014
    // it edits canonical — the doc with the newer updatedAt is authoritative,
    // so field divergence with unequal timestamps is expected churn (WARN).
    // Equal timestamps + divergent fields = a migration defect (FAIL).
    const soakDrift =
      typeof legacy.updatedAt === 'string' &&
      typeof canonData.updatedAt === 'string' &&
      legacy.updatedAt !== canonData.updatedAt;
    for (const k of ENGINE_FIELDS) {
      if (legacy[k] !== undefined && !deepEqual(legacy[k], canonData[k])) {
        const msg = `${id}: field '${k}' diverged — legacy ${JSON.stringify(legacy[k])} vs canonical ${JSON.stringify(canonData[k])}`;
        (soakDrift ? warns : fails).push(
          soakDrift ? `${msg} (soak drift — newer updatedAt is authoritative)` : msg,
        );
      }
    }

    const [legacyDa, canonDa] = await Promise.all([
      legacyDoc.ref.collection(DAILY_ANALYSIS_SUB).get(),
      canon.ref.collection(DAILY_ANALYSIS_SUB).get(),
    ]);
    const canonDaById = new Map(canonDa.docs.map((d) => [d.id, d]));
    for (const daDoc of legacyDa.docs) {
      const target = canonDaById.get(daDoc.id);
      if (!target) {
        fails.push(`${id}: daily-analysis/${daDoc.id} not carried to canonical`);
      } else if (!deepEqual(target.data(), daDoc.data())) {
        // Nightly engine writes make canonical `latest`/date docs newer —
        // canonical-newer divergence is expected post-migration churn.
        const targetData = target.data() as Record<string, unknown>;
        if (tsNewer(analysisTimestamp(daDoc.data()), analysisTimestamp(targetData))) {
          fails.push(`${id}: daily-analysis/${daDoc.id} diverged and legacy is newer — stale canonical`);
        } else {
          warns.push(`${id}: daily-analysis/${daDoc.id} diverged — canonical newer or untimestamped (expected post-migration churn)`);
        }
      }
    }
    if (!canonDaById.has(LATEST_DOC)) {
      if (legacyDa.docs.some((d) => d.id === LATEST_DOC)) {
        fails.push(`${id}: legacy daily-analysis/latest not carried`);
      } else {
        warns.push(`${id}: no daily-analysis/latest (instance never ran a selection pass)`);
      }
    }
  }

  // 3. Canonical docs with no legacy source — post-migration creates.
  for (const id of canonById.keys()) {
    if (!legacyById.has(id)) {
      warns.push(`${id}: canonical doc has no legacy source (post-migration create)`);
    }
  }

  // 4. Repo seam — the union read the engine actually uses.
  const listed = await listRunnableInstances(db);
  const listedIds = new Set(listed.map((i) => i.id));
  for (const doc of canonSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    if (d.mode === 'paper' && d.enabled !== false && !listedIds.has(doc.id)) {
      fails.push(`${doc.id}: runnable canonical doc not returned by listRunnableInstances`);
    }
  }
  const legacyOnly = [...legacyById.keys()].filter((id) => !canonById.has(id));
  for (const id of legacyOnly) {
    if (!listedIds.has(id)) {
      fails.push(`${id}: legacy-only doc dropped by the union read`);
    }
  }
  // Exclusion sanity — a dropped runnable filter must surface.
  for (const i of listed) {
    if (i.mode !== 'paper' || i.enabled === false) {
      fails.push(`${i.id}: listRunnableInstances returned a non-runnable doc (mode=${i.mode} enabled=${i.enabled})`);
    }
  }

  console.log('\n— audit —');
  for (const f of fails) console.log(`  ✖ ${f}`);
  for (const w of warns) console.log(`  ⚠ ${w}`);
  console.log(`\n${fails.length} FAIL, ${warns.length} WARN — canonical ${canonSnap.size}, seam listed ${listed.length}`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
