**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1512  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Domain:** STRAT-MANAGE  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-14  
**Last Updated:** 2026-11-14  

# IMPL (BE) — OpsStrat Manage Page Overhaul

## Scope

Engine-side work in `functions/src/paper-trading/engine/`: read the new
`ManageInstance` docs, open positions on the daily noon-PT routine per
trigger kind, track exits via the shared registry, and emit
analysis-compatible contract-list docs.

FE writes instance docs directly to Firestore (existing pattern — no CRUD
callables in v1). BE consumes them in passes.

## Design

### 1. Instance reader — `manage-instance-reader.ts`

- Query `st-strategy-instances` where `runState == 'ACTIVE'`, partitioned by
  `trigger` for the noon pass. Read the new `ManageInstance` shape only —
  legacy `StrategyInstanceConfig` docs no longer exist (collection cleaned);
  keep a narrow adapter so old-shape docs, if any survive, are skipped with a
  warning rather than crashing the pass.

### 2. Open pass rework — `passes/open-pass.ts` + `open-pass-timer.ts`

- The noon-PT scheduled pass iterates ACTIVE instances:
  - `trigger: 'daily'` → open a new position every trading day (ladder —
    concurrent positions accumulate, honoring `maxOpenPositions` if set).
  - `trigger: 'signal'` → open only when a fresh ST signal exists for the
    instance's symbol at the pass (query the signal source; blueprint picks
    the canonical "today's signal" lookup — likely the same collection the
    signal-review flow writes).
- `runState !== 'ACTIVE'` → skip. `STOPPED`/`UNSTARTED` get nothing — no
  separate pause handling needed (today's PAUSED semantics cover it).
- Position opening resolves each variant leg (Δ/DTE → contract) using the
  existing quote-provider/selection machinery; multi-leg positions write
  one position doc with `legs[]`.

**As-built (#1539):**

- The manage flow is a **new pass**, `passes/manage-open-pass.ts`, plus a
  new reader module — `open-pass.ts` itself only shed its
  `StrategyInstanceConfig` coupling (`evaluateOpenGates` now takes
  `(positions, { cadenceDays, maxOpenPositions }, marketDate)`; the
  legacy call site derives cadence from frequency).
- Scheduling is a **separate noon cron**, `manageOpenPassTimer`
  (`0 12 * * 1-5` PT, `RH_CREDENTIAL_BUNDLE` secret), exported from
  `functions/src/index.ts` — not folded into the legacy 5-minute slot
  timer, since manage instances carry no `openTimePT`.
- Signal source confirmed: `st-signals` — "fresh" = a doc whose
  `marketDate` (first-detection run date) equals the pass date. Signals
  detected by the morning intraday runs fire at noon; nightly-detection
  signals written post-close carry yesterday's `marketDate` and do not
  re-trigger (documented boundary).
- Dedup is two-layered and idempotent: cadence scan (any position opened
  on `marketDate` skips) + deterministic position id
  `{instanceId}-{marketDate}` with a pre-create `getPosition` check —
  concurrent ticks converge on the same doc id.
- Per-leg resolution: shared `fetchOptionExpirations` → expiry in the
  leg's DTE ±15d band → `fetchAllOptionInstruments` → `fetchOptionQuotes`
  → `selectOptionContract` on |Δ|; OCC ids via `buildOccContractId`.
  Legs resolve **sequentially with an exclusion set** — same-Δ targets
  can never mint one contract twice. The chain/quote fetchers moved into
  `rh-mcp-shapes.ts` and `expression-fill-pass` consumes them too.
- `createManagePosition` (position-repository) writes through
  `applyEntryFill` with `fill.price = |netPremium|` and order side =
  cash direction (SHORT credit / LONG debit) — single-leg fill semantics
  would book only leg-0's cash on spreads. `governingVariant` is `NONE` —
  `seedVariantRuns` was extended to admit `none` as the observational
  case (empty `variantKeys`/`variantRuns`, same doc shape
  `positionToTrade` writes); manage positions never auto-exit (B3's
  exit-scan evaluates exits). `expression` stamps the template code.
- Stock legs **throw** — `PositionLeg` has no share branch and the v1
  catalog has no stock-leg templates; share plumbing is a later task.
- `maxOpenPositions` honored as an optional console-edited field
  (non-negative int; malformed values warn + drop, `0` = uncapped).
- v1 paper-only gate: `listActiveManageInstances` warn-skips non-`paper`
  modes (mirrors legacy `isRunnablePaperInstance`); the legacy reader
  pre-filters `runState` docs so manage instances don't warn-spam
  legacy ticks.
- Error path: a thrown pass writes `{skipped:true, skipReason:'error'}`
  to `daily-analysis/latest` before rethrowing; `lastFiredAt` stamps via
  an injectable dep after mint (stamp failure warns, never fails).
- `st-order-tickets` parity: opens stage a `program`/`auto` ticket and
  mark it filled/failed — `averagePrice` is |netPremium|.

### 3. Exit-tracking pass — `passes/exit-scan-pass.ts` (new)

- Runs daily after mark-pass. For each open position of each manage
  instance, extend its mark series, then run the evaluators from
  `shared/options-analysis-registry.ts` +
  `functions/src/options-analysis/exit-evaluators.ts`:
  - `mode: 'paper'` → every `EXIT_REGISTRY` entry, one result per
    `(position, exitId)` — the exit matrix.
  - `mode: 'real'` (v2 path, schema-only) → only the instance's `stopType`.
- Results persist to `st-options-analysis-results/{instanceId}_{exitId}`
  docs, reusing the existing result-doc shape wherever fields line up
  (open question #5 — prefer reuse).

**§3 as-built (#1544):** shipped as `passes/manage-exit-scan-pass.ts`
+ `manageExitScanTimer` (1:30 PM PT cron, after the mark-pass grid ends
~1 PM PT — SA corpus fetch, no RH session/secrets). **Multi-leg
resolution:** a position's daily "mark" is its signed cost-to-close —
`mark(d) = Σ (short ? +mark_i : −mark_i)` over the inner join of the
legs' SA contract series (a date missing from any leg can't price the
package); `entryMark` = signed net premium at open. Identical to a
single contract's price for one-leg positions; keeps `evaluateExit`
untouched. `contractId` carries the deterministic position id
(multi-leg traceability — no single OCC id exists). `expired` uses net
intrinsic at the underlying close + max per-leg `assignmentDistancePct`
(per-leg ITM flags generalized). Fetch failure → `error` records per
rule; missing `contractID`/unpriceable → warn + skip. `mode:'real'`
evaluates nothing — the `stopType`→rule mapping waits on the real-mode
STOP_CODES vocabulary (placeholder `T8` today); paper's `ALL` → every
`EXIT_STRATEGIES` entry, so new registry rules auto-apply.
`manageExitScanResult` observability stamped on `daily-analysis/latest`.
`verify strat-manage-exit-scan-1544` covers the surface (34 checks).

**Post-review hardening:** `optionsAnalysisStart` now rejects
contract-list docs with synthetic `pickDocMeta` (`gridVersion === 0`)
— a manual replay run on a manage list would overwrite the pass's
position-grain result docs at the same `{instanceId}_{exitId}` ids with
per-leg contract records (last-writer-wins collision). Per-instance
try/catch isolation (one Firestore failure can't kill the day's matrix);
`parseMark` rejects blank strings; bar dates normalized `slice(0,10)` +
clipped to `[openDate, min(expiry, today)]`; `resp.ok === false` →
error records; `expired.terminalMark` = intrinsic (worker convention,
not the possibly-stale expiry-bar mark); positions opened today skip
(the EOD corpus can't carry an entry-day bar at 2 PM); mixed-expiry
legs → error (the terminal-value model can't price a still-open far
leg); non-finite intrinsic/distance → error (Firestore rejects
`Infinity`); `underlyingClose` hoisted per instance with an empty-map
warn; one `generatedAt` per instance run; timer moved to 2 PM PT so it
clears the mark-pass grid year-round (PDT included).

### 4. Contract-list emission — `passes/contract-list-writer.ts` (new)

- When a position opens, append its leg contracts as rows to
  `st-options-contract-lists/{instanceId}` so
  `options/strategy/backtest/analysis/{instanceId}` resolves — doc id IS
  the instanceId (symbol already embedded; no `_SYM` suffix). Row shape
  follows `ContractListRow` conventions (one row per leg contract;
  backtest side adopts the id format — separate thread).

**§4 as-built (#1543):** `passes/contract-list-writer.ts` emits
**v1 pick rows** (`ContractListPickRowV1`, `kind:'pick'`), one per
resolved option leg — the analysis worker still filters
`kind === 'pick'` rows (the BE v2 consumer migration is a separate
task), so v2 `position` rows would resolve-but-yield-zero-trades.
`runId` = instanceId; `status: 'success'` from first write (the doc is
analyzable at any point — rows accrue, nothing to wait on);
`pickDocMeta` synthesized with leg 0's coordinate + `gridVersion: 0`
(no SA grid behind a live open — lossy for multi-leg by design, and
the worker never reads it). `repeatsPrevious` uses **same-index**
comparison against the previous open's leg group — the meaningful
"same contract rolled forward" signal for multi-leg; literal
v1-previous-row semantics would compare leg i to leg i−1 (always
false). Missing quote numerics write `NaN` (never a fabricated `0`);
`underlyingClose` carries the live equity quote at entry. The pass
invokes it via a new `appendContractListRows` dep AFTER the position
mints — a write failure warns + continues.

**Post-review hardening:** the doc update is a single `upsertDoc` seam
— prod runs read-modify-write inside `runTransaction` (concurrent
appends can't drop leg groups; complete `set` clears stale `error`).
The append is idempotent per `(entryDate, contractId)` and the pass's
`already_opened_today` path re-attempts a lost group from persisted
position legs (greeks → NaN) — the repair story for a post-mint
append failure. The pass bounds every append at 30 s so a wedged MCP
call can't starve the serial instance loop or skip the result write.
`resolveOptionLeg` dedupes same-OCC instruments so a candidate's mark
and greeks always come from the same quote. `RhResolvedQuote` was
extended with `bid`/`ask`/`iv`/`volume`/`openInterest` to feed the
rows; `RhMcpToolCaller` hoisted into `rh-mcp-shapes`. `verify
strat-manage-contract-list-1543` covers the surface.

### 5. Existing passes, unchanged behavior

- mark/settlement/stats passes keep running against `st-paper-trading`
  anchored positions; they just see manage positions as ordinary positions.
- `listStrategyPositions` / `getStrategyEquityCurve` callables already
  filter by `instanceId` — no change needed for US-6.

### 6. Manual open callable — `passes/manage-open-callable.ts` (new)

**§6 as-built (#1545):** `manageOpenPassManual` — `onCall`,
`secrets: ['RH_CREDENTIAL_BUNDLE']`, 512 MiB/120 s, us-central1.
`runManageOpenPassManual(request, deps)` is the deps-injected core
(`getInstance`/`openSession`/`runPass`/`ticketsFactory`/`marketDate`);
the `onCall` export is a thin wrapper, matching the
`runAnalysisStart` convention. Auth guard → `instanceId` trim +
required → `getManageInstance` (`not-found` on missing/malformed) →
`runState !== 'ACTIVE'` and `mode !== 'paper'` return no-op
`skipped` results (`not_active`/`non_paper` — new
`ManageManualSkipReason` extends the pass's union) rather than
erroring, so the FE start flow can drive transitions through one
surface. "Due" is the pass's own gating — cadence dedup →
`already_opened_today`, signal freshness → `no_fresh_signal`, and the
deterministic `{instanceId}-{marketDate}` position id makes a
double-click harmless (idempotent by construction). One RH MCP
session per invocation, closed in `finally`; session-open and pass
failures map to `internal` with the cause preserved; a lost
same-instance race (`ALREADY_EXISTS` on the deterministic position
id) reports `already_opened_today` rather than a spurious `internal`.
`verify strat-manage-open-callable-1545` covers the surface
(15 checks).

## Task breakdown (BE)

1. **B1 — Manage instance reader + open-pass rework** — ACTIVE query by
   trigger, daily ladder + signal gating, multi-leg resolution via existing
   selection machinery.
2. **B2 — Contract-list writer** — emit `{instanceId}` docs on position
   open; ContractListRow-compatible rows per leg.
3. **B3 — Exit-scan pass** — daily evaluator run per open position;
   paper=all exits, real=configured; write analysis-results-shaped docs.
4. **B4 — Manual open pass callable** — absorb #157: callable that runs an
   open pass for one instance on demand (drives the table's start semantics
   for immediate first-open when desired).

## Dependencies

- S1–S3 (SHARED) block all BE tasks.
- ST signal lookup contract (B1, signal trigger) — needs the canonical
  signal-read; if the signal source isn't cleanly queryable, B1 splits
  (daily trigger lands first, signal follows).
