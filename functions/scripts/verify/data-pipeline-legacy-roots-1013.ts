/**
 * #1013 — read-only inventory + parity relay for the legacy roots being
 * retired in the ST Firestore Reorg (Topic #984).
 *
 * For every retiring root this reports:
 *   - doc count on the legacy side,
 *   - doc count on the canonical side (where a canonical twin exists),
 *   - legacy doc ids with NO canonical twin (exact-id check) or, for
 *     order-intents, refIds absent from st-order-tickets.
 *
 * FAIL (exit 1) when a parity-checked root would lose data on deletion —
 * i.e. a legacy doc id (or order-intent refId) with no canonical coverage.
 * Roots with no canonical twin are archive-only and reported INFO.
 *
 * Blocked roots (still live under later tasks) are reported but never
 * judged — deleting them is #1159/#1019/#1160 scope.
 *
 * Usage:
 *   cd functions
 *   npx tsx scripts/verify/data-pipeline-legacy-roots-1013.ts
 *
 * Prerequisites: ADC with prod Firestore access; do NOT set
 * FUNCTIONS_EMULATOR=true.
 */
import { db } from '../../src/firebase-admin-init';

interface Check {
  name: string;
  legacyPaths: string[];           // collection paths to enumerate
  /** Positionally paired with legacyPaths — legacyPaths[i] must be fully
   *  covered by canonicalPaths[i] (same doc ids). Renamed roots differ in
   *  every segment, so pairing is by position, never by path suffix. */
  canonicalPaths?: string[];
  refIdCanonical?: string;         // canonical collection matched by refId field
  archiveOnly?: boolean;           // no canonical twin exists by design
}

const CHECKS: Check[] = [
  {
    name: 'savant-trader/data/order-intents → st-order-tickets (refId)',
    legacyPaths: ['savant-trader/data/order-intents'],
    refIdCanonical: 'st-order-tickets',
  },
  {
    name: 'savant-trader/data/review-list',
    legacyPaths: ['savant-trader/data/review-list'],
    archiveOnly: true,
  },
  {
    name: 'savant-trader/data/status → st-config/status',
    legacyPaths: ['savant-trader/data/status'],
    archiveOnly: true, // singleton shadow — canonical doc is authoritative, id differs
  },
  {
    name: 'savant-trader/data/symbol-lists → st-symbol-lists',
    legacyPaths: ['savant-trader/data/symbol-lists'],
    canonicalPaths: ['st-symbol-lists'],
  },
  {
    name: 'savant-trader/data/occurrence-decisions',
    legacyPaths: ['savant-trader/data/occurrence-decisions'],
    archiveOnly: true, // dropped per design — ticket existence is the decision
  },
  {
    name: 'savant-trader/data/symbol-meta',
    legacyPaths: ['savant-trader/data/symbol-meta'],
    archiveOnly: true,
  },
  {
    name: 'savant-trader/data/trading-config → st-config',
    legacyPaths: ['savant-trader/data/trading-config'],
    canonicalPaths: ['st-config'],
  },
  {
    name: 'options-strategy-instances → st-strategy-instances',
    legacyPaths: ['options-strategy-instances'],
    canonicalPaths: ['st-strategy-instances'],
  },
  {
    name: 'options-strategy-positions',
    legacyPaths: ['options-strategy-positions'],
    archiveOnly: true, // drained into st-position-groups via cohort id remap — ids don't transfer
  },
  {
    name: 'options-strategy-stats',
    legacyPaths: ['options-strategy-stats'],
    archiveOnly: true,
  },
  {
    name: 'portfolio/{buckets,attributions}/items → st-portfolio',
    legacyPaths: ['portfolio/buckets/items', 'portfolio/attributions/items'],
    canonicalPaths: ['st-portfolio/buckets/items', 'st-portfolio/attributions/items'],
  },
  {
    name: 'backtest-runs → st-backtest-runs',
    legacyPaths: ['backtest-runs'],
    canonicalPaths: ['st-backtest-runs'],
  },
  {
    name: 'backtest-permutations → st-backtest-permutations',
    legacyPaths: ['backtest-permutations'],
    canonicalPaths: ['st-backtest-permutations'],
  },
  {
    name: 'paper-trading items → st-paper-trading (accounts/trades/stats/raw-quotes)',
    legacyPaths: [
      'paper-trading/accounts/items',
      'paper-trading/trades/items',
      'paper-trading/stats/items',
      'paper-trading/raw-quotes/items',
    ],
    canonicalPaths: [
      'st-paper-trading/accounts/items',
      'st-paper-trading/trades/items',
      'st-paper-trading/stats/items',
      'st-paper-trading/raw-quotes/items',
    ],
  },
  ...[
    'rh-agent-runs',
    'rh-agent-opportunities',
    'rh-agent-symbols',
    'rh-agent-triage-decisions',
    'rh-agent-occurrence-decisions',
    'rh-agent-symbol-lists',
    'rh-agent-status',
    'rh-agent-symbol-meta',
  ].map((c) => ({ name: c, legacyPaths: [c], archiveOnly: true })),
];

const BLOCKED = [
  'savant-trader/data/runs — live read/write root until #1159 (st-runs empty)',
  'savant-trader/data/symbols (+ run-ids/signal-history subcols) — live until #1019/#1159',
  'paper-trading/cohorts — live repository path',
  'paper-trading/analysis-{datasets,slices} — #1160',
  'rh-agent-credentials — live auth, permanent',
];

async function ids(colPath: string): Promise<Set<string>> {
  const snap = await db.collection(colPath).select().get();
  return new Set(snap.docs.map((d) => d.id));
}

async function main() {
  let failures = 0;

  for (const c of CHECKS) {
    const legacyIdSets: Set<string>[] = [];
    let legacyCount = 0;
    for (const p of c.legacyPaths) {
      const s = await ids(p);
      legacyIdSets.push(s);
      legacyCount += s.size;
    }

    let canonIdSets: Set<string>[] | null = null;
    if (c.canonicalPaths) {
      if (c.canonicalPaths.length !== c.legacyPaths.length) {
        console.error(`FAIL  ${c.name} — canonicalPaths not paired 1:1 with legacyPaths`);
        failures++;
        continue;
      }
      canonIdSets = [];
      for (const p of c.canonicalPaths) canonIdSets.push(await ids(p));
    }

    let refIdCanon: Set<string> | null = null;
    if (c.refIdCanonical) {
      const snap = await db.collection(c.refIdCanonical).select('refId').get();
      refIdCanon = new Set(
        snap.docs
          .map((d) => d.get('refId') as string | undefined)
          .filter((v): v is string => typeof v === 'string'),
      );
    }

    // Parity: positional path pairs — every id in legacyPaths[i] must
    // exist in canonicalPaths[i]; or refId coverage for order-intents.
    const missing: string[] = [];
    if (canonIdSets) {
      for (let i = 0; i < c.legacyPaths.length; i++) {
        for (const id of legacyIdSets[i]) {
          if (!canonIdSets[i].has(id)) missing.push(`${c.legacyPaths[i]}/${id}`);
        }
      }
    } else if (refIdCanon) {
      for (const p of c.legacyPaths) {
        const snap = await db.collection(p).select('refId').get();
        for (const d of snap.docs) {
          const refId = d.get('refId') as string | undefined;
          if (!refId || !refIdCanon.has(refId)) {
            missing.push(`${p}/${d.id} (refId ${refId ?? 'ABSENT'})`);
          }
        }
      }
    }

    const canonCount = canonIdSets?.reduce((a, s) => a + s.size, 0) ?? refIdCanon?.size;
    const status = missing.length > 0 ? 'FAIL' : c.archiveOnly ? 'ARCHIVE-ONLY' : 'OK';
    if (missing.length > 0) failures++;

    console.log(
      `${status.padEnd(12)} ${c.name}\n             legacy=${legacyCount}` +
        (canonCount !== undefined ? ` canonical=${canonCount}` : ' (no canonical twin)'),
    );
    for (const m of missing.slice(0, 20)) console.log(`               missing canonical: ${m}`);
    if (missing.length > 20) console.log(`               … +${missing.length - 20} more`);
  }

  console.log('\nBlocked roots (still live — NOT retired by this task):');
  for (const b of BLOCKED) console.log(`  - ${b}`);

  if (failures > 0) {
    console.error(`\n${failures} check(s) would LOSE data on delete — abort archive+delete until resolved.`);
    process.exit(1);
  }
  console.log('\nAll parity checks pass — archive+delete may proceed for the retiring roots.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
