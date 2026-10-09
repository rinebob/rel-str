/**
 * @topic #553 — Paper Trading Infra (task #917 / Thread #904)
 *
 * Auto-paper ingest pass: turns each qualifying persisted ST signal into an
 * isolated 1-share paper trade at a live RH quote. Runs on the dedicated
 * `stAutoPaperIngest` Cloud Task enqueued by RunProgressTracker at run
 * completion — outside the 256MiB/60s symbol-worker budget.
 *
 * This file owns the GATES and the resolved scope; the selection → quote →
 * fill pipeline lands in #918 on this same deps-injected seam:
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
  ST_TRADING_CONFIG_COLLECTION,
  type AutoPaperConfig,
} from '../../common/st-collections';
import { getMarketDatePT } from '../../common/pt-date-utils';
import { db } from '../../firebase-admin-init';
import type { AutoPaperIngestPayload } from '../../common/st-shared-types';
import { StSignalType } from '../../st-cloud-function/signals';
import { createLogger } from '../engine/logging';

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
}

export function resolveAutoPaperScope(config: AutoPaperConfig): AutoPaperScope {
  // Hand-edited docs can drop `lists` — treat anything non-array as empty.
  const lists = Array.isArray(config.lists) ? config.lists : [];
  return {
    global: lists.includes('*'),
    lists: lists.filter((l) => l !== '*'),
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

export interface AutoPaperIngestResult {
  status: 'skipped' | 'ready';
  reason?: 'missing-config' | 'disabled' | 'historical-run' | 'empty-scope';
  scope?: AutoPaperScope;
}

/**
 * Gate the ingest: config enabled + live market date. Returns `ready` with
 * the resolved scope once both pass — #918 continues from there with
 * candidate selection, quoting, and ledger fills.
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

  // TODO(#918): candidate selection → RH quote → applyEntryFill per signal.
  return { status: 'ready', scope };
}
