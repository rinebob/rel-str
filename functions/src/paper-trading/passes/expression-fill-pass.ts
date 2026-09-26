/**
 * @topic #553 — Paper Trading Infra (task #564)
 *
 * expression-fill-pass — noon-PT fill of PENDING signal expression trades.
 * For each pending trade: `get_option_chains` → in-band expirations →
 * `get_option_instruments` → batched `get_option_quotes` →
 * `selectOptionContract` by template delta/DTE → `applyPendingFill` → OPEN.
 *
 * Read-only: only quote/chain MCP tools are invoked — no `place_*`/`review_*`
 * broker mutations exist on this path.
 */

import { buildOccContractId, OptionQuoteSource } from '@options/common';
import type { PaperTrade } from '@paper-trading/contracts';
import { calendarDaysBetween } from '../../common/pt-date-utils';
import { selectOptionContract } from '../../common/option-contract-selection';
import type { HistoricalOptionContract } from '../../types/partner';
import {
  MCP_PREFIX,
  QUOTE_BATCH,
  extractChains,
  extractQuoteItems,
  fetchAllOptionInstruments,
  parseNum,
  quoteItemId,
  quoteMark,
  type RhInstrument,
} from '../engine/rh-mcp-shapes';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { PaperTradeStatus } from '@paper-trading/contracts';
import { db } from '../../firebase-admin-init';
import { getMarketDatePT } from '../../common/pt-date-utils';
import {
  createRobinhoodMcpSessionManagerFromEnv,
  type RobinhoodMcpSessionManager,
} from '../../options-strategy-engine/mcp/robinhood-mcp-session-manager';
import type { PendingFillInput } from '../ledger';
import { applyPendingFill } from '../ledger';
import { ledgerDeps, listTrades } from '../repository';
import { createLogger } from '../engine/logging';

const logger = createLogger('ExpressionFillPass');

/** Bound on per-trade instrument lookups — nearest-DTE expirations only. */
const MAX_EXPIRATIONS = 4;
/** Concurrent fill paths per pass — bounds RH MCP burst + acct-doc contention. */
const FILL_CONCURRENCY = 4;
/** Concurrent quote batches per trade — bounds intra-trade MCP bursts. */
const QUOTE_CONCURRENCY = 3;

// ── Deps ───────────────────────────────────────────────────────────────────

export interface ExpressionFillPassDeps {
  listPendingTrades(): Promise<PaperTrade[]>;
  /** RH MCP read-only tool caller (`get_option_chains`/`instruments`/`quotes`). */
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  applyPendingFill(input: PendingFillInput): Promise<unknown>;
  now(): Date;
}

export interface ExpressionFillPassSummary {
  filled: number;
  skipped: number;
  errors: { tradeId: string; error: string }[];
}

// ── MCP fetch helpers ──────────────────────────────────────────────────────

/** Fetch expiration dates for the trade's underlying via `get_option_chains`. */
async function fetchExpirations(
  callTool: ExpressionFillPassDeps['callTool'],
  symbol: string,
): Promise<string[]> {
  const raw = await callTool(`${MCP_PREFIX}get_option_chains`, { underlying_symbol: symbol });
  const dates = new Set<string>();
  for (const chain of extractChains(raw)) {
    if (chain.symbol && chain.symbol.toUpperCase() !== symbol.toUpperCase()) continue;
    for (const d of chain.expiration_dates ?? []) dates.add(d);
  }
  return [...dates];
}

/** Fetch instruments for one expiration via `get_option_instruments` (paginated). */
const fetchInstruments = (
  callTool: ExpressionFillPassDeps['callTool'],
  symbol: string,
  expiration: string,
  rhType: 'put' | 'call',
): Promise<RhInstrument[]> =>
  fetchAllOptionInstruments(callTool, {
    chain_symbol: symbol,
    expiration_dates: expiration,
    type: rhType,
  });

/** Quote a batch of instrument ids via `get_option_quotes` (parallel batches). */
async function fetchQuotes(
  callTool: ExpressionFillPassDeps['callTool'],
  instrumentIds: string[],
): Promise<Map<string, { mark?: number; delta?: number }>> {
  const batches: string[][] = [];
  for (let i = 0; i < instrumentIds.length; i += QUOTE_BATCH) {
    batches.push(instrumentIds.slice(i, i + QUOTE_BATCH));
  }
  const raws: unknown[] = [];
  for (let i = 0; i < batches.length; i += QUOTE_CONCURRENCY) {
    raws.push(
      ...(await Promise.all(
        batches
          .slice(i, i + QUOTE_CONCURRENCY)
          .map((ids) => callTool(`${MCP_PREFIX}get_option_quotes`, { instrument_ids: ids })),
      )),
    );
  }
  const byId = new Map<string, { mark?: number; delta?: number }>();
  for (const raw of raws) {
    for (const item of extractQuoteItems(raw)) {
      const id = quoteItemId(item);
      if (!id) continue;
      byId.set(id, {
        mark: quoteMark(item),
        delta: parseNum(item.quote?.delta),
      });
    }
  }
  return byId;
}

// ── Pass ───────────────────────────────────────────────────────────────────

export async function runExpressionFillPass(
  marketDate: string,
  deps: ExpressionFillPassDeps,
): Promise<ExpressionFillPassSummary> {
  const pending = await deps.listPendingTrades();
  const summary: ExpressionFillPassSummary = { filled: 0, skipped: 0, errors: [] };

  // Trades are independent docs — parallelize (bounded); account writes
  // retry inside the ledger transaction if fills contend on one acct doc.
  const results: PromiseSettledResult<FillOutcome>[] = [];
  for (let i = 0; i < pending.length; i += FILL_CONCURRENCY) {
    results.push(
      ...(await Promise.allSettled(
        pending.slice(i, i + FILL_CONCURRENCY).map((trade) => fillOne(marketDate, trade, deps)),
      )),
    );
  }
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      if (r.value === 'filled') summary.filled++;
      else summary.skipped++;
    } else {
      const message = r.reason instanceof Error ? r.reason.message : String(r.reason);
      summary.errors.push({ tradeId: pending[i].id, error: message });
      logger.warn(`${pending[i].id}: fill failed — ${message}`);
    }
  }

  return summary;
}

type FillOutcome = 'filled' | 'skipped';

async function fillOne(
  marketDate: string,
  trade: PaperTrade,
  deps: ExpressionFillPassDeps,
): Promise<FillOutcome> {
  if (!trade.userId) {
    throw new Error(`pending trade ${trade.id} is missing userId`);
  }
  const template = trade.expressionTemplate;
  if (!template) {
    throw new Error(`pending trade ${trade.id} has no expressionTemplate`);
  }
  const rhType = template.optionType === 'call' ? 'call' : 'put';
  const symbol = trade.symbol.toUpperCase();

  // expirations inside the template DTE band, nearest target first
  const inBand = (await fetchExpirations(deps.callTool, symbol))
    .map((expiration) => ({ expiration, dte: calendarDaysBetween(marketDate, expiration) }))
    .filter((e) => e.dte >= template.minDte && e.dte <= template.maxDte)
    .sort((a, b) => Math.abs(a.dte - template.targetDte) - Math.abs(b.dte - template.targetDte))
    .slice(0, MAX_EXPIRATIONS);

  if (inBand.length === 0) {
    logger.info(`${trade.id}: no expiration inside ${template.minDte}-${template.maxDte}d band`);
    return 'skipped';
  }

  // instruments (parallel over in-band expirations) → quotes → candidates
  const instrumentPages = await Promise.all(
    inBand.map(({ expiration }) => fetchInstruments(deps.callTool, symbol, expiration, rhType)),
  );
  const instruments = instrumentPages.flat();
  const quotes = await fetchQuotes(
    deps.callTool,
    instruments.map((i) => i.id).filter((id): id is string => !!id),
  );

  const candidates: HistoricalOptionContract[] = [];
  for (const inst of instruments) {
    const strike = parseNum(inst.strike_price);
    const q = inst.id ? quotes.get(inst.id) : undefined;
    if (!inst.expiration_date || strike === undefined || !q) continue;
    candidates.push({
      contractID: buildOccContractId(symbol, inst.expiration_date, template.optionType, strike),
      symbol,
      expiration: inst.expiration_date,
      strike: String(strike),
      type: template.optionType,
      mark: q.mark === undefined ? undefined : String(q.mark),
      delta: q.delta === undefined ? undefined : String(q.delta),
    });
  }

  const selected = selectOptionContract(marketDate, candidates, {
    type: template.optionType,
    targetDelta: template.targetDelta,
    targetDte: template.targetDte,
    minDte: template.minDte,
    maxDte: template.maxDte,
    requireMark: true,
    useAbsoluteDelta: true,
  });

  if (!selected || selected.mark === undefined || !selected.contract.contractID) {
    logger.info(`${trade.id}: no selectable contract (${candidates.length} candidates)`);
    return 'skipped';
  }

  const { contract } = selected;
  const contractID = contract.contractID;
  const strike = parseNum(contract.strike);
  if (!contractID || strike === undefined || !contract.expiration) {
    throw new Error(`${trade.id}: selected contract ${contractID ?? 'n/a'} lacks id/strike/expiration`);
  }
  await deps.applyPendingFill({
    userId: trade.userId,
    tradeId: trade.id,
    legs: [
      {
        kind: 'option',
        contractID,
        type: template.optionType,
        strike,
        expiration: contract.expiration,
        side: template.side,
        quantity: trade.order.quantity,
        multiplier: 100,
        entryMark: selected.mark,
        lastMark: selected.mark,
      },
    ],
    fill: {
      fillId: `entry-${trade.id}`,
      role: 'entry',
      date: marketDate,
      price: selected.mark,
      quantity: trade.order.quantity,
      quoteSource: OptionQuoteSource.RH_MCP,
    },
    tradeOverrides: { lastMarkedAt: deps.now().toISOString() },
    now: deps.now().toISOString(),
  });
  return 'filled';
}

// -- Noon-PT scheduled entrypoint -------------------------------------------

/**
 * Fills PENDING expression trades queued by `paperSignalOrder`: RH option
 * chains ? instruments ? quotes ? delta/DTE selection ? `applyPendingFill`
 * ? OPEN. Runs at noon PT � the same cadence as strategy opens.
 */
export const expressionFillPassTimer = onSchedule(
  {
    schedule: '0 12 * * 1-5',
    timeZone: 'America/Los_Angeles',
    memory: '512MiB',
    timeoutSeconds: 300,
    secrets: ['RH_CREDENTIAL_BUNDLE'],
  },
  async () => {
    logger.info('Expression fill pass starting');
    let manager: RobinhoodMcpSessionManager | undefined;
    try {
      const m = (manager = await createRobinhoodMcpSessionManagerFromEnv());
      const summary = await runExpressionFillPass(getMarketDatePT(), {
        listPendingTrades: () =>
          listTrades(db, { status: PaperTradeStatus.PENDING }),
        callTool: (name, args) => m.callTool(name, args),
        applyPendingFill: (input) => applyPendingFill(input, ledgerDeps(db)),
        now: () => new Date(),
      });
      logger.info(
        `Expression fill pass complete: filled=${summary.filled} ` +
          `skipped=${summary.skipped} errors=${summary.errors.length}`,
      );
    } finally {
      await manager?.close();
    }
  },
);
