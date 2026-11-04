**Topic:** Options Backtest  
**Topic Slug:** 1238-backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** 1266-backtest-analytics  
**Issue:** #1366  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1373  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

# CODE-REVIEW — #1373 options-replay store per-symbol rows + filtered store

## Verdict: PASS (one round)

All three axes ran in parallel against `.devin/tmp/review-1373.diff` (full task diff,
~990 lines). No critical or major findings. Convergent minors and cheap nits were
remediated in-cycle; the residual is a short list of documented deferrals owned
by later FE tasks.

## Axis summaries

### Standards — essentially clean, no hard violations

No `any`/index signatures, no contract-masking casts, all files under the
300-line target (store ~290, list component ~89, types ~90). NgRx Signals
structure faithfully mirrors `backtest-ui.store.ts`; spec conventions match
(zoneless, `setInput`, `Subject` seams, `jest.fn()`). Minors flagged: `selectRun`
lost its last production caller (kept deliberately as the deselect/clear API);
`track $index` diverged from sibling convention (fixed); `createdAt` ascending
spec gap (fixed); `listOutcomes` type redeclared (fixed); `ReplaySortDirection`
duplicated `BacktestSortDirection` (fixed); same-run `selectRow` could keep a
dead stream after an error (fixed).

### Spec — all 4 ACs MET

| AC | Status | Evidence |
|---|---|---|
| Multi-symbol run → N rows; missing `listOutcomes` → `'pending'` | MET | `runRows` flatMap + `?? 'pending'`; 6 derivation specs |
| Filters compose; default sort `createdAt` desc | MET | `filteredRows` composes status × template × symbol + sort; 10 filter/sort specs |
| Row click selects `(runId, symbol)`; detail shows that symbol list | MET | `selectRow` emit → store `selection` → detail `selectedSymbol` auto-expand; specs at all three seams |
| Jest specs per TEST doc | MET | Every TEST-FE item for this task's scope mapped to a spec (see Spec-axis ledger); `createdAt`-asc added this round |

Rerun action / toolbar controls / results table are #1374+ — correctly absent.

### Thermo-nuclear — APPROVE with minors

"Disciplined diff": old run-level row model fully deleted, store-side derivation
seam correct, `selectedSymbol` genuinely selection state, tests typed and
behavioral. Judo applied in-cycle: `selection` state consolidation (the axis's
strongest suggestion — `selectedRunId`/`selectedSymbol` are now derived
computeds over one `{runId, symbol}` object, so the pair can't drift),
`isSelected` folded into `viewRows`, composite track key, `listOutcomes` key
normalization, lexicographic `createdAt` compare, cross-run restream spec.

## Remediated in-cycle

| Finding | Fix |
|---|---|
| `createdAt` ascending untested (all 3 axes) | spec added |
| `track $index` vs composite key (all 3; BE dedupes symbols at write) | `track row.runId + '_' + row.symbol` restored |
| Same-run `selectRow` keeps dead stream after error (Standards/Spec) | `listsSubscription?.closed` guard; cross-run restream spec added |
| Data clump `selectedRunId`+`selectedSymbol` (TN) | single `selection` state + derived computeds |
| `isSelected` per-row method call vs view-model convention (TN) | folded into `viewRows` |
| `listOutcomes` type redeclared (Standards/TN) | `OptionsReplayRun['listOutcomes']` |
| `ReplaySortDirection` duplicate (Standards) | alias to `BacktestSortDirection` |
| `listOutcomes` key casing asymmetry vs uppercased symbols (TN) | converter uppercases outcome keys |
| `createdAt` NaN on `''` (Spec) | lexicographic ISO compare |
| Stale "failed-count badge" doc comment; `formattedStartDate` passthrough naming | comment fixed; renamed `startDateText` |

## Deferred (documented, not gaps)

- `selectRun` has no production caller — retained as the public deselect/clear-symbol API.
- Re-clicking an already-selected row does not re-expand its card (signal equality suppresses re-emit; fixing needs a version counter for marginal UX).
- Filtered-empty list shows "No selection replay runs yet" — `hasActiveFilters` threading to the list's empty state is the #1374 controls task's seam (sibling does exactly this).
- `<tr>` click has no keyboard/ARIA support — pre-existing pattern, future a11y pass.
- No `backtest-dashboard.component.spec.ts` exists — the `filteredRows`/`selectRow`/`selectedSymbol` binding seam is untested end-to-end.
- `runStatus` carried on `ReplayListRow` unrendered — reserved for #1374 rerun-disable per IMPL-FE §2/§3.
- `ReplaySymbolStatus` has no `'running'` — inherent: rows derive from run-doc `listOutcomes`, stamped at list close-out. Row can transiently show `pending` while the detail card shows `running`.

## Test results

- `npx jest options-replay` — **101/101** (9 suites; +2 specs this round)
- `npx jest` full suite — **5,078/5,083**; the 5 failures were `option-chart-generator.spec.ts` NG0201 in the user's in-flight contract-list wiring, fixed by the user mid-run (re-run: 5/5 green). Unrelated to this task.
- `npx tsc --noEmit -p tsconfig.app.json` — clean
- `npx ng build` — clean (post-remediation templates compile)
- `git diff --check` on task files — clean

## Verdict rationale

Zero critical/major findings across all axes; every convergent minor was either
fixed in-cycle or documented as an owned deferral. PASS → `7_QA`.

---

## Round 2 — post-remediation convergence check (2026-11-04)

All three axes re-ran against the post-remediation diff and verified every
round-1 fix correct at the source level — no AC regressions. TN verdict:
**APPROVE** ("the judo landed; the selection consolidation deleted the drift
invariant at the type level"). New findings were minors/nits only.

### Remediated in-cycle (R2)

| Finding | Fix |
|---|---|
| `listsSubscription?.closed` guard untested (Standards+TN) | spec: error the stream → same-run `selectRow` restreams |
| Stale `contractLists` joined across a cross-run switch (Standards+Spec) | `loadContractLists` start patch now clears `contractLists` |
| Expanded cards leaked across run switches (Spec) | detail effect resets `expandedSymbols` when `run` changes |
| `ReplayRowSelection`/`ReplaySelection` near-duplicate (Standards+TN) | `ReplayRowSelection` deleted; `selectRow` patches `ReplaySelection` straight through |
| `selectRun`/`startReplay` duplicated body (Standards+TN) | shared `applyRunSelection` helper |
| Redundant `[...filtered]` spread (Standards) | `filtered.sort()` directly |
| `listOutcomes` key-uppercasing branch untested (Spec) | spec: `{spy: 'success'}` → `{SPY: 'success'}` |
| Converter comment said "above", code was below (Spec+TN) | wording fixed |

### R2 deferred

- Filter/sort API unwired — confirmed #1374 groundwork (TN asked; answer is yes).
- `selectRow` symbol normalization — no caller passes non-uppercase (scope).
- `runStatus` unrendered — still reserved for #1374 rerun-disable.

### R2 test results

- `npx jest options-replay` — **103/103** (9 suites; +2 R2 specs)
- `npx tsc --noEmit -p tsconfig.app.json` — clean · `git diff --check` clean
