**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-spread  
**Issue:** #1613  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1499  
**Domain:** BE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# UAT — #1499 Position-row mapper + permutation worker

## Scope

Task [#1499](https://github.com/rinebob/rel-str/issues/1499) rewrote the
replay data path: `mapLegsToPositionRows(legs[], tradingDays)` performs
an atomic N-leg date join — every option leg picked → a `position` row
with legs in declared order; any miss → one `no-selection` row carrying
per-leg `legMisses` (absolute `legIndex` + coordinate + reason, rolled
up `miss > gap > out-of-range`). The worker reads the self-describing
`variantSnapshot` off the run doc (no registry call), fetches one SA
pick doc per option leg bounded-parallel (limit 4), and writes
`schemaVersion: 2` + ordered `legMetas[]`. Stock legs resolve off the
pick doc's `underlyingClose`. Review remediation added v2 rejection
gates on both options-analysis entry points, self-sufficient
merge-write hygiene, and a retry guard for snapshot-less runs.

## Prerequisites

- Node + tsx; `cd functions`.
- DRY stage: no credentials.
- `--live` stage: ADC (`firebase login`), `GOOGLE_CLOUD_PROJECT=rel-str`,
  IPv4 preload (`NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"`).

## Getting to the feature

No UI — the surface is the `optionsReplayPermutation` task worker +
the `options-replay-contract-lists` v2 docs. Verify:

```bash
cd functions
npx tsx scripts/verify/options-replay-worker-1499.ts           # DRY
NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs" \
GOOGLE_CLOUD_PROJECT=rel-str \
npx tsx scripts/verify/options-replay-worker-1499.ts --live    # LIVE
```

## Automated evidence (fresh, post-review 2026-11-18)

| Check | Result | Evidence |
|---|---|---|
| `npm run test:options-replay` | PASS | **127/127** (mapper + worker + retry) |
| `npm run test:options-analysis` | PASS | **73/73** (incl. both v2-gate tests) |
| Verify DRY stage | PASS | **15/15** — fetch counts, ordering, legMisses, snapshot guards, coded-404 leg context |
| Verify `--live` stage | PASS | **42/42** — real SA pick-doc fetches + Firestore writes via `prodReplayPermutationDeps` |
| `npm run build` (functions) | PASS | esbuild clean, 234ms |

## Scenarios

### S1 — Legacy 1-leg snapshot → v2 doc (AC: join + provenance)

- Seed a run doc with a pre-model `variantSnapshot` (`csp-45-20`,
  1 option leg) and invoke the worker data path against live Firestore.
- **Expected:** list doc `success` with `schemaVersion: 2`,
  `legMetas[1]` (SA-served coordinate), position rows carrying
  `legs[1]`; run closed out `completed`.
- **Result/evidence:** **PASS** — live `csp-45-20` case: 11 rows,
  doc + run verified in real Firestore.

### S2 — Two-leg atomic join (AC: N-leg date join)

- Run `pcs-45-20-5` (short put -0.20Δ 45DTE + long put -0.05Δ 45DTE).
- **Expected:** exactly 2 SA pick-doc requests (`put Δ20` + `put Δ5`,
  SPY 2026); every emitted `position` row carries `legs[2]` in
  declared order; `legMetas[2]`; no row is half-populated — a date
  where either leg misses yields `no-selection` with `legMisses`.
- **Result/evidence:** **PASS** — live: both partner URLs logged,
  atomic `legs[2]` rows asserted; dry + unit cover the miss →
  `no-selection` + `legMisses[legIndex]` path explicitly.

### S3 — Stock leg resolves off `underlyingClose` (AC: stock legs)

- Run `cov-45-20` (short call + long stock).
- **Expected:** one pick-doc fetch (the option leg only — zero extra
  fetch for stock); position rows carry the stock leg with
  `underlyingClose` sourced from the real pick doc; declared order
  preserved when the stock leg is first.
- **Result/evidence:** **PASS** — live: `cov-45-20` success, stock
  leg carries real `underlyingClose`; dry asserts stock-first
  declared ordering + zero extra fetch.

### S4 — Inline `custom` legs complete off snapshot (the #1498-deferred path)

- Run a doc with `templateId: 'custom'` + inline `variantSnapshot`
  (2 puts, -0.20/-0.05Δ, 45DTE).
- **Expected:** succeeds purely off the snapshot — the previously
  designed `Unknown templateId 'custom'` terminal is gone;
  `templateId` persisted verbatim as `'custom'`; `legMetas[2]`.
- **Result/evidence:** **PASS** — live: `custom` run `completed`,
  426 picks across both cells, `templateId: 'custom'` persisted.

### S5 — Missing / malformed / stock-only snapshot → permanent failure pre-fetch

- Run docs with: no `variantSnapshot`; off-grid Δ legs; stock-only legs.
- **Expected:** permanent `failed` before ANY pick-doc fetch, error
  naming the defect (`missing/malformed variantSnapshot`,
  `variantSnapshot leg 0: targetDelta … off-grid`, `no option legs —
  nothing to select`); run closed out `failed`.
- **Result/evidence:** **PASS** — dry r4/r5/r6 + live
  missing-snapshot case (real run doc → designed `failed` close-out).

### S6 — Coded-404 vs bare-404 leg semantics (AC: terminal semantics)

- Inject a coded partner 404 on leg 2 of a 2-leg snapshot; a bare 404;
  a transient failure.
- **Expected:** coded → permanent `failed` naming the leg
  (`leg 2 pick doc (put Δ-0.05 45dte): …`); bare/transient → retryable
  rethrow (final attempt → failed close-out). Both fetches still
  attempted under bounded parallelism.
- **Result/evidence:** **PASS** — dry r7 + unit cover all three
  classes; leg-context annotation asserted.

### S7 — Terminal / idempotent semantics (AC: retry short-circuit)

- Deliver the task against an already-`success` or `failed` list doc;
  deliver again after a terminal doc exists.
- **Expected:** short-circuit — no recompute, no fetch; close-out is
  retried safely so a crashed earlier close-out still converges
  (list `success` → run `completed`; `failed` → run `failed`).
- **Result/evidence:** **PASS** — unit asserts zero-fetch
  short-circuit + convergent close-out; live close-outs observed on
  all 5 real runs.

### S8 — Merge-write hygiene + retry reset (remediation)

- A v1 doc stuck `running`, then a v2 write; a retry reset after v2.
- **Expected:** every worker write deletes fields it doesn't own
  (`pickDocMeta` on v2 writes; `legMetas`/`schemaVersion` on retry
  reset; `rows`/`error` on their opposing writes) — no Frankenstein
  doc carries stale provenance of the other schema.
- **Result/evidence:** **PASS** — `Clearable` delete sentinels
  asserted in unit (running + success + failed writes); live stage
  proves `FieldValue.delete()` serializes through real Firestore
  merge-writes (42/42).

### S9 — v2 analysis gates (remediation — regression window closed)

- `optionsAnalysisStart` on a `schemaVersion: 2` list doc; the
  analysis worker on a directly-enqueued v2 task.
- **Expected:** start throws `failed-precondition` naming #1500;
  worker writes `failed` result docs (permanent, zero fetches) —
  never a silent empty `success` analysis over `position` rows.
- **Result/evidence:** **PASS** — unit: start rejects v2; worker
  writes failed result docs with zero fetches (73/73 incl. both new
  tests).

### S10 — Retry no-op guard parity (remediation)

- `optionsReplayRetry` on a failed run lacking `variantSnapshot` or
  with a stock-only snapshot.
- **Expected:** no-op — the worker's permanent-fail class is guarded
  before the reset destroys the prior list doc (mirrors the
  corrupt-run guard).
- **Result/evidence:** **PASS** — unit: both no-op cases + normal
  snapshot fixture still resets/enqueues.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface (worker + doc schema only).
V2 docs are intentionally invisible to v1 FE readers until the
dedicated FE task lands; the analysis-path regression is gated at
both entry points (S9).

## Findings

- None during QA. Review-cycle remediations already covered: v2
  analysis gates, self-sufficient writes, retry snapshot guard,
  verify `failurePattern`, legMetas ordering test, `FieldValue.delete()`
  live serialization.

## Traceability

| AC | Scenario |
|---|---|
| N-leg date join → atomic position rows; any leg miss → per-leg miss detail | S1, S2, S7-dry, mapper unit |
| Stock legs always resolve (underlyingClose) | S3 |
| Terminal/idempotent semantics preserved (coded-404 naming coordinate; retry short-circuit) | S6, S7 |
| Pure mapper + deps-faked worker tests per TEST-BE | 127/127 suite, DRY fake-deps stage |
| Snapshot-driven (self-describing run doc) | S1–S5 |
| `schemaVersion: 2` + ordered `legMetas[]` | S1, S2, S4 |
| `templateId` verbatim incl. `'custom'` | S4 |
| v2 analysis gated (review remediation) | S9 |
| Retry/merge hygiene | S8, S10 |

## Regression / smoke

- [x] Legacy 1-leg snapshot resolves to v2 — live `csp-45-20` completed
- [x] Analysis start/worker reject v2 — no silent-empty regressions
- [x] Run-all registration — script in `run-all.ts` + both READMEs
- [x] `options-analysis` suite green — 73/73 (worker refactors didn't break v1 paths)

## Verdict

**PASS** — all scenarios verified fresh post-review with unit + dry +
live-prod evidence (real SA pick-doc fetches, real Firestore writes
incl. delete-sentinel serialization, real run close-outs).

## Results log

- 2026-11-18 — impl → review PASS (1 critical + convergent majors
  remediated in-cycle) → QA execution: 127/127 options-replay,
  73/73 options-analysis, 15/15 dry, 42/42 live (5 real runs:
  csp-45-20 completed v2; pcs-45-20-5 atomic 2-leg; cov-45-20 stock
  leg; custom inline completed; missing-snapshot designed failure).
