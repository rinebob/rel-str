**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1572  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Task:** #1575  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# CODE REVIEW — #1575 Backfill mint: backfillSignalTrade walk + generatePaperSignalTrades callable

Three-axis gate review of the historical mint: `backfillSignalTrade`
(picked `st-signals` occurrence → real `PaperTrade` at the signal-bar
close via `SDS_BARS`, marks backfilled, curated variants walked in
memory with the nightly evaluator + governing policy, real
`applyExitFill`, one walk-state commit), the
`generatePaperSignalTrades` callable (auth → shape validation →
cap-50 per-item `MintResult`s, per-symbol bars memo), the
`commitBackfilledTrade` repo seam, the
`FillDimensions.governingPolicy` ledger seam, spec, and the verify
script/guide/registry entries.

## Standards

2 major · ~10 minor/nit on first pass — all fixed in-gate; second and
third passes each surfaced remediation-scoped findings, all resolved.

| Finding | Severity | Disposition |
|---|---|---|
| Walk had no `Number.isFinite` guard — a NaN close could poison marks + trailing watermarks permanently | **major** | **Fixed** — `isUsableBar` gates every walked bar (finite close + defined `barStatus===1‖undefined`); unusable bars skipped, unusable SIGNAL bar errors the mint. |
| Commit-before-exit ordering: `applyExitFill` failure after the walk-state commit left EXITED runs with no exit fill, and dedupe masked the half-state | **major** | **Fixed** — order swapped to nightly's close→annotate (ledger close first, then the single state commit); resume handling added. |
| `isValidMarketDate(undefined)` threw a raw TypeError → `internal` not `invalid-argument` | minor | **Fixed** — `typeof` guard before date validation. |
| `markFailed` declared in deps but never called — staged tickets orphaned on mint failure | minor | **Fixed** — `markFailed` in the error path, gated by `entryCommitted` (once the ledger entry exists the ticket's "filled" stays the truth). |
| `already exists` race dedupe returned no `tradeId`; an early draft would have `markFilled(0)` over the winner's real fill | minor | **Fixed** — `tradeId` returned; no ticket transition on race (the winning mint owns `markFilled`). |
| Final commit didn't stamp `legs[].lastMark` / `lastMarkedAt` | minor | **Fixed** — `CommitBackfilledTradeUpdate` carries both. |
| Missing-SMA `ma-close` skips were silent | nit | **Fixed** — warn once per run. (First fix had a `Set.add` truthiness bug — warns every bar; self-review caught it, `has`/`add` corrected.) |
| Symbol casing not normalized in the callable | nit | **Fixed** — trim + uppercase before minting. |
| File length (~460 lines) exceeds the ~300-line preference | nit | Accepted — single coherent pipeline with documented divergences; extracting the walk was weighed and rejected (moves complexity rather than removing it). |
| Per-day orchestration duplicates `runExitEvalPass` | nit | Accepted — thermo-nuclear review explicitly rejected wrapping the nightly pass in an in-memory adapter; shared pure `evalTradeDay` extraction deferred as follow-up polish. |
| Callable writes to the shared `auto-paper` account under auth-only | nit | Accepted — matches sibling curated-mint callables; the account is the platform's, not the user's. |
| Interim signals/bars accepted | nit | Documented — `signalStatus` is stamped on the trade (observable, not gated); interim BARS are skipped by `isUsableBar`. |
| Current-day partial bar could be minted | nit | Mitigated — `barStatus===0/-1` bars are skipped by `isUsableBar`; loaders without `barStatus` are treated final (corpus predates the flag). |

## Spec

All acceptance criteria verified present: `st-signals` doc resolution
(`stSignalOccurrenceId`), bars via `getCachedBarsFromSymbolData`,
signal-bar close as entry fill with `SDS_BARS` provenance, curated set
+ governing policy marker, in-memory walk (marks per bar, governing
pick per day, ACTIVE eval in array order, shadow `exitEvent`s,
governing/independent close → `applyExitFill`, never-fired → OPEN),
one walk-state commit, SMA enrichment via `smaIndicatorsFor`, manual
pick ticket `auto:false` + `idSeed:tradeId` + filled transition,
callable auth/validation/cap-50/per-item results/per-symbol bars
cache, index registration, spec + consistency pin vs
`replaySignalToRow`.

| Finding | Severity | Disposition |
|---|---|---|
| Same commit-order hole as Standards M2 (dedupe masked half-mints) | **major** | **Fixed** — see failure-model below. |
| Identity/consistency: request pick vs signal doc fields | minor | **Fixed** — symbol/barDate/signalType must match the doc or error. |
| Direction corrupt → silent LONG default | minor | **Fixed** — `normalizeStSignalDirection` null → error. |

## Failure-model (the design center of this review)

The dedupe/resume seam went through three passes — each surfaced a
real defect in the discriminator:

1. **Pass 1:** no resume at all — a crashed mint deduped forever.
   **Fix:** resume on `lastMarkedAt === undefined`.
2. **Pass 2:** nightly mark-pass stamps `lastMarkedAt` on every OPEN
   signal trade — the discriminator masked crashed mints after one
   night. **Fix:** mark-derived audit — an OPEN doc is walked iff
   every usable stored bar after entry already carries a mark (the
   walk owns those marks). Resumes also re-seed runs (nightly may
   have advanced watermarks; replaying old bars against advanced
   state could false-trigger exits) and use stored ledger truth
   (`entryFill.price`, `trade.order.side`) rather than the pick's.
3. **Pass 3 (MAJOR):** the deterministic `tradeId` collides with
   live auto-ingest — a live-filled trade for the same signal
   (dispatch-date fill, `RH_MCP` provenance) fails the marks audit
   and would be resumed, walking bars *before its real entry* and
   potentially minting an exit dated before the entry fill. **Fix:**
   provenance gate — only docs whose entry fill is at the
   signal-bar date via `SDS_BARS` (i.e. mint-seeded) resume;
   foreign docs dedupe before the bars read.

Every partial state is now self-healing and pinned by specs:
entry-only crash → resume (even after nightly marks); close-then-
commit-miss → CLOSED doc dedupes, nightly repair annotates runs;
exit-fill failure → unwalked OPEN resumes to CLOSED; ticket lifecycle
(`markFailed` only pre-entry, no transition on race).

## Thermo-nuclear

| Finding | Severity | Disposition |
|---|---|---|
| Per-day orchestration duplicates `runExitEvalPass` — future drift risk | major (architectural) | Accepted with documented intentional divergences in the file header; adapter-wrapping the nightly pass was judged worse. Shared `evalTradeDay` extraction filed as follow-up. |
| Walk semantics vs nightly | verified | Governing pick → flags across full run array → ACTIVE eval in order → shadow exits → same-day latch → break at close — mirrors `runExitEvalPass` exactly; `workingState` replaced on non-trigger (matches eval-pass, not replay). |
| `Set.add` truthiness warn-spam | minor | **Fixed** (self-review). |
| `trade.legs[0]`/`entryFill` unguarded on corrupt docs | minor | **Fixed** — explicit guards (`entryFill` present, exactly 1 leg) → error result. |
| Date-keyed audit can't distinguish nightly EOD marks from walk marks | minor | Accepted + commented — requires `PaperMark` provenance to fix; outcome near-equivalent (same evaluator, same closes). |

## Tests

| Gate | Result |
|---|---|
| `backfill-signal-trade.test.ts` | **29/29** — incl. consistency pin vs `replaySignalToRow`, resume pins (crash, nightly-marked, exit-failure), live-ingest collision dedupe, ticket lifecycle, NaN/interim guards |
| `test:paper-trading` batch | **377/377** — zero regressions |
| `test:st-order-tickets` | **26/26** |
| `test:st-signals` | **34/34** |
| `tsc --noEmit` | clean |
| `scripts/verify/paper-trading-backfill-signal-trade-1575.ts` | **32/32** |

## Verdict

**PASS** — 3 passes; every major and actionable minor fixed in-gate
and pinned by a spec. Remaining nits are documented intentional
divergences or deferred follow-ups (shared `evalTradeDay`,
`PaperMark` provenance), none blocking.
