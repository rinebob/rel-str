/**
 * @topic #553 — Paper Trading Infra (tasks #917 gates + #918 fill / Thread #904)
 *
 * Auto-paper ingest pass: turns each qualifying persisted ST signal into an
 * isolated 1-share paper trade at a live RH quote. Runs on the dedicated
 * `stAutoPaperIngest` Cloud Task enqueued by RunProgressTracker at run
 * completion — outside the 256MiB/60s symbol-worker budget.
 *
 * This file owns the GATES (`runAutoPaperIngestPass`) and the fill
 * pipeline (`runAutoPaperIngestFill`, #918):
 *
 *   1. Config gate — `savant-trader/data/trading-config/autoPaper` missing
 *      or `enabled: false` → skip (no candidate reads, no quotes).
 *   2. Live-date gate — `payload.marketDate !== today PT` →
 *      `st_autopaper_skip` (historical/replay runs never paper-trade).
 *      PARTIAL runs proceed — succeeded signals are still valid.
 *
 * Scope resolution: `lists` names symbol-list keys (user-scoped
 * `{uid}_{KEY}` docs); a `'*'` entry flips to global capture — config-only
 * change, no redeploy. `signalTypes` defaults to the four daily
 * trend-rider types.
 */

import {
  AUTO_PAPER_CONFIG_DOC,
  ST_JOBS_SUBCOLLECTION,
  ST_RUN_IDS_SUBCOLLECTION,
  ST_RUNS_COLLECTION,
  ST_SYMBOLS_COLLECTION,
  ST_SYMBOL_LISTS_COLLECTION,
  ST_TRADING_CONFIG_COLLECTION,
  type AutoPaperConfig,
} from '../../common/st-collections';
import { getMarketDatePT, isValidMarketDate } from '../../common/pt-date-utils';
import { db } from '../../firebase-admin-init';
import type { AutoPaperIngestPayload } from '../../common/st-shared-types';
import { StSignalDirection, StSignalType, type StSignalEntry } from '../../st-cloud-function/signals';
import { createLogger } from '../engine/logging';
import {
  buildRawQuoteId,
  buildTradeId,
  EQUITY_TRADE_DESC,
  signalDedupeKey,
  signalTradeDesc,
} from '@paper-trading/ids';
import { TradeSide } from '@common';
import { OptionQuoteSource } from '@options/common';
import {
  AUTO_PAPER_USER_ID,
  PaperTradeSource,
  SIGNAL_GOVERNING_VARIANT,
  SIGNAL_SHADOW_VARIANT_KEYS,
  type PaperTrade,
  type RawQuoteDoc,
} from '@paper-trading/contracts';
import { extractEquityPrice, findEquityQuoteItem, MCP_PREFIX } from '../engine/rh-mcp-shapes';
import { rawQuoteToDoc } from '../engine/trade-adapter';
import {
  applyEntryFill as ledgerApplyEntryFill,
  type ApplyFillResult,
  type EntryFillInput,
} from '../ledger';
import {
  getTrade as repoGetTrade,
  ledgerDeps,
  setRawQuote,
} from '../repository';

const logger = createLogger('AutoPaperIngestPass');

/** Event-name-first line — keeps `st_autopaper_*` greppable with fields. */
const logEvent = (event: string, fields: Record<string, unknown>) =>
  logger.info(`${event} ${JSON.stringify(fields)}`);

/** Default signal-type allowlist — daily trend-rider V1 + V2, both sides. */
export const AUTO_PAPER_DEFAULT_SIGNAL_TYPES: readonly string[] = [
  StSignalType.D_ST_TREND_RIDER_V1_LONG,
  StSignalType.D_ST_TREND_RIDER_V1_SHORT,
  StSignalType.D_ST_TREND_RIDER_V2_LONG,
  StSignalType.D_ST_TREND_RIDER_V2_SHORT,
];

/** Resolved ingest scope — what #918's selection step consumes. */
export interface AutoPaperScope {
  /** `'*'` configured — capture every signaled symbol. */
  global: boolean;
  /** Named list keys to capture from (empty when `global`). */
  lists: string[];
  /** Signal types to paper (default: AUTO_PAPER_DEFAULT_SIGNAL_TYPES). */
  signalTypes: string[];
  /** Pins which user's `{uid}_{KEY}` list doc to read (lists are user-scoped). */
  ownerUid?: string;
}

export function resolveAutoPaperScope(config: AutoPaperConfig): AutoPaperScope {
  // Hand-edited docs can drop `lists` — treat anything non-array as empty.
  const lists = Array.isArray(config.lists) ? config.lists : [];
  return {
    global: lists.includes('*'),
    lists: lists.filter((l) => l !== '*'),
    ownerUid: config.ownerUid,
    signalTypes:
      config.signalTypes && config.signalTypes.length > 0
        ? config.signalTypes
        : [...AUTO_PAPER_DEFAULT_SIGNAL_TYPES],
  };
}

// ── Dependencies ──────────────────────────────────────────────────────────

export interface AutoPaperIngestDeps {
  /** Read the autoPaper config doc; null when absent. */
  loadConfig: () => Promise<AutoPaperConfig | null>;
  /** Today's PT calendar date — injected for determinism in tests. */
  todayPT: () => string;
}

// ── #918 — selection → quote → fill ──────────────────────────────────────

/**
 * Pull signal entries out of a run-ids doc in BOTH observed shapes:
 * prod stores them as literal flattened top-level `signals.{type}` fields
 * (dotted keys survive `set(merge)` verbatim), while backfill-produced docs
 * carry a nested `signals` map. Values that aren't entry-shaped are ignored.
 */
export function signalEntriesFromRunDoc(
  data: Record<string, unknown>,
): Record<string, StSignalEntry> {
  const out: Record<string, StSignalEntry> = {};
  const isEntry = (v: unknown): v is StSignalEntry =>
    typeof v === 'object' && v !== null && 'barDate' in v && 'direction' in v;
  for (const [key, value] of Object.entries(data)) {
    if (key.startsWith('signals.') && isEntry(value)) {
      out[key.slice('signals.'.length)] = value;
    }
  }
  const nested = data['signals'];
  if (typeof nested === 'object' && nested !== null) {
    for (const [type, value] of Object.entries(nested as Record<string, unknown>)) {
      if (isEntry(value)) out[type] ??= value;
    }
  }
  return out;
}

export interface AutoPaperFillSummary {
  candidates: number;
  created: number;
  deduped: number;
  quoteFailed: number;
  /** Dropped by the list gate, the signal-type allowlist, an unsupported
   *  (non-trend-rider) configured type, or an unparseable barDate. */
  filtered: number;
  errors: { symbol: string; signalType?: string; error: string }[];
}

export interface AutoPaperIngestFillDeps {
  /** Job symbols under the run where createdOpportunity == true. */
  listCandidates(runId: string): Promise<string[]>;
  /** Member symbols of a user-scoped symbol-list key. */
  listMembers(listKey: string, ownerUid?: string): Promise<string[]>;
  /** Signal entries on `symbols/{sym}/run-ids/{runId}` (both shapes). */
  getSignals(symbol: string, runId: string): Promise<Record<string, StSignalEntry>>;
  /** Overview stamps — live on the `symbols/{sym}` doc. */
  getSymbolMeta(
    symbol: string,
  ): Promise<{ sector?: string; industry?: string; marketCapTier?: string }>;
  /** One batched `get_equity_quotes` call for all admitted symbols. */
  getEquityQuotes(symbols: string[]): Promise<unknown>;
  getTrade(tradeId: string): Promise<PaperTrade | null>;
  applyEntryFill(input: EntryFillInput): Promise<ApplyFillResult>;
  writeRawQuote(doc: RawQuoteDoc): Promise<void>;
  now(): Date;
}

/**
 * Selection → quote → fill, run once per gated-ready run completion.
 * Per-signal: deterministic dedupe (tradeId + signalId), batched live
 * quote, symbol-meta stamps, `applyEntryFill` — then a `rq-` audit doc.
 * Retries are safe: `getTrade` skips created trades and the ledger's own
 * `already exists` throw counts as dedupe.
 */
export async function runAutoPaperIngestFill(
  payload: AutoPaperIngestPayload,
  scope: AutoPaperScope,
  deps: AutoPaperIngestFillDeps,
): Promise<AutoPaperFillSummary> {
  const { runId, marketDate } = payload;
  const base = { runId, marketDate };
  const summary: AutoPaperFillSummary = {
    candidates: 0,
    created: 0,
    deduped: 0,
    quoteFailed: 0,
    filtered: 0,
    errors: [],
  };

  const complete = () => {
    logEvent('st_autopaper_ingest_complete', {
      ...base,
      candidates: summary.candidates,
      created: summary.created,
      deduped: summary.deduped,
      quoteFailed: summary.quoteFailed,
      filtered: summary.filtered,
      errors: summary.errors.length,
    });
    return summary;
  };

  // 1. Candidates: job symbols that produced an opportunity this run.
  const candidates = await deps.listCandidates(runId);
  summary.candidates = candidates.length;
  if (!candidates.length) return complete();

  // 2. List gate → symbol → captureList stamp.
  const admitted = new Map<string, string>();
  if (scope.global) {
    for (const sym of candidates) admitted.set(sym, '*');
  } else {
    const candSet = new Set(candidates);
    for (const listKey of scope.lists) {
      for (const sym of await deps.listMembers(listKey, scope.ownerUid)) {
        if (candSet.has(sym) && !admitted.has(sym)) admitted.set(sym, listKey);
      }
    }
  }
  summary.filtered += candidates.length - admitted.size;

  // 3. Per-symbol signal read (parallel; one bad doc errors, others proceed),
  //    filtered to the allowlist.
  interface Work {
    symbol: string;
    signalType: string;
    entry: StSignalEntry;
    captureList: string;
  }
  const work: Work[] = [];
  await Promise.all(
    [...admitted].map(async ([symbol, captureList]) => {
      let signals: Record<string, StSignalEntry>;
      try {
        signals = await deps.getSignals(symbol, runId);
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        summary.errors.push({ symbol, error });
        logEvent('st_autopaper_signals_failed', { ...base, symbol, error });
        return;
      }
      for (const [signalType, entry] of Object.entries(signals)) {
        if (scope.signalTypes.includes(signalType)) {
          work.push({ symbol, signalType, entry, captureList });
        } else {
          summary.filtered++;
        }
      }
    }),
  );
  if (!work.length) return complete();

  // 4. Trade-desc validation up front — a configured type that isn't a
  //    daily trend-rider warns once and filters its items, instead of
  //    throwing per signal inside the fill loop.
  const descByType = new Map<string, string>();
  for (const t of scope.signalTypes) {
    try {
      descByType.set(t, signalTradeDesc(t));
    } catch {
      logEvent('st_autopaper_signal_type_unsupported', { ...base, signalType: t });
    }
  }
  const supported = work.filter((w) => {
    if (descByType.has(w.signalType)) return true;
    summary.filtered++;
    return false;
  });

  // 5. Dedupe BEFORE quoting — a fully-deduped rerun burns no MCP session
  //    or quote call. TradeId keys on the signal's bar date (not dispatch
  //    date) so a next-day re-dispatch mints the same doc id, matching the
  //    {sym}_{type}_{barDate} signalId contract.
  interface Pending extends Work {
    signalId: string;
    tradeId: string;
  }
  const pending: Pending[] = [];
  await Promise.all(
    supported.map(async (w) => {
      if (!isValidMarketDate(w.entry.barDate)) {
        summary.filtered++;
        logEvent('st_autopaper_bar_date_invalid', {
          ...base, symbol: w.symbol, signalType: w.signalType, barDate: w.entry.barDate,
        });
        return;
      }
      const signalId = signalDedupeKey(w.symbol, w.signalType, w.entry.barDate);
      const tradeId = buildTradeId(
        new Date(`${w.entry.barDate}T12:00:00Z`),
        'sig',
        w.symbol,
        descByType.get(w.signalType)!,
      );
      if (await deps.getTrade(tradeId)) {
        summary.deduped++;
        return;
      }
      pending.push({ ...w, signalId, tradeId });
    }),
  );
  // Deterministic order — parallel pushes land in completion order.
  pending.sort((a, b) =>
    a.symbol === b.symbol
      ? a.signalType.localeCompare(b.signalType)
      : a.symbol.localeCompare(b.symbol),
  );
  if (!pending.length) return complete();

  // 6. One batched quote call for the surviving symbols only.
  const symbols = [...new Set(pending.map((w) => w.symbol))];
  let rawQuotes: unknown;
  try {
    rawQuotes = await deps.getEquityQuotes(symbols);
  } catch (err) {
    // Batch miss: every pending item quote-fails; detail lands in the
    // summary, not a partial state.
    summary.quoteFailed = pending.length;
    logEvent('st_autopaper_quote_failed', {
      ...base,
      symbols,
      error: err instanceof Error ? err.message : String(err),
    });
    return complete();
  }

  // 7. Symbol meta once per symbol (parallel) — missing meta still fills;
  //    the stamps are optional slices.
  const metas = new Map<string, { sector?: string; industry?: string; marketCapTier?: string }>();
  await Promise.all(
    symbols.map(async (symbol) => {
      try {
        metas.set(symbol, await deps.getSymbolMeta(symbol));
      } catch (err) {
        metas.set(symbol, {});
        logger.warn(
          `st_autopaper_meta_failed ${JSON.stringify({ ...base, symbol, error: err instanceof Error ? err.message : String(err) })}`,
        );
      }
    }),
  );

  const now = deps.now();
  const fillDate = marketDate ?? getMarketDatePT(now);

  // 8. Fill loop — one ledger txn per surviving signal.
  for (const w of pending) {
    try {
      const price = extractEquityPrice(rawQuotes, w.symbol);
      if (price === undefined || !Number.isFinite(price)) {
        summary.quoteFailed++;
        logEvent('st_autopaper_quote_failed', { ...base, symbol: w.symbol, signalType: w.signalType });
        continue;
      }

      const meta = metas.get(w.symbol) ?? {};
      const side =
        w.entry.direction === StSignalDirection.SHORT ? TradeSide.SHORT : TradeSide.LONG;
      // rqId date segment = the quote's market date (repository.ts:260
      // convention), not the dispatch instant.
      const rqId = buildRawQuoteId(w.tradeId, new Date(`${fillDate}T12:00:00Z`));

      // Audit doc BEFORE the fill: a failed rq write blocks nothing durable
      // (retry overwrites the same id), while a post-fill write failure
      // would leave a dangling fill.rawQuoteRef that retries never heal.
      await deps.writeRawQuote(
        rawQuoteToDoc(
          w.tradeId,
          {
            date: fillDate,
            rawResponse: {
              symbol: w.symbol,
              signalType: w.signalType,
              tool: `${MCP_PREFIX}get_equity_quotes`,
              pass: 'auto-paper-ingest',
              quote: findEquityQuoteItem(rawQuotes, w.symbol),
            },
          },
          rqId,
          now.toISOString(),
        ),
      );

      await deps.applyEntryFill({
        userId: AUTO_PAPER_USER_ID,
        tradeId: w.tradeId,
        order: { side, type: 'MARKET', quantity: 1 },
        legs: [
          {
            kind: 'share',
            side,
            quantity: 1,
            multiplier: 1,
            entryMark: price,
            lastMark: price,
          },
        ],
        fill: {
          fillId: `entry-${w.tradeId}`,
          role: 'entry',
          date: fillDate,
          price,
          quantity: 1,
          quoteSource: OptionQuoteSource.RH_MCP,
          rawQuoteRef: rqId,
        },
        underlyingClose: price,
        dims: {
          source: PaperTradeSource.SIGNAL,
          symbol: w.symbol,
          expression: EQUITY_TRADE_DESC,
          governingVariant: SIGNAL_GOVERNING_VARIANT,
          variantKeys: [SIGNAL_GOVERNING_VARIANT, ...SIGNAL_SHADOW_VARIANT_KEYS],
          signalId: w.signalId,
        },
        tradeOverrides: {
          signalType: w.signalType,
          signalTimeframe: w.entry.timeframe,
          signalBarDate: w.entry.barDate,
          signalStatus: w.entry.status as 'INTERIM' | 'CONFIRMED',
          signalRunId: runId,
          signalIndicators: w.entry.indicators,
          sector: meta.sector,
          industry: meta.industry,
          marketCapTier: meta.marketCapTier as PaperTrade['marketCapTier'],
          captureList: w.captureList,
        },
        now: now.toISOString(),
      });
      summary.created++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/already exists/i.test(message)) {
        // Concurrent creator won the tradeId race inside the txn.
        summary.deduped++;
      } else {
        summary.errors.push({ symbol: w.symbol, signalType: w.signalType, error: message });
        logEvent('st_autopaper_fill_failed', { ...base, symbol: w.symbol, signalType: w.signalType, error: message });
      }
    }
  }

  return complete();
}

export function defaultAutoPaperIngestDeps(): AutoPaperIngestDeps {
  return {
    loadConfig: async () => {
      const doc = await db
        .collection(ST_TRADING_CONFIG_COLLECTION)
        .doc(AUTO_PAPER_CONFIG_DOC)
        .get();
      return (doc.exists ? doc.data() : null) as AutoPaperConfig | null;
    },
    todayPT: getMarketDatePT,
  };
}

// ── Pass ──────────────────────────────────────────────────────────────────

export type AutoPaperSkipReason =
  | 'missing-config'
  | 'disabled'
  | 'historical-run'
  | 'empty-scope';

export type AutoPaperIngestResult =
  | { status: 'skipped'; reason: AutoPaperSkipReason; scope?: never }
  | { status: 'ready'; scope: AutoPaperScope; reason?: never };

/**
 * Gate the ingest: config enabled + live market date. Returns `ready` with
 * the resolved scope once both pass — the task then continues into
 * `runAutoPaperIngestFill` for selection → quote → ledger fills.
 */
export async function runAutoPaperIngestPass(
  payload: AutoPaperIngestPayload,
  deps: AutoPaperIngestDeps,
): Promise<AutoPaperIngestResult> {
  const { runId, marketDate, triggeredBy } = payload;
  const base = { runId, marketDate, triggeredBy };

  const config = await deps.loadConfig();
  if (!config) {
    logEvent('st_autopaper_skip', { ...base, reason: 'missing-config' });
    return { status: 'skipped', reason: 'missing-config' };
  }
  if (!config.enabled) {
    logEvent('st_autopaper_skip', { ...base, reason: 'disabled' });
    return { status: 'skipped', reason: 'disabled' };
  }

  // marketDate is the run's PT trading date; dispatching after PT midnight
  // (retry backoff or a ~23:59 finisher) flips this to a skip by design —
  // a next-day ingest would price yesterday's signals off today's quotes.
  const todayPT = deps.todayPT();
  if (marketDate !== todayPT) {
    logEvent('st_autopaper_skip', { ...base, reason: 'historical-run', todayPT });
    return { status: 'skipped', reason: 'historical-run' };
  }

  const scope = resolveAutoPaperScope(config);
  if (!scope.global && scope.lists.length === 0) {
    logEvent('st_autopaper_skip', { ...base, reason: 'empty-scope' });
    return { status: 'skipped', reason: 'empty-scope' };
  }

  logEvent('st_autopaper_ingest_start', {
    ...base,
    global: scope.global,
    lists: scope.lists,
    signalTypes: scope.signalTypes,
  });

  return { status: 'ready', scope };
}

/** Prod fill deps — Firestore reads + the RH MCP quote caller the task wires. */
export function defaultAutoPaperIngestFillDeps(
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>,
): AutoPaperIngestFillDeps {
  return {
    listCandidates: async (runId) => {
      const snap = await db
        .collection(ST_RUNS_COLLECTION)
        .doc(runId)
        .collection(ST_JOBS_SUBCOLLECTION)
        .where('createdOpportunity', '==', true)
        .get();
      return snap.docs.map((d) => d.id);
    },
    listMembers: async (listKey, ownerUid) => {
      if (ownerUid) {
        const doc = await db
          .collection(ST_SYMBOL_LISTS_COLLECTION)
          .doc(`${ownerUid}_${listKey}`)
          .get();
        return ((doc.data()?.symbols ?? []) as string[]);
      }
      const snap = await db
        .collection(ST_SYMBOL_LISTS_COLLECTION)
        .where('key', '==', listKey)
        .get();
      if (snap.size > 1) {
        logger.warn(
          `auto-paper list '${listKey}' matched ${snap.size} user docs — ` +
            `using the first; set ownerUid on the autoPaper config`,
        );
      }
      return ((snap.docs[0]?.data()?.symbols ?? []) as string[]);
    },
    getSignals: async (symbol, runId) => {
      const doc = await db
        .collection(ST_SYMBOLS_COLLECTION)
        .doc(symbol)
        .collection(ST_RUN_IDS_SUBCOLLECTION)
        .doc(runId)
        .get();
      return doc.exists ? signalEntriesFromRunDoc(doc.data() ?? {}) : {};
    },
    getSymbolMeta: async (symbol) => {
      const doc = await db.collection(ST_SYMBOLS_COLLECTION).doc(symbol).get();
      const d = doc.data() ?? {};
      return { sector: d.sector, industry: d.industry, marketCapTier: d.marketCapTier };
    },
    getEquityQuotes: (symbols) =>
      callTool(`${MCP_PREFIX}get_equity_quotes`, { symbols }),
    getTrade: (tradeId) => repoGetTrade(db, tradeId),
    // ledgerDeps (no screenshot capture): auto-paper trades are forensics
    // observations, not user journeys — an ORDER_FILLED screenshot per
    // ~50-200-signal run would swamp the capture pipeline for no consumer.
    applyEntryFill: (input) => ledgerApplyEntryFill(input, ledgerDeps(db)),
    writeRawQuote: (doc) => setRawQuote(db, doc),
    now: () => new Date(),
  };
}
