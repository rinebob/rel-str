/**
 * Read-only parity audit for #1008 — st-config + st-symbol-lists
 * consolidation. Checks every legacy doc exists at the canonical
 * destination and content matches, with soak-direction-aware severity:
 *
 *   savant-trader/data/trading-config/{docId} → st-config/{docId}
 *     legacy→canon mirror. FE writes legacy; the mirror copies async.
 *     WARN: source-only doc or divergence — mirror lag, expected in soak.
 *     WARN: dest-only doc (mirror can't create canonical-only docs —
 *           flag anyway).
 *     `st-config/status` is excluded from this family's dest scan — it
 *     belongs to the status family below.
 *
 *   savant-trader/data/status/current → st-config/status
 *     canon→legacy mirror (BE writes canonical; FE polls legacy).
 *     Doc id renames 'current' → 'status'.
 *     FAIL: legacy 'current' with no canonical 'status' — nothing writes
 *           legacy directly, so this means the copy migration missed it.
 *     WARN: canonical-only doc or divergence — shadow lag, or the rare
 *           reverse (legacy newer) which the next canonical write heals.
 *
 *   savant-trader/data/symbol-lists/{docId} → st-symbol-lists/{docId}
 *     legacy→canon mirror + BE dual-write on the bare 'NEW' doc.
 *     WARN: source-only doc or divergence — mirror lag.
 *     WARN: dest-only doc — the dual-write lands canonical immediately,
 *           so a dest-only 'NEW' between a legacy delete and its mirror
 *           echo is normal soak drift.
 *
 * Usage (from functions/):
 *   npx tsx scripts/verify/data-pipeline-config-lists-1008.ts
 *   npx tsx scripts/verify/data-pipeline-config-lists-1008.ts --family status
 *
 * Read-only — never writes. Exit 0 on clean audit; nonzero on any FAIL.
 */
import { db } from '../../src/firebase-admin-init';
import {
  AGENT_STATUS_DOC,
  ST_CONFIG_ROOT,
  ST_CONFIG_STATUS_DOC,
  ST_STATUS_COLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
  ST_SYMBOL_LISTS_ROOT,
  ST_TRADING_CONFIG_COLLECTION,
} from '../../src/common/st-collections';
import { deepEqual } from '../../src/order-tickets/legacy-order-intents';

type Direction = 'legacy-to-canon' | 'canon-to-legacy';

interface Family {
  source: string;
  dest: string;
  dir: Direction;
  /** source doc id → dest doc id (status renames 'current' → 'status'). */
  srcToDestId?: (id: string) => string;
  /** dest ids to exclude from the dest-only scan (doc lives in a
   *  different family — st-config hosts both config docs and status). */
  destExclude?: ReadonlySet<string>;
  /** dest ids the dest-only scan is limited to — the inverse of
   *  destExclude, for a family whose one doc shares its dest root with
   *  other families (status under st-config). */
  destInclude?: ReadonlySet<string>;
}

const FAMILIES: Record<string, Family> = {
  'trading-config': {
    source: ST_TRADING_CONFIG_COLLECTION,
    dest: ST_CONFIG_ROOT,
    dir: 'legacy-to-canon',
    destExclude: new Set([ST_CONFIG_STATUS_DOC]),
  },
  status: {
    source: ST_STATUS_COLLECTION,
    dest: ST_CONFIG_ROOT,
    dir: 'canon-to-legacy',
    // Only 'current' remaps to 'status'; a stray doc id compares at its
    // own st-config/{id} path rather than overwriting 'current' in the map.
    srcToDestId: (id) => (id === AGENT_STATUS_DOC ? ST_CONFIG_STATUS_DOC : id),
    // st-config also hosts the trading-config family's docs — without a
    // dest scoping, every autoPaper/{uid} doc warns 'dest-only' forever.
    destInclude: new Set([ST_CONFIG_STATUS_DOC]),
  },
  'symbol-lists': {
    source: ST_SYMBOL_LISTS_COLLECTION,
    dest: ST_SYMBOL_LISTS_ROOT,
    dir: 'legacy-to-canon',
  },
};

const fails: string[] = [];
const warns: string[] = [];

function isoTs(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && 'toDate' in v) {
    return (v as { toDate(): Date }).toDate().toISOString();
  }
  return undefined;
}

async function auditFamily(key: string, f: Family): Promise<void> {
  const [srcSnap, dstSnap] = await Promise.all([
    db.collection(f.source).get(),
    db.collection(f.dest).get(),
  ]);
  const mapId = f.srcToDestId ?? ((id: string) => id);
  // Key the source map by DESTINATION id so lookups line up with the
  // dest map after the status doc-id rename.
  const srcByDestId = new Map(srcSnap.docs.map((d) => [mapId(d.id), d.data()]));
  const dstById = new Map(dstSnap.docs.map((d) => [d.id, d.data()]));

  let srcOnly = 0, dstOnly = 0, diverged = 0;
  for (const [destId, data] of srcByDestId) {
    const dst = dstById.get(destId);
    if (!dst) {
      srcOnly++;
      // legacy→canon: missing dest is mirror lag → WARN.
      // canon→legacy: the dest (canonical) should already hold the
      // migrated copy — nothing else writes it → FAIL.
      (f.dir === 'legacy-to-canon' ? warns : fails).push(
        `${key}/${destId}: source-only doc (no canonical counterpart)`,
      );
    } else if (!deepEqual(dst, data)) {
      diverged++;
      const srcTs = isoTs(data.updatedAt) ?? isoTs(data.lastRunAt);
      const dstTs = isoTs(dst.updatedAt) ?? isoTs(dst.lastRunAt);
      warns.push(
        `${key}/${destId}: content divergence (src=${srcTs ?? '?'} dest=${dstTs ?? '?'}) — soak drift or in-flight write`,
      );
    }
  }
  for (const id of dstById.keys()) {
    if (f.destInclude && !f.destInclude.has(id)) continue;
    if (!srcByDestId.has(id) && !f.destExclude?.has(id)) {
      dstOnly++;
      warns.push(`${key}/${id}: dest-only doc (post-migration write or drift)`);
    }
  }
  console.log(
    `  ${key}: src ${srcSnap.size} → dest ${dstSnap.size} | src-only ${srcOnly}, dest-only ${dstOnly}, diverged ${diverged}`,
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const famIdx = args.indexOf('--family');
  const family = famIdx >= 0 ? args[famIdx + 1] : undefined;
  if (famIdx >= 0 && (family === undefined || family.startsWith('--'))) {
    console.error('--family requires a value');
    process.exit(2);
  }
  if (family && !FAMILIES[family]) {
    console.error(`unknown --family '${family}'. keys: ${Object.keys(FAMILIES).join(', ')}`);
    process.exit(2);
  }
  console.log('#1008 st-config + st-symbol-lists parity audit\n');
  for (const [k, f] of Object.entries(FAMILIES)) {
    if (!family || family === k) await auditFamily(k, f);
  }
  console.log('\n— audit —');
  for (const s of fails) console.log(`  ✖ ${s}`);
  for (const s of warns) console.log(`  ⚠ ${s}`);
  console.log(`\n${fails.length} FAIL, ${warns.length} WARN`);
  process.exit(fails.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
