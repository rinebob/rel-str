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
**Last Updated:** 2026-11-17  

# BE IMPL — Historical Signal Replay

Two ingestion paths feed ONE ledger. The historical path mints a real
`PaperTrade` per picked signal — entry at signal-bar close, marks
backfilled over stored bars, all `CURATED_VARIANT_KEYS` runs walked
forward in memory, committed in one shot. The live path is today's
auto-paper ingest widened to PRIMARY+SECONDARY lists and seeding the
same curated variant set. Grooming is a bulk hard-delete callable.

## Files

- `functions/src/paper-trading/passes/backfill-signal-trade.ts` — new:
  the in-memory walk + commit.
- `functions/src/paper-trading/callables.ts` (or sibling) — new
  `generatePaperSignalTrades` + `deletePaperTrades` handlers.
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

## 2. `generatePaperSignalTrades` callable

`(request, deps)` convention — auth first, `items` validated
(`symbol`/`signalBarDate`/`signalType` shapes, max ~50), then per-item
`backfillSignalTrade` collecting `MintResult`s. A bad item errors in
its result; the call doesn't fail. Bars are cached per symbol within
the call (picks cluster by symbol).

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

## 5. `deletePaperTrades` callable + cascade

`(request, deps)` — `{tradeIds}` validated, then per id a
`deleteTradeCascade` repository seam: transaction deletes the trade
doc; post-txn best-effort removes `rq-*` rawQuote docs
(`where('tradeId','==',id)`) and `pap_*` tickets (query by the ticket's
trade linkage — `idSeed`/origin ref; pin the field at task time). A
missing trade id lands in `notFound` — deletes are idempotent for
re-grooming. Stats docs are recomputed by the nightly stats pass —
deleted trades simply drop out of the next snapshot; no eager recompute.

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
