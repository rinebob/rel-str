**Topic:** Strategy Builder UI  
**Topic Slug:** strat-manage  
**Thread:** OpsStrat Manage Page Overhaul  
**Thread Slug:** page-overhaul  
**Issue:** #1536  
**Thread Parent:** #1510  
**Topic Parent:** #137  
**Task:** #1539  
**Domain:** STRAT-MANAGE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# Code Review — #1539 BE: Manage instance reader + open-pass rework

## Scope reviewed

New: `paper-trading/engine/manage-instance-reader.ts`,
`paper-trading/engine/passes/manage-open-pass.ts`, shim pair under
`options-strategy-engine/`, `manage-open-pass.test.ts` (21 tests),
`strat-manage-open-pass-1539.ts` + `.md` verify harness.
Modified (manage hunks): `open-pass-gates.ts` (decoupled signature),
`open-pass.ts` (call site), `open-pass-timer.ts` (`manageOpenPassTimer`
noon cron), `position-repository.ts` (`createManagePosition`),
`strategy-instance-repository.ts` (manage-doc pre-filter), `index.ts`
(export), `ledger.ts` (`seedVariantRuns` observational-`none` case),
`expression-fill-pass.ts` + `rh-mcp-shapes.ts` (shared fetchers).
Working tree carries foreign in-flight edits in neighboring files —
reviewed manage-domain hunks only.

## Verdict: PASS

Three axes; eight majors found — seven fixed in this pass and re-verified,
one dispositioned as pre-existing (ledger account-target limitation, shared
with the legacy path). Regression: 523/529 green — the 6 failures are
foreign in-flight edits (`stats-repository` mid-refactor, `writeDataset`
suite), confirmed untouched by this change.

## Axis summaries

### Thermo-Nuclear — FAIL → fixed

- **M1 — `createManagePosition` could never succeed:** `applyEntryFill →
  seedVariantRuns` throws on non-terminal governing keys and `'none'`
  parses to nothing — every manage open would have died at the ledger.
  Tests never exercised it (injected `createPosition`). Fixed by
  extending `seedVariantRuns`: `NONE_VARIANT_KEY` seeds
  `{variantKeys: [], variantRuns: []}` — the observational-trade contract,
  byte-identical to what `positionToTrade` writes, keeping the
  transactional account update. Ledger spec amended + a new spec pins
  the empty-seed shape.
- **M2 — multi-leg cash booked leg-0 only:** `fill.price`/`order.side`
  came from `paperLegs[0]` — a 5.00/3.00 debit spread debited $500, not
  $200. Fixed: `fill.price = |netPremium|`, order side = cash direction
  (SHORT=credit, LONG=debit); `expression` stamps the template code
  instead of a mislabeled single-leg code.
- **M3 — reader crashed on `variant: null`:** `typeof null === 'object'`
  slipped the guard → `variant.legs` threw → the whole noon pass died on
  one malformed doc. Fixed + per-leg validation added (kind, OptionType,
  TradeSide, finite positive targetDelta, positive-int dte).
- **M4 — same-contract legs:** per-leg `selectOptionContract` had no
  exclusion pool; adjacent Δ targets minted duplicate `buildLegId`s on a
  self-canceling position. Fixed: sequential resolution, each pick joins
  the exclusion set; expirations fetch hoisted to once-per-pass.
- **M5 — `lastFiredAt` unseamed:** direct `db` write meant tests/verify
  touched real Firestore and a post-mint failure split bookkeeping. Now
  a `stampLastFiredAt` dep (default merges onto the instance doc);
  post-mint stamp failures warn but never fail the pass.
- **M6 — `paperAccountId` divergence (DISPOSITIONED):** the ledger always
  books `buildAccountId(userId)` while tickets honor `paperAccountId` —
  a **pre-existing** limitation identical in the legacy path
  (`open-pass-tickets.ts:55`). Flagged for a ledger follow-up; not
  introduced here.
- **M7 — no trading-day guard (DISPOSITIONED):** `getMarketDatePT` is
  calendar-today; the noon cron fires market holidays. No
  market-calendar helper exists anywhere in the codebase and the legacy
  pass shares the exposure (its `getUnderlyingClose` null-check does not
  actually block holidays — last close persists). Flagged as accepted
  shared gap.
- **M8 — errors left stale success:** throws wrote nothing, so
  `daily-analysis/latest` kept yesterday's "opened". Fixed: the pass
  wraps its flow, writes `{skipped, skipReason:'error', error}` before
  rethrowing; the sink's own failure never masks the real error.

### Standards — PASS-WITH-FINDINGS → fixed

- **Duplicated selection machinery (FIXED):** the ~120-line
  chains→instruments→quotes→select flow copied from
  `expression-fill-pass`. `fetchOptionExpirations`/`fetchOptionQuotes`
  now live in `rh-mcp-shapes.ts` and both passes consume them
  (expression-fill keeps its string `expiration_dates` arg — the
  working-prod convention).
- **Missing paper-mode gate (FIXED):** the reader admitted `mode:'real'`
  ACTIVE docs — a console-flipped instance would mint paper trades under
  a real-mode id. `listActiveManageInstances` now warn-skips non-paper
  (mirrors `isRunnablePaperInstance`).
- **Ticket fill price (FIXED):** `markFilled` stamped leg-0's mark;
  now `|netPremium|` — the honest spread fill price.
- Minors fixed: injectable-clock leak in `stageManageTicket` (`deps.now`),
  dead `e.dte !== undefined` check, dead `normalizeTimestamp` fallback,
  `stopType` normalized before validation/output, `defaultWriteResult`
  via `strategyInstanceDailyAnalysisRef`, ticket side consistency at
  `netPremium === 0`.
- Dispositioned: `stageManageTicket`/`stageOpenTicket` overlap (different
  origin/terms — judgement call, left), `isTimestampOrString`/
  `normalizeTimestamp` re-declared (8-line stable helpers, siblings
  already duplicate), `getManageInstance` has no caller yet — kept for
  B4 (#1545 manual open callable).

### Spec — PASS-WITH-FINDINGS → fixed/dispositioned

- **Legacy warn-spam (FIXED):** `listInstances` full-scans the root; every
  ACTIVE manage doc would warn each 5-min tick. Manage docs (`runState`
  field) now pre-filtered before `normalizeInstance`.
- **Paper-only (FIXED):** same gate as Standards.
- Dispositioned: (a) the skip-with-warning adapter is unreachable for
  pure legacy docs by design — the `runState=='ACTIVE'` query excludes
  them server-side before validation (reader header documents this);
  (b) `marketDate`-keyed freshness is the verified "detected today"
  semantic — signals written by nightly post-close detection carry the
  prior date and don't re-trigger next noon (boundary documented in
  IMPL as-built); (c) ticket staging + result write-back weren't in the
  IMPL letter but are the legacy open path's observability seam — kept
  (the #1549 results popup consumes `manageOpenPassResult`).

## Test status

21/21 manage-open-pass specs · 31/31 ledger specs · 29/29 verify checks ·
`tsc` clean (functions) · `npm run build` clean. Regression: 523/529 —
6 failures confirmed foreign (`stats-repository` mid-refactor,
`writeDataset` CSV suite).

## Remaining flags for downstream tasks

- `PositionLeg` has no share branch — stock legs throw (share plumbing
  is a later task; v1 catalog has no stock-leg templates).
- `markPosition`/`settlement` are single-leg (`findPrimaryLeg`) — latent;
  manage positions aren't iterated by the legacy per-instance loop, and
  B3 (#1544) owns manage mark-series extension.
- Composite index needed for `st-signals` `symbol + marketDate` query —
  deploy step should verify the index exists.
- Market-holiday guard: shared gap, needs a calendar helper that doesn't
  exist yet — flag to blueprint before real mode ships.
