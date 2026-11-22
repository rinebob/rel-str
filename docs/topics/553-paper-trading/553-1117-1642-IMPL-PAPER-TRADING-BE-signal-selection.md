**Topic:** Paper Trading Infra  
**Topic Slug:** `paper-trading`  
**Thread:** Signal Selection  
**Thread Slug:** `signal-selection`  
**Issue:** #1642  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Domain:** PAPER-TRADING  
**Type:** IMPL  
**Status:** Approved  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# BE IMPL — signal-selection: review callables, legacy wipe, auto-mint retire

## Architecture overview

Three deliverables, one file cluster:

```text
getSignalReviewQueue({})
  → st-config/autoPaper.ownerUid            (which user's lists)
  → st-symbol-lists/{uid}_PRIMARY + _SECONDARY  (member sets)
  → st-symbols where symbol 'in' members (30/chunk)  → lastDailySignalDate
  → st-config/signalReview                  → lastOpenedAt map
  → SignalReviewQueueRow[]

getSignalReviewBundle({ symbol })
  → st-signals where symbol==X and timeframe=='D', orderBy barDate desc
  → paper-trading/trades/items where symbol==X and source==SIGNAL
  → join: checked = signalDedupeKey(SYM,type,barDate) ∈ trade.signalId set
  → st-config/signalReview read → previousOpenedAt
  → st-config/signalReview stamp lastOpenedAt[SYM] = now → openedAt
  → GetSignalReviewBundleResponse

wipe (ops script, not a callable)
  → enumerate paper-trading/trades/items where source==SIGNAL
  → same eligibility predicate the delete handler applies
    (refuses cohortId/positionGroupId/ticket → reported skipped)
  → deleteTradeCascade per eligible id, batched

retire auto-mint (config op + verify, zero code)
  → st-config/autoPaper.enabled := false
  → verify script asserts enabled==false + signal-trade census == 0
```

## Boundary

- **`functions/src/paper-trading/signal-review-callables.ts`** (new) —
  both handlers + `onCall` wrappers + prod-deps factories. Mirrors
  `signal-trade-callables.ts`'s deps-injection shape.
- **`functions/src/index.ts`** — two callable exports.
- **`functions/scripts/groom-legacy-signal-trades.ts`** (new) — the wipe
  driver; runs locally under admin SDK like the seed/groom siblings.
- **`functions/scripts/verify/paper-trading-signal-review-*.ts`** — DRY/
  LIVE verify pair for the callables + post-wipe/retire census.
- **Not this area:** mint/delete semantics (`signal-trade-callables.ts`
  already owns them — reused verbatim); Firestore schema changes (none —
  `st-signals` and `st-config` already exist); detection changes (out of
  scope per PRD).

## Files

- `functions/src/paper-trading/signal-review-callables.ts` (new)
- `functions/src/index.ts` (modified — 2 exports)
- `functions/src/common/st-collections.ts` (modified — re-export
  `SIGNAL_REVIEW_CONFIG_DOC`, SHARED task)
- `functions/scripts/groom-legacy-signal-trades.ts` (new — wipe)
- `functions/scripts/verify/paper-trading-signal-review-callables-{task}.ts` (new)
- `functions/scripts/verify/paper-trading-signal-review-retire-{task}.ts` (new)
- `tests/functions/paper-trading/signal-review-callables.test.ts` (new)
- `scripts/verify/run-all.ts` + `scripts/verify/README.md` (registration)

## Modules

- **`handleGetSignalReviewQueue(deps)`** — reads `AutoPaperConfig` for
  `ownerUid`, loads both list docs' member sets (union, deduped),
  batches `st-symbols` `in`-queries for `lastDailySignalDate`, merges
  the review-state stamp map. Member with no signals still appears —
  the picker shows the whole universe.
- **`handleGetSignalReviewBundle(deps)`** — the three reads, the
  `signalDedupeKey` join (server-side — the FE never sees the key), a
  read-then-stamp of `st-config/signalReview` returning the *prior*
  value as `previousOpenedAt`. Occurrence → row mapping is a thin
  reshape of `StSignal` + join fields.
- **`SignalReviewDeps`** — injected seams: `listOccurrences(symbol)`,
  `listSignalTrades(symbol)`, `listMembers(listKey, ownerUid)`,
  `getSymbolSignalDates(symbols)`, `getReviewState()`,
  `stampOpened(symbol, at)`, `now()`. Prod wiring: Firestore queries +
  `signalDedupeKey`/`stSignalOccurrenceId` from the shared id helpers.
- **`groom-legacy-signal-trades.ts`** — paged scan of `source==SIGNAL`
  trades; applies the same eligibility the `handleDeletePaperTrades`
  cascade enforces (non-signal / cohort / ticket / positionGroup rows
  → skipped + reported, never force-deleted); calls `deleteTradeCascade`
  (repository seam — the callable's prod dep) in
  `DELETE_PAPER_TRADES_MAX_ITEMS`-sized batches; `--dry` default,
  `--apply` to write.
- **Retire step** — `st-config/autoPaper.enabled = false` is an ops
  action (console/script); the task's artifact is the verify script
  asserting it, plus AC evidence that a forced run mints zero trades.

## Contracts

Per SHARED IMPL — `GetSignalReviewQueueRequest/Response`,
`GetSignalReviewBundleRequest/Response`, `SignalReviewOccurrence`,
`SignalReviewStateDoc`, `SIGNAL_REVIEW_CONFIG_DOC`. Callable deploy
names `getSignalReviewQueue` / `getSignalReviewBundle` in `index.ts`.

Handler error semantics (mirror `signal-trade-callables.ts`):
- non-string / empty `symbol` → `invalid-argument`.
- symbol with no occurrences → `occurrences: []`, state still stamped
  (opening an empty log is still a visit).
- stamp write failure → the whole call throws `internal` — silently
  serving a bundle without stamping would freeze the divider forever;
  a retried read is the safe failure.

## Decisions

- **Join on `trade.signalId`, not deterministic trade id** — `signalId`
  carries `signalDedupeKey` for curated mint and legacy auto-ingest
  lineage, so the join is one set-membership test. **Review correction
  (#1649 gate, 2026-11-22):** accept-flow trades are an exception — the
  `paperSignalOrder` FE stamps `signalId` with
  `canonicalOccurrenceDecisionId` = `{runId}_{SYM}_{timeframe}_{type}`
  (paper-ticket.util.ts → firestore-helpers.ts), a third namespace that
  carries **no barDate** and cannot be back-mapped to an occurrence.
  Those trades join as `checked: false` despite being ledger members.
  The implementation must either accept this as scoped coverage
  (documented: accept-flow trades don't appear checked — they can't be
  uncheck-deleted through the pane, which the cascade would refuse
  anyway) or widen the match with the known cross-barDate
  false-positive hazard. Decide in #1650 and pin the chosen semantic
  in its spec — the pane-facing honest claim is only "checked =
  curation-mint membership."
- **`timeframe=='D'` filtered in the query** — `W` occurrences can't
  mint (mint allowlist is daily); rendering them would put dead
  checkboxes in the pane. The field stays on the row for forward-compat.
- **Stamp inside the bundle read** — a second callable would invite
  drift between "what the divider shows" and "when I was last here."
  `previousOpenedAt`/`openedAt` both returned so the FE renders the
  stable position.
- **Queue reads lists, not st-signals** — the universe is PRIMARY ∪
  SECONDARY membership by decision; a member with zero occurrences is
  still reviewable (its log starts empty).
- **Wipe shares the callable's eligibility predicate, not a looser
  rule** — accept-flow/user-accepted trades survive by design; they
  were also human selections, just through the order page. The PRD's
  "only trades surviving curation are analyzed" applies to the *pane's*
  curation scope.
- **Retire via config, not code deletion** — `enabled:false` is
  reversible and needs no deploy; `runAutoPaperIngestFill` stays
  deployed-inert. Physical removal is deferred cleanup (out of this
  thread's scope).

## Sequence / phases

- **Phase 1 — Task: review callables** — module + handlers + deps +
  `index.ts` exports + specs + verify script.
- **Phase 2 — Task: legacy wipe** — groom script (dry/apply) + verify.
- **Phase 3 — Task: auto-mint retire** — config flip (ops step, user
  executes) + census verify (`enabled==false`, zero `source=SIGNAL`
  trades post-wipe, forced run mints nothing).

Blocked by SHARED contracts task.

## Prior art / regression

- `signal-trade-callables.ts` — deps-injection pattern, error mapping,
  and the `DeletePaperTradesDeps`/`deleteTradeCascade` seam the wipe
  reuses verbatim. `#1575` backfill mint is untouched — the pane calls
  it per toggle via the existing callable.
- `auto-paper-ingest-pass.ts` — untouched code; retirement is config.
  Its `AutoPaperConfig.ownerUid` convention is the queue's list-doc
  resolver (same answer to "which user's lists").
- `stGetSymbolSignalHistory` (dashboard-callables.ts) — prior
  per-symbol read; the bundle supersedes it *for the pane* (uncapped +
  join + stamp). The signal-review page keeps using it — no migration.

## Verify relay

- `cd functions && npm run test:paper-trading` — handler + wipe specs
  live in that batch (add the new spec file to the script)
- `cd functions && npm run build`
- `functions/scripts/verify/paper-trading-signal-review-*` — DRY in
  run-all; LIVE asserts real Firestore state post-ops
- Callable-name parity: `index.ts` exports ↔ FE `CallableName` (FE task)

## Risks / open seams

- **Trade join size** — `source==SIGNAL` per symbol is small post-wipe
  (curated-only); pre-wipe symbols carry ~hundreds at most. No index
  beyond the existing symbol+source composite need is anticipated —
  confirm at verify (Firestore will say if a composite index is needed).
- **Stamp race** — two concurrent bundle reads for one symbol: last
  writer wins on `lastOpenedAt[symbol]`; both get a valid
  `previousOpenedAt`. Harmless for a single-user surface.
- **Wipe irreversibility** — `--apply` deletes ~300+ docs; dry-run
  census output is the required pre-check (AC), and the delete is
  per-doc idempotent so a re-run is a no-op report.
- **`enabled:false` vs in-flight task runs** — a Cloud Tasks run already
  dispatched before the flip could still mint; the retire AC's
  "next run mints zero" check is what proves the gate took effect.
