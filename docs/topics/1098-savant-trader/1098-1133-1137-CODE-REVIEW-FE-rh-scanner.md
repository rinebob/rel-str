# Code Review — #1137 scanner recipe catalog

**Topic:** RH Scanner  
**Topic Slug:** rh-scanner  
**Thread:** RH Scanner Page  
**Thread Slug:** rh-scanner-page  
**Issue:** #1137  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Blueprint:** #1133  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

## Scope

`src/app/features/savant-trader/scanner/scanner-recipes.ts` — 12 field-
guide-verified `preview_scan` recipes (`ScannerRecipe extends ScanRecipe`
+ `supportsPrune`/`noDataPred`/`columnLookup` FE metadata) and
`scanner-recipes.spec.ts` (12 catalog-invariant specs). Three axes:
standards, spec, thermo-nuclear.

## Axes results

| Axis | Verdict | Findings |
|---|---|---|
| Standards | PASS | 4 minor (split import, duplicated enum literal, missing export JSDoc, vacuous spec) + nits |
| Spec | PASS | 2 LOW (unverified enum-filter defaults, vacuous wire-boundary test) |
| Thermo-nuclear | PASS | 1 HIGH verification gap (F1), 2 MEDIUM, 3 LOW |

## Remediation applied during review

- **F1 (HIGH → resolved live):** header claimed `buildColumnLookup`
  covered non-quality columns — false: it joins column↔filter
  expressions by equality, and no recipe pair ever matches. Ran a live
  `preview_scan` probe (10-ticker `symbol ANY_OF` scope, all 7
  suspicious expression columns): every non-standard column returned
  keyed by its requested `display_name` — **no canonicalization**.
  `QUALITY_LOOKUP` (ROE/NPM) is the complete static rename set. Header
  corrected with the probe date/result.
- **F2 (MEDIUM):** backend pre-cuts `Last desc` to ~200 rows; >200-match
  recipes are re-sorts of a price-weighted subset. Header documents it;
  gainers/losers blurbs now say "within the 200-row page".
- **F3 (MEDIUM):** `PERCENT_CHANGE_FROM_CLOSE` thresholds are
  fraction-scaled on the wire (`'2'` = +200%); `pctChangeFilter`
  documents `'0'` as deliberately scale-safe and `% Change` as
  fraction-scaled for the display layer.
- **F4:** `FORBIDDEN_PERCENT_ENUMS` extended —
  `HISTORICAL_VOLATILITY`, `GAP` + exemption comment for
  `PERCENT_CHANGE_FROM_CLOSE`.
- **Spec L1:** gainers/losers enum filters now mirror the verified
  dep-prev-scan-07 form — explicit `interval:'1d'` + `plot:'Close'`.
- **M4/F6/spec L2:** vacuous wire-boundary test replaced with a real
  key-whitelist assertion over every filter/column object; NPM
  threshold `'0.10'` pinned alongside ROE/IVR.
- **Standards minors:** merged split import, hoisted
  `pctChangeFilter` (collapses the duplicated enum literal), JSDoc on
  `SCANNER_RECIPES`/`scannerRecipeById`, reused the `2e9` filter across
  quality-mid and IVR recipes, ASCII apostrophe.
- **F5:** documented — `noDataSymbols` will be ≈empty for quality
  recipes by construction (a blank-fundamentals symbol fails the
  filters and lands in `deadSymbols`); `noDataPred` guards canonical-
  ization drift, which is its purpose.

## Accepted / deferred

- N4 (carried from #1136 review): verified clean — no recipe's identity
  is an index scope and no filter expression is `symbol`, so
  `evaluateUniverseSpec`'s scope-strip is inert and the injected
  `ANY_OF` scope never collides.
- **Relay note for #1141:** the planned `rh-scanner-recipes-1098.ts`
  relay should assert each requested column resolves to a non-blank
  key — `success` + row shape alone would pass a canonicalized-but-
  renamed column with blank cells. (This review's live probe already
  covers the seven non-standard columns; quality's two renames are
  score-symbols-verified.)
- `scannerRecipeById` has no production caller yet — it's the #1139
  store seam, kept deliberately.

## Re-verification

`npx jest scanner-recipes.spec.ts --coverage=false` → 12/12.
`tsc --noEmit` → zero diagnostics on both files.

## Verdict: PASS

F1 verified clean against the live backend rather than shipped on
assumption; all remaining findings remediated or documented above.
