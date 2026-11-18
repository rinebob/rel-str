**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1302  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1305  
**Domain:** SAVANT-TRADER  
**Area:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-29  
**Last Updated:** 2026-10-29  

# Code Review — #1305: page filter — All/New/Tracked header control

Three-axis gate review (Standards / Spec / Thermo-nuclear, parallel
sub-agents) over the change set:

- `src/app/features/savant-trader/pages/scanner/scanner.component.{ts,html,scss}`
  — `symbolFilter` signal, tri-state pill group, readiness gate, filtered
  `railEntries` (count + tickers), count tooltip qualifier
- `src/app/features/savant-trader/pages/scanner/scanner-recipe-table.component.ts`
  — `symbolFilter` input fed into the shared `scanRunRows` pipeline
- `src/app/features/savant-trader/utils/scanner-rows.util.ts` —
  `ScannerSymbolFilter`, `rowPassesSymbolFilter`, `normSymbolSet`,
  `SymbolRowFilter`, `scanRunRows` filter param (the type + predicate
  additions were swept into the other stream's commit `20dcc61b`)
- `src/app/features/savant-trader/utils/scanner-sort.util.ts` —
  `baselineSortedRows` `symbolFilter` param
- `src/app/features/savant-trader/stores/symbol-list.store.ts` —
  `trackedStatus` readiness state (M1 remediation)
- Specs: `scanner.component.spec.ts` (trimmed),
  `scanner.component.filter.spec.ts` (new — filter specs + readiness),
  `scanner-rows.util.spec.ts` (predicate describe)

## Verdict: **PASS** (after remediation — first pass was FAIL)

First pass produced 1 major + ~10 minor/nit findings. All were remediated
and the final state re-verified (specs re-run, strict tsc clean, full
suite green).

## Findings — first pass

### Standards axis — PASS with minors
- minor — normalized-set construction spelled two ways (`Array.from(s, fn)`
  vs `.from(s).map(fn)`) at page + table → shared `normSymbolSet`
- minor — `rowPassesSymbolFilter` had no util-level spec; broke the
  file's per-export describe convention
- minor — `scanner.component.spec.ts` crossed 400 lines (499) — filter
  block split out
- nit — stray blank lines; stale `.scss` task tag; `trackedNorm` comment
  named only one consumer; `wireRow` fixture name collided with the
  `wireRowToScanRow`/`ScanRow` vocabulary; `.symbol-filter` class existed
  only as a test selector

### Spec axis — PASS
- Every PRD US-3 criterion, IMPL §1 rule, TEST-FE §1 spec item, and
  issue-body checkbox MET with non-trivial behavioral specs (DOM clicks
  → rail text/table rows).
- minor — `first N of M` reads imprecisely under an active filter on a
  capped page (12 filtered-of-first-page renders "first 12 of 350") —
  addressed via the rail count's `title` qualifier; table-header
  semantics noted for UAT
- nit — no case-mismatch spec on the filter path (row `'aapl'` vs
  tracked `'AAPL'`) — added in the util describe

### Thermo-nuclear axis — FAIL
- **major** — Tracked-universe readiness/failure invisible:
  `loadTrackedSymbols` resolves `[]` silently on error and starts empty,
  so `New`/`Tracked` could render `0 / M` (flash-then-settle) or
  permanently wrong counts (silent failure) — the filter turned a
  cosmetic badge race into wrong numbers across the scoreboard
- minor — `N / M` count conflates filtered-of-returned over universe
  total with no qualifier
- minor — filter spelled differently at the two pipeline ends
  (sort-then-filter rail vs filter-then-sort table) — drift risk the
  shared pipeline exists to prevent
- minor — spec gaps: readiness, filter × stale/error states, no
  util-level predicate spec, child's input probed
- nit — badge column degenerates under filter (accepted — informative);
  extras derive from filtered rows (defensible, commented); `aria-pressed`
  on an exclusive group (accepted — matches the task spec + pill idiom);
  `trackedNorm` read twice per recipe; remount resets filter (intended);
  util file-header didn't mention the filter

## Remediation applied

| Finding | Fix |
|---|---|
| **Tracked readiness (major)** | `trackedStatus: 'idle'\|'loading'\|'ready'\|'error'` state in `SymbolListStore`, patched through `loadTrackedSymbols` (loading→ready/error); load failure snackbars like `loadSymbolLists` does; New/Tracked pills disabled + titled until `ready` — the filter refuses rather than lies; rail count shows `…` in the window |
| Count semantics | `countTitle` on `RailEntry` — `[title]` qualifies "N of M scan hits match the filter" whenever a filter is active |
| Pipeline drift | `SymbolRowFilter` param folded into `scanRunRows` (filter applies after `mergeLookup`, over the unfiltered wire set); `baselineSortedRows` takes `symbolFilter`; both call-site `.filter` spellings deleted |
| `normSymbolSet` | Shared helper next to `normScanSymbol`; page + table both consume it |
| Spec gaps | New `scanner.component.filter.spec.ts` (7 specs: tri-state, all three modes, table input, `0 / M` empty state, rail-switch persistence, count title, readiness loading + error); `rowPassesSymbolFilter` describe incl. row-side case-fold; `tables()[0].symbolFilter()` input probe dropped |
| Nits | Blank lines, `.scss` task tag, `trackedNorm` comment, `wireRow`→`wireResultRow`, `.symbol-filter` class→`data-testid="symbol-filter"`, util file header |

## Test results

- `npx jest --coverage=false` — **280 suites / 4,812 tests, all green**
- Strict `tsc --noEmit` clean on all touched files
- New specs: 7 filter + 5 util-predicate behavioral specs

## Accepted-by-design (noted, not findings)

- `aria-pressed` tri-state — task-spec'd and matches the pill idiom; a
  `radiogroup` upgrade is possible but not required
- Badge column identical under an active filter — kept (consistent info)
- Filter resets on remount — view state by design (PRD: needn't survive)
- `first N of M` header phrasing under filter — qualifier carried in the
  rail count `title`; UAT to confirm wording reads correctly

## Verdict rationale

No unresolved critical/major findings after remediation. The readiness
gap that made wrong numbers possible is closed at the store boundary
(`trackedStatus`) and enforced in the UI (pills refuse); the filter is
one canonical pipeline concept (`SymbolRowFilter` on `scanRunRows`), the
normalized-membership spelling is shared, and every spec criterion is
covered behaviorally.

## Pass 2 — convergence check (user-requested, post-remediation)

Three axes re-run over the remediated state. One real new major, plus
minors — and the remediation's own spec then caught a second live bug.

### Findings → fixes

| Finding | Resolution |
|---|---|
| **MAJOR — `getTrackedSymbols$` swallows its own error channel** (`catchError → of([])`), so `'error'` status/snackbar/retry were dead code and a real load failure reported `'ready'` + empty universe — the exact silently-wrong-counts hole reopened | Fixed at the service boundary: `getTrackedSymbols$` now `defer`s `inCtx` (matching every sibling method — also closes the eager-throw/stuck-`'loading'` hole) and logs via `tap` instead of `catchError`. Errors now reach `loadTrackedSymbols`' live error arm. `stock-list-v2.feature.ts` (the only other caller, which relies on silent `[]`) compensated with a local `.catch(() => [])` |
| **New bug found by the new spec — `trackedInFlight` clobber:** a synchronous observable error nulled `trackedInFlight` inside the Promise executor, then the outer assignment overwrote the null — the retry path could never fire, and `return trackedInFlight` could return `null` | Restructured: resolve captured, promise stored, THEN subscribed; returns the local `pending`. The producer spec proves failure → `'error'` + snackbar → later call retries to `'ready'` |
| Rail tickers not masked under `!filterReady` (count showed `…` but tickers still computed against the absent set) | `tickers` gated on `filterReady` alongside count |
| `countTitle` vs `…` inconsistency | `…` count now carries `'Waiting for the tracked-symbol universe'` title |
| `title` on `[disabled]` pills never renders | Tooltip hoisted to the `.pill-group` container |
| Dead `tables()` helper + orphaned imports in filter spec | Removed |
| `matchedCount` in `scanner.store` hand-rolled the `normScanSymbol`-to-set spelling | Consumes `normSymbolSet` |
| IMPL §1 mechanism text stale post-fold-in; TEST §1 suite name stale | As-built updates to both docs |
| Producer-side `trackedStatus` transitions untested; `scanRunRows` filter-param ordering unpinned | 3 new store specs (idle→loading→ready+cached, legit-empty→ready, error→retry) + 2 pipeline specs (filter applies post-merge over the unfiltered set) |

### Re-verified

- `npx jest --coverage=false` — **282 suites / 4,845 tests, all green**
- `tsc -p tsconfig.app.json --noEmit` — clean
- Producer-side specs pin the exact failure→error→retry lifecycle the
  pass-1 major was about; the pipeline spec pins merge-over-unfiltered
  ordering end-to-end.
