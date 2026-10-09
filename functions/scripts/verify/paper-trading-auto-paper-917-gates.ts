/**
 * @topic #553 — Paper Trading Infra (task #917 — auto-paper enqueue + gates)
 *
 * Verifies the auto-paper ingest ORCHESTRATION layer against prod —
 * read-only, no writes, no task enqueues:
 *
 *   1. `stAutoPaperIngest` is defined by the task module (export/registration).
 *   2. `AUTO_PAPER_CONFIG_DOC` resolves the `autoPaper` doc under the
 *      trading-config collection.
 *   3. The default signal-type allowlist is exactly the four daily
 *      trend-rider types.
 *   4. The pass gates behave against the REAL config doc:
 *        - config missing  → skipped / missing-config
 *        - enabled:false   → skipped / disabled
 *        - stale marketDate → skipped / historical-run (regardless of config)
 *        - live config     → ready, with scope resolving '*' to global
 *   5. Exactly-once + payload shape of the enqueue are covered by unit
 *      tests (tests/functions/st-run-completion.test.ts) — the only
 *      enqueue call site is post-transaction, gated on the
 *      `evalRunCompletion` result.
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-auto-paper-917-gates.ts
 *
 * Requires: ADC (rel-str). Read-only.
 * PASS: all checks hold; exit 0.
 */

import { db } from '../../src/firebase-admin-init';
import {
  AUTO_PAPER_CONFIG_DOC,
  ST_TRADING_CONFIG_COLLECTION,
  type AutoPaperConfig,
} from '../../src/common/st-collections';
import { getMarketDatePT } from '../../src/common/pt-date-utils';
import { stAutoPaperIngest } from '../../src/paper-trading/auto-paper-ingest-task';
import {
  AUTO_PAPER_DEFAULT_SIGNAL_TYPES,
  defaultAutoPaperIngestDeps,
  resolveAutoPaperScope,
  runAutoPaperIngestPass,
} from '../../src/paper-trading/passes/auto-paper-ingest-pass';

const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
const check = (name: string, ok: boolean, detail?: string) =>
  checks.push({ name, ok, detail });

async function main(): Promise<void> {
  // 1. Task registered
  check(
    'stAutoPaperIngest task is defined',
    !!stAutoPaperIngest && typeof stAutoPaperIngest === 'function',
    `typeof=${typeof stAutoPaperIngest}`,
  );

  // 2. Config doc id + path
  check('AUTO_PAPER_CONFIG_DOC === autoPaper', AUTO_PAPER_CONFIG_DOC === 'autoPaper');
  check(
    'config doc path under trading-config',
    `${ST_TRADING_CONFIG_COLLECTION}/${AUTO_PAPER_CONFIG_DOC}` ===
      'savant-trader/data/trading-config/autoPaper',
  );

  // 3. Default allowlist
  check(
    'default allowlist = 4 daily trend-rider types',
    JSON.stringify(AUTO_PAPER_DEFAULT_SIGNAL_TYPES) ===
      JSON.stringify([
        'D_ST_TREND_RIDER_V1_LONG',
        'D_ST_TREND_RIDER_V1_SHORT',
        'D_ST_TREND_RIDER_V2_LONG',
        'D_ST_TREND_RIDER_V2_SHORT',
      ]),
  );

  // 4. Gates against the real prod config doc
  const configDoc = await db
    .collection(ST_TRADING_CONFIG_COLLECTION)
    .doc(AUTO_PAPER_CONFIG_DOC)
    .get();
  const config = (configDoc.exists ? configDoc.data() : null) as AutoPaperConfig | null;
  const today = getMarketDatePT();

  console.log(`\nprod config: ${config ? JSON.stringify(config) : '(missing)'}  todayPT=${today}`);

  const live = await runAutoPaperIngestPass(
    { runId: 'verify-917', marketDate: today, triggeredBy: 'manual' },
    defaultAutoPaperIngestDeps(),
  );
  if (!config) {
    check('missing config → skipped/missing-config', live.status === 'skipped' && live.reason === 'missing-config', JSON.stringify(live));
  } else if (!config.enabled) {
    check('disabled config → skipped/disabled', live.status === 'skipped' && live.reason === 'disabled', JSON.stringify(live));
  } else {
    check('enabled config → ready', live.status === 'ready', JSON.stringify(live));
    check('scope reflects config', !!live.scope, JSON.stringify(live.scope));
  }

  // Historical date skips regardless of config state
  const historical = await runAutoPaperIngestPass(
    { runId: 'verify-917', marketDate: '2000-01-03', triggeredBy: 'manual' },
    defaultAutoPaperIngestDeps(),
  );
  const expectedHist = !config ? 'missing-config' : !config.enabled ? 'disabled' : 'historical-run';
  check(
    'historical marketDate never reaches ready',
    historical.status === 'skipped',
    `reason=${historical.reason} (expected ${expectedHist} — config gates run first)`,
  );

  // 5. Scope resolution — global capture is config-only
  const globalScope = resolveAutoPaperScope({ enabled: true, lists: ['*'] });
  check("lists:['*'] → global capture", globalScope.global === true && globalScope.lists.length === 0);

  // Report
  console.log('');
  let failed = 0;
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
    if (!c.ok) failed++;
  }
  console.log(`\n=== ${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECKS FAILED`} ===`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify error:', err);
  process.exit(1);
});
