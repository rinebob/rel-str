# ADR-012: Signal Selection — Checkbox = Ledger Membership; Auto-Ingest Becomes the Log Writer

## Status

Accepted

## Context

Topic #553 (Paper Trading Infra), Thread #1117 (Signal Selection) designs
the symbol-by-symbol review workflow where a user browses accumulated
signal occurrences and keeps the ones they would have traded.

Two architectures were on the table. Under the shipped auto-paper model
(Thread #904), `runAutoPaperIngestFill` mints a `PaperTrade` for every
qualifying signal on PRIMARY/SECONDARY list members — curation then
means *deleting* the ones you wouldn't have taken. Early planning for
this thread extended that model with a per-symbol review cursor: a
"convert these and delete the rest" commit sealed a contiguous
`[cursor, seal]` range, checked rows stayed minted, unchecked minted
rows were deleted, and the cursor advanced.

Grilling surfaced two problems with the cursor model:

- **It forces linear review.** The user does not review a symbol's
  backlog front-to-back — they start at recent signals, jump to a hot
  stretch, and revisit regions non-linearly. A cursor models a queue;
  the actual gesture is browsing.
- **Auto-mint makes "keep" expensive.** If minted trades render
  checked, curation is *unchecking* the rejects — hundreds of toggles.
  The user wants the opposite default: everything unchecked, check only
  the keepers.

Separately, `backfillSignalTrade` (#1575) already replays a trade's
entire lifecycle on mint — entry at signal-bar close, marks replayed
from stored bars, exits evaluated forward. A trade minted weeks after
its signal carries identical lifecycle data to one minted on the day.
Auto-mint's entire value was "capture the signal so it's never lost" —
but a durable occurrence log provides that guarantee without minting
anything.

## Decision

**Checkbox = ledger membership.** The review pane shows a symbol's
Signal Log with one checkbox per occurrence. Checked means a
`PaperTrade` exists for that occurrence; checking mints it via the
backfill machinery, unchecking deletes it via `deletePaperTrades`
cascade. There is no cursor, no commit range, no rejected state — each
toggle is an independent ledger action.

**Auto-ingest becomes the log writer.** `runAutoPaperIngestFill` stops
minting `PaperTrade`s and instead appends signal-occurrence records to
each eligible symbol's Signal Log. The log is the capture net — the
data-collection guarantee ("never miss a signal, even when nobody
reviews") survives without the mint.

**The legacy minted ledger is bulk-deleted.** The ~300 auto-minted
trades in production (including the ~60 stray NEW-capture residue
censused under #1576) are deleted via `deletePaperTrades` before the
new flow goes live — the log repopulates as the sole source, and only
user-kept signals ever mint. No kept flag, no grandfathered cohort.

## Considered Options

- **Auto-ingest keeps minting; checkbox reflects ledger membership** —
  rejected: live signals arrive pre-checked, restoring the
  reject-by-uncheck workload the user explicitly rejected.
- **Auto-ingest keeps minting; separate "kept" flag on trades** —
  rejected: a second selection state parallel to ledger membership —
  the duplicate-universe cognitive load rejected in earlier planning.
- **Per-symbol cursor + seal-commit ("convert these and delete the
  rest")** — designed, then rejected: forces linear review; the seal
  range doesn't exist when review is non-linear.
- **No log; derive occurrences at query time from SDS_BARS** — rejected
  for the canonical log: the per-symbol list needs persistence (a
  browsable record of every occurrence and its disposition), and the
  ingest pass already detects eligible occurrences — writing them is
  the same pass, not a new scan.
- **Keep legacy minted trades as checked-by-default** — rejected: they
  were never user-selected; a clean ledger means "checked" always means
  "a human kept this." Re-minting is trivial for anything actually
  wanted — the log retains the occurrences.

## Consequences

- `runAutoPaperIngestFill` changes output: occurrence writes replace
  trade mints. The detection machinery, list-membership gating, and
  dedupe semantics carry over unchanged.
- Paper trades only ever exist because a human checked a box — the
  ledger becomes the curated pick store by construction, which is what
  "only trades surviving curation are analyzed" was always reaching
  for.
- Unselected occurrences persist forever in the log — the negative
  cohort for kept-vs-unselected pattern analysis is free.
- Backfill minting is the only path to a trade: every trade's entry is
  at its signal-bar close with marks replayed to today. Latency of
  selection is irrelevant to data quality.
- A per-symbol `lastOpenedAt` stamp survives as pure view metadata —
  it drives the "new since last visit" divider and gates nothing.
- The bulk legacy delete is destructive but recoverable in aggregate:
  every deleted trade's signal occurrence remains logged, and any
  wanted trade is one checkbox away.
- Mint volume becomes human-scale (one user, occasional sessions), so
  `generatePaperSignalTrades`-style batch minting is sufficient — no
  ingest-throughput path needed.

## Addendum — blueprint as-decided mechanics (2026-11-20)

Blueprint grounding refined the decision without changing it:

- **`st-signals` already IS the Signal Log.** The ST detection pipeline
  has always upserted one occurrence doc per detection
  (`{SYM}_{barDate}_{signalType}`) across every run. No new collection,
  no new writer — "auto-ingest becomes the log writer" reduces to
  "auto-ingest stops minting." Retirement is `st-config/autoPaper.enabled
  = false`, a config flip with no code change (physical pass removal is
  deferred cleanup).
- **`st-signals` stays flat.** Docs carry a `symbol` field; every reader
  already queries `where('symbol','==')` — the pane's exact access
  pattern. A per-symbol subcollection restructure was evaluated and
  rejected (migration + five reader/writer call sites, no benefit a
  field index doesn't already give).
- **Review universe = PRIMARY ∪ SECONDARY members exactly.** The
  queue callable derives the picker from the list docs themselves —
  symbols outside the lists are never part of the surface (no filtering
  UI), though their `st-signals` docs remain for `/signals/review` and
  the analysis datasets.
- **Pane reads a bundle callable.** `getSignalReviewBundle(symbol)`
  returns D-timeframe occurrences + the server-side join to
  `source=SIGNAL` trades (`checked`/`tradeId` via `signalDedupeKey`) +
  the `lastOpenedAt` read-then-stamp. `getSignalReviewQueue` feeds the
  symbol picker. Checkbox toggles call the existing
  `generatePaperSignalTrades`/`deletePaperTrades` callables directly.
- **Pane location:** new route `/signals/symbol-review`, shaped like
  `chart-view` with the symbol's occurrence list as the left pane.
