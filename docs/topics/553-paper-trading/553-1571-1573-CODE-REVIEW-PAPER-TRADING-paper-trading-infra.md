**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1571  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Task:** #1573  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-17  

# CODE REVIEW — #1573 Signal-replay contracts

Three-axis gate review of the curated-trade contract surface
(`shared/paper-trading-contracts.ts`, `shared/options-common.ts`,
`shared/paper-trading-contracts.spec.ts`, verify script + guide +
run-all/README registration).

## Standards

0 critical · 0 major · 2 minor · 3 nit. Conventions, spec style, and
the verify-script pattern all conform; no SDK misuse (pure contracts);
no type-erased fixtures or no-assert tests. Zero-consumer exports judged
**not** speculative generality — legitimately staged contracts consumed
by #1575/#1576 in the same thread.

| Finding | Severity | Disposition |
|---|---|---|
| `MintResult.signalId` JSDoc said `stSignalOccurrenceId` (`{SYM}_{date}_{type}`) but spec/verify pin `signalDedupeKey` (`{SYM}_{type}_{date}`) — the swapped-layout trap `st-ids.ts` warns about | **major** (cross-axis) | **Fixed in-gate** — dedupe key is the correct value (it's what lands on `trade.signalId`; verified at auto-paper-ingest-pass.ts:292). JSDoc rewritten to name the layout + warn it's NOT the occurrence id. IMPL-SHARED §1 synced. New verify check pins the two layouts distinct (14th check). |
| `governingVariant`/`governingPolicy` dual source of truth — contract didn't say which wins or whether the field mirrors the daily pick | **major** | **Fixed in-gate** — mirror semantics pinned (the pin was itself corrected in Round 2 — see below: seed is `trailing-8`, not an arbitrary policy pick, and the real consumer is `exitReason`). |
| `deletePaperTrades` over-promised ("every artifact") and had no partial-failure shape | **major** | **Fixed in-gate** — response gains `failed: {tradeId, error}[]`; doc scoped honestly (derived aggregates recompute, not enumerated) and gated to `source=SIGNAL` trades. Spec updated. IMPL-SHARED §2 synced. |
| README Index table missing the #1573 row | minor | **Fixed in-gate** — row added with guide link. |
| Verify-guide/script title vs issue title drift | minor | **Fixed in-gate** — both now say "Signal-replay contracts" (the issue title). |
| `trailing-8` literal duplicated `DEFAULT_TRAILING_STOP_KEY` | nit | **Fixed in-gate** — array uses the constant. |
| `GENERATE_PAPER_TRADES_MAX_ITEMS` vs callable `generatePaperSignalTrades` | nit | **Fixed in-gate** — renamed `GENERATE_PAPER_SIGNAL_TRADES_MAX_ITEMS`. |
| Spec fixture `variantKeys: 7` with `variantRuns: []` (incoherent) | nit | **Fixed in-gate** — fixture builds 7 runs matching the keys. |
| `PaperFill` doc called AV_EOD "live-priced" | nit | **Fixed in-gate** — accurate per-source wording. |
| Stale member comment on `source: OptionQuoteSource` (options-strategy-engine-contracts.ts:42) | minor | **Fixed in-gate** — comment notes SDS_BARS is equity-bars provenance, never an option quote. |

## Spec

Every acceptance criterion met. Deferred-by-design items verified to be
downstream scope, not gaps: `parseVariantKey`/`ExitVariantParams` for
`ma-close-*`/`target-*` (#1574 — TEST-BE covers), callable
implementation + validation + ticket emission (#1575), delete cascade +
ingest widening (#1576), optional `PaperMark` provenance. One
contract-level note: the dedupe-key Date convention
(`barDate + T12:00:00Z`) matches the ingest's exact construction —
verified, not assumed.

## Thermo-Nuclear

1 major (the signalId contradiction — shared worst finding with Spec),
2 moderate (governingVariant invariant, delete-contract shape), plus the
minor/nit items above — all fixed in-gate. Post-fix contract matrix is
coherent: mint types carry exactly what the id builders need, delete is
scoped + honest about derived state, `governingPolicy`/`governingVariant`
has a single pinned semantic, and the explicit member-union on
`quoteSource` correctly excludes `AV_REALTIME`.

## Test results

- `shared/paper-trading-contracts.spec.ts` — **24/24 PASS** (7 new specs)
- Verify script — **14/14 PASS** (added the layout-trap pin in-gate)
- Related batch (paper-trading|options-common|options-strategy) — **186/186 PASS**
- Full suite — **5821/5821 PASS** (run during implement; post-review changes are
  contract-file + spec only, covered by the re-runs above)
- `functions` tsc — clean for this change set; one **pre-existing
  unrelated** error in `functions/src/paper-trading/engine/
  stats-increments.ts` (untracked file from parallel work — a
  `runTransaction` signature mismatch, not this task's code)

## Round 2 — re-review of the fix set (3 axes)

Re-ran all three axes against the post-fix diff. Round-1 fixes verified
correct and complete (rename propagated, docs consistent, both README
entries present, spec fixture coherent). New findings:

| Finding | Severity | Disposition |
|---|---|---|
| **Mirror-at-mint collides with the terminal gate** — the pinned "rewritten at mint" is impossible: `seedVariantRuns` throws unless the seed is a terminal-family key (`ledger.ts:439`), so a policy pick like `ma-close-100` can't be seeded | **major** | **Fixed in-gate** — pin corrected: seeds `'trailing-8'` at mint (always-terminal fallback), rewritten on each eval day. JSDoc + IMPL-SHARED §3 + IMPL-BE §3 synced. |
| **Dead-fallback edge unpinned** — if `trailing-8`'s run already shadow-EXITED, the below-entry fallback names a dead run → unprotected OPEN trade | major | **Fixed in-gate** — pinned: ACTIVE-runs-only candidates; dead fallback → deepest ACTIVE candidate governs. Doc + both IMPLs synced; #1574's `selectGoverningRun` encodes it. |
| **Independent-closer misattributes `exitReason`** — a `target-50` close left `governingVariant` on the last policy stop | major | **Fixed in-gate** — pinned: an independent closer firing the real exit rewrites `governingVariant` to its key at close. |
| `var-{key}` justification wrong — stats scopes read `variantKeys`, not `governingVariant`; real consumer is `exitReason` | minor | **Fixed in-gate** — JSDoc justification corrected. |
| Dedupe scope — `sig`-origin ids only; `paperSignalOrder` cohorts are a separate lineage | minor | **Fixed in-gate** — documented on the mint contract. |
| Spec fixture: `failed` id absent from `req.tradeIds` | nit | **Fixed in-gate** — id added to the request. |
| Verify check was tautological (f(x)==f(x)) | nit | **Fixed in-gate** — now pins the literal `'240311-sig-AAPL-EQV1L'`. |
| TEST-SHARED over-promised a shared-seam `parseVariantKey` test | nit | **Fixed in-gate** — doc reworded; the parse pin lives in TEST-BE/#1574 where the grammar lands. |

## Verdict: **PASS**

All major findings resolved in-gate and re-verified; remaining deferred
items are explicitly scoped to #1574–#1576 and recorded in the IMPL/TEST
docs.

## Deferred to downstream tasks

- `parseVariantKey`/`ExitVariantParams` `ma-close-*`/`target-*` members + their spec pins → #1574.
- `SignalPick` validation, `items` bound enforcement, ticket emission → #1575.
- Delete cascade implementation + `source=SIGNAL` guard + ingest widening → #1576.
- Optional `PaperMark` bars-vs-quote provenance → #1575 (if needed).
