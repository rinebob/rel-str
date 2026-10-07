**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #851  
**Task:** #852  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-07  

# Code Review — PAGE_INFO registry + route wiring (#852)

Three-axis gate review (Standards / Spec / Thermo-nuclear) of the working-tree diff for task #852: `src/app/core/common/interfaces.ts`, `src/app/core/common/constants.ts`, `src/app/core/core-routes.ts`, `src/app/core/core-routes.spec.ts`.

## Axis summaries

### Standards — PASS

Clean and idiomatic: compile-time exhaustiveness via `Record<AppRoutes, PageInfo>` plus runtime spec; uniform registry-sourced titles; conventions match `nav-sections.spec.ts`. NAV_MENU_ITEMS / PAGE_INFO co-existence judged defensible — nav label and page title are independent axes that legitimately diverge (`'Runs'` vs `'Run Dashboard'`). Minors noted: `PageInfo` name collides with an unrelated GraphQL `PageInfo` in `functions/src/gh-lifecycle/github-client.ts:131` (no import conflict); icon names are unchecked strings (visual pass owns this per the test plan).

### Spec — PASS

Every task AC verified met: PageInfo in interfaces.ts; PAGE_INFO with all 40 enum members; dormant CHART/LOGOUT entries present; all 38 leaf routes titled from the registry; redirect/parent routes untouched. No scope leakage — header rendering (#853) and the markup sweep (#854) are absent as required.

### Thermo-nuclear — FAIL → fixed in-loop

Two majors were found and **fixed within this review iteration** (consistent with prior review precedent where fixes applied during review):

- **M1 — resolver logic shipped only as a test-local clone.** The prefix-walk inside spec 3 was an oracle duplicating a contract that lived nowhere in production. **Fixed:** extracted `resolvePageInfo(joinedPath)` into `constants.ts` — the spec now tests the real function and #853 consumes it. The function documents the `routeConfig.path`-vs-`url` join contract (param template `'heatmap-chart/:baseline/:symbol'` is a direct key).
- **M2 — the suite permitted the divergence the design denies.** Spec 2 passed an untitled leaf (`undefined !== undefined`); spec 3 let a *registered* leaf resolve by prefix. **Fixed:** spec 2 now requires a non-empty string title per leaf; the route-table spec requires every registered leaf to be a *direct* `PAGE_INFO` key; prefix inheritance is now tested as resolver behavior (`trading/live/detail` → Signal Order) rather than route-table tolerance.

Additional fixes: `p in PAGE_INFO` → `Object.hasOwn` in the resolver (prototype-key false-positive nit); comments corrected — the loaded icon font is **Material Icons** (`index.html`), not Material Symbols.

## Findings by severity

- **Critical:** none.
- **Major:** 2 — both fixed in-loop (M1, M2 above).
- **Minor:** PageInfo name overlap with GraphQL PageInfo (noted, not actionable); dormant CHART/LOGOUT entries are the price of exhaustiveness — comment documents it.
- **Nit:** `r.path as AppRoutes` cast in spec reads as if membership is guaranteed; icon-name validity deferred to the sweep-pass visual check by design.

## Test results

- `npx jest core-routes`: **70/70 pass** (4 registry/resolver specs including the new `resolvePageInfo` suite).
- Full suite `npx jest`: **2932 pass / 1 fail** — the failure is `shared/screenshot-capture-contracts.spec.ts` ("PositionType is limited to stock"), stale against concurrent #844 work (user extended the enum with `VERTICAL_DEBIT_SPREAD`/`CALENDAR`/`OPTION_SINGLE` without updating the spec). **Unrelated to this task** — flagged, not fixed here.

## Verdict: **PASS**

Both majors remediated during review and re-verified green. Remaining items are documented minors/nits.

---

## Round 2 — post-fix re-review (2026-10-06)

Both axes re-ran on the post-fix diff. **Standards: PASS** — `resolvePageInfo` correct (loop terminates, `Object.hasOwn` sound, co-location with PAGE_INFO is the tightest cohesion). **Thermo-nuclear: PASS** — M1/M2 closure verified; resolver trace against the real `pathFromRoot` join semantics confirmed param-template keys and wildcard/redirect edges all behave.

One shared LOW flag was fixed in this round: a naive `pathFromRoot.map(r => r.routeConfig?.path).join('/')` includes the root `''` segment → `'/signals/review'` → previously resolved `undefined` on every page. `resolvePageInfo` now normalizes empty segments internally (constants.ts), with spec cases covering `/signals/review` and `/trading/live/detail`. Callers pass the raw join.

Remaining INFO/nits (non-blocking, dispositioned): icon ligature validity → visual sweep pass; `PageInfo` name overlap → noted; resolver has no production caller until #853 (accepted — #853 is the adjacent task).

`npx jest core-routes` after round 2: **70/70 pass**.
