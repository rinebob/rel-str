**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-spread  
**Issue:** #1489  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1499  
**Domain:** BE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Code Review — #1499 Position-row mapper + permutation worker

**Verdict: PASS** — 3 axes converged on PASS after one critical and
convergent majors/minors were remediated in-cycle and re-verified.

## Pass sequence

```text
First pass complete — 3 axes in parallel: Standards PASS-with-judgement-calls (no hard violations; 3 judgement + 4 minor), Spec PASS-partial (2 partial, 2 informational), Thermo changes-requested (1 critical + 2 major + nits). Convergent on: (a) asymmetric stale-field hygiene on merge writes; (b) verify LIVE 'either' acceptance too loose; (c) legMetas-ordering assertion indistinguishable. Real critical: v2 docs silently break every downstream reader — optionsAnalysisStart enqueues them and the v1 analyzer writes empty 'success' result docs.
Second pass complete — remediation applied and re-verified: v2 gates on BOTH analysis entry points (start failed-precondition; worker failed result docs, permanent not retriable); job refactor kills the sparse-array + both masking casts and hoists legToPickDocCoordinate out of the error-swallowing concurrency callback; every list-doc write self-sufficient (Clearable deletes for pickDocMeta/legMetas/error/rows + schemaVersion:2 on failed stubs); retry no-op guard extended to snapshot-less/stock-only runs; verify 'either' requires per-case failurePattern; legMetas ordering asserted with distinct fixture docs; delete sentinels asserted; stale start.ts comment + dead getApps fallback + missReason double-call fixed. Dispositioned with reason: merged legs[] signature vs spec text (required for interleaved stock-first order — IMPL doc-sync at ship); Error.message mutation kept for Error instances (preserves class+stack; non-Error now wrapped); success-write pickDocMeta delete kept (self-sufficient per-write doctrine); 425-line worker (over-400 smell line — cohesive; further extraction adds indirection); FE v1 read-path invisibility (roadmap-deferred, documented).
Convergence: PASS — one critical + convergent findings fixed and re-verified (127/127 options-replay, 73/73 options-analysis, 15/15 DRY, 42/42 LIVE, build clean); remaining dispositions documented.
```

## Diff summary

- `functions/src/options-replay/pick-doc-mapper.ts` — rewritten to
  `mapLegsToPositionRows(legs[], tradingDays)`: legs in declared order
  (option `{kind:'option', side, coordinate, doc}` / stock
  `{kind:'stock', side}`); atomic join — every option leg picked →
  `position` row, any miss → `no-selection` with `legMisses[]` carrying
  absolute `legIndex` + coordinate + per-leg reason; roll-up
  `miss > gap > out-of-range`; `positionRepeatsPrevious` across all legs;
  throws on zero option legs (stock `underlyingClose` unresolvable).
- `functions/src/options-replay/permutation.ts` — worker reads
  `variantSnapshot` off the run doc (self-describing — no registry call);
  missing/malformed/stock-only → permanent failure before any fetch;
  one pick-doc fetch per option leg bounded-parallel (4); each job
  carries index+coordinate+doc; failures annotated
  `leg N pick doc ({type} Δ{delta} {dte}dte): …` with deterministic
  earliest-leg ordering; writes `schemaVersion: 2` + ordered `legMetas[]`
  (SA-served coordinate); `ContractListWrite` widened with `Clearable`
  deletes so every write clears fields it doesn't own.
- `functions/src/options-replay/retry.ts` — reset deletes v2 fields
  (`legMetas`, `schemaVersion`) alongside `pickDocMeta`; the
  can't-ever-succeed no-op guard extended to snapshot-less and
  stock-only runs (mirrors the worker's permanent-fail class).
- `functions/src/options-analysis/start.ts` — `failed-precondition`
  gate on `schemaVersion === 2` (the v1 analyzer cannot read position
  rows; leg-aware analysis is #1500).
- `functions/src/options-analysis/worker.ts` — `getListDoc` widened to
  the doc union; a v2 doc writes `failed` result docs naming the schema
  (permanent, zero fetches) instead of empty `success`; the failed-write
  block extracted as `writeFailedResultDocs` shared with the
  final-attempt catch.
- `functions/src/options-replay/start.ts` — stale "(worker switch lands
  in #1499)" comment updated.
- Tests — mapper rewrite (all-pick/miss/gap/out-of-range/absent,
  multi-leg atomic join, `legMisses` index+reason, stock ordering +
  underlyingClose, repeatsPrevious all-legs, zero-option-leg throw);
  worker rewrite (fetches-per-leg, legMetas ordering with distinct docs,
  delete sentinels, snapshot guards, coded/bare-404 + transient
  semantics preserved); retry no-ops for missing/stock-only snapshots;
  analysis start + worker v2-gate tests.
- `functions/scripts/verify/options-replay-worker-1499.{ts,md}` + run-all
  + both READMEs — DRY (15 checks, fake deps through the real worker +
  mapper) and LIVE (5 cases against real run docs, real SA fetches,
  real Firestore writes, `prodReplayPermutationDeps`).

## Findings by severity

### Critical (fixed)

- **C1 — v2 docs silently break every downstream reader** (thermo +
  standards convergent). `optionsAnalysisStart` gated only on
  `pickDocMeta.gridVersion === 0` — a v2 doc (no `pickDocMeta`)
  enqueued normally, then the v1 worker's `r.kind === 'pick'` filter
  produced zero picks → `success` result docs with `trades: []`.
  Silent-empty persisted analysis is worse than failure; unlike the FE
  read path (roadmap-deferred task), this is a regression the change
  introduces. Fixed on both entry points: start throws
  `failed-precondition` naming #1500; the worker writes `failed`
  result docs (permanent — a v2 doc can never become v1), zero
  fetches, no retry burn.

### Major (fixed)

- **M1 — asymmetric stale-field hygiene** (standards + thermo
  convergent). The `running` merge-write deleted `pickDocMeta` but
  left `legMetas`/`error` from a prior attempt's terminal doc — the
  same Frankenstein class the delete was added for, reachable via the
  documented at-least-once redelivery window. Fixed by the
  `Clearable` widening + self-sufficient doctrine: running clears
  `pickDocMeta`/`legMetas`/`error`; success clears `pickDocMeta`/
  `error`; failed clears `rows`/`legMetas`/`pickDocMeta`.
- **M2 — verify LIVE `either` hid regressions** (thermo). Any failed
  doc matching `/leg|variantSnapshot/` passed and doc-shape asserts
  were skipped. A worker that 404s every leg (e.g. a wrong wire
  coordinate — precisely what LIVE exists to catch) still passed.
  Fixed: per-case `failurePattern` (default the leg-annotated pick-doc
  failure); `noSnapshot` gets `/missing\/malformed variantSnapshot/`
  and its dead `assertDoc` removed.
- **M3 — retry parity gap** (thermo). The corrupt-run no-op guard
  existed because "the worker fails it permanently only AFTER the
  claim destroyed the prior list doc" — a pre-model failed run with
  no `variantSnapshot` (or a stock-only snapshot) is the same
  can-never-succeed class. Guard extended + 2 tests.
- **M4 — failed stubs carried no `schemaVersion`** (spec). Pre-try
  guard failures wrote docs that were neither v1 nor stamped v2.
  `schemaVersion: 2` now stamped on every worker write.

### Minor (fixed)

- Masking casts + unreachable-error path: `legInputs as MapperLegInput[]`
  + `as Extract<…>` and `legToPickDocCoordinate` inside the
  error-swallowing concurrency callback — job refactor carries
  `{index, coordinate, doc}`, kills both casts, hoists the conversion.
- `legMetas` ordering indistinguishable in tests (same fixture doc per
  leg) — distinct docs now assert `legMetas[0].coordinate.targetDelta`.
- No test asserted the delete sentinels — now asserted on the running
  write.
- Non-`Error` fetch failures got zero leg context — now wrapped.
- `missReason`/`rollUpReason` double-invocation — bound to consts.
- Dead `getApps()`/`initializeApp` fallback in the verify script
  (firebase-admin-init always initializes at import) — removed.
- `coordLabel` JSDoc omitted its own parens — fixed.
- Stale `start.ts` "(worker switch lands in #1499)" comment — updated.

### Dispositioned, no change (reasons recorded)

- **Spec signature deviation**: `mapLegsToPositionRows(legDocs,
  stockLegs, tradingDays)` in the issue text vs implemented
  `(legs[], tradingDays)` — the merged list is REQUIRED to preserve
  interleaved declared order (a stock leg at index 0). The
  implementation is the correct shape; IMPL-BE doc-sync happens at
  ship as-built.
- **`Error.message` mutation** kept for `Error` instances — preserves
  the original class + stack (`PartnerHttpError.status/partnerCode`
  flow through `instanceof` checks unchanged); only non-`Error`
  throws wrap.
- **`underlyingClose ??=` first-leg wins** — per-leg docs could
  disagree on a day's close; spec says "from pick doc/bars" and the
  divergence is benign in practice (same symbol, same day). Noted.
- **Success-write `pickDocMeta` delete kept** though strictly
  redundant after the running write — self-sufficient per-write
  hygiene; zero-cost and guards any future path skipping the running
  write.
- **Tuple spreads** `[x[0], ...x.slice(1)]` kept over `as`-casts —
  runtime-honest construction for the non-empty tuple types.
- **permutation.ts at 425 lines** — over the 400 strong-smell line by
  ~6%; cohesive worker, all helpers already extracted; a further
  fetch-block extraction adds indirection without clarity.
- **FE read path invisible for v2 docs** — `contract-list.service`,
  converter, table, and chart replay all read v1 shapes; v2 UI is an
  explicit later blueprint task, not a silent-wrong regression (the
  docs simply don't appear yet).

## Test results

- `npm run test:options-replay` — **127/127** (mapper + worker +
  retry incl. new cases)
- `npm run test:options-analysis` — **73/73** (incl. both new v2-gate
  tests)
- Verify script DRY — **15/15**
- Verify script LIVE — **42/42** (real SA pick-doc fetches,
  `pcs-45-20-5` atomic 2-leg rows, `cov-45-20` stock leg off real
  `underlyingClose`, `custom` inline completing — the #1498-deferred
  path — missing-snapshot designed failure)
- `npm run build` — clean; `git diff --check` on task files — clean

## Verdict

**PASS.** All acceptance criteria met and traced to tests:

- N-leg date join → atomic position rows; any leg miss → per-leg
  miss detail ✓
- Stock legs always resolve (`underlyingClose` from picks) ✓
- Terminal/idempotent semantics preserved (coded-404 → failed doc
  naming the leg; bare-404/transient → rethrow; terminal short-circuit
  + convergent close-out) ✓
- Pure mapper + deps-faked worker tests per TEST-BE ✓

One deploy-order note for ship: new runs write v2 docs — the v1
analyzer is now gated both directions, but any analysis attempt on a
v2 doc before this deploy reaches prod would still silently produce
empty results. The gates and the worker ship together in this task,
so the window is only un-deployed code, not a code defect.
