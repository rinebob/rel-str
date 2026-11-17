**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1581  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Task:** #1573  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-17  

# UAT — #1573 Signal-replay contracts

## Scope

The shared contract surface for the merged-ledger design (Thread #906):
mint/delete callable request+response types, the curated variant set,
the governing-policy marker + `governingVariant` mirror semantics,
`OptionQuoteSource.SDS_BARS`, and the live⇄mint id-determinism
guarantee. Pure contract task — no runtime feature ships here; the
downstream tasks #1574–#1576 consume these shapes.

## Prerequisites

- Repo checkout at `C:\aa\projects\rel-str`, Node + npm installed.
- `cd functions && npm install` previously run (tsx available).
- No env vars, no Firebase/ADC, no dev server needed — everything here
  is compile-time contracts + pure functions.

## Getting to the feature

**Not applicable — library seam, no UI route.** The "feature" is the
shared contract module consumed by the Angular app and Cloud Functions.
Reach it by opening `shared/paper-trading-contracts.ts` (and
`shared/options-common.ts` for the enum). Downstream tasks (#1575 mint
callable, #1576 delete callable) will have callable surfaces; their own
UATs cover those.

## Test scenarios

### 1. Contract spec suite

- **Confirms:** constants pinned (7-key curated set, policy marker,
  batch bounds), mint/delete request+response shapes, `governingPolicy`
  field shape, `SDS_BARS` fill provenance, live⇄mint id determinism,
  `SIGNAL_*` constants retained.
- **Run:** `npx jest shared/paper-trading-contracts.spec.ts --coverage=false`
- **Expected:** `Tests: 24 passed, 24 total` (7 new specs in the
  `curated signal-trade contracts (Thread #906)` describe block).
- **Result:** PASS — 24/24 (2026-11-15).

### 2. Runtime verify script

- **Confirms:** the runtime-verifiable contract surface incl. the
  swapped-layout trap pin (dedupe `signalId` ≠ `stSignalOccurrenceId`).
- **Run:** `cd functions && npx tsx scripts/verify/paper-trading-curated-contracts-1573.ts`
- **Expected:** `=== 14 passed, 0 failed ===`, exit 0. Guide:
  `functions/scripts/verify/paper-trading-curated-contracts-1573.md`.
- **Result:** PASS — 14/14 (2026-11-15).

### 3. Eyeball — mint contract semantics

- **Confirms:** `MintResult.signalId` is the dedupe key, explicitly NOT
  `stSignalOccurrenceId`.
- **Steps:** open `shared/paper-trading-contracts.ts`, find
  `interface MintResult` — the `signalId` JSDoc names `signalDedupeKey`
  `{SYM}_{signalType}_{barDate}` and warns NOT `stSignalOccurrenceId`.
  Cross-check `shared/st-ids.ts` `stSignalOccurrenceId` builds
  `{SYM}_{barDate}_{signalType}` — different layout by design.
- **Result:** PASS — JSDoc at ~line 640 states both layouts + the NOT
  warning; `st-ids.ts` confirms the swapped order.

### 4. Eyeball — governing-variant mirror semantics

- **Confirms:** `governingVariant` JSDoc pins seed=`'trailing-8'` at
  mint (terminal-family gate), rewrite on each eval day, rewrite to an
  independent closer's key on close; `governingPolicy?: GoverningPolicy`
  optional field present.
- **Steps:** read the `governingVariant` JSDoc (~line 232) and
  `CURATED_GOVERNING_POLICY` block (~line 420, value
  `'deepest-stop-else-trailing-8'`, ACTIVE-candidates + dead-fallback
  pin).
- **Result:** PASS — mirror semantics + policy doc present as described.

### 5. Eyeball — delete contract

- **Confirms:** `DeletePaperTradesResponse` = `{ deleted, notFound,
  failed: {tradeId, error}[] }`; scoped to `source=SIGNAL`; derived
  aggregates documented as recompute-not-enumerate.
- **Steps:** read `DeletePaperTradesResponse` (~line 670) + the request
  doc block.
- **Result:** PASS — shape and scope doc present.

### 6. Regression smoke — enum + retained constants

- **Confirms:** `OptionQuoteSource` gains `SDS_BARS` without disturbing
  existing members; `SIGNAL_GOVERNING_VARIANT`/`SIGNAL_SHADOW_VARIANT_KEYS`
  retained for non-signal trades.
- **Steps:** `shared/options-common.ts` enum has 4 members
  (AV_EOD/RH_MCP/AV_REALTIME/SDS_BARS); contracts.ts ~line 399 keeps
  `SIGNAL_*` constants. Related consumers: related jest batch
  `(paper-trading|options-common|options-strategy)` — 186/186 PASS;
  `functions` tsc clean for this change set.
- **Result:** PASS.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Mint types ≤50, per-item created\|deduped\|error | 1, 3 |
| Delete types bulk, deleted+notFound+failed, idempotent | 1, 5 |
| `CURATED_VARIANT_KEYS` 7-key set | 1, 2 |
| `CURATED_GOVERNING_POLICY` + `governingPolicy` field | 1, 2, 4 |
| `OptionQuoteSource.SDS_BARS`, members unchanged | 1, 2, 6 |
| Specs pin constants + `SIGNAL_*` retained | 1, 6 |
| `signalId` dedupe-vs-occurrence contract | 2, 3 |
| `governingVariant` mirror semantics | 4 |

## Regression checklist

- [x] Related spec batch (paper-trading|options-common|options-strategy) — 186/186
- [x] Full suite — 5821/5821 (implement pass; post-review changes covered by re-runs)
- [x] `functions` tsc — clean for this change set (unrelated pre-existing error in untracked `stats-increments.ts` — parallel work, not this task)

## Refinement pass

Not applicable — no user-facing surface.
