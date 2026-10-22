**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — Auto-Run Scans  
**Thread Slug:** scanner-auto-run  
**Issue:** #1195  
**Thread Parent:** #1183  
**Topic Parent:** #1098  
**Task:** #1197  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-22  

# Code Review — #1197 Recipe table + multi-sort util

**Verdict: PASS** — three remediation rounds. Round 1: three MEDIUMs +
convergent LOWs remediated. Round 2: 'Symbol' wire-key duplicate column +
leftover-copy HIGH remediated. Round 3: convergent norm-policy extraction +
case-symmetry + two branch gaps remediated; axes then produced only
judgement calls and doc-drift notes. Final: 148/148 focused specs +
zero tsc diagnostics.

Files under review (uncommitted worktree, scoped diff):

- `src/app/features/savant-trader/utils/scanner-sort.util.ts` + spec (new — `SortLevel`, `nextSortLevels`, `sortRows` chained numeric-aware comparator, `sortInfo` badges)
- `src/app/features/savant-trader/pages/scanner/scanner-recipe-table.component.{ts,html,scss,spec.ts}` (new — dumb per-recipe table: `recipe`/`run`/`tracked` inputs, `refresh` output, header metadata, all-wire-fields columns, click-cycle sort)
- `src/app/features/savant-trader/utils/scanner-rows.util.ts` + spec (`ScanRow.instrumentId`, `mergeLookup` extracted from store, `dedupeScanRows` + `displayCell` shared helpers)
- `src/app/features/savant-trader/stores/scanner.store.ts` (`RecipeRunState`, local mergeLookup removed)
- `scanner-compare.util.spec.ts`, `scanner-recipes.spec.ts`, `scanner.component.spec.ts` (factories updated for required `instrumentId`)

## Standards

No hard violations — zoneless spec setup, `jest.fn()` idiom, no fake-timer
flush misuse, contract baseline verified against the wire contracts.

Remediated:
- **Duplicated Code ×3 → shared helpers** — cell formatting
  (`cellValue` ≈ `ScannerComponent.columnValue`), normalized-ticker
  dedupe (3rd copy after compare engine + page), and tracked-set
  normalization extracted to `scanner-rows.util` as `displayCell` +
  `dedupeScanRows`; the old page's copies disappear with the #1199
  rewrite.
- **Badge SCSS copy** — `.badge`/`.badge.tracked` → canonical
  `@include vl.badge` + local `.tracked` variant (no canonical
  membership variant exists, cf. `.bucket-dead` precedent).
- `RecipeRunState` doc tightened (entry shape of the #1198 runs map);
  store tombstone comment deleted; unused `By` import dropped;
  `td.mono` → `ui-monospace, monospace` (sibling convention).

Accepted: `errorKind: 'auth'|'other'|null` is a second, coarser error
taxonomy next to `ScannerError.category` — deliberate per IMPL §2 (the
dumb input needs a boolean-shaped flag, not the category enum).

## Spec

Remediated:
- **`sorted_by` chip** — was a bare italic span; now carries the chip
  pill styling the checklist names.
- **Loading deviation pinned** — IMPL §3's "loading → spinner, no table"
  is kept for initial load; refresh-in-flight keeps the prior table
  (disclosed deviation) — now spec'd so it can't silently regress.
- **`columnValue` "reuse"** — resolved by extracting `displayCell` to
  the shared util (the old method was a protected member of the page
  slated for rewrite, not a reusable util).

Accepted / noted:
- Undeclared wire keys render as trailing columns — beyond the literal
  checklist ("all declared columns") but the PRD's "all fields returned
  in the response" intent and spec'd; kept.
- `Number()` over IMPL-sketch `parseFloat` — stricter (no partial-parse
  of `12abc`), equivalent on real wire data.
- `order`-vs-index mixing in the column comparator is latent — no recipe
  sets `order`/`visible` today.

## Thermo-Nuclear

Remediated (all three MEDIUMs):
- **`visible:false` leak** — extras suppression now builds from ALL
  declared columns, not just visible ones: a hidden column's wire key
  (hidden-columns-still-compute contract) can no longer re-render as a
  trailing extra. Spec'd with a synthetic recipe.
- **`idle` renders a bare header gap** — later recipes sit idle for
  seconds under the stagger; now renders the queued/loading block.
  Spec'd.
- **`recipe().sort` dead config** — `sortLevels` seeds from the recipe's
  declared sort via `linkedSignal`, so each table's initial order honors
  the catalog's "best first" contract; clicking still click-cycles.
  Spec'd (seed order + `1↓` badge + chain interaction).

Remediated LOWs:
- `N of M` count uses deduped `rows().length` (raw wire count could
  desync on a dropped/duplicated ticker). Spec'd.
- Tracked badge column made sortable (`tracked` key → 1/0) — the
  new-vs-tracked grouping is the overview's most useful sort. Spec'd.
- `mergeLookup` gained 3 direct pin specs (echo wins when real, bad echo
  → static map, unmapped passthrough) — was indirectly covered only.

Accepted / not fixed: 'Symbol' label over wire `ticker` (existing page
convention); `instrument_id` sortable (harmless click target).

## Verified

- **148/148** specs across the 8 scanner suites (14 new component specs,
  3 mergeLookup pins, tie-stability pin, visible-sort-column pin)
- `tsc --noEmit` clean on the app project; `git diff --check` clean on
  the change's fileset (one unrelated blank-line-at-EOF in
  `common/constants.ts` belongs to a concurrent session)
- Contract matrix: `RecipeRunState` fields ↔ component usage, sort key
  space (fixed + column names) ↔ header click keys — coherent

## Round 2

All three axes re-verified the R1 remediations hold. New findings, all
remediated:

| Finding | Fix |
|---|---|
| **'Symbol' wire key duplicates the fixed column** (missed in R1 — wire rows always carry `Symbol`/`Name`/`Last`/… in `columns`, so 'Symbol' rendered twice: fixed `td.symbol` + trailing extra; spec mocks under-specified the wire shape) | `FIXED_KEYS` case-insensitive collision filter in extras — kills the dup AND the fixed-key/column-key namespace collision in `cellFor` (convergent MEDIUM) |
| **HIGH — leftover bespoke copies** (`scanner.component.ts` still inlined the dedupe block and `columnValue` verbatim after the helpers were extracted) | Old page now delegates: `dedupeScanRows(this.store.rows())`, `displayCell(...)` — one policy, one implementation |
| **MED — invisible seeded sort possible** (catalog pin required `sort.column` declared but not visible — a hidden seed would apply an unremovable badge-less sort) | `scanner-recipes.spec` pin extended to `visible !== false` |
| **LOW — stale-result + 0-row gap** (`idle/loading && result` with 0 deduped rows fell through every template branch → bare header) | Empty state shows on `run().result` presence, status-agnostic |
| `headLabel` spec regex could false-strip a digit-ending label | Subtracts the `.sort-indicator` child's text instead |
| `sortLevels` public vs protected siblings | `protected` |
| `.badge.tracked` rgba literal drift vs `dir-long` convention; `.sorted-by` hand-rolled chip | `color-mix(var(--ds-up) 15%)`; `vl.badge` + `.tf` variant |
| `!!seen.add(key)` cryptic idiom; `SortLevel.key` doc missing `'tracked'`; `mergeLookup` argument literal | has/add two-liner; doc union extended; `mergeLookup(this.recipe(), …)` direct |
| TEST-plan "stable for equal keys" pinned only indirectly | Full-tie stability spec added to the util suite |

**Accepted / not fixed:** `Number()` vs `parseFloat` (stricter, noted);
`errorKind` carried unused (documented for #1198); `sorted_by` chip
shows the wire sort after client re-sort (spec-required, cosmetic);
`linkedSignal` re-seed on recipe-identity change (catalog recipes are
consts; a re-emitting parent would reset user sort — documented).

## Round 3

All three axes re-attacked the post-R2 diff; R1+R2 remediations verified
holding. Findings, all remediated:

| Finding | Fix |
|---|---|
| **MED (convergent, all 3 axes) — norm policy duplicated 5×** (`trim().toUpperCase()` in dedupe, compare `norm`, tracked membership, focus-symbol, matchedCount — comments asserting a shared contract, drift would silently desync) | `normScanSymbol` exported from `scanner-rows.util`; all 5 sites delegate |
| `cellFor` fixed-key dispatch exact-case while extras suppression is case-insensitive — a declared `'SYMBOL'`/`'Tracked'` column would sort the wrong namespace | `switch (key.toLowerCase())` in `cellFor` |
| `success` + `result:null` (interface permits; spec factory defaults to it) → bare header, no template branch | Empty state on `run().result \|\| status==='success'`; spec pinned |
| `td.num`/`th.num` applied unconditionally — text extras ('Name', 'Asset type') right-aligned | `numericCols` computed (all non-blank raw values parse numeric) drives `[class.num]` per column; spec pinned |
| `sortRows` both-blank branch: `String(undefined)` → `'undefined'` vs `''` reorders two blank cells arbitrarily | `String(av ?? '')` both sides |
| `.table-empty` included `vl.state-block` then gutted its 48px padding — fought the mixin | Plain quiet-density styles matching `.table-loading` |
| Doc drift (spec axis): IMPL said literal `signal([])`/raw `{results.length}`/`parseFloat`; TEST E2E said first click → `1↑` | IMPL §2/§3 + TEST E2E re-synced to the seeded/deduped/`Number()` implementation |

**Accepted / not fixed:** `order ?? index` ordering path (contract field,
harmless); `.clickable`/`.sort-indicator` scss copied from option-chart
(emulated encapsulation requires per-component styles — the copy *is*
the idiom); old-page hand-rolled badge (`#1199` rewrites it); old-page
manual sort diverging from `sortRows` (same scope); `RecipeRunState`
living in the store unused by it (documented for #1198).
