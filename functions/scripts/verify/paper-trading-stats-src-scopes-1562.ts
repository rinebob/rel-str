/**
 * @topic #984 — ST Firestore Reorg (task #1562)
 *
 * Verifies the `src-{source}` stats scope family against REAL prod —
 * no stubs, no emulator:
 *
 *   1. Builder pins: statsScopeSource / buildStatsId produce the
 *      documented doc ids (src values are lowercase enums — the scope
 *      uppercases like sym-*).
 *   2. Runs the REAL generalized stats pass (prod repository + stats
 *      writer) and asserts src-* scopes appear in scopesWritten.
 *   3. Reads stats-src-{STRATEGY,SIGNAL[,MANUAL]} + stats-all back
 *      through the REAL repository getStats seam and asserts the
 *      canonical PaperStats shape (kind/scope/counts/equityCurve).
 *   4. Callable read path: getPaperStats(scope='src-STRATEGY') passes
 *      SCOPE_RE and returns the doc; the omitted-scope enumeration
 *      surfaces the src-* docs (dashboard selector substrate).
 *   5. Partition invariant: every non-CANCELLED trade lands in exactly
 *      one src-* doc, so the per-source open/closed counts must sum to
 *      the all-scope counts.
 *
 * Run:    cd functions && npx tsx scripts/verify/paper-trading-stats-src-scopes-1562.ts
 * Prereq: Application Default Credentials with Firestore access
 *         (gcloud auth application-default login). No RH OAuth needed.
 *         Writes are the real nightly recompute — idempotent, no seeded
 *         data, nothing to clean up.
 */

import {
  PaperTradingKind,
  PaperTradeSource,
  type PaperStats,
} from '../../../shared/paper-trading-contracts';
import { buildStatsId, statsScopeSource } from '../../../shared/paper-trading-ids';
import { db } from '../../src/firebase-admin-init';
import { getStats } from '../../src/paper-trading/repository';
import {
  handleGetPaperStats,
  paperReadDeps,
} from '../../src/paper-trading/read-callables';
import {
  createPaperStatsPassDeps,
  runPaperStatsPass,
} from '../../src/paper-trading/passes/paper-stats-pass';
import type { CallableRequest } from 'firebase-functions/v2/https';

const DATE = new Date().toISOString().slice(0, 10);

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const SRC_SCOPES = [
  statsScopeSource(PaperTradeSource.STRATEGY),
  statsScopeSource(PaperTradeSource.SIGNAL),
  statsScopeSource(PaperTradeSource.MANUAL),
];

async function main() {
  // ── Builder pins ──────────────────────────────────────────────────
  check('statsScopeSource(STRATEGY) → src-STRATEGY',
    statsScopeSource(PaperTradeSource.STRATEGY) === 'src-STRATEGY');
  check('buildStatsId(src-SIGNAL) → stats-src-SIGNAL',
    buildStatsId(statsScopeSource(PaperTradeSource.SIGNAL)) === 'stats-src-SIGNAL');
  check('statsScopeSource(MANUAL) → src-MANUAL',
    statsScopeSource(PaperTradeSource.MANUAL) === 'src-MANUAL');

  // ── Real pass ─────────────────────────────────────────────────────
  const summary = await runPaperStatsPass(DATE, createPaperStatsPassDeps());
  check('stats pass: no errors', summary.errors.length === 0,
    summary.errors.join('; '));
  for (const scope of ['src-STRATEGY', 'src-SIGNAL']) {
    check(`stats pass: scope ${scope} written`,
      summary.scopesWritten.includes(scope));
  }

  // ── Read back via the real repository seam ────────────────────────
  const all = await getStats(db, buildStatsId('all'));
  check('stats-all exists via getStats', !!all);

  const srcDocs = new Map<string, PaperStats>();
  for (const scope of SRC_SCOPES) {
    const doc = await getStats(db, buildStatsId(scope));
    if (!doc) {
      // A source with zero non-cancelled trades legitimately has no doc —
      // tolerated for MANUAL only; STRATEGY/SIGNAL must exist in prod.
      check(`stats-${scope} doc present`, scope === 'src-MANUAL',
        'expected doc missing for a populated source');
      continue;
    }
    srcDocs.set(scope, doc);
    check(`stats-${scope}: canonical shape`,
      doc.kind === PaperTradingKind.STATS &&
        doc.scope === scope &&
        typeof doc.openTradeCount === 'number' &&
        typeof doc.closedTradeCount === 'number' &&
        // Increment-minted docs (#1563) legitimately lack equityCurve
        // until the first nightly recompute owns them.
        (doc.equityCurve === undefined || Array.isArray(doc.equityCurve)) &&
        typeof doc.updatedAt === 'string');
  }
  check('stats-src-STRATEGY + stats-src-SIGNAL both exist',
    srcDocs.has('src-STRATEGY') && srcDocs.has('src-SIGNAL'));

  // ── Callable read path — SCOPE_RE accepts src-* + enumeration ─────
  const req = <T>(data: T) =>
    ({ data, auth: { uid: 'verify-1562', token: {} } }) as CallableRequest<T>;
  const readDeps = paperReadDeps();

  const named = await handleGetPaperStats(req({ scope: 'src-STRATEGY' }), readDeps);
  check('getPaperStats(scope=src-STRATEGY) passes SCOPE_RE + returns the doc',
    named.stats.length === 1 && named.stats[0].scope === 'src-STRATEGY',
    `got ${named.stats.length} docs`);

  const enumerated = await handleGetPaperStats(req({}), readDeps);
  const scopes = enumerated.stats.map((s) => s.scope);
  check('getPaperStats (no scope) enumerates src-* docs',
    scopes.includes('src-STRATEGY') && scopes.includes('src-SIGNAL'));

  // ── Partition invariant ───────────────────────────────────────────
  if (all) {
    let srcOpen = 0;
    let srcClosed = 0;
    for (const doc of srcDocs.values()) {
      srcOpen += doc.openTradeCount;
      srcClosed += doc.closedTradeCount;
    }
    check('src-* open counts partition stats-all open count',
      srcOpen === all.openTradeCount,
      `src sum ${srcOpen} vs all ${all.openTradeCount}`);
    check('src-* closed counts partition stats-all closed count',
      srcClosed === all.closedTradeCount,
      `src sum ${srcClosed} vs all ${all.closedTradeCount}`);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
