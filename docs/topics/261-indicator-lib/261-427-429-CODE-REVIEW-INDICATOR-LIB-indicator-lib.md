**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Issue:** #427  
**Task:** #429  
**Task Slug:** batch-ui  
**Topic Parent:** #261  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Resolved  
**Created:** 2026-09-21  
**Last Updated:** 2026-09-21

# CODE REVIEW — FE: Batch UI (Task #429)

## Summary

| Axis | Result |
|------|--------|
| Standards | 1 major found → **fixed** (component extraction); minors/nits resolved |
| Spec | **PASS** — every #429 acceptance criterion met; TEST-doc component targets covered |
| Thermo-nuclear | 1 major (comments/rules honesty) + 2 minors → **all fixed** |
| Tests | `swing-analysis*` suites: **238/238 green** (7 suites, incl. sibling nav spec) |

> Scope note: this diff also carried the `swing-sets` → `st-swing-sets`
> rename (service/rules/specs/docs), the userId-constrained list queries
> (required by the deployed rules), and the AGENTS.md collection-prefix
> convention. The store also contains another session's in-flight
> symbol-nav work — reviewed only at the seams where it touched this
> task's spec providers.

## Majors — all resolved before verdict

| # | Finding (axis) | Resolution |
|---|----------------|------------|
| 1 | Page component hit ~700 lines vs ~400 guideline; batch block fully self-contained (Standards + Thermo, independent) | Extracted `BatchSweepComponent` (`components/batch-sweep.component.ts`, ~160 lines) — owns textarea signal, wires store signals; page back to ~585 lines |
| 2 | `st-swing-sets` rules used `resource == null` fallback — vacuous for list queries; comments claimed the where-clause satisfied the rules when it was really the only boundary (Thermo + Standards) | Dropped the fallback: `allow read` now requires `resource.data.userId == auth.uid` — provable because the service queries constrain `where('userId','==',uid)`. Rules + service comments rewritten to describe the actual mechanism. **Rules redeploy needed.** |

## Minors / nits addressed

- `cancelBatch` left a stale `current` symbol in the progress line → now clears `current`, keeps done/total as post-mortem; comment documents the non-cancellable in-flight save caveat (Thermo #2/#3)
- Template called `store.cancelBatch()` directly → `onCancelBatch()` wrapper (Standards nit)
- `canRunBatch` accepted separators-only text (`,,,` → silent no-op) → now previews via `parseSymbols` (both axes nit); test extended
- `PageSetup.fixture: any` → `ComponentFixture<SwingAnalysisPageComponent>` (both axes)
- Two tests duplicated setupPage's TestBed body → converted to the `chart` param (Standards nit)
- Unused `forkJoin` import in `swing-batch.ts` (Spec nit)
- IMPL doc stale "no explicit Cancel button in v1" → updated (Cancel exists per #428 review fix)
- **Collateral:** the sibling symbol-nav work added `RelStrDbV2Service`/`SymbolListStore` as unconditional store injects, breaking DI in 6 spec TestBed setups — providers added to `setupPage`, `setupBatch`, and 4 inline blocks

## Spec coverage — task #429 acceptance criteria

| Criterion | Verdict |
|-----------|---------|
| Symbols textarea (comma/space/newline), `batch-symbols` | ✅ renders in collapsible section; parses via shared `parseSymbols` |
| Run button disabled while running or input empty | ✅ `canRunBatch` — incl. whitespace/separator-only cases, tested |
| Progress line `{done}/{total} — {current}` | ✅ `aria-live`, tested against pending stream |
| Per-symbol ✓/✗ results + error, `batch-results` | ✅ real-store end-to-end test (AAPL ok / EMPTY fail) |
| Cancel while running | ✅ beyond spec — added per #428 review's `cancelBatch` |

**Test-path quality:** tests drive the real store with only ChartService/SwingAnalysisService mocked — textarea → runBatch → buildBatchSweep → patchState → DOM is genuinely exercised, including the cancel path against a never-emitting Subject. No sleeps, no type-erased fixtures.

## Files

- `components/batch-sweep.component.ts` (new — extracted panel)
- `swing-analysis-page.component.ts` / `.spec.ts`
- `swing-analysis.service.ts` / `.spec.ts` (userId-scoped list queries)
- `swing-analysis.store.ts` (cancelBatch fix + comment), `swing-batch.ts` (dead import), `swing-analysis.types.ts` (comment)
- `swing-analysis.store.spec.ts` (nav-provider DI fixes)
- `firestore.rules` (rename + tightened list rule — **needs deploy**)
- `AGENTS.md` (collection-prefix convention)
- IMPL/TEST/PRD docs (rename + cancel semantics)

## Verdict

**PASS** — all acceptance criteria met, majors resolved, tests green at the task seam. Post-ship actions: `firebase deploy --only firestore:rules` for the tightened rule; confirm no legacy `swing-sets` docs remain in prod (old collection is now unreadable by clients).
