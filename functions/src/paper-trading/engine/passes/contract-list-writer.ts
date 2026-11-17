/**
 * @topic #137 — Strategy Builder UI
 * @task #1543 — BE: Contract-list writer ({instanceId} docs on position open)
 *
 * On each successful manage open, appends one `ContractListPickRowV1`
 * (`kind:'pick'`) per resolved option leg to
 * `st-options-contract-lists/{instanceId}` so the options analysis route
 * (`options/strategy/backtest/analysis/{instanceId}` →
 * `optionsAnalysisStart`) resolves: the callable only gates on
 * `status:'success'` + `runId`/`symbol`/`templateId`, and the worker reads
 * v1 pick rows (`contractId`, `entryDate`, `expiration`, `mark`, `delta`,
 * `iv`, `strike`) — so manage docs stay on the v1 row schema until the BE
 * consumer migration emits/reads v2 (`ContractListRow` position rows).
 *
 * Doc shape mirrors `OptionsContractListDocV1` with `runId = instanceId`
 * and `pickDocMeta` synthesized from the written legs' leg-0 coordinate
 * (`gridVersion: 0` — there is no SA pick-doc grid behind a live manage
 * open). Meta is lossy for multi-leg variants by design: the analysis
 * worker never reads it, and the v1→v2 narrowing shim only needs a
 * coordinate to stamp onto rows — leg 0's is the least-wrong single
 * answer. `pickCount` counts leg rows (not open-days), `missCount` stays
 * 0, and skipped days emit no `no-selection` marker — the
 * `[firstDate, lastDate]` range has implicit gaps a one-row-per-day v1
 * consumer would misread; none exists today.
 *
 * `repeatsPrevious` uses same-index comparison against the previous
 * position's leg group (a multi-leg generalization of v1's "previous row
 * picked the same contractId"): manage rows are always appended in
 * complete legs.length-sized groups, so the row at
 * `pickRows.length - legs.length + i` is the previous open's leg i.
 * Comparing to the literally-preceding flat row would compare leg i to
 * leg i-1 — different contracts by construction, always false. The flag
 * is write-only today: the worker ignores it and the v1→v2 shim
 * re-derives its own (narrowed-position) semantics.
 *
 * Missing quote numerics write `NaN` (Firestore stores it) rather than
 * `0` — `0` asserts a real bid/ask/volume that never existed.
 * `underlyingClose` carries the live equity quote at entry (the field
 * name is a schema holdover; for a noon open there is no close yet).
 *
 * The doc update is a single `upsertDoc` seam — prod runs the
 * read-modify-write inside `runTransaction` so a racing manual-open
 * callable (B4) or cron overlap can't lose a leg group. The append is
 * idempotent per `(entryDate, contractId)`: re-invoking with a leg
 * group that already landed (the `already_opened_today` reconcile)
 * returns the doc untouched.
 *
 * Residual notes: `generatedAt` is an ISO string while the SA writer
 * stamps `serverTimestamp()` — Firestore sorts timestamps before
 * strings, so manage docs order after same-day SA docs in the list
 * picker (cosmetic; the field's declared type is `string`). A
 * legs-count change mid-life (variant edited 2→3 legs) misaligns the
 * same-index group math — write-only flag, cosmetic. When the deferred
 * v2 consumer migration emits `position` rows onto these docs, this
 * writer must move to the v2 schema rather than mixing v1 pick rows
 * into a `schemaVersion:2` doc.
 */

import { db } from '../../../firebase-admin-init';
import { ST_OPTIONS_CONTRACT_LISTS_ROOT } from '@st/collections';
import {
  legToPickDocCoordinate,
  type ContractListPickRowV1,
  type OptionLeg,
  type OptionsContractListDocV1,
  type PickDocMeta,
} from '@options-replay/contracts';
import type { RunnableManageInstance } from '../manage-instance-reader';
import type { ResolvedLegContract } from './manage-open-pass';
import type { RhMcpToolCaller } from '../rh-mcp-shapes';
import { MCP_PREFIX, extractEquityPrice } from '../rh-mcp-shapes';
import { calendarDaysBetween } from '../../../common/pt-date-utils';
import { createLogger } from '../logging';

const logger = createLogger('ContractListWriter');

/** One resolved option leg — the variant spec leg plus its filled
 *  contract fields, as produced by `resolveOptionLeg`. */
export interface ContractListLegInput {
  leg: OptionLeg;
  contract: ResolvedLegContract;
}

export interface ContractListWriterDeps {
  /** Read-modify-write the list doc — prod runs the callback inside a
   *  Firestore transaction so concurrent appends can't drop rows. The
   *  callback receives the current doc (undefined when absent) and
   *  returns the full replacement; the write is a complete `set`, so a
   *  stale `error` field on a prior doc is cleared too. */
  upsertDoc: (
    instanceId: string,
    fn: (
      existing: OptionsContractListDocV1 | undefined,
    ) => OptionsContractListDocV1,
  ) => Promise<void>;
  /** Live underlying price at entry — wired to `get_equity_quotes` in prod. */
  fetchUnderlyingPrice: (symbol: string) => Promise<number | undefined>;
  now: () => Date;
}

const numOrNaN = (v: number | undefined): number =>
  v !== undefined && Number.isFinite(v) ? v : NaN;

/** Append one pick row per resolved leg to the instance's contract-list
 *  doc, creating it on first open. */
export async function appendManageContractListRows(
  instance: RunnableManageInstance,
  legs: readonly ContractListLegInput[],
  marketDate: string,
  deps: ContractListWriterDeps,
): Promise<void> {
  if (legs.length === 0) return;

  const underlyingClose = await deps.fetchUnderlyingPrice(instance.symbol);

  await deps.upsertDoc(instance.id, (existing) => {
    const priorRows = existing?.rows ?? [];
    const pickRows = priorRows.filter(
      (r): r is ContractListPickRowV1 => r.kind === 'pick',
    );

    // Same-index comparison against the previous open's leg group — the
    // meaningful "rolled the same contract forward" signal for multi-leg
    // positions (v1 was single-leg so literal-previous-row == same-index).
    const prevGroupStart = pickRows.length - legs.length;
    const newRows: ContractListPickRowV1[] = legs.map(({ leg, contract }, i) => {
      const prev = prevGroupStart >= 0 ? pickRows[prevGroupStart + i] : undefined;
      return {
        kind: 'pick',
        entryDate: marketDate,
        side: leg.side,
        repeatsPrevious:
          prev?.kind === 'pick' && prev.contractId === contract.contractID,
        underlyingClose: numOrNaN(underlyingClose),
        contractId: contract.contractID,
        expiration: contract.expiration,
        dte: calendarDaysBetween(marketDate, contract.expiration),
        strike: contract.strike,
        delta: numOrNaN(contract.delta),
        iv: numOrNaN(contract.iv),
        mark: contract.mark,
        bid: numOrNaN(contract.bid),
        ask: numOrNaN(contract.ask),
        volume: numOrNaN(contract.volume),
        openInterest: numOrNaN(contract.openInterest),
      };
    });

    // Idempotent dedupe — a reconcile re-append (or any retry) with a
    // leg group that already landed adds nothing.
    const present = new Set(
      pickRows.map((r) => `${r.entryDate}|${r.contractId}`),
    );
    const freshRows = newRows.filter(
      (r) => !present.has(`${r.entryDate}|${r.contractId}`),
    );
    if (existing !== undefined && freshRows.length === 0) return existing;

    const pickDocMeta: PickDocMeta = {
      coordinate: legToPickDocCoordinate(legs[0].leg),
      gridVersion: 0,
      pickCount: pickRows.length + freshRows.length,
      missCount: 0,
      firstDate: pickRows[0]?.entryDate ?? marketDate,
      lastDate: marketDate,
    };

    return {
      runId: instance.id,
      symbol: instance.symbol,
      templateId: instance.variant.templateId,
      status: 'success',
      rows: [...priorRows, ...freshRows],
      pickDocMeta,
      generatedAt: deps.now().toISOString(),
    };
  });
  logger.info(
    `contract-list ${instance.id}: appended ${legs.length} leg rows`,
  );
}

// ==========================
// Production wiring
// ==========================

/** Production deps — `callTool` is the open pass's session-scoped RH MCP
 *  caller (same session, no extra connect). */
export function prodContractListWriterDeps(
  callTool: RhMcpToolCaller,
): ContractListWriterDeps {
  return {
    async upsertDoc(instanceId, fn) {
      const ref = db.collection(ST_OPTIONS_CONTRACT_LISTS_ROOT).doc(instanceId);
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const existing = snap.exists
          ? (snap.data() as OptionsContractListDocV1)
          : undefined;
        // Complete set (no merge) — the doc is fully specified and any
        // stale `error` field a prior failed doc carried is cleared.
        tx.set(ref, fn(existing));
      });
    },
    async fetchUnderlyingPrice(symbol) {
      try {
        const raw = await callTool(`${MCP_PREFIX}get_equity_quotes`, {
          symbols: [symbol],
        });
        return extractEquityPrice(raw, symbol);
      } catch (e) {
        logger.warn(
          `contract-list ${symbol}: underlying price fetch failed — ${e instanceof Error ? e.message : String(e)}`,
        );
        return undefined;
      }
    },
    now: () => new Date(),
  };
}
