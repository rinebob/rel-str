/**
 * @topic #553 — Paper Trading Infra (task #1575)
 *
 * `generatePaperSignalTrades` — the curated mint boundary. FE signal-mode
 * review submits picked occurrences; each mints a real (possibly
 * backdated) PaperTrade through `backfillSignalTrade`. Validation is
 * up-front (malformed input is a caller bug → invalid-argument); per-item
 * data failures land in that item's MintResult — the call doesn't fail.
 * Bars are cached per symbol for the call's duration — a curated batch
 * clusters on a handful of symbols.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { db as adminDb } from '../firebase-admin-init';
import { ST_SIGNALS_ROOT } from '@st/collections';
import {
  GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS,
  type GeneratePaperSignalTradesRequest,
  type GeneratePaperSignalTradesResponse,
  type MintResult,
  type SignalPick,
} from '@paper-trading/contracts';
import { signalDedupeKey } from '@paper-trading/ids';
import type { StSignal } from '@st/signals';
import type { OhlcBar } from '../common/market-data-types';
import { getMarketDatePT, isValidMarketDate } from '../common/pt-date-utils';
import { OPTIONS_STRATEGY_ALLOWED_ORIGINS } from './engine/options-strategy-cors';
import { applyEntryFill, applyExitFill } from './ledger';
import { commitBackfilledTrade, getTrade, ledgerDeps } from './repository';
import { getCachedBarsFromSymbolData } from '../st-cloud-function/data-loader';
import { StOrderTicketWriter } from '../order-tickets/st-order-ticket-writer';
import { backfillSignalTrade } from './passes/backfill-signal-trade';

// ── Deps ──────────────────────────────────────────────────────────────────

export interface GeneratePaperSignalTradesDeps {
  /** One mint — prod wiring delegates to `backfillSignalTrade`. The
   *  second arg is the call-scoped per-symbol bars cache. */
  mint(
    item: SignalPick,
    shared: { getBars(symbol: string): Promise<OhlcBar[]> },
  ): Promise<MintResult>;
  /** Stored daily bars — wrapped in a per-call memo before reaching mints. */
  getBars(symbol: string): Promise<OhlcBar[]>;
}

// ── Handler ───────────────────────────────────────────────────────────────

interface CallableRequestLike {
  data: GeneratePaperSignalTradesRequest;
  auth?: { uid: string } | null;
}

export async function handleGeneratePaperSignalTrades(
  request: CallableRequestLike,
  deps: GeneratePaperSignalTradesDeps,
): Promise<GeneratePaperSignalTradesResponse> {
  if (!request.auth?.uid) {
    throw new HttpsError('unauthenticated', 'Must be signed in to mint paper signal trades');
  }
  const items = request.data?.items;
  if (
    !Array.isArray(items) ||
    items.length === 0 ||
    items.length > GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS
  ) {
    throw new HttpsError(
      'invalid-argument',
      `items must be a non-empty array of at most ${GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS} picks`,
    );
  }
  for (const it of items) {
    if (
      typeof it?.symbol !== 'string' ||
      it.symbol.trim() === '' ||
      typeof it?.signalType !== 'string' ||
      it.signalType.trim() === '' ||
      typeof it?.signalBarDate !== 'string' ||
      !isValidMarketDate(it.signalBarDate)
    ) {
      throw new HttpsError(
        'invalid-argument',
        'each pick needs a non-empty symbol + signalType and a YYYY-MM-DD signalBarDate',
      );
    }
  }
  // Normalize once — id builders uppercase internally but getBars and the
  // stamped trade/ticket fields carry the literal pick.
  const picks: SignalPick[] = items.map((it) => ({
    symbol: it.symbol.trim().toUpperCase(),
    signalType: it.signalType.trim(),
    signalBarDate: it.signalBarDate.trim(),
  }));

  // Per-symbol bars cache — a curated batch clusters on few symbols and
  // each load reads every year-shard for the symbol.
  const barsCache = new Map<string, Promise<OhlcBar[]>>();
  const getBars = (symbol: string): Promise<OhlcBar[]> => {
    let p = barsCache.get(symbol);
    if (!p) {
      p = deps.getBars(symbol);
      barsCache.set(symbol, p);
    }
    return p;
  };

  const results: MintResult[] = [];
  for (const item of picks) {
    try {
      results.push(await deps.mint(item, { getBars }));
    } catch (err) {
      results.push({
        signalId: signalDedupeKey(item.symbol, item.signalType, item.signalBarDate),
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { results };
}

// ── Production wiring ─────────────────────────────────────────────────────

export function generatePaperSignalTradesProdDeps(): GeneratePaperSignalTradesDeps {
  const db = adminDb;
  const ledger = ledgerDeps(db);
  const tickets = new StOrderTicketWriter({ db });
  return {
    getBars: async (symbol) =>
      (await getCachedBarsFromSymbolData(symbol, getMarketDatePT())).dailyBars,
    mint: (item, shared) =>
      backfillSignalTrade(item, {
        getSignal: async (occurrenceId) => {
          const snap = await db.collection(ST_SIGNALS_ROOT).doc(occurrenceId).get();
          return snap.exists ? (snap.data() as StSignal) : null;
        },
        getBars: shared.getBars,
        getTrade: (tradeId) => getTrade(db, tradeId),
        applyEntryFill: (input) => applyEntryFill(input, ledger),
        applyExitFill: (input) => applyExitFill(input, ledger),
        commitBackfill: (tradeId, update) =>
          commitBackfilledTrade(db, tradeId, update, new Date().toISOString()),
        tickets,
        now: () => new Date(),
      }),
  };
}

export const generatePaperSignalTrades = onCall<
  GeneratePaperSignalTradesRequest,
  Promise<GeneratePaperSignalTradesResponse>
>(
  {
    cors: OPTIONS_STRATEGY_ALLOWED_ORIGINS,
    memory: '512MiB',
    timeoutSeconds: 300,
  },
  (request) =>
    handleGeneratePaperSignalTrades(request, generatePaperSignalTradesProdDeps()).catch(
      (err) => {
        // Sibling convention: non-HttpsError escapes re-mapped to internal.
        if (err instanceof HttpsError) throw err;
        throw new HttpsError(
          'internal',
          err instanceof Error ? err.message : String(err),
        );
      },
    ),
);
