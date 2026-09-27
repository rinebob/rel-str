**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #604  
**Task:** #605  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-26  
**Last Updated:** 2026-09-26  

# Code Review — #605 `st-swing-configs` service, types, rules

## Axes summary

- **Standards:** clean, pattern-conformant. No critical/major. Minor/nit items listed below.
- **Spec:** all five acceptance criteria met; TEST-doc service targets covered. Flagged PRD↔IMPL evolution (new `st-swing-configs` collection — IMPL supersedes PRD's in-place slimming) as a documentation note, not a code gap.
- **Thermo-nuclear:** one MAJOR (fixed below), several minor/nit.

## Findings & disposition

| # | Severity | Finding | Disposition |
|---|----------|---------|-------------|
| 1 | **Major** | `deriveParamsId` under-hashed `ZigZagConfig` — `showTriggerDots` collision silently overwrites a different config | **Fixed** — `trig{Y\|N}` segment added, `showTriggerDots ?? true` normalized; `lineColor` documented as intentionally excluded (visual-only dedupe). Literal-format + differentiation specs added. |
| 2 | Minor | Whitespace-only `name` persisted verbatim | **Fixed** — `input.name?.trim()` + spec coverage (`'   '` → absent, `'  Tight  '` → `'Tight'`). |
| 3 | Minor | `update` rule lets owner rewrite `userId` | **Fixed** (new collection only) — added `request.resource.data.userId == resource.data.userId`. Legacy `st-swing-sets` keeps its shape; tightening there is for the #416 retirement task. |
| 4 | Minor | `deleteConfig`/`saveConfig` lack empty-input guards | **Fixed** — `deleteConfig('')` → `of(void 0)` + spec. `saveConfig` guard deferred (callers pass built configs; deriveParamsId input is typed non-null). |
| 5 | Minor | `fsMock.where`/`query` never cleared in beforeEach | **Fixed** — both cleared per-test now. |
| 6 | Nit | Missing segment-count guards + `deleteConfig` error-propagation + unauth `loadConfigs` tests | **Fixed** — all added. |
| 7 | Nit | `id === paramsId` redundant fields on `SwingConfigDoc` | **Accepted** — kept for symmetry with `SwingAnalysisDoc`. |
| 8 | Nit | Spec file >400 lines | **Accepted** — mostly pre-existing; revisit if it keeps growing. |
| 9 | Note | `paramsId` doc-field vs doc-id integrity is client-side only | **Accepted** — documented in rules comment context; single-user app. |

## Test results

- `swing-analysis.service.spec.ts`: **46/46 pass** (16 new for the config library + deriveParamsId pinning).
- Full suite earlier in session: **1951/1951 green** (142 suites) — before review fixes; the re-run was blocked by an in-flight user edit to `jest.config.js` (moduleNameMapper entries mid-write at the time of review). Re-run full suite before ship.
- One flaky failure observed in `swing-analysis-page.component.spec.ts` ("navigating onto a failed symbol…", `prevSymbol` at ~line 1425) — in the user's in-progress symbol-nav work (`symbol-nav.feature.ts` `effect()` changes), unrelated to this task. Passes standalone; intermittent when run with sibling suites. **Owner: user's WIP — flag for attention.**

## Verdict

**PASS** — for task #605 scope. The flaky nav spec is unrelated WIP and must be re-verified before `/proj ship` (full suite must be green at ship time).
