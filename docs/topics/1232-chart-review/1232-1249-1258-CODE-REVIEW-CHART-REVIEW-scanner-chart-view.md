**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1249  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1258  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-28  
**Last Updated:** 2026-10-28  

# Code Review — #1258 FE-IMPL: LatestRunStore + scan dropdown + New-only toggle

**Verdict: PASS** — 3 rounds, 3 axes per round. Round 1 produced 4 majors (all converged on by ≥2 axes) plus minors; every major remediated and re-verified on a regenerated diff. Round 2: no majors; latent-edge + nits fixed or adjudicated. Round 3 (fresh eyes on the final diff): one converged MED (ghost-scan disabled menu) plus lows — all fixed or adjudicated below.

## Scope

Uncommitted working-tree diff, 13 files (`git diff` vs HEAD; new files via intent-to-add):

- NEW `src/app/features/savant-trader/stores/latest-run.store.ts` (+ spec) — root signalStore: `loadLatestRuns()` via the `ScannerService.listLatestRuns()` seam → `latestRuns` Map, `scanOptions` computed (catalog join + ranAt + truncation cap), `rowsFor(recipeId)`.
- NEW `src/app/features/savant-trader/testing/scan-fixtures.ts` — shared typed `scanRun`/`scanRow` factories (3 specs consume).
- MOD `services/scanner.service.ts` (+ spec) — `listLatestRuns()` read seam, `listProposals` pattern (authed → getDocs → per-doc parse/drift-skip).
- MOD `services/chart-view-viewport.service.ts` (+ spec) — `scan:{id}` rows → tickers; `newOnly` signal (default on) filters tracked rows; scan-only.
- MOD `components/chart-view-toolbar/*` — live Scan dropdown (`—` clear option; `scanMenuValue`/`listMenuValue` single-source derivation), `[x] New only` pill gated to scan sources.
- MOD `pages/chart-view/*` — `loadLatestRuns()` on init, `onSourceChange` for both dropdowns, `prevViewport`-tracked escape guard (neighbor-advance).

## Round 1 findings → remediation

| # | Axis | Finding | Resolution |
|---|------|---------|------------|
| M1 | Thermo+Spec+Standards | Both dropdowns render blank when the *other* source owns the slot (value matches no option) | Deleted `activeScan` input; `scanMenuValue`/`listMenuValue` derive from single `activeList` — every display value is option-backed |
| M2 | Thermo | `—` pick while a list source is active emitted ALL → silently reset the list | Guarded: `—` emits only while `scanActive`; no-op otherwise (spec'd) |
| M3 | Thermo+Spec | Escape guard changed documented detached-chart parity + stale comments; head-advance ≠ advanceReviewQueue semantics | `prevViewport` tracking → neighbor-advance at the dropped index (spec'd: `AAPL`@idx2 → `NEW3`); comments + header divergence note updated |
| M4 | Thermo | idx=-1 guard test no longer exercised the guard (effect ran first) | Reordered: emit `toggleList` before flush → synchronous guard path spec'd |
| a1 | Spec | TEST plan: truncated run label must communicate the cap | `scanOptions` appends `{rows}/{totalItems}` when `truncated` (spec'd `2/5`) |
| a2 | Spec | TEST plan: cold cache → empty/disabled dropdown | `[disabled]="scanOptions().length === 0"` (spec'd) |
| m | Standards+Thermo | `latestRunsLoading` dead state; `runs.get()!`; silent catch; fixture triplication; `'—'` magic literal; mock fidelity | All fixed: state removed, flatMap, `console.error`, shared `scan-fixtures.ts`, `SCAN_CLEAR` const, signal-backed mocks |

## Round 2 findings → resolution

- **Latent blank trigger (thermo #5, spec A):** active scan key + emptied cache → `scanMenuValue` unmatched → blank. Fixed: `scanMenuOptions` appends the raw active key when missing — label resolves, item stays selectable (spec'd `scan:ghost`).
- **Unparseable `ranAt` (standards):** `new Date()` → `format()` RangeError would brick `scanOptions()`. Fixed: `Number.isNaN` guard skips the option (spec'd).
- **Type widening (2 axes):** `scanOptions` now `RhSelectOption<SymbolListFilter>` (was `string`).
- **Naming (standards):** `load()` → `loadLatestRuns()`; `void` prefix at the page call site; fixture renamed `scan-fixtures.ts` per `swing-fixtures.ts` precedent.
- **Adjudicated — no change:**
  - IMPL's `{rel ranAt}` vs absolute PT stamp — TEST plan requires only `{ranAt}`; absolute PT matches the run-history panel's formatter (same `Intl` options). Recorded.
  - `newOnly` persists across source switches — intended session posture; comment already documents.
  - Neighbor-index policy `Math.min(idx, len-1)` appears in both `advanceQueue` and the escape guard — one line; cross-referenced in comments rather than extracted.
  - "list keys can't contain `:`" documented in constants.ts, not spec-asserted — trivial guard invariant.
  - Toolbar `newOnly` input default `true` mirrors the service default — defensive input default, harmless.

## Round 3 findings → resolution

- **Ghost-scan menu disabled (all 3 axes converged, MED):** with an active `scan:{id}` whose cache doc vanished, the ghost-option fallback kept the trigger readable but `[disabled]` gated on the raw input → the `—` clear was unreachable (escape only via the List menu). Fixed: `[disabled]="scanOptions().length === 0 && !scanActive()"`; spec pins enabled + `—` → ALL.
- **New-only against an unloaded tracked set (thermo, MED-LOW):** a scan picked before ngOnInit's tracked load landed filtered against `[]` → tracked rows flash into the pane, then vanish on snapshot → mid-session escape. Fixed: `setActiveSource(scan:*)` and `setNewOnly(true)` lazily call `loadTrackedSymbols()` — same seam as NO_MEMBERSHIP (spec'd).
- **Doc id ≠ recipeId (standards, LOW):** contract says the doc id IS the recipeId; a mismatched-but-parseable doc would be keyed under the wrong recipe and look uncached. Fixed: `d.id === run.recipeId` guard in `listLatestRuns` (spec'd).
- **Scan ticker dedupe (thermo, LOW):** a cache doc with repeated tickers rendered duplicate pane rows; the ALL path already dedupes. Fixed: `Set` in the scan branch (spec'd).
- **Cap-label inversion (thermo, LOW):** `truncated` with `rows.length ≥ totalItems` rendered "5/2". Fixed: marker only when `rows.length < totalItems`.
- **Stale comments (2 axes, trivial):** store header still said `load()`; page comment said the escape guard "clears" where neighbor-advance applies; `prevViewport` is last-*flushed*-run viewport noted. All corrected.
- **Escape-guard clear path untested (spec axis, LOW):** added — cache doc shrinks to empty → selection clears, auto-select stays out.
- **Adjudicated — no change:**
  - `ranAt` parseable-garbage (`'Oct 27'`, `'0'`) produces a plausible-but-wrong label — accepted: no crash, no worse than drift-skip posture; the write side owns ranAt's format.
  - Spec mock `scanOptions` independently settable vs the store's derived computed — accepted: mocks can construct states the real store can't; the risk is test-side only.
  - `prevViewport` last-run vs last-change under coalesced writes — bounded consequence (min-idx clamp lands in-bounds); comment updated.

## Drive-by disclosure

`Collection.ST_SYMBOLS` → `ST_SYMBOLS_ROOT` in `chart-view.component.ts` is inside this diff but older than the task's code (page-file carryover). Verified correct: `chart-review.component.ts:158` reads `ST_SYMBOLS_ROOT` in production — the #1159 cutover resolved the #1256 review's "merged docs unverified" deferral. Call out in the commit message.

## Test results

- Full suite on final tree: **270/270 suites, 4,678/4,678 tests**.
- `npx tsc --noEmit -p tsconfig.app.json` — clean.
- Spec conventions: `@Input/@Output` decorator mocks (signal-mock hoist pitfall documented in-file), typed fixtures via `testing/scan-fixtures.ts`, no type-erased fixtures, no setTimeout async.
- Contract pins: `collection('st-scanner/latest-runs/items')` literal; `doc(fs, ST_SYMBOLS_ROOT, 'AAPL')`; drift-skip in both service and store layers.

## Acceptance criteria — all met

1. ✅ Map-by-recipeId load, drift skipped (service parse-skip + store-level guards)
2. ✅ One option per catalog recipe with a doc; `{title} · {ranAt}` + `{rows}/{total}` cap
3. ✅ Single `activeSource` slot — scan↔list exclusivity by construction
4. ✅ New-only default ON filters tracked; OFF restores all rows in scan order
5. ✅ Toggle scan-only (viewport derivation + disabled pill on lists)
6. ✅ Neighbor-advance/clear on escape — advanceReviewQueue semantics via `prevViewport`
7. ✅ Store/viewport/toolbar/page specs per TEST-FE
