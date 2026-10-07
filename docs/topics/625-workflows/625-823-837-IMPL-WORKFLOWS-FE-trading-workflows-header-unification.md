**Topic:** #625 — Navigation and Workflows  
**Topic Slug:** trading-workflows  
**Thread:** #823 — App-wide Header Unification  
**Thread Slug:** header-unification  
**Issue:** #837  
**Thread Parent:** #823  
**Topic Parent:** #625  
**Domain:** WORKFLOWS  
**Type:** Implementation Plan  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-07  

# Implementation Plan — App-wide Header Unification (FE)

Links the approved PRD: `625-823-824-PRD-WORKFLOWS-trading-workflows-header-unification.md`.
Companion test plan: `625-823-837-TEST-WORKFLOWS-FE-trading-workflows-header-unification.md`.

## Files to add or modify

| File | Action | Purpose |
|---|---|---|
| `src/app/core/common/interfaces.ts` | Modify | Add `PageInfo` interface (`{ title: string; icon: string }`). |
| `src/app/core/common/constants.ts` | Modify | Add `PAGE_INFO: Record<AppRoutes, PageInfo>` — one entry per `AppRoutes` member (title + Material Icons ligature name — the legacy font index.html loads). Dormant entries for redirect-only members (`CHART`, `LOGOUT`). Plus `resolvePageInfo(joinedPath)` — the longest-prefix resolver the header consumes. |
| `src/app/core/core-routes.ts` | Modify | Every leaf route gains `title: PAGE_INFO[AppRoutes.X].title` so `Route.title`/`TitleStrategy` serve the document tab title from the same registry. |
| `src/app/core/comps/header/header.component.ts` | Modify | Add a `pageInfo` signal: `toSignal(router.events)` filtered to `NavigationEnd`; on emission walk `router.routerState.snapshot.root` firstChild chain to the leaf, join `routeConfig.path` segments across `pathFromRoot`, and longest-prefix-match against `PAGE_INFO`. |
| `src/app/core/comps/header/header.component.html` | Modify | Render `mat-icon` + title after `.header-text` when `pageInfo()` is set; nothing rendered otherwise. |
| `src/app/core/comps/header/header.component.scss` | Modify | Page-identity typography/icon sizing; hide the `.header-text` wordmark under a small-viewport breakpoint so icon+title survive. |
| `src/app/core/comps/header/header.component.spec.ts` | Modify | New specs for identity resolution across navigation, param routes, redirects, and unkeyed paths (see test plan). |
| `src/app/core/core-routes.spec.ts` | Modify | Specs pinning the registry↔route-table invariants (see test plan). |
| ~20 page templates under `src/app/features/**` | Modify | Delete pure title-restatement markup only (narrow sweep — control-bearing headers untouched). |
| `docs/topics/625-workflows/625-823-…-UAT-…` | Add | Per-page header-content inventory table feeding the thread-exit UAT pass (Task 3). |

## Resolution semantics

```
NavigationEnd → pathFromRoot segments joined → 'trading/live/detail'
  try PAGE_INFO['trading/live/detail'] → miss
  try PAGE_INFO['trading/live']        → hit → Signal Order icon+title
```

Longest-prefix lookup means nested routes inherit ancestor identity rather than blanking; a deeper `PAGE_INFO` key overrides when it exists. This mirrors `TitleStrategy` upward-walking `Route.title` — tab and header agree by construction. Wildcard `**` and anonymous paths resolve to nothing → the identity zone renders empty.

## Phases and tasks

| # | Task | Impl AC | Test AC | AC Map | Depends | Task AC(s) |
|---|---|---|---|---|---|---|
| 1 | **PAGE_INFO registry + route wiring** | `PageInfo` interface; `PAGE_INFO` keyed on every `AppRoutes` member; every leaf route in `core-routes.ts` sets `title` from `PAGE_INFO`; redirect/parent routes unchanged | Exhaustiveness spec (every enum member has an entry, icon non-empty); route-table spec asserting every leaf `title` equals its registry title | AC1 (registry is single source; titles/icons live in one place) | — | Registry compiles only when complete; tab titles follow registry |
| 2 | **`rs-header` page-identity zone** | Icon + title rendered after `.header-text`; `pageInfo` signal resolves via `pathFromRoot` join + longest-prefix; blank on unkeyed path; brand wordmark collapses under a small-viewport breakpoint; fullscreen/auth/menu behavior untouched | Specs: title tracks navigation across routes; param route (`heatmap-chart/:baseline/:symbol`) resolves; redirect chain resolves to destination identity; synthetic nested path resolves ancestor key; unkeyed path renders empty zone; unauthenticated header still renders identity | AC2 (icon+title in header), AC3 (registry-derived), AC4 (existing header behavior preserved) | 1 | Header shows correct icon+title per page with zero per-page code |
| 3 | **Title-markup sweep + page inventory** | Audit every routed page template; delete markup whose only job is restating the page title; leave all control-bearing headers (filters, run selectors, sort) untouched; no double titles; write the per-page inventory table into the thread's UAT doc | No new specs — the sweep is markup-only; existing per-page specs must still pass; inventory doc lists every page × residual header content | AC5 (no redundant titles; inventory ready for exit UAT) | 1, 2 | Every page identifiable from the global header alone |

## Sequencing

One phase; T1 → T2 → T3 in order. T2 needs the registry to render; T3 is meaningless until the header actually shows the title.

## Risks

- **Nested-path assumption** — closed by design (longest-prefix) rather than by spec alone; new nesting inherits instead of blanking. The resolver normalizes empty segments (`pathFromRoot` includes the root `''` route) — callers pass the raw join.
- **Icon set coverage** — PAGE_INFO icons must be valid Material Icons names rendered by `mat-icon`; visually verified during the sweep pass.
- **Sweep judgment calls** — "pure title restatement" vs "context line" is a per-page call; the inventory doc records what was deleted vs. left, making the call reviewable at the exit UAT rather than hidden.
- **Auth/dev/public pages** — `LOGIN`, `SIGNUP`, `CONTACT`, `DOCUMENTATION` carry unguarded routes; they get registry entries like everything else — header identity is not auth-gated.
