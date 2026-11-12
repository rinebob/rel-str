**Topic:** Options Backtest  
**Topic Slug:** backtest  
**Thread:** Backtest Analytics  
**Thread Slug:** backtest-analytics  
**Issue:** #1266  
**Thread Parent:** #1266  
**Topic Parent:** #1238  
**Task:** #1471  
**Domain:** BACKTEST  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-12  
**Last Updated:** 2026-11-12 (Round 2)  

# Code Review — #1471: FE: Selection Replay row actions (detail panel removal) + results-to-chart narrowing dialog

## Round 2 — 2026-11-12: PASS

Re-review of the post-remediation delta (verify-every-fix + fresh-eyes
on the new lines). Both R1 majors confirmed substantively fixed; the
residuals found during re-verification were closed in-cycle.

**R1 remediations verified:**
- **M-1 (aux-stream recovery):** `loadAuxStreams()` now runs before the
  `runsSubscription` early-return; each aux branch gates on
  `!sub || sub.closed` (`catchError → of(fallback)` completes the
  subscription, so `.closed` is the correct liveness test); a dead runs
  stream re-subscribes the same way. Three new specs pin revival with
  fresh Subjects (lists, results, runs). `listsStreaming` fully
  excised — zero remaining references.
- **M-2 (`getList$` error channel):** `openResultsNarrow` subscribes
  `{next, error}` — the error path seq-guards, names the failure via
  `listError`, and still emits the full set through the generic
  confirm. `take(1)` intact; next/error are mutually exclusive so
  `fallback()` fires at most once. New spec pins both the error text
  and the 51-entry emit.
- **m-1 (stale `onSend`):** `pickerRef?.close()` + null before
  `loadListDoc`; `DsDialogRef.close()` is synchronous so the guard
  can't block the fresh dialog.
- **Minors swept:** empty-entries check now precedes
  `switchSymbolForDoc`; dead `app-options-replay-run-detail` SCSS
  removed; `analysisLink: string`; `@if (row.canViewContracts)` unifies
  the duplicated predicate (verified equivalent); `let doc` typed;
  dialog title pluralized + spec updated; `#1431`→`#1471` refs
  corrected only where they describe the detail-panel removal.

**R2 residuals closed in-cycle:**
- **Reverse-direction picker collision** (found during R2): a
  `?list=`/chooser send landing while the results picker is open hit
  the same silent-onSend class — the open picker would keep the
  results-aware `byContract` mapping over a plain list session and
  emit an empty subset. Fixed by tracking the installed Send
  (`pickerOnSend`): `openListPicker` early-returns only when the
  requested Send is identical; a different Send closes and reopens.
- Three stale `#1431` comment refs in the two services + run-list spec
  corrected to `#1471`.

**Deferred, not blocking (follow-up candidates):**
- Unbounded collection watches carrying full `rows`/`trades` payloads
  to derive `analysisReadyListIds` (a `Set<string>`) — spec-prescribed
  architecture, volume-bounded today; run-doc rollup fields
  (`listStatus`, `hasResults`) would delete both watches. File under
  the analytics thread.
- `watchResultDocs(runId)` survives with zero consumers (spec said
  "survives for other consumers"; only `watchContractList` retains
  one). Dead API — remove on next touch or keep documented.
- Root-scoped store keeps the three collection watches hot for the app
  session after leaving the dashboard — same posture as `watchRuns`,
  accepted convention.
- Picker selection is pick-day granular — the contract-substring
  filter widens to every contract sharing a selected date; the
  contract-granular mapping caveat documented in code stands.

**Test results:** focused remediation suites 107/107 green
(`options-replay.store`, `option-chart-services`,
`options-replay-run-list`, `options-replay-contract-list-dialog`);
full suite **308/308 suites, 5,504/5,504 tests green**.
`tsc --noEmit` reports only 12 pre-existing
errors in foreign `portfolio-dashboard.store.spec.ts` (committed by
the #1411 portfolio session — untouched by this task, out of scope);
zero errors in changed files.

---

## Round 1 — 2026-11-12: FAIL — two verified majors, both small fixes

Diff reviewed: working tree vs `HEAD` scoped to the #1471 surface
(`.devin/tmp/1471-review.diff`, ~4,044 lines). Foreign-in-diff excluded
per scope: #1431 results-page columns/chips/back-nav, converter
`openCount` backfill, analysis-results store; #1470 `dse-select`
restyling; user's in-progress chart pinned-window WIP (plus the 6-line
dated-bars type fix that unblocked spec compilation).

| Axis | Result |
|---|---|
| Standards | One hard violation (dead `listsStreaming` signal) + one regression (aux-stream recovery path lost with `selectRow`) |
| Spec | APPROVE — part A implemented as spec'd; part B's picker-pivot satisfies stated intent (documented deviation) |
| Thermo-nuclear | 2 majors + 1 major-adjacent collision; structural wins acknowledged |

**Test results:** `npx jest` — **308/308 suites, 5,500/5,500 tests, green**
(77s). `tsc --noEmit` clean on the reviewed tree.

## Findings

### Critical

None.

### Major

**M-1 — Aux streams can never recover after a listener error
(regression vs deleted code).**
`options-replay.store.ts:195-266`. `watchStream`'s
`catchError → of(fallback)` *completes* the subscription on any stream
error; `loadAuxStreams` guards `if (!listsSubscription)` /
`if (!resultsSubscription)` but a closed `Subscription` is still
non-null, so neither restart branch ever fires. Worse, `loadAuxStreams`
is invoked only inside `loadRuns()`, which early-returns once
`runsSubscription` exists — so nothing re-invokes the restart path even
on a later dashboard mount. Consequence: one transient error (e.g. the
`Missing or insufficient permissions` event observed live on this
surface) emits the `[]` fallback, toasts once, and permanently freezes
every row's Contracts/Analyze/Results state for the app session
(root-scoped store). The deleted `selectRow` re-streamed on
`listsSubscription.closed`; that recovery path and its spec
("reselect restreams when the stream died") were removed without an
equivalent.
**Fix:** reorder `loadAuxStreams()` ahead of the `runsSubscription`
early-return in `loadRuns()`, and gate each aux branch on
`!sub || sub.closed`. Restore a spec covering "dead stream revives on
next `loadRuns()`".

**M-2 — `openResultsNarrow` subscribes to `getList$` with no error
handler.**
`option-chart-list.service.ts:183-186`. `getList$` wraps a `docData`
listener, which errors on rules/permission/network failures. The
missing-doc and invalid-doc paths degrade to the plain emit (as
documented), but an *errored* read is an unhandled Observable error —
no fallback emit, no `listError` entry, silent dead-end for the user.
The sibling `?list=` path (`onContractListDocId`) wraps the same call
in `firstValueFrom` + try/catch and names the error. Same error class
as M-1's trigger.
**Fix:** add an error channel that either names the failure via
`this.listError` or degrades to `fallback()` — consistent with the "the
result doc stands alone" posture already documented.

### Major-adjacent (recommended same-cycle fix, edge-case reachability)

**m-1 — `pickerRef` guard silently drops the results-aware `onSend`.**
`option-chart-list.service.ts:299-309`. If a picker is already open
when `openResultsNarrow` fires, `openListPicker` early-returns; the
already-open picker keeps its `emitSessionLines` Send, so Send emits
plain `date,contractId` lines — markers dropped and the generic >50
confirm returns. Only reachable same-tab (in-app producer opens a new
tab, so `pickerRef` starts null), but the failure mode is silent.
**Fix:** close an existing picker before opening the results picker,
or track which `onSend` is installed and re-open on mismatch.

### Minor

- `switchSymbolForDoc` runs before the empty-entries check —
  `onResultsDocId` (`option-chart-list.service.ts:155-160`): a
  valid-but-empty doc resets the page symbol/session, then errors.
  Move the `entries.length === 0` check above the swap, matching the
  `?list=` path's validate-first order.
- Dead `app-options-replay-run-detail` SCSS selector —
  `backtest-dashboard.component.scss:63`.
- `listsStreaming` is now write-only — `options-replay.store.ts:38`;
  its only consumer was the deleted detail panel. Remove or re-purpose.
- `analysisLink` typed `string | null`, never null —
  `options-replay-run-list.component.ts` (`@if (row.hasResults)`
  guards); tighten to `string`.
- Duplicated predicates — run-list template uses `row.canViewContracts`
  (Contracts) and `row.list` (Analyze) for the same condition; one flag.
- Dead API — `watchResultDocs(runId)` survives with zero consumers
  (spec said "survives for other consumers"; only `watchContractList`
  retains one). Keep documented or remove.
- Task-ref comments cite `#1431` for the detail-panel removal
  (`options-replay.store.ts:7`, run-list header, dialog) — the removal
  ships under #1471; #1431 is the (separate) results-page task.

### Nits

- `let doc;` evolving-any in `onResultsDocId` — declare
  `AnalysisResultDoc | null`.
- "1 rows" pluralization in the dialog title (spec pins it).
- `seen` set in the Send map is constructed per fetch — a second
  `onSend` invocation would filter previously-seen contracts to `[]`
  (picker emits once today).
- Selection is pick-day granular, so the picker's contract-substring
  filter widens to every contract sharing a selected date — documented
  contract-granular mapping caveat stands.

### Noted, not blocking (documented risk / follow-up)

- **Unbounded collection watches with full payloads** —
  `watchContractLists()` / `watchAllResultDocs()` stream every doc in
  both collections including full `rows`/`trades` payloads; the
  `analysisResults` array exists only to derive `analysisReadyListIds`
  (a `Set<string>`). Spec-prescribed (the issue specifies
  collection-wide watches) and volume-bounded today (~1 list/run, ~6
  results/analyzed run), but payload weight grows with history.
  Follow-up: rollup fields (`listStatus`, `hasResults`) on the run doc
  written by the workers would delete both watches — worth a backlog
  issue.
- Cell-index DOM assertions (`cells[6]`, `tds[7]`) in the
  analysis-results spec — brittle to column reorder; consistent with
  the accepted convention from the #1431 review.

## Standards

All SDK contracts verified clean: `doc(firestore, collection, docId)`
segments, `collectionData` + `idField`, `DsDialogService.open<C,D,R>`
generics, `DsDialogRef<C>` injection, `selectDates(Iterable<string>)`
← `Set<string>`, `PlottedEntry.markerDates?` optionality, deep-link
wiring at `option-chart.component.ts`.

Hard violations: dead `listsStreaming` signal (write-only state);
lost aux-stream error-recovery path (regression — see M-1). Judgement
calls: stale `analysisLink` doc/type, duplicated row predicates,
silent onSend/narrowing drops, unbounded watches, `let doc` any,
task-ref numbering — itemized above.

## Spec

Part A implemented exactly as spec'd: detail component deleted,
five row actions live per row with correct state predicates
(`analyzingListIds`, `analysisReadyListIds`, `contractListById`),
selection machinery (`selectRow`/`selectedRun`/`ReplaySelection`) fully
excised, rows no longer clickable.

Part B is an accepted design pivot: the issue body sketches a checkbox
narrowing dialog; the user rejected that mid-flight ("it would be
better to just have the picker open with all its selection controls")
and the implementation reuses `ContractListPickerComponent` with a
results-aware `onSend` mapping emitted `date,contractId` lines back to
the original `PlottedEntry[]` — `markerDates` preserved verbatim.
Intent met: narrowing control before plotting, marker preservation,
"load all" reachable via the pre-checked selection or select-all+Send.
Caveat documented in code: contract-granular mapping — a contract
picked on multiple days is one entry and plots its full marker set
when any of its rows is selected.

Coverage pinned: row action presence/state per row; >50 `?results=`
opens picker with pick days pre-checked and nothing emits until Send;
Send maps lines→entries preserving `markerDates` with
`skipLargeConfirm`; missing list doc falls back to plain emit;
under-threshold path unchanged; generic confirm retained for
textarea/`?list=` paths.

Test gaps (noted): no spec for a `getList$` error inside
`openResultsNarrow` (the M-2 surface), a superseded narrow fetch (seq
guard), or the picker-already-open collision (m-1).

## Thermo-Nuclear

End-to-end trace completed: row → store signals → services → Firestore
listeners; `?results=` → `onResultsDocId` → `openResultsNarrow` →
`getList$` → `loadListDoc` → `selectDates` → `openListPicker(onSend)` →
`emitEntriesToChart(skipLargeConfirm)` → `confirmAndLoad` →
`loadPlotted` → `occIdInput` rewrite. Deleted component: zero code
references; one dead SCSS selector.

Structural wins: selection machinery fully excised across types, state,
streams, and panel; `bindQueryParamLink` dedupes the deep-link pipe;
`confirmAndLoad` shares the >50 gate across textarea and programmatic
sends; the contract-list dialog reuses the existing table component;
the `occIdInput` round-trip preserves markers through a re-paste.
Symbol-ordering verified: `switchSymbolForDoc` → `onSymbolChange` →
`listStore.setSymbol` is synchronous, so `loadListDoc` passes the
symbol check and its `loadSeq++` cancels `setSymbol`'s saved-doc
restore.

## Required fixes to re-run the gate

1. M-1 — restore aux-stream recovery (`.closed`-aware `loadAuxStreams`,
   invoked ahead of the `loadRuns` early-return) + spec.
2. M-2 — error channel on `getList$` in `openResultsNarrow`
   (`listError` entry or `fallback()` emit) + spec.
3. m-1 (recommended same-cycle) — handle picker-already-open before
   installing the results-aware `onSend`.
4. Minor sweep (cheap): dead SCSS selector, `listsStreaming`,
   `analysisLink` type, symbol-swap ordering, task-ref comments.

Re-run `/proj review 1238 1471` after remediation.
