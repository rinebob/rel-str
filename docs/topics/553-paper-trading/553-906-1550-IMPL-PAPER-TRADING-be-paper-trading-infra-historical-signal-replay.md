**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1550  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-18  

# BE IMPL — Historical Signal Replay

Two ingestion paths feed ONE ledger. The historical path mints a real
`PaperTrade` per picked signal — entry at signal-bar close, marks
backfilled over stored bars, all `CURATED_VARIANT_KEYS` runs walked
forward in memory, committed in one shot. The live path is today's
auto-paper ingest widened to PRIMARY+SECONDARY lists and seeding the
same curated variant set. Grooming is a bulk hard-delete callable.

## Files

- `functions/src/paper-trading/passes/backfill-signal-trade.ts` — new:
  the in-memory walk + commit. *(#1575)*
- `functions/src/paper-trading/signal-trade-callables.ts` — new:
  `generatePaperSignalTrades` handler + prod deps + `onCall` export.
  `deletePaperTrades` lands in `callables.ts` (or sibling) under #1576.
- `functions/src/paper-trading/exits/registry.ts` — `ma-close-*`,
  `target-*` evaluators + `variantLevel` accessor.
- `functions/src/paper-trading/exits/governing-policy.ts` — new:
  `selectGoverningRun` implementing the curated policy.
- `functions/src/paper-trading/exits/eval-pass.ts` — governing-recompute
  hook for policy-marked trades; ctx enrichment for `ma-close`.
- `functions/src/paper-trading/repository.ts` — `deleteTradeCascade`
  seam; trade-update seam for the committed walk state.
- `functions/src/paper-trading/passes/auto-paper-ingest-pass.ts` — dims
  switch to `CURATED_VARIANT_KEYS` + `governingPolicy` marker.
- `functions/src/index.ts` — register the two callables.

## 1. `backfillSignalTrade` — the in-memory walk

`backfillSignalTrade(item: SignalPick, deps): Promise<MintResult>` —
per pick:

1. **Resolve the occurrence** — read the `st-signals` doc at
   `stSignalOccurrenceId(symbol, barDate, signalType)` (verify doc-id
   layout at task time; fall back to a symbol+barDate+signalType query).
   Absent → `{status:'error'}`. The doc supplies `direction`,
   `timeframe`, `status`, `indicators` for the same `tradeOverrides`
   stamps the live ingest applies (minus `captureList` — a manual pick
   has no list).
2. **Load bars** — `getCachedBarsFromSymbolData(symbol)` (the same
   loader replay uses). The signal's bar must be present — else
   per-item error, not a partial trade.
3. **Entry** — `applyEntryFill` with `fill.price = signal-bar close`,
   `fill.date = barDate`, `quoteSource: SDS_BARS` (SHARED §5),
   `dims.variantKeys = CURATED_VARIANT_KEYS`, `governingPolicy` marker.
   This creates the OPEN trade, seeds runs via `seedVariantRuns`, and
   does the account debit — the real ledger path, not a copy. Dedupe is
   free: `getTrade(tradeId)` first / `already exists` → `deduped`.
4. **Emit the pick ticket** — `StOrderTicketWriter` with `auto: false`,
   `idSeed: tradeId`, `markFilled` after the entry commit (SHARED §6).
5. **Walk forward in memory** — for each bar after the entry bar to the
   last stored bar:
   - `marks[barDate] = { mark: close, underlyingClose: close }`.
   - `daysHeld = calendarDaysBetween(entry.date, barDate)` — the same
     helper the eval pass uses.
   - Run the governing-selection policy (§3) → set `governing` on the
     day's chosen run.
   - `evaluateVariant(ctx)` per ACTIVE run — governing or
     independent-closer fire → record the exit fill + run `EXITED` with
     `exitEvent`; other-run fires → shadow `exitEvent` (same fields the
     daily pass writes); no fire → ratchet `workingState` in memory.
   - Governing/independent fire ends the walk: the trade closes at that
     bar's mark.
6. **Commit once** — one txn: append accumulated `marks`, final run
   states; then `applyExitFill` when the walk produced a closing fill —
   the real exit path credits the account and computes `realizedPnl`.
   Never-fire → trade stays OPEN at the last stored bar and the live
   nightly passes (mark + eval) pick it up — the history→live bridge is
   automatic via `listOpenSignalTrades` / `listCandidateTrades`.
7. **SMA precompute** — `ma-close` needs `smaN` per bar; compute rolling
   SMAs over the loaded bars once (pure, in-memory) and expose them to
   the eval ctx via the indicator accessor (§4).

Three txns max per pick (entry, marks+runs commit, optional exit) —
fast inside a callable; no Cloud Task needed at pick volume (~dozens).

**§1 as-built (#1575, post-review):** shipped as
`paper-trading/passes/backfill-signal-trade.ts` —
`backfillSignalTrade(item, deps)`. Order: terminal-status dedupe →
bars + d-ascending + usable-entry checks → **marks audit** (an OPEN
doc is walked only when every usable stored bar after entry already
carries a mark — the discriminator is mark-derived, NOT
`lastMarkedAt`, because the nightly mark-pass stamps that field on
every OPEN signal trade; a missing mark ⇒ crashed mint → resume) →
`st-signals` doc + identity/direction checks → pick ticket
(`auto:false`, `idSeed:tradeId`, fail-soft) → `applyEntryFill`
(signal-bar close, `SDS_BARS`, curated set + `governingPolicy` marker
via the `FillDimensions.governingPolicy` seam) → ticket `markFilled`
at the stored entry price → in-memory walk (resumes **re-seed** runs —
nightly eval may have advanced watermarks, and replaying old bars
against advanced state can false-trigger exits) → real `applyExitFill`
when a run fires (close→annotate order: the ledger close lands BEFORE
the state commit) → ONE `commitBackfill` (marks + full run array +
mirror + `legs[].lastMark` + `lastMarkedAt` + `unrealizedPnl` for open
trades). The walk mirrors the nightly pass exactly: per-day
`smaIndicatorsFor` enrichment, `selectGoverningRun` pick with
flag-corrected full run array, array-order `evaluateVariant`, same-day
latch (first governing/independent fire closes at that bar's mark,
later same-day fires shadow-record), blind-fire guard on missing SMAs
(warns once per run), unusable bars skipped (non-finite close or
defined non-final `barStatus`; an unusable SIGNAL bar errors), per-run
error isolation. Every partial state is self-healing: entry-only docs
resume on re-mint even after nightly marks; a close-then-commit-miss
leaves a CLOSED trade the nightly repair path annotates. Tickets:
staged-then-failed only when no ledger entry landed (`entryCommitted`
gate — once the trade exists the ticket's "filled" is the truth); an
`already exists` ledger race reads `deduped` with no ticket transition
(the winner owns `markFilled`). A corrupt `direction` errors;
`signalTradeDesc` throws unsupported types; all failures return
`MintResult.error`. Tests: `backfill-signal-trade.test.ts` (28 specs)
runs the REAL ledger over an in-memory txn store, incl. a consistency
pin that the minted outcome equals `replaySignalToRow` for the closing
variant and resume pins for the crash/nightly-marked/exit-failure
shapes.

## 2. `generatePaperSignalTrades` callable

`(request, deps)` convention — auth first, `items` validated
(`symbol`/`signalBarDate`/`signalType` shapes, max ~50), then per-item
`backfillSignalTrade` collecting `MintResult`s. A bad item errors in
its result; the call doesn't fail. Bars are cached per symbol within
the call (picks cluster by symbol).

**§2 as-built (#1575):** shipped as
`paper-trading/signal-trade-callables.ts` —
`handleGeneratePaperSignalTrades(request, deps)` +
`generatePaperSignalTradesProdDeps()` + the `onCall` export
(512 MiB / 300 s, `OPTIONS_STRATEGY_ALLOWED_ORIGINS`, registered in
`index.ts`). Auth first (unauthenticated → `HttpsError`), then
up-front shape validation (`invalid-argument` — malformed picks are
caller bugs, not data errors); per-item failures land in that item's
`MintResult` only. Bars are memoized per symbol for the call's
duration and passed into each mint (`deps.mint(item, {getBars})`) —
prod wiring delegates to `backfillSignalTrade` with
`st-signals`/`getCachedBarsFromSymbolData`/`getTrade`/ledger/`tickets`
deps.

## 3. Dynamic governing — `selectGoverningRun`

`selectGoverningRun(runs, ctx): VariantRun` — the curated policy:

- Candidates: ACTIVE runs whose `variantLevel(run, ctx)` is defined and
  sits on the stop side of the mark (below for longs, above for shorts).
- Long: governing = the candidate with the **lowest** level (deepest
  below the high watermark = most room). If that level is **below the
  entry fill price** → `trailing-8`'s run governs instead.
- Short: mirror — highest level governs unless it's above entry.
- The chosen run's `governing` flag is set for that day's eval.
  `trade.governingVariant` mirrors what actually governs (SHARED §3
  pin): seeded `'trailing-8'` at mint (`seedVariantRuns` requires a
  terminal-family key — a `ma-close-*` pick can't be seeded), rewritten
  to the policy's selection each eval day, and rewritten to an
  independent closer's key when one fires the real exit (keeps
  `exitReason` truthful). Only ACTIVE runs are candidates; if
  `trailing-8`'s own run is already EXITED the fallback can't apply and
  the deepest ACTIVE candidate governs instead.

**Eval-pass hook:** when `trade.governingPolicy ===
CURATED_GOVERNING_POLICY`, `runExitEvalPass` re-runs
`selectGoverningRun` for the mark date before iterating runs —
minted-OPEN trades get the same policy under live management. Trades
without the marker keep today's static `governingVariant` behavior —
existing live trades are unchanged.

`selectGoverningRun` is pure — fully unit-testable on fixture levels.

**§3 as-built (#1574):** shipped as
`exits/governing-policy.ts` —
`selectGoverningRun(runs, ctx)` + `smaAt(bars, date, period)` (sorted
defensively; undefined on short windows) + `smaIndicatorsFor` (collects
the `indicators.sma` map per distinct period). Candidacy is
**family-scoped** (`trailing-stop`/`ma-close` only) AND
**watermark-scoped** — the side test is vs the trade's high watermark
(peak, from run `workingState` + entry + mark), NOT today's mark: a
stop breached today still sits below the peak → stays a candidate →
its trigger fires the real close (the mark-side reading stranded every
loser OPEN — review-caught impl bug, not a spec gap). `undefined` when
nothing qualifies — the mirror then keeps its last value until a closer
rewrites it. Eval-pass hook: `policyActive = governingPolicy ===
CURATED_GOVERNING_POLICY && status === OPEN` — pick → ONE atomic
`applyGoverningPick` write carrying flag-corrected `variantRuns` +
`governingVariant` (repo seam; no observable mid-state), under the
file's per-trade error isolation. Same-day `closedThisPass` latch:
post-close triggers shadow-record instead of re-attempting the ledger.
`getBars` is per-symbol pass-cached and mark-gated.
ASSIGNED/CLOSED policy trades use the static path (the ASSIGNED
share-exit seam is unchanged). Production wiring split to
`eval-pass-deps.ts` (eval-pass.ts 383 lines).

## 4. New exit evaluators + `variantLevel`

Registry additions (SHARED §4 table):

- `ma-close-{N}` — fire when the mark crosses the N-day SMA (longs:
  `mark < smaN`; shorts: `mark > smaN`). `variantLevel` = today's smaN.
  Needs bars/indicator access: the `VariantEvalCtx` gains an optional
  `indicators?: { sma?: Record<number, number> }` accessor — backfill
  supplies precomputed SMAs; the nightly eval enriches ctx for trades
  carrying `ma-close` runs via a new `getBars` dep on `defaultEvalDeps`
  (absent bars → skip that run with a summary error, never fire blind).
- `target-{pct}` — fire when mark reaches entry × (1±pct); `variantLevel`
  = the target price. Family = independent closer.

Registry gains **`variantLevel(run, ctx): number | undefined`** so the
governing selector compares rules uniformly; `undefined` (time exits,
unparsed keys) is never a governing candidate.

**Closing classes:** `evalOne` closes on `run.governing ||`
`isIndependentCloser(run.variantKey)` (target/time families) — shadow
recording unchanged for everything else.

**§4 as-built (#1574):** grammar in `exits/registry.ts` —
`ma-close-{N}` (close-cross of the N-day SMA; `indicators.sma` on
`VariantEvalCtx`; absent data → no fire) and `target-{pct}` (entry ×
(1±pct)). `variantLevel(run, ctx)` returns the rule's current price
level — trailing rides the watermark including today's mark, `ma-close`
= today's SMA, `target` = the fixed price, `initial-stop` = the entry
band; `undefined` for time/limit/unparseable. `isIndependentCloser` =
`target` + `time-stop` families, honored **only on policy trades**
(`policyClose` flag in `evalOne`) — unmarked trades keep the
governing-only close rule. Independent-closer fire → `applyExit` +
`setGoverningVariant` rewrite to the closer key (attribution pin).
`defaultEvalDeps` gains `getBars` (`getCachedBarsFromSymbolData`
dailyBars) + `setGoverningVariant`; ma-close runs without SMA data
skip with a summary error. `ExitVariantParams` (shared) gained
`ma-close`/`target` members — the strategy-builder picker narrowed to
`PickerVariantFamily` so non-terminal families stay unselectable.
Coverage: 64 focused specs (registry + governing-policy + eval-pass),
344/344 paper-trading batch, `verify
paper-trading-curated-exit-engine-1574` (33 checks).

## 5. `deletePaperTrades` callable + cascade

`(request, deps)` — `{tradeIds}` validated, then per id a
`deleteTradeCascade` repository seam: transaction deletes the trade
doc; post-txn best-effort removes `rq-*` rawQuote docs
(`where('tradeId','==',id)`) and `pap_*` tickets (query by the ticket's
trade linkage — `idSeed`/origin ref; pin the field at task time). A
missing trade id lands in `notFound` — deletes are idempotent for
re-grooming. Stats docs are recomputed by the nightly stats pass —
deleted trades simply drop out of the next snapshot; no eager recompute.

**§5 as-built (#1576, post-review):** shipped as
`repository.deleteTradeCascade(db, tradeId)` → `'deleted' | 'notFound' |
'non-signal' | 'accept-flow'` + the `deletePaperTrades` onCall in
`signal-trade-callables.ts` (registered in `index.ts`). Ticket linkage
is a **direct-id delete, not a query** — `st-order-tickets` docs carry
no `tradeId` field; the cascade deletes `stTicketId('paper', tradeId)`
(the `pap_{tradeId}` lifecycle/pick ticket — the only ticket a curated
or auto-ingest trade ever emits) in one post-txn batch with the `rq-*`
docs. **Review remediation (2 majors):** (1) the refuse gate is narrower
than `source=SIGNAL` — a trade carrying `cohortId`/`positionGroupId`/
`ticket` is *accept-flow* lineage whose staged member tickets live on
the cohort/group docs and would keep minting zombie trades into a
dangling cohort, so the txn returns `'accept-flow'` → per-item `failed`
(curated picks and auto-ingest captures carry none of the markers);
(2) the account doc is ledger-incremental and *never* recomputed — the
txn now rewinds `openTradeCount` for lifecycle-open deletes
(`LIFECYCLE_OPEN_TRADE_STATUSES`), while cash/equity/realizedPnl stay
unwound as documented groom drift (reversing them needs the
fill-accounting model). Auth is `auth.uid`-only, same as the mint
sibling — a deliberate groom-tool asymmetry vs `closePaperTrade`'s
ownership gate, noted not gated. Post-txn cleanup is best-effort —
failures log `paper_delete_cascade_cleanup` and still report `deleted`;
absent-doc deletes are no-ops, so re-grooming is always safe. Residual
(nits, documented not fixed): ~ms window where a same-id re-mint could
lose its fresh ticket/audit doc to a trailing cleanup batch; `pap_*`
deletes are id-unverified; >500 rq docs would overflow one batch
(~2yr daily marks — unrealistic for groomed trades).

## 6. Live ingest — curated set + config widening

- `runAutoPaperIngestFill` dims change: `variantKeys: CURATED_VARIANT_KEYS`
  + `governingPolicy: CURATED_GOVERNING_POLICY` in `tradeOverrides`/
  dims — new captures carry the same tracked set as minted picks.
  `SIGNAL_GOVERNING_VARIANT` stays for non-signal trades.
- **Config widening is a doc edit, not code**: `st-config/autoPaper`
  `lists` gains the SECONDARY list key (verify real key names via a
  prod probe — `paper-trading-auto-paper-916-inputs` precedent);
  `signalTypes` stays the four trend-rider types (other types throw in
  `signalTradeDesc` — widening the type allowlist is a desc-grammar
  task if ever wanted). `createdOpportunity` already surfaces every
  signaled symbol — no candidate-gate change.
- Live-date gate unchanged: historical runs still never auto-ingest —
  the only path from history to the ledger is an explicit pick.

**§6 as-built (#1576):** ingest dims swapped in
`runAutoPaperIngestFill` — `governingVariant:
DEFAULT_TRAILING_STOP_KEY` (the policy's 'trailing-8' fallback seed),
`governingPolicy: CURATED_GOVERNING_POLICY`, `variantKeys:
[...CURATED_VARIANT_KEYS]`; `SIGNAL_*` retained in `callables.ts` +
`expression-fill-pass.ts` for non-signal trades. **Config probe found a
stray widening** — `st-config/autoPaper` read
`lists: ["PRIMARY","SECONDARY","MONITOR","NEW"]` (ownerUid
`wAFg…NI3`); user confirmed MONITOR+NEW (490 symbols) were unintended —
**doc corrected to `["PRIMARY","SECONDARY"]`** on 2026-11-18. No
candidate-gate or signalTypes change; live-date gate unchanged.
Coverage: 20 delete specs (incl. accept-flow refuse + account-rewind
pins) + 1 SECONDARY/dims ingest pin (398/398 paper-trading batch),
`verify paper-trading-ledger-ops-1576` (36 checks), prod config read
confirmed.

## Operational notes

- **Account leg**: minted trades book to `AUTO_PAPER_USER_ID` — user
  decision: historical and live are the same book. Entry debit /
  exit credit at historical prices land in the live account's
  aggregates; accepted (the book is synthetic anyway).
- **Idempotency**: `buildTradeId` keys on signal barDate — a
  re-generated pick is a `deduped` result, and a live capture of the
  same signal can never double-mint.
- **Open-at-mint trades** join `runSignalMarkPass` +
  `runExitEvalPass` automatically — no dispatch changes.
- **Consistency pin**: a spec asserts the minted trade's outcome equals
  `replaySignalToRow`'s row for the same signal+variant (same return,
  same exit reason) — catches walk/eval drift against the shipped
  replay engine.
