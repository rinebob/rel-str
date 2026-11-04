**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Selected Contract List Picker  
**Thread Slug:** contract-list-picker  
**Issue:** #1359  
**Thread Parent:** #1352  
**Topic Parent:** #1243  
**Task:** #1361  
**Domain:** OPTIONS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-04  
**Last Updated:** 2026-11-04  

# Code Review — Task #1361: Session store + list service + `?list=` handler + chooser

Three axes (Standards / Spec / Thermo-nuclear) run on the task's change set:
`contract-list-emit.util.{ts,spec.ts}` (new), `contract-list-session-settings.{ts,spec.ts}` (new),
`contract-list.service.{ts,spec.ts}` (new), `contract-list-session.store.{ts,spec.ts}` (new),
`contract-list-chooser.component.{ts,html,scss,spec.ts}` (new),
`contract-list-picker.component.{ts,html,scss,spec.ts}` (new — shell only, rows/lines UI is #1362),
`option-chart.component.{ts,html,scss}` + `option-chart-list.spec.ts`. Sibling uncommitted work
in the same page files (replay dropdown, study-range clear button, de-materify migration hunks)
was excluded by hunk attribution.

## Standards

| # | Finding | Disposition |
|---|---|---|
| S-1 (violation) | `option-chart.component.ts` crossed **1,033 lines** — this task added ~170; the 1k hard rule requires extraction or documented team approval | **DEFERRED with user approval** — dedicated extraction task filed under Blueprint #1359 covering the whole page (list wiring + generator wiring + chart glue), not just this diff. See "File-size decision" below. |
| S-2 | `rowsToPlottedEntries` exported, fully spec'd, zero production callers | Accepted — named by IMPL §FE-2 for the #1362 consumer; the wired path is `toPairLines`→textarea→`loadPlotted`. |
| S-3 (minor violation) | `pickRowsOf(...).filter(selection.has)` recomputed three times in `withComputed` (uniqueCount / emittedLines / selectedRows) | **FIXED** — second `withComputed` block now reads the `selectedRows`/`chunks` signals; single filter, single partition. |
| S-4 (nit) | `version: 1` literal in `persist()` while `LIST_SESSION_VERSION` exists | **FIXED** — imported and used. |
| S-5 | `sendSelected`/`sendChunk` vs mirrored store's `emit()` verb | Accepted — `send*` names the handoff to the textarea; different store, different seam. |
| S-6 (nit) | `ds-dialog` imported twice in chooser; `recentLists$(50)` restates the service default | **FIXED** — imports merged; arg dropped. |
| S-7 | 15-field `pick()`/`listDoc()` fixture copy-pasted across ~6 spec files | Deferred — shared spec helper is a #1362-era cleanup when more consumers land. |
| S-8 (nit) | `void this.loadList(...)` self-invocation inside `setSymbol` | **FIXED** — loader hoisted to `doLoadList` closure shared by `setSymbol` and the `loadList` method; no `this` detachment risk. |
| S-9 (nit) | `loadListDoc` wrote `status:'loading'` then synchronously applied — invisible intermediate state | **FIXED** — dead write removed; `loadSeq++` retained (still invalidates an in-flight fetch). |
| S-10 | `store.error()`/`listError()` render identical error-chip blocks | Accepted — different error sources (chart store vs list session); merging couples unrelated lifecycles. |

**Standards verdict:** clean mirror of `option-group-generator`/settings/service conventions; Firestore
posture (`ST_OPTIONS_CONTRACT_LISTS_ROOT`, `docData`, `collectionData({idField})`, `runInInjectionContext`)
matches `options-replay-runs.service.ts` exactly. Approved with the file-size item dispositioned.

## Spec

All seven issue ACs verified **MET** after remediation. In-gate findings:

| # | Finding | Disposition |
|---|---|---|
| C-1 (major, UAT-found) | `?list=` param never consumed — stayed in the URL, so every refresh re-fired `onContractListDocId` and re-opened the picker / re-spammed the named error | **FIXED** — subscription now consumes-then-clears via `router.navigate([], {queryParams:{list:null}, queryParamsHandling:'merge', replaceUrl:true})` on first consumption; cleared no-op emission guarded; spec added. |
| C-2 | Persist-wipe fired on *any* load failure — a bogus `?list=` deep link erased a prior session's saved docId/selection/cursor | **FIXED** — `fail()` takes `wipePersisted`, set only on restore-initiated loads (`restore != null`). Explicit/deep-link failures preserve the blob; stale-restore failures clear it. Spec added. |
| D-1 | Missing specs for the named-error branches (non-success status, no pick metadata, empty rows, wrong symbol) and the `loadSeq` stale-load guard | **FIXED** — six specs added across store + service (`doc()` path/collection assertion, `from(deferred)` seq-discard test, `loadListDoc` no-refetch + wrong-symbol tests). |
| Scope check | Picker renders provenance + count readout + Send only — the shell contract | Correct for #1361; rows/stepper/lines tabs are #1362, mini-controls/timeline are #1363. |

AC evidence: `?list=` load+open+named-error paths (`option-chart-list.spec.ts`), cross-symbol
switch-before-load (`onContractListDoc` shared tail), chooser sort/filter/widen (chooser spec),
first-10 selection + cursor-0 + no-selection-row rejection (store spec), chunk partition +
`i/n · days · unique` + clamping (store spec), `toPairLines` dup-preserving deterministic emit
excluding no-selection rows (emit spec), `rs-optlist:{SYMBOL}` round-trip + stale-docId named
error (settings + store specs).

## Thermo-nuclear

| # | Finding | Disposition |
|---|---|---|
| TN-1 (major) | `listError` chip rendered inside the closed right drawer — a failed `?list=` deep link's named error was invisible | **FIXED** — chip moved into the always-visible `mat-sidenav-content` error section beside `store.error()` (`option-chart.component.html:562-570`), with a comment explaining placement. |
| TN-2 (major) | Chooser closed with `listId` → page refetched a doc `recentLists$` already held — redundant Firestore read, defeated the `loadListDoc` de-dup seam | **FIXED** — chooser closes with the converted `OptionsContractListUi`; `openListChooser` passes it to `onContractListDoc`, which shares the tail with `onContractListDocId` (fetch → symbol switch → `loadListDoc` → open picker). No second `getList$` on the chooser path; spec added. |
| TN-3 | Two `?list=` fires could stack two picker dialogs | Deferred to #1362 — dialog is rebuilt there; edge case, no state corruption (same session store underneath). |
| TN-4 | `doc.symbol.trim()` sits outside the try in `onContractListDocId` — a doc with no `symbol` throws instead of naming an error | Accepted — every real doc carries `symbol`; scope discipline over defensive armoring. |
| TN-5 | `onLoad`'s `dialog.openDialogs.length` guard relies on `DsDialogService` unsubscribing before the caller's `afterClosed` subscriber | Accepted — verified correct ordering (service's `_openDialogs` splice subscribes first); documented as fragile-but-correct. |
| TN-6 | Async load races (init `setSymbol` restore vs `?list=`; cross-symbol restore vs doc load) | Verified guarded — `loadSeq` + `store.symbol()` re-check discard stale continuations; seq-discard spec added (C/D-1). |

## File-size decision

`option-chart.component.ts` grew ~860 → **1,033 lines** on this task, crossing the repo's 1k hard
rule. The #1360 review had already deferred the 838-line overage as a named follow-up. Options
were presented to the user (extract the ~170-line contract-list wiring into a page-scoped bridge
now vs. document vs. dedicated task). **User chose a dedicated extraction task for the whole
component** — filed under Blueprint #1359 — timed to land alongside #1362/#1363, which will add
more picker wiring to this page, and after the in-flight de-materify migration in the same file.

## Test results

- Contract-list sweep (`--testPathPatterns "contract-list"`): **7 suites / 57 tests — PASS**
- Option-chart sweep (`--testPathPatterns "option-chart"`): **3 suites / 45 tests — PASS**
- `tsc -p tsconfig.spec.json --noEmit` — **0 errors in the task fileset** (10 errors exist elsewhere:
  dashboard-v2 `updateSize`, generator/option-chain spec drift — all in-flight de-materify
  migration WIP in unchanged-by-this-task files, flagged to that workstream)
- Full suite: 296 suites run; **50 failing suites are all outside this task's fileset**
  (order-ticket, manual-order, portfolio dialogs, sidenav — same migration fallout); zero
  contract-list/option-chart failures.

## Still deferred (carried to later tasks)

- Picker rows/stepper/lines UI — **#1362** (by design; the shell + this plumbing is the whole #1361 contract).
- Chunk stepper/timeline/chart mini-controls; `listError`'s permanent home — **#1363**.
- Chooser `mat-button-toggle` → `dse-switch` (repo convention) — #1362 dialog pass.
- Missing-doc (page-level, session preserved) vs invalid-doc (store-level, blob wiped) asymmetry — semantics call for #1362.
- `docData` vs `getDoc` point-read semantics — matches current repo convention; revisit only if the convention moves.
- Fixture helper extraction — deferred (S-7).
- Whole-page 1k-line extraction — dedicated task under #1359 (above).

## Verdict

**PASS** — both majors remediated in-gate with covering specs; UAT found one real defect
(unconsumed `?list=`) that is also fixed and spec'd. The picker behaving as a shell is the
correct #1361 boundary. Remaining items are minors with stated dispositions or explicit
later-task scope.

---

# Second pass — post-remediation re-review

All three axes re-run on the post-fix working tree. Every pass-1 fix verified intact
(8/8 confirmed by the Standards axis, all 7 ACs still MET by the Spec axis); the pass
surfaced **two new majors**, both remediated in-gate:

| # | Finding | Disposition |
|---|---|---|
| 2-1 (major) | **Restore-failure errors were invisible.** `setSymbol` → `doLoadList` → `fail()` wrote `store.error()`, but nothing rendered it — the page only showed `listError` (bridged solely in `onContractListDoc`), the drawer only `activeList`. A stale persisted docId failed every page load silently — the exact "never silent empty" the store header promises, same defect class as TN-1. | **FIXED** — `listErrorText = computed(() => listError() ?? listStore.error())` unions page-level and store-level errors; the template binds it. Spec: persisted stale docId → `listErrorText` carries the named error while `listError` stays null. |
| 2-2 (major) | **Out-of-order `?list=` applies the wrong doc.** `?list=A` → `?list=B` resolved B first (session + picker), then A overwrote the session and stacked a second picker — the store's `loadSeq` can't help since each `loadListDoc` is a legit fresh apply. | **FIXED** — page-level `listDocReqSeq` in `onContractListDocId`; a superseded fetch applies nothing and opens nothing. `onContractListDoc` also bumps it, so a chooser selection invalidates a still-in-flight deep-link fetch (latest user intent always wins). Spec: deferred-A resolves after B applied — session stays on B, `dialog.open` called once. |
| 2-3 (minor) | A failed cross-symbol doc committed a wasted symbol switch + catalog/underlying reload before failing | **FIXED** — shared `contractListDocError` validator (exported from the store module) runs shape checks in `onContractListDoc` *before* `onSymbolChange`; same validator inside `applyLoadedDoc`, so page and store can't drift. Spec added. |
| 2-4 (minor) | All-miss doc (success + pickDocMeta + only `no-selection` rows) landed on a dead `ready` session with nothing sendable | **FIXED** — the validator requires ≥1 pick row (`pickRowsOf(doc.rows).length === 0` → "contains no pick rows"), covering empty-rows too. Store spec updated + all-miss spec added. |
| 2-5 (nit) | Whitespace `?list=` lingered in the URL (trimmed to `''`, guard returned before the clear) | **FIXED** — subscription clears whenever the param is present, loads only on non-empty trimmed id. Spec added. |
| 2-6 (nit) | `pickRowsOf` duplicated store↔emit-util; unused `chunkCursor` destructure; `fail` comment said "clears docId" but wipes the whole blob; unused type imports | **FIXED** — single exported `pickRowsOf` in `emit.util` (widened to `rows?`), store imports it; destructure/comment/imports cleaned. |
| 2-7 | `listErrorText` prefers the page error — a stale store error can mask a newer page error | Accepted — both are real errors; store error clears on the next successful apply. |
| 2-8 | NaN inputs (`setChunkSize(NaN)`/`selectStride(NaN)`) propagate into cursor/selection | Accepted — self-heals via the persisted-cursor validator; hostile-input armoring is out of scope. |
| 2-9 | `store.symbol() !== symbol` check in `doLoadList` unreachable (setSymbol bumps seq first) | Accepted — harmless defense at a public seam. |
| 2-10 | Chooser still lists all-miss docs (load now names the error) | Accepted — named error on select is consistent with deep-link behavior; chooser-level filtering is #1362 UX. |

## Second-pass test results

- Sweeps: `contract-list|option-chart` — **10 suites / 107 tests — PASS** (+5 specs: all-miss
  doc, superseded `?list=`, whitespace param, failed-cross-symbol no-switch, restore-error
  visibility)
- `tsc -p tsconfig.spec.json --noEmit` — clean for the change set (pre-existing errors
  elsewhere unchanged)

## Verdict (reaffirmed)

**PASS** — the second pass found two real majors in remediation-adjacent paths (error
visibility, request ordering), both now fixed with covering specs. All remaining items are
minors with stated dispositions or later-task scope.

---

# Third pass — post-remediation + post-migration re-review

Run against the working tree after the repo-wide de-materify migration rewrote
`option-chart.component.{ts,html}` and `contract-list-chooser.component.{ts,html}`
(`mat-sidenav`→`aside.side-panel[class.open]`, `mat-chip`→`flag-chip`, `mat-button-toggle`→
`pill`/`role="switch"`, all Material imports dropped). All contract-list hunks verified
intact post-migration; all pass-2 fixes verified on every axis. One new major found and fixed:

| # | Finding | Disposition |
|---|---|---|
| 3-1 (major) | **`listError` was never cleared on success or symbol switch.** Set to `null` only at `onContractListDocId` entry — a `?list=BAD` error survived a successful chooser recovery indefinitely, and its `??` precedence then masked later store-level restore errors (recreating the 2-1 invisible-error class). | **FIXED** — `listError.set(null)` at the top of `onContractListDoc` (every doc handoff clears) and inside `onSymbolChange`. Specs: chooser success after `?list=` failure clears the chip; symbol change clears it. |
| 3-2 (minor) | `onContractListDocId`'s `"not found"` literal duplicated `contractListDocError`; bare `catch {}` dropped `err.message` | **FIXED** — the docId path now folds through `contractListDocError(doc, docId)` (one validator, one message set); catch surfaces `err.message`. |
| 3-3 (minor) | Chooser-invalidates-in-flight-`?list=` interleaving was unspec'd — deleting the `onContractListDoc` seq bump passed every spec | **FIXED** — spec added: deferred `?list=A` resolves after chooser applies doc B — session stays B, no second picker. |
| 3-4 (nit) | Absent-param → no `router.navigate` unasserted; stale chooser doc-comment ("converge on `loadList`") | **FIXED** — `not.toHaveBeenCalled` assertion added to the whitespace spec; comment corrected. |
| 3-5 | Closed `.side-panel` contents remain keyboard-focusable under `aria-hidden` (negative-margin hide ≠ `inert`) | Flagged to the de-materify workstream — pre-existing migration pattern, not #1361 scope. |
| 3-6 | `onReplaySelected` inlines `r.kind === 'pick'` instead of `pickRowsOf` | Not this diff — pre-existing replay path; flagged. |

## Third-pass test results

- Sweeps: `contract-list|option-chart` — **10 suites / 110 tests — PASS** (+3 specs:
  chooser-invalidates-fetch, stale-error-clear-on-handoff, symbol-change-clear; plus the
  absent-param assertion folded into the whitespace spec)

## Verdict (reaffirmed)

**PASS** — three passes total, five majors remediated in-gate. The finding trajectory
(2 → 2 → 1 majors, all in error-lifecycle/request-ordering paths now individually spec'd)
shows the surface is combed; a fourth pass would yield only nits.
