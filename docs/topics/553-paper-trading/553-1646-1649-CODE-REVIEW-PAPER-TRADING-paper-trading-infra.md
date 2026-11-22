**Topic:** Paper Trading Infra  
**Topic Slug:** `paper-trading`  
**Thread:** Signal Selection  
**Thread Slug:** `signal-selection`  
**Issue:** #1646  
**Thread Parent:** #1117  
**Topic Parent:** #553  
**Task:** #1649  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# CODE-REVIEW — #1649 SHARED-IMPL: signal-review contracts

## Verdict: PASS

Contract-surface task — six wire types, one mapper function, one
doc-id constant + re-export, pinning specs, and a read-only verify
script. Zero drift from the IMPL doc; all four ACs met; in-diff
findings remediated in-gate.

## Passes

```text
First pass complete — 3 axes ran (Standards, Spec, Thermo-nuclear):
  1 major (cross-task — accept-flow signalId namespace), 5 minors
  (3 in-diff, remediated; 2 pattern-level, deferred with rationale),
  ~7 nits.
Second pass complete — every finding dispositioned; foreign
  SignalExpressionTemplate hunks in the touched file excluded from
  scope; foreign mid-edit jest failure (topic-viewer spec) re-verified
  healed green; no new findings.
Convergence: PASS — additive contract surface, all ACs verified
  against the diff; the major is a downstream-task design correction
  documented where it lands (#1650).
```

## Axis summaries

### Standards

All eight checks pass. Verified accurate (not just consistent): the
`signalDedupeKey` vs `stSignalOccurrenceId` field-order claims in the
section comments match both id builders verbatim; `lastDailySignalDate`
denormalization matches `StSymbol.lastDailySignalDate`; section
divider/comment style, constant placement, re-export ordering, spec
conventions (jest-native, typed fixtures, thread-tagged describe), and
verify-script format all match sibling precedents.

### Spec

All 4 ACs statically met, field-for-field identical to the IMPL
Contracts block. Every TEST-doc item pinned: mapper literal + no-leak
key-set, constant literal + single-segment guard, `previousOpenedAt`
null first-visit, queue/state shapes, checked/unchecked fixtures using
real allowlist signal types (`D_ST_TREND_RIDER_V1_{LONG,SHORT}`),
occurrence-id layout pinned via the canonical builder AND literal.
Callable registration correctly deferred to the BE/FE task ACs.

### Thermo-nuclear (Dr. Reed)

Design challenges answered cleanly: the `previousOpenedAt`/`openedAt`
stamp-on-read protocol is sound and deliberately documented;
`Record<string,string>` single-doc review state is the right call
(~288 keys ≈ 15 KB vs 288 doc reads); a function over a type cast is
correct — it strips `occurrenceId` + join fields a cast would carry
silently; wire types are appropriately minimal. Test quality: no type
erasure, contract-not-implementation assertions throughout.

## Findings

### Critical — none.

### Major

| # | Finding | Disposition |
|---|---|---|
| M1 | **Accept-flow `signalId` is a third id namespace** — `paperSignalOrder` stamps `trade.signalId` with the FE-passed `canonicalOccurrenceDecisionId` = `{runId}_{SYM}_{timeframe}_{type}` (paper-ticket.util.ts:52 → firestore-helpers.ts:47), which carries **no barDate** and cannot be back-mapped to occurrences. The BE IMPL's planned `signalDedupeKey` set-membership join marks such trades `checked: false` despite ledger membership, and its stated "accept-flow joins as checked: true" is false. | **Carried to #1650** — not a contract defect (the `checked` semantic is mechanism-agnostic). BE IMPL doc corrected in-place; comment posted on #1650 with the two options (scoped coverage vs widened match + false-positive hazard). |

### Minor

| # | Finding | Disposition |
|---|---|---|
| m1 | Mapper JSDoc misattributed the rename — both sides already use `signalBarDate`; the real rename (`StSignal.barDate/timeframe/indicators/status` → `signal*`) lives in the BE reshape. | **Fixed in-gate** — JSDoc now states the true purpose (field stripping so `occurrenceId`/join fields can't leak into mint items); reshape spec-pin flagged to #1650. |
| m2 | Verify-script check `occurrence join fields co-present` was tautological — asserted on a literal fixture defined above it. | **Fixed in-gate** — replaced with a real pin: unchecked occurrence maps to the identical pick (mapper ignores join fields). |
| m3 | `checked:true ⇒ tradeId+tradeStatus` pairing is documented-only, not type-encoded. | **Deferred** — flat wire shape is deliberate for FE binding; BE join is the sole writer; handler-side pin flagged to #1650. |
| m4 | Stamp-then-fail edge: if the bundle callable stamps `lastOpenedAt` then errors, the retry reports `previousOpenedAt` = the lost stamp → new signals render as seen. | **Carried to #1654** — comment posted; FE should anchor the divider on the first successful response. |
| m5 | `GetSignalReviewQueueRequest {}` — repo's first bare empty interface; `Record<string,never>` would enforce emptiness, `{}` accepts extra props. | **Deferred** — matches IMPL verbatim; `{}` is growable without a signature change; lint scope doesn't cover `shared/`. |

### Nit

- `SIGNAL_REVIEW_CONFIG_DOC` naming diverges from `ST_CONFIG_*_DOC`
  siblings — matches the `AUTO_PAPER_CONFIG_DOC` convention for feature
  config docs; renaming has a spec/verify tail. Deferred.
- `sourceRunId` kept (vs PaperTrade's `signalRunId`) — honest lineage
  name; matches IMPL. Deferred.
- `signalTimeframe` is constant `'D'` on every wire row — documented
  forward-compat. Deferred.
- `lastDailySignalDate` last-write-wins (no monotonic guard) —
  pre-existing data property of `st-symbols`, not this diff.
- README numbered list "55" collision — verified already sequential on
  disk (55=#1649, 56–60=#1498–#1502); stale report, no-op.
- Explicit `tradeId: undefined`/`tradeStatus: undefined` on the
  unchecked spec fixture — **fixed in-gate** (omission style).

## Test results

- `npx jest shared/paper-trading-contracts.spec.ts shared/st-collections.spec.ts
  --coverage=false` — **57/57 green** (4 new contract specs + 1 doc-id pin).
- `npx tsx functions/scripts/verify/paper-trading-signal-review-contracts-1649.ts`
  — **11/11 checks green** (registered in `run-all.ts` + verify README).
- `cd functions && npm run build` — **clean** (shared consumed by the
  functions bundle).
- Full suite `npx jest --coverage=false` — 6,131 tests green across 324
  suites; the one suite failure (`topic-viewer-page.component.spec.ts`,
  TS2305 `AllSectionRows`) was **foreign mid-edit state** from the
  parallel #619 session — the import was healed between runs and
  re-verified green standalone (35/35).
- Repo-root `tsc --noEmit` reports pre-existing `TS7031`/`TS7006`
  implicit-any errors in `portfolio-dashboard.store.spec.ts` —
  unmodified on HEAD, foreign, unrelated to this diff.

## Scope notes

- `shared/paper-trading-contracts.ts` also contains **foreign
  uncommitted hunks** (~lines 315–381: `SignalExpressionTemplate`
  `minDte`/`maxDte` deprecation) belonging to another session's #1502
  work — excluded from this review; ship will need hunk-level staging.
- Reviewed against: `553-1117-1642-IMPL-PAPER-TRADING-SHARED-signal-selection.md`,
  `553-1117-1642-TEST-PAPER-TRADING-SHARED-signal-selection.md` (both
  Complete), issue #1649 ACs.
