**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Selection Replay  
**Thread Slug:** selection-replay  
**Issue:** #1242  
**Thread Parent:** #1240  
**Topic Parent:** #1238  
**Task:** #1430  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# Code Review — #1430: Selection Replay: single-symbol runs (one run doc per symbol)

## Verdict

**PASS (Round 3)** — Round 3 (fresh axes on the remediated diff) surfaced 1
major + 5 minors, all remediated in-cycle and re-verified. Deployment-gated
ACs (live e2e, migration deletion) remain post-deploy work, not review
blockers.

## Round 3 (2026-11-06) — fresh axes on the remediated diff

The R2 remediation itself got reviewed — the three axes re-ran on the
R2-remediated diff. Findings + dispositions:

| Sev | Finding | Disposition |
|---|---|---|
| major | `tests/functions/firestore-rules-indexes-1012.test.ts:241` still asserts the `(runId,symbol)` index R2 removed — `test:st-rules-indexes` was RED (the suite never ran in R1/R2 verification) | **fixed** — stale assertion replaced with the no-index-needed rationale; suite green 15/15 |
| minor | `onReplaySelected` called `onSymbolChange` BEFORE the Wednesday-picks bail — a cross-symbol list with no picks yanked the page then errored | **fixed** — symbol switch moved after all bail paths; spec added (cross-symbol + no picks → error, no switch) |
| minor | Detail html emitted `.symbol-name`/`.symbol-status`/`.symbol-error` while scss styled `.list-*` (rename half-applied — visual regression on the failed card) | **fixed** — html renamed to `.list-*`; classes consistent across html/scss/spec |
| minor | `resolveCloseOutStatus` treated `cancelled` (unreachable but forward-compat) and `undefined` (doc deleted mid-flight → `tx.update` NOT_FOUND → burned task retries) as writable | **fixed** — allowlist `pending`/`running` only; `cancelled`+missing skip quietly; spec pins both |
| minor | `claimRetry` created a bare `{status:'pending'}` stub on a missing list doc — persists if re-enqueue fails, then the audit FAILs it for field disagreement | **fixed** — stub stamps `runId`/`symbol`/`templateId` off the run snap |
| minor | `/` (or any doc-path-illegal char) in a symbol → invalid doc path → `createRun` rejects mid-fanout → callable throws for the whole submission | **fixed** — ticker-charset guard `^[A-Z0-9.\-^]{1,12}$` (BRK.B / BF-B / ^GSPC pass) → invalid-argument naming the offender; spec added |
| minor | Stale contract comments — `st-collections` "one doc per symbol per run", `options-analysis-contracts` `'{runId}_{symbol}'`, replay-contracts "one per symbol per run"; analysis spec fixture pinned the retired composite keying | **fixed** — comments + fixture updated to `listDocId == runId` |
| nit | `retry.ts` header named deleted `resetRunForRetry`; store header "per-symbol contract lists"; verify guide overstated FAIL tier | **fixed** |
| nit | `retry.ts` no `run.symbol` guard — a legacy failed run would enqueue `symbol: undefined` | **fixed** — missing-symbol → `retriedSymbol: null`; spec added |
| nit | `failRun`/`markRunEnqueueFailed` inconsistencies — `failRun` didn't re-stamp `completedAt`; `markRunEnqueueFailed` was a blind update (could regress a raced `completed`) | **fixed** — both now `running`-guarded transactions stamping `completedAt` |
| nit | `firstValueFrom` rejection → silent failure in `onReplaySelected` | **fixed** — catch sets `replayError` |
| nit | Option-chart hint "for {{ symbol() }}" — plotted symbol is now the run's | **fixed** |
| nit | Duplicate `.filter-input` scss blocks; audit WARN text framed durable disagreements as "closeout-window"; `listFor` spec fixture kept composite `listId`/`runId` | **fixed** |
| nit | 'Cancelled' filter pill — unreachable status, permanently empty | **note** — vocabulary coverage, consistent with the row status union |
| nit | `pills[4]` DOM-index pin; parallelism not pinned (isolation is); no `listDocReqSeq` race guard (pre-existing); `option-chart-list.spec` `selectAll()` (user's in-flight picker work); no service-level spec for `watchContractList`; `replayLabel` unpinned | **note** — acceptable, flagged |

### Round-3 test results

- `npm --prefix functions run test:st-rules-indexes` — **15/15** (was RED)
- `npm --prefix functions run test:options-replay` — **65/65** (+5: charset,
  legacy-symbol guard, cancelled/missing close-out, cross-symbol no-switch)
- Touched FE suites — **137/137**; functions typecheck + build clean; app tsc clean

## Round 2 (2026-11-06) — remediation verification

Each Round-1 finding re-checked against the remediated code (direct reads +
targeted suites). Test results below.

| R1 finding | Fix | Verified |
|---|---|---|
| TN-1 `onReplaySelected` cross-symbol error | Now streams the singular `watchContractList(runId)` doc; a `success` list whose symbol differs calls `onSymbolChange(list.symbol)` before plotting — the `onContractListDoc` pattern. Spec pins: symbol switch on cross-symbol, no switch + error when list isn't successful | `option-chart.component.spec.ts` 31/31 |
| TN-2 serial fanout + dead pending→running | `start.ts` creates each run **born `running`** (no blind post-create write exists to protect) and `Promise.all`s the per-symbol blocks; `markRunStatus` → `markRunEnqueueFailed` (its only call site). Specs pin born-running ordering, parallel fanout, per-run enqueue failure isolation | `start.test.ts` |
| TN-3 split-transaction retry | `claimRetry(runId)` is ONE transaction over the 1:1 pair — re-reads run, asserts `failed`, guarded list reset (`shouldResetForRetry`), flips `failed→running` atomically. A losing concurrent retry mutates nothing. Tests reworked for the merged seam | `retry.test.ts` |
| STD-1 audit FAILs legal no-list runs | `completed` run without a list doc → FAIL (worker writes list before close-out — genuinely corrupt); every other status without a list → WARN (pending/running pre-enqueue, enqueue-died `failed`, `cancelled`) | script read |
| SPEC coverage regression | `resolveCloseOutStatus(existing, outcome)` extracted pure from the prod tx; unit-pinned `success→completed`, `failed→failed`, terminal-skip on both terminal statuses | `permutation.test.ts` (+2) |
| TN minors: `watchContractLists` query, `runStatus`/`symbolStatus` row model, `symbol*` vocabulary | `watchContractList` = `docData(doc(runId))` — no query/index; store `contractList` singular (`watchStream` generalized over `T` w/ explicit fallback); `ReplayListRow` carries single `status`; `SymbolListRow`/`symbolStatus`/`runStatus`/`symbol-grid` vocabulary gone; `rerunDisabled` = in-flight-retry only | grep clean; suites pass |
| `symbolOfRun` runId parsing | `endsWith` suffix check (no `split`) | — |
| **new:** orphaned `(runId, symbol)` composite index on `st-options-contract-lists` — existed only for the deleted collection query | removed from `firestore.indexes.json` | — |

Deliberate postures (documented, not defects):

- **Lost-ack convergence:** a `failed` run stays `failed` even on a late
  `success` close-out — terminal-skip is intended; the anomaly is
  auditable (verify script WARNs on status disagreement) and
  `optionsReplayRetry` heals it explicitly. Pinned in
  `resolveCloseOutStatus` tests.
- **`stOptionsContractListDocId` identity seam:** kept as the single
  named home for the 1:1 keying contract.
- **Auto-expand on run select:** one card per run — the panel is
  otherwise empty; deliberate UX.
- **`cancelled` unreachable:** no cancel path exists for replay runs
  (status reserved in vocabulary only).

### Round-2 test results

- `npx jest` — **300/301 suites, 5249 tests pass**; the one failure is
  `signal-review.component.spec.ts` failing to compile on
  `bucketsError`/`attributionsError` in `allocation.store.ts` — the
  user's in-flight portfolio-dashboard work, outside the #1430 diff.
  All #1430-touched suites pass (store, run-list, run-detail,
  run-controls, converter, option-chart, shared).
- `npm --prefix functions run test:options-replay` — **62/62**
- `npm --prefix functions run typecheck` + `build` — clean
- `npx tsc -p tsconfig.app.json --noEmit` — clean

## Round 1 (2026-11-06)

Three axes ran in parallel on the task-scoped diff (`.devin/tmp/1430-review-diff.txt`,
~3.3k lines: shared contracts + 3 functions + FE converter/store/3 components +
option-chart seam + verify scripts + ADR). Full jest suite green (301 suites /
5251 tests); `test:options-replay` 58/60 — the 2 misses are live partner-transport
tests in `pick-doc-client.test.ts` (untouched file) failing on DNS without the
IPv4 preload; **20/20 with `NODE_OPTIONS` set → 60/60 effective**;
`test:options-analysis` 62/62.

### Standards

| Sev | Finding | Disposition |
|---|---|---|
| major | `options-replay-single-symbol-1430.ts:117-124` FAILs any non-`pending` run missing a list doc — but an enqueue-failed run never gets one, and `cancelled` may not either. The audit FAILs states the model legally produces | **fix** — missing list doc on a terminal run → WARN (run's own error field explains), not FAIL |
| minor | `start.ts` serializes the per-symbol fanout — independent work awaited in a `for…of` (guideline §6) | **fix** — fold into TN-2 remediation |
| minor | `rerunDisabled` dead conditions — `runStatus==='pending'|'running'|'cancelled'` unreachable now that `symbolStatus` IS the mapped run status | **fix** — fold into row-model cleanup |
| nit | `stOptionsContractListDocId` is `return runId` — identity pass-through | **defer** — deliberate named seam for the 1:1 keying contract (single home; analysis-result builder and verify scripts hang off it). Dissent noted, kept |
| nit | `markRunStatus` `'completed'` branch unreachable | **fix** — dies with the TN-2 remediation |
| nit | create `pending` then mark `running` = 2 writes where 1 suffices | **fix** — TN-2 |
| nit | stale `symbol*` vocabulary cluster (`OptionsReplaySymbolListRow`, `symbolStatus`, `ReplaySymbolStatus`, `.symbol-grid`) | **fix** — mechanical rename; the row IS the run now |
| nit | `symbolOfRun` test helper parses `runId.split('_')` — the seam doc says never parse | **fix** — `endsWith` |
| nit | unrelated #1247 rows ride inside the verify-README/run-all diffs | **note** — commit-scope hygiene, not code |

### Spec

Every scope bullet implemented; nothing missing. ACs: 1, 2, 3, 5 **met**;
4 **deferred-live** (code path traced correct — Analyze emits listId=runId →
`optionsAnalysisStart` reads fields off the doc → results `{runId}_{exitId}` →
analysis page queries `contractListDocId==runId`); 6 **deferred** (migration is
deployment-gated by design).

| Sev | Finding | Disposition |
|---|---|---|
| minor | Coverage regression: `success→completed` mapping + terminal-skip guard moved inline into untested `prodReplayPermutationDeps` — the deleted `resolveRunCloseOut` had 4 unit tests | **fix** — extract pure `resolveCloseOutUpdate`, unit-test the mapping + guard |
| minor | `closeOutRun` refuses `failed`→`completed`: a lost-ack enqueue that landed server-side leaves run `failed` + list `success` forever (old counter model converged this) | **note** — retry heals it explicitly; terminal-skip is intended semantics; the post-fix audit WARNs rather than FAILs |
| nit | detail card auto-expands on every run select — UX change inside a model refactor | **note** — deliberate: one card now, the panel is empty otherwise; flagged to user |

### Thermo-nuclear

| Sev | Finding | Disposition |
|---|---|---|
| major | `option-chart.component.ts:856` — `onReplaySelected` finds `l.symbol === pageSymbol && status==='success'`; under single-symbol runs every cross-symbol selection errors (`No X contract list in this run`). The common case, not an edge | **fix** — find the `success` list, `onSymbolChange(list.symbol)` on mismatch (the `onContractListDoc` pattern two methods up already does exactly this) |
| major | `start.ts` — serial `create(pending)→mark(running)→enqueue` per symbol, 3N RPCs; the pending→running mark guarded a blind post-fanout write that no longer exists | **fix** — create `running` directly, `Promise.all` per-symbol blocks (`pending` becomes honest crash-window vocabulary) |
| major | `retry.ts` — `resetListDoc` commits before `resetRunForRetry` claims the run: split transactions on a 1:1 pair; loser of a concurrent retry still mutates the list doc | **fix** — single tx reads both docs, asserts `failed`, resets list + flips run atomically; deletes a dep seam |
| minor | `watchContractLists` queries `where('runId'==)+orderBy` for a guaranteed-single doc | **fix** — `docData(doc(runId))`; store/detail pipeline goes singular |
| minor | `ReplayListRow` carries `runStatus`+`symbolStatus` (same value modulo mapping); stale `symbol*` vocabulary | **fix** — drop `runStatus`, rename to run-row vocabulary |
| minor | `watchResultDocs`/`watchListResultDocs` now interchangeable predicates; `runId` denorm on result docs redundant | **note** — harmless; leave |
| nit | auto-expand on select (same as Spec nit) | **note** — deliberate |

### Test results

- `npx jest` — **301 suites / 5251 tests, all pass** (includes touched suites)
- `npm --prefix functions run test:options-replay` — **60/60 effective** (2
  live-transport misses are `NODE_OPTIONS`-less DNS, verified 20/20 with preload)
- `npm --prefix functions run test:options-analysis` — **62/62**

## Remediation plan (Round 2 targets)

1. `option-chart.onReplaySelected` — symbol-agnostic find + `onSymbolChange` on
   cross-symbol selection; spec pins the switch
2. verify script — missing list doc on terminal run → WARN with the run's
   `error` field, not FAIL
3. `start.ts` — create `running`, per-symbol `Promise.all`, `markRunStatus` →
   `markRunEnqueueFailed`
4. `retry.ts` — one transaction: read run+list, assert `failed`, reset list +
   flip run; `failRun` unchanged; tests reworked for the merged seam
5. `permutation.ts` — extract `resolveCloseOutUpdate(existing, outcome)` pure
   fn; spec pins `success→completed`, `failed→failed`, terminal-skip
6. Row model — drop `runStatus`; `symbolStatus`→`status`,
   `OptionsReplaySymbolListRow`→`OptionsReplayRunRow`, dead `rerunDisabled`
   branches; propagate through store/components/specs
7. `watchContractLists` → single-doc `docData`; store `contractList` singular;
   detail `listView` drops the `.find`

Deferred-with-note items stay in the doc header list above (identity seam,
auto-expand UX, cancelled-unreachable, lost-ack convergence, redundant
analysis predicates).
