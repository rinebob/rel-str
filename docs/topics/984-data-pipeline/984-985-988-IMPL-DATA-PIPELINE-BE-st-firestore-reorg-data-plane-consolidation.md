**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #988  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** IMPL  
**Area:** BE  
**Status:** Draft  
**Created:** 2026-10-14  
**Last Updated:** 2026-10-28  

# IMPL — Data Plane Consolidation: BE (functions)

## Overview

All writer/reader changes on the functions side, executed in phases that preserve live trading: dual-write → verify → cutover for every collection that carries live data.

## Phase 1 — Canonical signals (`st-signals`)

1. `SignalDateWriter.persistBarDate()` — add upsert of `st-signals/{SYM}_{barDate}_{signalType}` alongside existing `run-ids`/`signal-history` batch writes. Upsert semantics: `set(merge)` + `runIds: arrayUnion(runId)`; `status` from `barStatus` (INTERIM unless historical); `marketDate`/`sourceRunId` set on create only. *(As-built #1000: done — plus fail-soft per-entry skip + wholesale try/catch so a canonical-path failure can't drop the legacy batch; deps seam `{db, fieldValue, logger}`; parity audit `functions/scripts/verify/data-pipeline-st-signals-dual-write-1000.ts`.)*
2. **Backfill script** (`.devin/tmp`-style tsx or `scripts/`): walk `signal-history/{barDate}` docs → mint canonical `st-signals` docs (status CONFIRMED); walk `run-ids` for occurrences absent from history → INTERIM. Verify: counts per symbol, no dupes.
3. Gate fields on `st-symbols/{SYM}` — keep writing to both `savant-trader/data/symbols` and `st-symbols` during transition (mirror write).
4. Cutover: after verification soak, flip reads to `st-signals`/`st-symbols`, stop legacy writes.

## Phase 2 — Universal tickets (`st-order-tickets`)

1. Writers — every action path emits a ticket:
   - auto-paper ingest: `origin:{type:signal, signalId, runId}`, `auto:true`, `mode:paper` — before ledger write.
   - `runOpenPass`/`openPassTimer`: `origin:{type:program, instanceId}`, `auto:true`, `mode` from instance.
   - `paperSignalOrder` callable: `origin:{type:signal|manual}`, `mode:paper` — creates staged tickets instead of PENDING trades.
   - Live submit path: `origin:{type:signal|manual|management}`, `mode:live`, `refId`→RH `ref_id`, `brokerOrderId` + `reviewSnapshot` at submit, `fillSummary` on observed fill.
   - Management actions (stop_loss, fractional_close): `origin.type:management`, `positionGroupId`.
2. **Dual-write** `order-intents` + `st-order-tickets`; migrate the 77 existing docs (map `source`→`origin.type`, `status:'paper'`→`mode:'paper'`); cut readers over after verify.
3. `cancel_pending` state — cancel accepted ≠ cancelled (async at RH).
4. `lastError:{category,message}` on failures (RH `rh_error_category`).

## Phase 3 — Position groups (`st-position-groups`)

1. Signal-order accept creates group `{SYM}-{YYMMDD}-grp-{NN}`; spawned tickets carry `positionGroupId`; trades stamped at mint.
2. Live groups: `brokerOrderIds[]` → join via `tax_lots[].order_id` (equity) / `option_id`/`chain_id` (options).
3. Migrate 9 cohort docs → groups (carry `signalId`, `tradeIds`→`memberTradeIds`).

## Phase 4 — Expression-fill at minted-fill

1. `expression-fill-pass` reads staged tickets (not PENDING trades) → resolves contract → mints trade `{SYM}-{YYMMDD}-{origin}-{expr}-{exp}-{strike}-{NN}` + stamps `strike`/`expiration`/`optionType` fields + `positionGroupId`.
2. `cancelPaperTrade` on pending → ticket `state:cancelled`.

## Phase 5 — Strategy instances (`st-strategy-instances`)

1. Migrate 4 `options-strategy-instances` docs → `st-strategy-instances` with `mode:'paper'`.
2. Re-point `strategy-instance-repository`, engine passes, callables; delete `paper-trading/instances` anchor.

## Phase 6 — Renames + consolidation

1. `paper-trading/{accounts,trades,stats,raw-quotes}` → `st-paper-trading/*` (copy + dual-write soak + cutover; update `paper-trading-ids.ts` path math).
2. `portfolio/{buckets,attributions}` → `st-portfolio/*`; `backtest-runs/permutations` → `st-backtest-*`.
3. `trading-config` + `status/current` → `st-config/{docId}`; `symbol-lists` → `st-symbol-lists`.
4. `review-list` + `occurrence-decisions` — stop writes (TTL keeps draining); remove readers.

## Phase 7 — Maintenance + cleanup

1. `jobs` TTL: scheduled cleanup deleting `st-runs/*/jobs` docs >7d; one-shot purge of 1.24M backlog.
2. NEW-list backfill: additive — zero-membership tracked symbols → `{uid}_NEW`.
3. Security rules + `firestore.indexes.json` for new paths (st-signals by marketDate/status; tickets by mode/state/origin refs; trades by positionGroupId).
4. Legacy deletion (final phase, after diffs): `savant-trader/data/*`, `rh-agent-*`, `options-strategy-*`.
   *(As-built #1013: soak mirrors + sweeper removed and undeployed — `orderIntentsMirror`,
   `portfolioItemsMirror`, `stBacktest{Runs,Permutations}Mirror`, `tradingConfigMirror`,
   `symbolListsMirror`, `stStatusMirror`, `cleanupStOccurrenceDecisions`; legacy fallbacks
   dropped from `getTicketDoc`, `addSymbolToDefaultList`, `strategy-instance-repository`,
   `position-repository`; retired ACLs + index entries removed; parity relay
   `verify/data-pipeline-legacy-roots-1013.ts` + archive/delete op
   `scripts/archive-legacy-roots-1013.ts` (dry-run default). Retired: `order-intents`,
   `review-list`, `status`, `symbol-lists`, `trading-config`, `occurrence-decisions`,
   `symbol-meta`, `options-strategy-*`, `portfolio` items, `backtest-*`,
   `paper-trading/{accounts,trades,stats,raw-quotes}` items, `rh-agent-*` (except
   `rh-agent-credentials` — live auth). Still live — NOT retired: `savant-trader/data/{runs,symbols}`
   + subcollections (#1159/#1019), `paper-trading/cohorts`, `paper-trading/analysis-*` (#1160).)*
   *(As-built #1159: doc-level traffic cut to `st-runs`/`st-symbols` — run create/
   enqueue/progress/TTL/callables repointed; `SignalDateWriter` split so gate
   fields write `st-symbols` while `run-ids`/`signal-history` stays on the legacy
   parent until #1019 cuts readers to `st-signals`. `migrate-st-runs-symbols-1159.ts`
   copied 244 runs + 23,150 jobs → `st-runs` and 926 symbol docs → `st-symbols`
   verbatim (no subcollections); relay `verify/data-pipeline-st-runs-symbols-1159.ts`
   green 9/9. Review round: `stageCopy` gained an updateTime direction guard —
   post-deploy straggler re-runs SKIP canonical-newer docs (post-cutover drift)
   instead of overwriting live state; relay legs gained empty-legacy floors so
   a zero-evidence run fails rather than passing vacuously; the 916/918 meta
   legs + replay/backfill ops scripts were repointed off the frozen root.
   `savant-trader/data/runs` archive+delete pending at ship;
   `savant-trader/data/symbols` retained as subcollection host until #1019.)*

## Dependencies

SHARED area (contracts/paths/IDs) must land first. FE cutovers pair with BE phases 1/2/6.

## Risks

- Dual-write divergence — mitigate with per-phase verify scripts comparing counts/IDs.
- Live ticket migration must preserve `refId` — losing idempotency keys risks duplicate broker orders on re-submit.
- `symbol-added`/`pdr` run paths must upsert signals identically — same `SignalDateWriter` path covers them.
