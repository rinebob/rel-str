/**
 * @topic #553 — Paper Trading Infra
 *
 * Production wiring for the exit eval pass: the Firestore-backed dep
 * surface (`defaultEvalDeps`) plus the candidate listing and account-
 * owner resolution it composes. The deps-injected pass itself lives in
 * `eval-pass.ts` — this module is the thin IO boundary around it.
 */

import type { Firestore } from 'firebase-admin/firestore';
import { db as adminDb } from '../../firebase-admin-init';
import {
  PaperTradeStatus,
  type PaperTrade,
} from '@paper-trading/contracts';
import {
  applyExitFill,
  type ApplyFillResult,
  type ExitFillInput,
} from '../ledger';
import {
  applyGoverningPick,
  getInstance,
  listTrades,
  updateVariantRun,
} from '../repository';
import { ledgerDepsWithCapture } from '../screenshot-lifecycle';
import { getCachedBarsFromSymbolData } from '../../st-cloud-function/data-loader';
import { parseVariantKey } from './registry';
import type { ExitEvalDeps } from './eval-pass';

// ── Production wiring ───────────────────────────────────────────────────────

/**
 * Candidate trades for eval: every trade with ≥1 ACTIVE variant run —
 * OPEN/ASSIGNED evaluate live; CLOSED backfills a governing run left ACTIVE
 * by a partial failure and keeps shadow runs measuring. PENDING trades are
 * intentionally excluded: they carry no entry fill yet, so no variant can
 * honestly fire (expression-fill-pass flips them to OPEN before marks land).
 */
async function listCandidateTrades(db: Firestore): Promise<PaperTrade[]> {
  const statuses = [PaperTradeStatus.OPEN, PaperTradeStatus.ASSIGNED, PaperTradeStatus.CLOSED];
  const results = await Promise.all(statuses.map((s) => listTrades(db, { status: s })));
  return results
    .flat()
    // ≥1 ACTIVE run with a real variant — 'none' runs stay ACTIVE forever
    // (inert by parse fallthrough) and would keep every engine trade a
    // nightly candidate forever; the parse check retires them.
    .filter((t) =>
      t.variantRuns.some((r) => r.state === 'ACTIVE' && parseVariantKey(r.variantKey) !== null),
    );
}

/**
 * Owner resolution: the trade's own `userId` first — signal trades carry
 * it precisely for server-side fills (#652) and have no strategyInstanceId
 * to look through. The instance lookup is the legacy fallback for strategy
 * trades that predate the field.
 */
export async function resolveAccountOwner(
  db: Firestore,
  trade: PaperTrade,
): Promise<string | undefined> {
  if (trade.userId) return trade.userId;
  if (!trade.strategyInstanceId) return undefined;
  const inst = await getInstance(db, trade.strategyInstanceId);
  return inst?.userId;
}

/** Production dep wiring (Firestore + ledger). */
export function defaultEvalDeps(db: Firestore = adminDb): ExitEvalDeps {
  return {
    listTrades: () => listCandidateTrades(db),
    applyExit: (input: ExitFillInput): Promise<ApplyFillResult> =>
      applyExitFill(input, ledgerDepsWithCapture(db)),
    updateRun: (tradeId, run) =>
      updateVariantRun(db, tradeId, run, new Date().toISOString()),
    resolveUserId: (trade) => resolveAccountOwner(db, trade),
    getBars: async (symbol, date) =>
      (await getCachedBarsFromSymbolData(symbol, date)).dailyBars,
    applyGoverningPick: (tradeId, runs, governingVariant) =>
      applyGoverningPick(db, tradeId, runs, governingVariant, new Date().toISOString()),
  };
}
