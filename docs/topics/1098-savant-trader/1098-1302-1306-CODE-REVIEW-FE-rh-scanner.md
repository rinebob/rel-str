**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1302  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1306  
**Domain:** SAVANT-TRADER  
**Area:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-18  
**Last Updated:** 2026-11-18  

# Code Review — #1306: row list menu + membership chip

Three-axis gate review (Standards / Spec / Thermo-nuclear, parallel
sub-agents) over the change set:

- `src/app/features/savant-trader/pages/scanner/scanner.component.{ts,html}`
  — `listDefs`/`listMembership` computeds (exclusive-only, first-wins,
  normalized keys), `loadSymbolLists()` on init, `onListPick` →
  `toggleSymbolInList`
- `src/app/features/savant-trader/pages/scanner/scanner-recipe-table.component.{ts,html,scss}`
  — `.list-cell` chip before Symbol, `.actions-cell` `playlist_add`
  dse-menu (catalog order, checkmark on current), `listPick` output,
  `listsLoading` input
- `src/app/features/savant-trader/common/symbol-list-defs.ts` —
  `normalizeListSymbols` (remediation — canonical read-side spelling)
- `src/app/features/savant-trader/services/symbol-list-registry.ts` —
  `toDef` + legacy-merge normalization (remediation)
- specs: `scanner-recipe-table.component.spec.ts` (new #1306 describe,
  10 specs), `scanner.component.spec.ts` (+4), `scanner.component.filter.spec.ts`
  (mock surface), `symbol-list-registry.spec.ts` (new, 9 specs)

Deliberate deviation from IMPL §2: `dse-menu` (the #1348
post-deMaterify convention, per slice-menu) instead of `mat-menu` —
the repo no longer uses Material menus. `show_chart` stays deferred
to #1307 (§3 popup infra).

## Verdict: **PASS** (after remediation — first pass was FAIL)

First pass produced 1 MAJOR + ~7 minor/nit findings. All substantive
items remediated in-gate; the review pass is recorded below.

## Findings — first pass

### Standards axis — PASS with minors

- **M1** `scanner.component.html:1` — `@task` tag not extended with
  `#1306` though the template gained the new bindings.
- **M2** `pickList` emitted raw `row.symbol`, not the normalized
  spelling — contract asymmetry with the store's canonical comparisons.
- **M3** `.list-menu` anchors inside `.table-scroll` (`overflow-y:
  scroll`) — clips on bottom rows; scrollable-overflow keeps it
  reachable. Accepted as a known trade-off; flagged for UAT eyes.
- NITs — `!important` td padding avoidable via the file's own
  `.results-table` nesting; dead `list-head`/`actions-head` hooks;
  unused `data-testid="list-cell"`; synthetic `LIST_DEFS` fixture vs
  the real catalog (shape fidelity fine).

### Spec axis — PASS

All five issue ACs MET; every TEST-FE §2 bullet covered. Two
under-spec'd spots: AC2's "tracks the map (live catalog emission)"
pinned only at first render, and the page-level different-list pick →
`toggleSymbolInList` path unpinned (only the re-pick was).

### Thermo-nuclear axis — FAIL

- **MAJOR — read/write normalization asymmetry.** The page's
  `listMembership` map normalizes `def.symbols` via `normScanSymbol`
  (trim+upper), but `toggleSymbolInList`/`moveToList` compare raw
  stored spellings (`toUpperCase()` — no trim — and strict `includes`).
  A stored variant (`' aapl '` or `'aapl'` — the backend symbol-added
  writer trims but never uppercases) makes the chip claim membership
  the store can't see: a re-pick becomes a move instead of an
  un-assign, `moveToList` can't strip the variant, and the first-wins
  map keeps showing the stale list. Data precondition (dirty stored
  docs) is unverifiable from code, but the read side is the first
  consumer that normalizes — any existing variant produces a
  user-visible disagreement.
- **M1** menu clips inside `.table-scroll` (same finding as
  Standards M3).
- **M2** `listMenuFor` survives silent row swaps — a refresh-driven
  `run().result` change doesn't dismiss the menu; if the symbol
  returns on a later refresh the menu resurrects unprompted.
- **M3** `Loading lists…` lies forever on catalog stream error —
  the store sets `symbolListsLoading: false` but the menu couldn't
  distinguish loading from settled-empty.
- **M4** dse-menu ARIA contract (roving tabindex / Escape) unmet —
  convention-wide debt shared with slice-menu; deferred, not a
  regression.
- NITs — `hidden` exclusive defs would appear as assign targets
  (none exist in the seed); `normScanSymbol` would throw on
  non-string `def.symbols` entries (folded into the MAJOR fix);
  chip renders key vs menu label (AC-literal).

## Remediation applied

- **MAJOR →** `normalizeListSymbols(raw)` added to
  `symbol-list-defs.ts` (trim+uppercase, dedupe, non-strings/empties
  dropped) and applied at every read-boundary merge: `toDef`,
  `resolveSnapshot`'s legacy merge, both `fallbackDefs` sites.
  `def.symbols` is now canonical everywhere, so `inList`,
  `moveToList`'s strip filter, and the page map all compare
  canonical-vs-canonical. Bonus: `resolveSnapshot`'s migration batch
  writes normalized symbols back, self-healing dirty docs.
- **M2 →** `listMenuFor` converted to `linkedSignal` sourced on
  `rows()` — any row-array re-emission (silent refresh, sort,
  filter, recipe swap) closes the menu; clicks/picks still close it
  as before.
- **M3 →** new `listsLoading` input, bound to the store's
  `symbolListsLoading` — empty catalog renders `'Loading lists…'`
  while streaming, `'No lists available'` after settle/failure.
- **M2-standards →** `pickList` emits `normScanSymbol(row.symbol)`.
- **M1-standards →** `@task` tag extended.
- **NITs →** `!important` dropped via `td.actions-cell`/`td.list-cell`
  nested under `.results-table` (outranks the dense-table mixin on
  specificity); unused `signal` import removed.
- **Spec gaps →** new specs: chip tracks re-emitted `listMembership`
  (appear/move/clear); silent `rows` re-emission closes the menu;
  loading-vs-settled empty copy; page-level different-list pick →
  `toggleSymbolInList('AAPL','HIDE')`; `symbol-list-registry.spec.ts`
  (9 specs) pinning the canonicalization boundary.
- Mock surface updated: `symbolListsLoading: signal(false)` in both
  page-spec `SymbolListStore` mocks.

## Test results

- Targeted: `jest` scanner pages + `symbol-list-registry.spec` +
  `symbol-list.store.spec` — **6 suites / 99 tests, all pass**.
- `tsc --noEmit` — clean on all touched files (3 unrelated foreign
  files error, all other-session work: `portfolio-dashboard.store.spec`,
  `topic-viewer-page.component.spec`, `scripts/bulk-swing-sweep.ts`).
- Full suite: **323/324 suites, 6043/6063 tests**. The single failing
  suite is `topic-viewer-page.component.spec.ts` (20 failures,
  `ctx.store.topicSections is not a function`) — the
  `gh-issues-ui-labels` session's uncommitted #1531 store-v2 work;
  their session file declares that spec in scope. Zero failures in
  this task's change set (same foreign-residue disposition as the
  #1305 review).

## Accepted-by-design (noted, not findings)

- Menu clips at the scroll viewport on bottom rows — abs-positioned
  children extend scrollable overflow so it stays reachable; CDK
  overlay popover (option-chart idiom) is the heavier fix. UAT eyes.
- No Escape/arrow-key menu nav — identical to slice-menu; a
  convention-wide gap worth its own task.
- `hidden: true` exclusive defs would render as assign targets — no
  hidden exclusive def exists today; `filterOptionGroups`'s hidden
  filter serves a different surface (exclusion dropdowns).
- Chip renders the key (`PRIMARY`), menu items render the label
  (`Primary`) — AC-literal.
- Chip staleness after a pick is the documented store contract (no
  optimistic patch — watch-stream echo).

## Pass 2 — convergence check (post-remediation)

Re-verified every first-pass finding against the post-remediation
diff: the MAJOR is closed at the registry boundary (all three symbol
entry points normalize; a spec pins it), both MINORs are spec-pinned
(listMenuFor reset; loading copy), and the spec-coverage gaps are
filled. No new findings.

Post-review catch (fixed same day): the page template bound
`symbolLists.symbolListsLoading()` while `symbolLists` was injected
`private` — `protected` now. Jest's JIT template compile doesn't
enforce TS access modifiers, so the suite stayed green with the bug
in place; it only surfaced in AoT/IDE diagnostics.

## Verdict rationale

One real defect class existed at merge-read boundaries the task's new
consumer exposed for the first time; fixed at the boundary rather
than in each consumer. Everything else was hygiene, spec-pinning, or
accepted trade-offs consistent with sibling surfaces.
