/**
 * @topic #553 — Paper Trading Infra (task #676 — signal-trade mark coverage)
 *
 * Verifies the signal mark path against REAL prod data + REAL RH quotes:
 *
 *   1. Reads all OPEN signal-source trades — the population the engine
 *      mark pass misses.
 *   2. Runs `runSignalMarkPass` with the real RH MCP session — option legs
 *      via `get_option_quotes`, share legs via `get_equity_quotes`.
 *   3. Asserts each marked trade gained `marks[ptDate].mark` under the PT
 *      market-date key, and that legs' lastMark moved.
 *
 * This WRITES real marks on real signal trades — that's the point (marks
 * are exactly what the nightly pass writes). No scratch docs; the marks
 * land on live positions where they belong. Safe to re-run (same-day
 * marks overwrite by date key).
 *
 * Usage (from functions/ dir):
 *   npx tsx scripts/verify/paper-trading-signal-marks-676.ts
 *
 * Requires: ADC (rel-str) + the local RH MCP API up (127.0.0.1:3456)
 * with OAuth — same path the close-667 script uses via
 * `executeObservationTool`.
 *
 * PASS: every CHECK prints OK and exits 0. If there are no OPEN signal
 * trades yet, the pass is still exercised (marked=0 is honest — prints
 * "no OPEN signal trades; pass exercised end-to-end").
 * FAIL: a check fails; exit 1. No cleanup needed — writes are real marks.
 */

import { db } from '../../src/firebase-admin-init';
import {
  PaperTradeSource,
  PaperTradeStatus,
  PaperTradingKind,
} from '../../../shared/paper-trading-contracts';
import { paperItemsRef } from '../../src/paper-trading/collections';
import { getMarketDatePT } from '../../src/common/pt-date-utils';
import {
  runSignalMarkPass,
  defaultSignalMarkDeps,
} from '../../src/paper-trading/passes/signal-mark-pass';
import { RobinhoodMcpOptionQuoteProvider } from '../../src/paper-trading/engine/quote-providers/rh-mcp-option-quote-provider';
import { executeObservationTool } from '../../src/rh-agent-mcp/tools/robinhood-tool-executor';
import type { PaperTrade } from '../../../shared/paper-trading-contracts';

let passed = 0;
let failed = 0;

function check(name: string, cond: boolean, detail?: unknown): void {
  if (cond) {
    passed++;
    console.log(`OK   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}`, detail ?? '');
  }
}

async function listOpenSignalTrades(): Promise<PaperTrade[]> {
  const snap = await paperItemsRef(db, PaperTradingKind.TRADE)
    .where('status', '==', PaperTradeStatus.OPEN)
    .where('source', '==', PaperTradeSource.SIGNAL)
    .get();
  // Trade docs are persisted without the `id` field — inject it so the
  // per-trade checks key on the real doc id, not `undefined`.
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as PaperTrade);
}

async function main(): Promise<void> {
  const before = await listOpenSignalTrades();
  console.log(`\n  ${before.length} OPEN signal-source trades in prod`);
  check(
    'signal trade query works',
    before.every((t) => typeof t.id === 'string' && t.id.length > 0),
  );

  const callTool = async (name: string, args: Record<string, unknown>) => {
    const res = await executeObservationTool(name, args);
    if (!('success' in res) || !res.success) {
      throw new Error(`MCP ${name} failed: ${'error' in res ? res.error : 'unknown'}`);
    }
    return (res as { parsed?: unknown }).parsed ?? {};
  };
  const provider = new RobinhoodMcpOptionQuoteProvider({ callTool });
  {
    const summary = await runSignalMarkPass(
      defaultSignalMarkDeps(db, {
        getOptionQuotes: (ids, side) => provider.getQuotes(ids, side),
        callTool,
      }),
    );
    console.log(
      `  pass summary: marked=${summary.marked} skipped=${summary.skipped} errors=${summary.errors.length}`,
    );

    check('pass ran with no internal errors', summary.errors.length === 0, summary.errors);
    check(
      'pass marked count matches population (no silent skips)',
      summary.marked === before.length,
      { marked: summary.marked, skipped: summary.skippedTradeIds, total: before.length },
    );

    if (before.length === 0) {
      console.log('  no OPEN signal trades — pass exercised end-to-end (marked=0 is honest)');
      check('empty population handled cleanly', summary.marked === 0);
      return;
    }

    const ptDate = getMarketDatePT();
    const after = await listOpenSignalTrades();
    const byId = new Map(after.map((t) => [t.id, t]));

    let withFreshMark = 0;
    for (const t of before) {
      const now = byId.get(t.id);
      if (!now) continue;
      const mark = now.marks?.[ptDate]?.mark;
      if (mark !== undefined && Number.isFinite(mark)) withFreshMark++;
      if (mark === undefined || !Number.isFinite(mark)) {
        console.log(`    ${t.id}: no fresh mark under ${ptDate}`, now.marks);
      }
    }
    check(
      `every OPEN signal trade has marks[${ptDate}].mark`,
      withFreshMark === before.length,
      { marked: withFreshMark, total: before.length },
    );

    // Single-leg trades get the fresh mark stamped onto leg.lastMark by
    // markSignalTrade — verify it equals the mark just written (not just
    // "differs from entryMark", which a stale mark would also satisfy).
    const singleLeg = after.filter((t) => t.legs.length === 1);
    const staleLeg = singleLeg.filter(
      (t) => t.legs[0].lastMark !== t.marks?.[ptDate]?.mark,
    );
    check(
      'single-leg lastMark equals the fresh mark',
      staleLeg.length === 0,
      { stale: staleLeg.map((t) => t.id) },
    );

    // Governing-eval reachability: a marked OPEN signal trade with an
    // ACTIVE terminal run is a real eval candidate (eval pass filters on
    // status + parseable run key — source is not a gate, #676 test).
    const evaluable = after.filter(
      (t) =>
        t.status === PaperTradeStatus.OPEN &&
        t.marks?.[ptDate]?.mark !== undefined &&
        t.variantRuns.some((r) => r.state === 'ACTIVE' && r.variantKey !== 'none'),
    );
    console.log(`  ${evaluable.length} signal trades now eval-eligible (mark + ACTIVE run)`);
    check(
      'eval-eligible set is non-empty when trades carry ACTIVE runs',
      evaluable.length > 0 || !after.some((t) => t.variantRuns.some((r) => r.state === 'ACTIVE')),
    );
  }
}

main()
  .catch((err) => {
    failed++;
    console.log('FAIL unhandled', err);
  })
  .finally(() => {
    console.log(`\n${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  });
