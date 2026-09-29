**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle viewer  
**Thread Slug:** `lifecycle-viewer`  
**Issue:** #691  
**Task:** #644  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Area:** FE  
**Status:** Complete  
**Created:** 2026-09-29  
**Last Updated:** 2026-09-29  

---

# UAT — #644 FE-IMPL: Route + nav entry (Topic Viewer)

## Scope

`AppRoutes.TOPIC_VIEWER` = `tools/topic-viewer`, lazy auth-gated route, "Topic Viewer" nav entry, plus the `dev-lifecycle` → `topic-viewer` rename (dir, classes, service, store, selectors, testids) per the nav-reorg PRD. The #643 deferred rendered-surface refinement lands here.

## Prerequisites

- `npm install` done.

## Scenarios

### S1 — Specs + build

```powershell
npx jest src/app/features/topic-viewer --coverage=false
npx ng build
```

Expected: 30/30 (incl. `TopicViewer route + nav` block — lazy module resolves, `canActivate` present, nav entry `Topic Viewer`/`external:false`). Build clean.

**Result:** PASS — 30/30; `ng build` clean (one pre-existing `DecimalPipe` warning in unrelated WIP).

### S2 — Rename consistency reads

- No stale `dev-lifecycle`/`DEV_LIFECYCLE` refs in `src/` — grep clean; contracts naming (`lifecycle-*`, `getLifecycleTree`) is the BE domain term, unchanged.
- Route path `tools/topic-viewer` matches the nav-reorg PRD's canonical tree (`/topic-viewer` → `/tools/topic-viewer` alias planned there).
- `data-testid` hooks renamed consistently (`topic-viewer-page`, `tree-node-*`, `caret-*`, `topic-*`, banners).

**Result:** PASS.

### S3 — Rendered-surface refinement (deferred from #643)

Component-level check of the visual tree: depth indent, caret/`aria-expanded`, closed dimming, chip vocabulary (type badge, stage chip, Status badge, tag chips), banner roles. Verified via specs + template read; live visual pass happens when the callable is deployed (#638 → #641) — the page renders its shell + error banner until then.

**Result:** PASS (with noted pending live-data visual pass at #641).

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Nav entry renders and routes to the page | S1 (spec asserts module resolves) |
| Lazy route + auth guard like siblings | S1 |
| `ng build` clean | S1 |
| (rename) consistent surface naming | S2 |
| (deferred from #643) rendered-surface refinement | S3 |

## Refinement pass

The page is deliberately minimal chrome-wise; no write affordances (audited). One known visual debt: raw ISO `fetchedAt`; accepted (precision over localization for a dev tool).
