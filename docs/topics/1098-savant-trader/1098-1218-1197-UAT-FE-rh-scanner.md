**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** Auto-Run Scans  
**Thread Slug:** scanner-auto-run  
**Issue:** #1195  
**Thread Parent:** #1183  
**Topic Parent:** #1098  
**Task:** #1197  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #1197 Recipe table + sort utility

QA issue: #1218. Review doc:
`1098-1195-1197-CODE-REVIEW-FE-rh-scanner.md` (PASS, 3 rounds — R1: 3
MEDIUMs + convergent LOWs; R2: 'Symbol' wire-key dup column + leftover
helper copies; R3: `normScanSymbol` extraction + case-symmetry +
branch gaps; axes converged on judgement calls only).

## Scenario results

### 1. Focused suites green — PASS

`npx jest scanner-sort.util.spec scanner-recipe-table.component.spec
scanner-rows.util.spec scanner-compare.util.spec scanner-recipes.spec
scanner.store.spec scanner.component.spec scanner-compare-panel.component.spec
--coverage=false` (fresh run, post-R3-remediation): **8/8 suites,
148/148 tests** — 11 sort-util specs (click-cycle, mid-chain removal,
priority badges, numeric/`%`/`$`/comma parsing, blank-NaN-last both
directions, secondary tiebreak, localeCompare fallback, full-tie
stability) + 14 component specs (header metadata, refresh emit,
loading/queued/stale-refresh states, error omission, all-field
columns incl. extras + 'Symbol' suppression + hidden-column
suppression, canonical ROE rename, percent/blank/drift formatting,
empty + success-null states, dedupe + deduped count, recipe-sort
seed, tracked sort, click-cycle chain, numbered badges, num-class
alignment) + mergeLookup pins + visible-sort-column catalog pin.
Zoneless NG0914 warnings are the repo-wide known non-failure.

### 2. `tsc --noEmit` — PASS

Zero diagnostics on the app project (`tsconfig.app.json`).

### 3. Semantics vs. issue checklist + IMPL §2/§3 + TEST plan — PASS

| Checklist | Evidence |
|---|---|
| `SortLevel`, `nextSortLevels` (add→asc→desc→remove), `sortRows` chained numeric-aware comparator, blank/NaN last both directions, stable ties | `scanner-sort.util.ts` — 11 specs pin every clause; `numericCell` strips `%`/`$`/commas then `Number()` (strict); both-blank falls to `localeCompare` on `?? ''` |
| Inputs `recipe`/`run`/`tracked`, output `refresh` | `scanner-recipe-table.component.ts` — `input.required` ×2 + `input` set; `refresh` emits on the header button (spec'd) |
| Header: title + blurb + `N of M` + `sorted_by` chip + ran-at + refresh icon-button | Header spec'd (`1 of 350`, 'Last desc' chip, time-formatted ran-at); count is the deduped rendered count (IMPL re-synced) |
| Columns = tracked badge, ticker, instrument_id, instrument_type, all visible declared columns in order | Fixed columns + declared (visible-only, `order`-honoring) + undeclared wire keys trailing — beyond the checklist's literal wording, faithful to PRD "every returned field"; spec'd incl. canonical-target and FIXED_KEYS (case-insensitive) suppression so 'Symbol'/'Return on equity' never double-render |
| percentColumns→`%`, blank→'—', non-string→`String()` | Shared `displayCell`; spec'd ('5.0%', '—', '42') |
| First-wins normalized-ticker dedupe (NG0955) | Shared `dedupeScanRows` on `normScanSymbol`; spec'd ('aapl '/'AAPL' → 1 row, '1 of 2' header) |
| Numbered `1↑`/`2↓` priority badges on sorted headers | `sortInfo` → `.sort-indicator`; spec'd (`['2↑','1↓','3↑']` in DOM order incl. the seed level) |
| Loading block while `status==='loading'`; nothing on `'error'` | Queued/spinner block for `idle`/`loading` w/o result; stale result retained during refresh (spec-pinned deviation — no 9-table layout collapse); `error` → no section at all; `success`+null → empty state (R3) |
| Component spec + sort util spec per TEST plan | All TEST-plan items covered; TEST doc E2E note updated for the recipe-sort seed |

IMPL §2/§3 re-synced during R3 (linkedSignal seed, deduped count,
`Number()`, extras columns, tracked sortable, per-column `num`).

### 4. Diff footprint — PASS

`git status` scoped to #1197:

- NEW: `pages/scanner/scanner-recipe-table.component.{ts,html,scss,spec.ts}`,
  `utils/scanner-sort.util.{ts,spec.ts}`
- MOD: `utils/scanner-rows.util.{ts,spec.ts}` (`instrumentId`,
  `mergeLookup`/`dedupeScanRows`/`displayCell`/`normScanSymbol`),
  `utils/scanner-compare.util.{ts,spec.ts}` (shared norm),
  `stores/scanner.store.ts` (`RecipeRunState`, shared helpers),
  `pages/scanner/scanner.component.{ts,spec.ts}` (shared helpers),
  `scanner/scanner-recipes.spec.ts` (visible-sort-column pin)
- DOC: PRD/IMPL/TEST/CODE-REVIEW for the thread

All files are scanner-scoped or the thread's docs. No unrelated
worktree files touched (the concurrent #1017/session edits visible in
`git status` belong to other work and are excluded).

### 5. Manual verification — N/A for this task

The component is not yet mounted on a page (that's #1199 — the
ScannerComponent rewrite). All verification here is spec-level; the
E2E journeys in the TEST doc run at #1199 UAT. A standalone harness
was considered and rejected — mounting the component outside the app
adds a throwaway route for no additional signal over the 14 component
specs.

## Verdict: **PASS**

#1197 delivers the reusable per-recipe table + pure sort layer the
auto-run overview builds on. QA issue #1218 → RESOLVED.
