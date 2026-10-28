/**
 * @topic #984 — ST Firestore Reorg (task #1013)
 *
 * Legacy-roots retirement pin — deployed-code scan asserting every root
 * scheduled for deletion in #1013 has ZERO code references left in
 * functions/src. A stray reference fails here, not at delete-script time
 * (deleting a collection a deployed trigger still mirrors propagates the
 * delete into canonical — the mirror-undeploy ordering depends on this
 * pin holding).
 *
 * Two classes:
 * - Legacy collection literals — must appear NOWHERE in functions/src.
 * - Mirror/trigger identifiers — the soak triggers must be undeployed
 *   before their legacy source roots can be deleted (delete propagation
 *   would cascade into st-*).
 *
 * Still-allowed roots (blocked by later tasks) are NOT scanned here:
 *   savant-trader/data/symbols + run-ids/signal-history (#1019 — the legacy
 *   parent still hosts live subcollection reads/writes),
 *   paper-trading/{cohorts,analysis-*} (#1160), rh-agent-credentials (live
 *   auth, permanent), positions.
 * #1159 added savant-trader/data/runs to the forbidden list (root deleted
 * wholesale; jobs TTL now sweeps st-runs only).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const SRC_ROOT = join(REPO_ROOT, 'functions', 'src');

/** Deployed-code scan radius — every .ts under functions/src. Ops scripts
 *  (functions/scripts) are historical artifacts, not deployed code. */
function* tsFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) yield* tsFiles(p);
    else if (entry.endsWith('.ts')) yield p;
  }
}

const hits = (needle: string): string[] => {
  const out: string[] = [];
  for (const f of tsFiles(SRC_ROOT)) {
    if (readFileSync(f, 'utf8').includes(needle)) {
      out.push(f.slice(SRC_ROOT.length + 1));
    }
  }
  return out;
};

// Legacy collection literals that must not survive #1013 — quoted so
// 'backtest-runs' can't false-positive inside 'st-backtest-runs'.
const FORBIDDEN_COLLECTION_LITERALS = [
  `'savant-trader/data/order-intents'`,
  `'savant-trader/data/review-list'`,
  `'savant-trader/data/occurrence-decisions'`,
  `'savant-trader/data/status'`,
  `'savant-trader/data/symbol-lists'`,
  `'savant-trader/data/symbol-meta'`,
  `'savant-trader/data/trading-config'`,
  // #1159 — runs root retired (migrated to st-runs). ST_RUNS_COLLECTION is
  // not needle-able (substring of BACKTEST_RUNS_COLLECTION) but the
  // constant is deleted — any re-add fails tsc, not just this pin.
  `'savant-trader/data/runs'`,
  `'options-strategy-instances'`,
  `'options-strategy-positions'`,
  `'options-strategy-stats'`,
  `'rh-agent-runs'`,
  `'rh-agent-opportunities'`,
  `'rh-agent-symbols'`,
  `'rh-agent-triage-decisions'`,
  `'rh-agent-occurrence-decisions'`,
  `'rh-agent-symbol-lists'`,
  `'rh-agent-symbol-meta'`,
  `'rh-agent-status'`,
  `'backtest-runs'`,
  `'backtest-permutations'`,
  // Anchored legs — leading quote keeps 'st-portfolio/' and
  // 'st-paper-trading/' from matching.
  `'portfolio/`,
  `'paper-trading/accounts`,
  `'paper-trading/trades`,
  `'paper-trading/stats`,
  `'paper-trading/raw-quotes`,
  `'paper-trading/instances`,
];

// Deprecated constants + mirror/trigger identifiers — removal is what
// undeploys the delete-propagating triggers.
const FORBIDDEN_IDENTIFIERS = [
  'ST_ORDER_INTENTS_COLLECTION',
  'ST_TRADING_CONFIG_COLLECTION',
  'ST_SYMBOL_LISTS_COLLECTION',
  'ST_STATUS_COLLECTION',
  'AGENT_STATUS_DOC',
  'LEGACY_OPTIONS_STRATEGY_INSTANCES',
  'LEGACY_PORTFOLIO_ROOT',
  'LEGACY_BACKTEST_RUNS_ROOT',
  'LEGACY_BACKTEST_PERMUTATIONS_ROOT',
  'orderIntentsMirror',
  'portfolioItemsMirror',
  'stBacktestRunsMirror',
  'stBacktestPermutationsMirror',
  'tradingConfigMirror',
  'symbolListsMirror',
  'stStatusMirror',
  'cleanupStOccurrenceDecisions',
  'MIRROR_ORDER_INTENTS_PATH',
  'MIRROR_PORTFOLIO_ITEMS_PATH',
  'MIRROR_ST_BACKTEST_RUNS_PATH',
  'MIRROR_ST_BACKTEST_PERMUTATIONS_PATH',
];

describe('legacy roots retirement (#1013)', () => {
  for (const lit of FORBIDDEN_COLLECTION_LITERALS) {
    it(`no functions/src reference to ${lit}`, () => {
      assert.deepEqual(hits(lit), []);
    });
  }

  for (const ident of FORBIDDEN_IDENTIFIERS) {
    it(`no functions/src reference to ${ident}`, () => {
      assert.deepEqual(hits(ident), []);
    });
  }

  // legacy-order-intents.ts stays — pure mapping helpers consumed by the
  // straggler migration (migrate-order-intents-1003.ts); it carries no
  // trigger and no legacy path literals.
  it('mirror + sweeper source files are deleted', () => {
    const gone = [
      'order-tickets/order-intents-mirror.ts',
      'portfolio/portfolio-mirror.ts',
      'st-cloud-function/backtest/backtest-mirror.ts',
      'st-config/config-lists-mirror.ts',
      'scheduled/cleanup-st-occurrence-decisions.ts',
    ];
    const present = gone.filter((f) => {
      try {
        statSync(join(SRC_ROOT, f));
        return true;
      } catch {
        return false;
      }
    });
    assert.deepEqual(present, []);
  });
});
