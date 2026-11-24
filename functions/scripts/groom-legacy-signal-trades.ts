/**
 * @topic #553 — Paper Trading Infra (task #1651)
 *
 * One-shot wipe of the `source=SIGNAL` trades left by the retired
 * auto-ingest (340 scanned 2026-11-22 — 313 eligible, 27 skipped). The pane's
 * checkbox join would render every surviving auto-mint as checked-by-
 * default, so this runs BEFORE the signal-selection pane ships.
 *
 * Each scanned doc is pre-classified against the same refusal set
 * `deleteTradeCascade` enforces inside its transaction — trades carrying
 * `cohortId` / `positionGroupId` / `ticket` are accept-flow lineage
 * (staged member tickets + group membership live on other docs) and are
 * skipped + reported, never force-deleted. Eligible ids drive the prod
 * cascade in `DELETE_PAPER_TRADES_MAX_ITEMS` batches; the cascade's own
 * refusal stays authoritative (a marker arriving post-scan still stops
 * the delete).
 *
 * Default is DRY-RUN — pass --apply to delete. Idempotent: a re-run sees
 * only the skipped set and deletes nothing.
 *
 *   cd functions
 *   npx tsx scripts/groom-legacy-signal-trades.ts          # census only
 *   npx tsx scripts/groom-legacy-signal-trades.ts --apply  # delete
 *
 * Prerequisites: ADC with prod Firestore access; do NOT set
 * FUNCTIONS_EMULATOR=true.
 */
import { pathToFileURL } from 'node:url';
import {
  DELETE_PAPER_TRADES_MAX_ITEMS,
  PaperTradeSource,
  PaperTradingKind,
  type PaperTrade,
} from '../../shared/paper-trading-contracts';
import { db as adminDb } from '../src/firebase-admin-init';
import { paperItemsRef } from '../src/paper-trading/collections';
import {
  deleteTradeCascade,
  type DeleteTradeCascadeOutcome,
} from '../src/paper-trading/repository';

// ── Core (deps-injected — specs never touch Firestore) ─────────────────────

/** The fields the groom reads to classify a signal-source trade doc. */
export type GroomSignalTradeRow = Pick<
  PaperTrade,
  'id' | 'cohortId' | 'positionGroupId' | 'ticket' | 'status'
>;

export interface GroomSignalTradesDeps {
  /** Every `source=SIGNAL` trade doc — prod wiring enumerates the
   *  collection (single `.get()`, fine at ~340 docs). */
  listSignalTrades(): Promise<GroomSignalTradeRow[]>;
  /** One cascade — prod wiring delegates to `deleteTradeCascade`, which
   *  re-enforces the refusal set inside its transaction. */
  deleteTrade(tradeId: string): Promise<DeleteTradeCascadeOutcome>;
}

export interface GroomCensus {
  scanned: number;
  /** Passed the pre-check — the delete targets when applying. */
  eligible: string[];
  /** Eligible-by-status histogram — a PENDING row would be a phantom
   *  openTradeCount decrement inside the cascade (PENDING never
   *  incremented it); expected population is zero, so it prints for
   *  operator confirmation rather than hiding in the ids list. */
  eligibleByStatus: Record<string, number>;
  /** Carried cohort/group/ticket markers — skipped, never force-deleted. */
  skippedAcceptFlow: string[];
  deleted: string[];
  notFound: string[];
  /** Refusals the cascade returned itself (marker arrived post-scan, or
   *  a stale id) — kept distinct from the pre-scan skip. */
  cascadeRefused: { acceptFlow: string[]; nonSignal: string[] };
  failed: { tradeId: string; error: string }[];
}

/** Mirrors the marker check `deleteTradeCascade` runs inside its txn.
 *  Exported so the #1652 retire verifier shares the residue predicate —
 *  one refusal set, no mirror. */
export function isAcceptFlowMarker(row: GroomSignalTradeRow): boolean {
  return !!(row.cohortId || row.positionGroupId || row.ticket);
}

export async function runGroomSignalTrades(
  deps: GroomSignalTradesDeps,
  opts: { apply: boolean; batchSize?: number },
): Promise<GroomCensus> {
  const rows = await deps.listSignalTrades();
  const eligibleRows = rows.filter((r) => !isAcceptFlowMarker(r));
  const eligibleByStatus: Record<string, number> = {};
  for (const r of eligibleRows) {
    const s = r.status ?? 'unknown';
    eligibleByStatus[s] = (eligibleByStatus[s] ?? 0) + 1;
  }
  const census: GroomCensus = {
    scanned: rows.length,
    eligible: eligibleRows.map((r) => r.id),
    eligibleByStatus,
    skippedAcceptFlow: rows.filter(isAcceptFlowMarker).map((r) => r.id),
    deleted: [],
    notFound: [],
    cascadeRefused: { acceptFlow: [], nonSignal: [] },
    failed: [],
  };
  if (!opts.apply) return census;

  // Serial within each batch — eligible legacy trades share one
  // `acct-{userId}` doc, so concurrent cascades contend on its
  // openTradeCount rewind (sibling handleDeletePaperTrades is serial too).
  const batchSize = Math.max(1, opts.batchSize ?? DELETE_PAPER_TRADES_MAX_ITEMS);
  for (let i = 0; i < census.eligible.length; i += batchSize) {
    for (const tradeId of census.eligible.slice(i, i + batchSize)) {
      let outcome: DeleteTradeCascadeOutcome | Error;
      try {
        outcome = await deps.deleteTrade(tradeId);
      } catch (err) {
        outcome = err instanceof Error ? err : new Error(String(err));
      }
      if (outcome === 'deleted') census.deleted.push(tradeId);
      else if (outcome === 'notFound') census.notFound.push(tradeId);
      else if (outcome === 'accept-flow')
        census.cascadeRefused.acceptFlow.push(tradeId);
      else if (outcome === 'non-signal')
        census.cascadeRefused.nonSignal.push(tradeId);
      else if (outcome instanceof Error)
        census.failed.push({ tradeId, error: outcome.message });
      else
        census.failed.push({
          tradeId,
          error: `unrecognized cascade outcome: ${String(outcome)}`,
        });
    }
  }
  return census;
}

// ── Production wiring ───────────────────────────────────────────────────────

/** Production deps — the Firestore scan + repository cascade seam. */
export function groomProdDeps(): GroomSignalTradesDeps {
  return {
    listSignalTrades: async () => {
      const snap = await paperItemsRef(adminDb, PaperTradingKind.TRADE)
        .where('source', '==', PaperTradeSource.SIGNAL)
        .get();
      return snap.docs.map(
        (d) => ({ id: d.id, ...d.data() }) as GroomSignalTradeRow,
      );
    },
    deleteTrade: (tradeId) => deleteTradeCascade(adminDb, tradeId),
  };
}

function printIds(label: string, ids: string[]): void {
  if (ids.length === 0) return;
  console.log(
    `  ${label} (${ids.length}): ` +
      `${ids.slice(0, 50).join(', ')}${ids.length > 50 ? ` …+${ids.length - 50}` : ''}`,
  );
}

function printCensus(census: GroomCensus, applied: boolean): void {
  console.log(
    `scanned ${census.scanned} signal-source trades — ` +
      `${census.eligible.length} eligible, ` +
      `${census.skippedAcceptFlow.length} skipped (accept-flow markers)`,
  );
  const hist = Object.entries(census.eligibleByStatus)
    .map(([s, n]) => `${s}:${n}`)
    .join(', ');
  console.log(`  eligible by status — ${hist || 'none'}`);
  console.log(
    `deleted ${census.deleted.length}, notFound ${census.notFound.length}, ` +
      `cascade-refused (accept-flow ${census.cascadeRefused.acceptFlow.length}, ` +
      `non-signal ${census.cascadeRefused.nonSignal.length}), ` +
      `failed ${census.failed.length}`,
  );
  if (!applied) {
    console.log('dry-run — pass --apply to delete the eligible set');
    return;
  }
  printIds('deleted ids', census.deleted);
  printIds('cascade-refused accept-flow', census.cascadeRefused.acceptFlow);
  printIds('cascade-refused non-signal', census.cascadeRefused.nonSignal);
  for (const f of census.failed) {
    console.log(`  FAILED ${f.tradeId}: ${f.error}`);
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const census = await runGroomSignalTrades(groomProdDeps(), { apply });
  printCensus(census, apply);
  if (census.failed.length > 0) process.exit(1);
}

const invokedAsScript =
  !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  main().catch((err) => {
    console.error('groom failed:', err);
    process.exit(1);
  });
}
