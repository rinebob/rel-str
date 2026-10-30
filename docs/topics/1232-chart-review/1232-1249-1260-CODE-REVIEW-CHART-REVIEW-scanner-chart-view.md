**Topic:** Scanner Chart View  
**Topic Slug:** chart-review  
**Thread:** Chart View Extension  
**Thread Slug:** scanner-chart-view  
**Issue:** #1260  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1260  
**Domain:** CHART-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-06  
**Last Updated:** 2026-11-06  

# Code Review — #1260 Retire chart-review (redirect + dead-code removal)

Retires the former `/signals/charts` chart-review surface now that
`trading/chart-view` (#1256–#1259) is canonical. Three parallel review
axes (Standards / Spec / Thermo-nuclear) over the full deletion
changeset — routes, stores, specs, verify scripts, barrels, docs, and
generated artifacts. All actionable findings remediated in-tree.

## Verdict: **PASS**

| AC | Verdict | Evidence |
|---|---|---|
| `signals/charts` redirects to `trading/chart-view` | MET | `core-routes.ts` redirect + `pathMatch: 'full'`; route spec asserts the mapping. Multi-segment relative-redirect idiom matches the file's `'signals'`/`'options'` group roots; query params preserved by default |
| `AppRoutes.CHART_REVIEW` removed | MET | enum member + `PAGE_INFO` entry deleted; exhaustive `Record<AppRoutes, PageInfo>` and spec key-parity pin compile-enforced; `signal-review.facade` navigates to `CHART_VIEW` |
| Old page + review-header + new-symbols dialog deleted | MET | `pages/chart-review/` (3 files), `components/review-header/` (3), `components/new-symbols-dialog/` (3), `services/chart-review-viewport.service(.spec).ts`, `services/new-symbols-dialog.service.ts` all deleted |
| Per-item consumer verification (keep shared) | MET | Kept `RunMetricsStripComponent` (dashboard + signal-review), `SignalReviewFacade` (facade/group.store/staging.util), TriageStore `reviewFlags` core (reviewCount pill + group.store). Deleted only sole-consumer files |
| Nav renamed "Chart View" | MET | `constants.ts` has pointed at `trading/chart-view` since #1256 |

## Findings → remediations

| Finding | Severity | Disposition |
|---|---|---|
| `scripts/verify/design-system-widget-migration-1114.ts` eagerly `readFileSync`ed deleted `review-header` scss/html → ENOENT crash in `run-all.ts` (spec MEDIUM / thermo MAJOR) | major | **Fixed** — dropped `reviewHeader`/`reviewHeaderHtml` targets and all dependent check loops; guide + README updated (three consumers, 33/33). Sibling of the #1171 fix landed in the second pass |
| `TriageStore.reviewSymbols` computed + `markGroupForReview` — sole consumers deleted with the page (standards MINOR / thermo NIT) | minor | **Fixed** — removed dead surface + its spec block; `reviewFlags`/`reviewCount`/`markForReview`/`unmarkFromReview`/`clearReviewFlags`/`resetForRun` retained (live: header pill, group.store) |
| `goToReview` name drift — dead emit chain now targets chart-view (standards MINOR / thermo MINOR-2) | minor | **Fixed** — chain renamed `goToChartView` across facade, page, and header (emit/output/template). Button stays hard-disabled (#1016); flags have no chart-view viewport source — noted for any future re-enable |
| Stale comments/provenance: `signal-list` docstring + `newSymbols` input comment, `triage.store` header "Review page", `styles.scss` consumer list, `ds-gallery` `seenIn` ×6 | minor | **Fixed** — repointed to chart-view/live sites (`spread-builder-dialog`, `scanner-compare-panel`, `chart-toolbar`) |
| `ui-color-sites.json` ~17 stale generated entries | minor | **Fixed** — regenerated via `scripts/inventory-ui-colors.mjs`; residual hits are historical comments in live files |
| Redirect line style vs file's multi-line convention; stray blank lines in `chart-view-viewport.service.ts`; `run-all`-facing `.accept` variant check stale since #1017's `.order` rename | nit | **Fixed** — cosmetic + the stale check now asserts `.review`/`.order` |

## Deliberately retained

- `chart-view.component.ts` "ported from chart-review" comments — design-history
  breadcrumbs matching the repo's `#1016`/`#1017` convention.
- `core-routes.spec.ts` `'chart-review'` entry — negative assertion that the
  legacy path is unregistered.
- `vendor/savant-ds/styles/_widgets.scss` "graduated from … review-header"
  provenance — past-tense origin history.
- Disabled Review pill + flag emit chain (#1016 leftovers) — dead UI already;
  removing it is a signal-review-cleanup task, not this one.

## Verification

- `npx jest` — 281/281 suites, 4845/4845 tests (post-deletion baseline);
  focused rerun after remediation: 6 suites / 130 tests.
- `npx tsc --noEmit` — clean except the 3 pre-existing committed-HEAD errors
  (`scripts/bulk-swing-sweep.ts` ×2, `indicator-config-dialog.component.ts`),
  all in untouched files.
- `npx tsx scripts/verify/design-system-widget-migration-1114.ts` — **33/33**
  (was a hard ENOENT crash before the fix).
- `npx tsx scripts/verify/design-system-foundation-migration-1171.ts` —
  104/104 (fixed in the implementation pass).
- `ng build` — compiles; exits non-zero only on the pre-existing
  `ds-gallery.component.scss` 28.76 kB vs 25 kB style-budget error committed
  by #1217 — unrelated to this changeset.
- Zero surviving references to deleted symbols/paths outside the new redirect
  code (repo-wide sweep incl. `functions/`, `cypress/`, `scripts/`, `.devin/`).

## Pass 3 — delta re-review (no new findings)

Swept the remediation delta plus a repo-wide leftover-reference pass.
Corrected two imprecise `ds-gallery` `seenIn` strings added in the
remediation (`chart-toolbar back/history`/`tf` — those controls were
deliberately not ported; repointed to `chart-toolbar` /
`signal-review-header`). Focused jest (ds-gallery, triage.store): 20/20.

## Review loop verdict

Converged — second pass swept the whole repo (not just `src/`), found and
fixed the script-relay crash plus dead store surface; remaining concerns are
scope questions (disabled signal-review chrome, future flagged-viewport
source) best handled in dedicated tasks.
