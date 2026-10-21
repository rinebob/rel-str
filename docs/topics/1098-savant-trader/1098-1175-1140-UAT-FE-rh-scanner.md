**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — RH Scanner Page  
**Thread Slug:** rh-scanner  
**Issue:** #1133  
**Thread Parent:** #1099  
**Topic Parent:** #1098  
**Task:** #1140  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-21  
**Last Updated:** 2026-10-21  

# UAT — #1140 Scanner page (route, picker, results table)

QA issue: #1175. Review doc:
`1098-1133-1140-CODE-REVIEW-FE-rh-scanner.md` (PASS, 2 rounds —
3 MEDIUMs + 6 LOWs remediated in R1; R2 re-attack found 6 LOWs, all
fixed or documented; no HIGH/MEDIUM in R2).

## Scenario results

### 1. Focused suites green — PASS

`npx jest pages/scanner scanner.store scanner-compare scanner/ nav-sections core-routes --coverage=false`
(fresh run, post-R2-remediation): **6/6 suites, 219/219 tests** —
component (16: picker/blurb, delegation, busy-disable, progress,
dynamic columns, percent rescale, sort, tracked/new badges, status
labels, truncation warning, empty-vs-error, reauth card + flow,
lookup merge, norm-dedupe, non-string cell), store (incl. runKind
pins, echo-merge, title-echo clobber, loadProposals merge-survival,
matchedCount persistence, supersession), compare engine, recipes
catalog (percentColumns ⊆ columns, sort.column ⊆ columns), nav +
routes (single nav entry, lazy load, authGuard `it.each` pin).
Zoneless-change-detection warnings are the repo-wide known
non-failure.

### 2. `tsc --noEmit` — PASS

Zero diagnostics matching `scanner|core-routes|interfaces|constants`
on the full root typecheck.

### 3. Semantics vs. issue checklist + IMPL — PASS

| Checklist | Evidence |
|---|---|
| `AppRoutes.SCANNER = 'trading/scanner'`; lazy route; `authGuard`; `PAGE_INFO` title `Scanner`; Trading nav | `interfaces.ts:41`, `core-routes.ts:228-233` (`loadComponent` + `canActivate`), `constants.ts:144` (`title:'Scanner', icon:'radar'`), nav appended `…Analysis · Scanner` (`constants.ts:33`); pins in `nav-sections.spec` + `core-routes.spec` |
| Page — `pages/scanner/scanner.component`: recipe picker + blurb, Run, status line, results table w/ tracked badge + recipe columns | Real `SCANNER_RECIPES` select + blurb; `Run`/`Evaluate tracked` (gated on `canEvaluateTracked`, busy-disabled); `statusLine` `N shown of M matched` / `N rows · M matched` per `runKind`; dynamic recipe columns + badge + `percentColumns` rescale + client-side `recipe.sort` |
| Store additions — matchedCount, runKind, columnLookup | `matchedCount` = wire `totalItems` (scan) / unique matched symbols (eval); `runKind` patched atomically with each compare; `columnLookup` = presence-verified `[echo, static, raw]` merge over returned rows, shared by display AND `noDataPred` |
| Error states: AUTH → reauth prompt; other → inline | `requiresReauth` → `vpn_key` banner + working Re-authorize button (`RobinhoodMcpObservationService.reauthenticate()`, signal-order flow); other errors → dismissible `vl.error-banner` |
| Component spec: loading / rows / capped / error states | 16 component specs covering every mandated state + remediated edges (norm-dedupe, non-string cell, eval label, echo clobber) |

IMPL §2/§3 + TEST doc re-synced during review (lookup signatures,
`noDataPred` lookup arg, as-built AUTH button, nav order, eval
progress wording, status-label semantics, #1140/#1141 split).

### 4. Diff footprint — PASS

`git status`: 12 modified + 1 new dir, all scanner/route-scoped —

- NEW: `pages/scanner/scanner.component.{ts,html,scss,spec.ts}`
- MOD: `core/common/{interfaces,constants}.ts`, `core-routes.ts`,
  `nav-sections.spec.ts`, `core-routes.spec.ts` (route/nav/metadata)
- MOD: `scanner/scanner-recipes.{ts,spec.ts}` (`percentColumns`,
  widened `noDataPred`), `stores/scanner.store.{ts,spec.ts}`
  (`matchedCount`/`runKind`/`columnLookup` state + R2 fixes),
  `utils/scanner-compare.util.{ts,spec.ts}` (additive `columnLookup`
  arg — #1138 file, scope-flagged), `utils/scanner-rows.util.ts`
  (readonly widening)
- MOD: FE IMPL + TEST docs (as-built re-sync); NEW CODE-REVIEW doc

`constants.ts` also carries the unrelated `ST_ORDER_INTENTS` removal
(another session's #1014 work — flagged; stays unstaged at ship).
No user files touched.

## Notes carried forward

- Compare panel + proposal history UI are #1141 — the store exposes
  `buckets`/`dropDetail`/`unevaluated`/`proposals` already; `runKind`
  is available for panel labeling.
- `CurationProposal` still lacks `unevaluated` (carried from #1139)
  — contract change is #1131 scope if needed.
- Superseded eval still fires its two-eval batch (no abort mechanism
  anywhere — wasted /batch calls only).
- `SymbolListStore.loadTrackedSymbols` has no timeout — pre-existing
  #553 store, out of scope.

## Gate resolution

All four scenarios green → **QA gate: PASS**. #1140 is ship-eligible.
