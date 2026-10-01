# UAT — #715 FE-IMPL: Topic Viewer visual polish pass

- **Topic:** #619 — DEV-TOOLS: GitHub read-only issue UI
- **Thread:** #697 — Topic Viewer UI polish & misc fixes
- **Task:** #715 — FE-IMPL: Topic Viewer visual polish pass
- **QA issue:** #718
- **Review:** `619-697-715-CODE-REVIEW-dev-tools-gh-issues-ui.md` (PASS)
- **Date:** 2026-09-30
- **Status:** Complete

## Scope

Visual polish of `/tools/topic-viewer` per inventory #713 items 1–11 and the
user's directed requirements (430px left pane, chip-free topic rows with
stage dot, centered carets, `Topic:` prefix strip, "Topic Viewer" heading).
Purely presentational — the page must remain read-only and both supported
repositories must still load.

## Prerequisites

- `npm start` dev server (or prod build) at `http://localhost:4200`
- Authenticated user with access to the deployed `getLifecycleTree` callable
- Both repos readable: rel-str (Topics present) and av-proxy-api

## Start

1. `npm start`; sign in.
2. Navigate to `/tools/topic-viewer`.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|----------|-------|----------|--------|
| 1 | Left pane layout | Load page | Left pane ~430px; rows show `#N title` only — no chips; title ellipsizes if long; small stage-colored dot on right edge; `Topic:`/`Topic -` prefix stripped from titles | PASS — user inspected dev page; prefix strip + dot confirmed in code & spec |
| 2 | Section grouping | Scroll left pane | Section names (inventory groups) render with weight + rule, not disabled-looking | PASS — user inspected |
| 3 | Caret alignment + click targeting | Expand/collapse tree nodes | Chevron glyph centered in its 24px target; clicking near a row's bottom edge does NOT toggle the row below (48px touch-target disabled) | PASS — user confirmed chevron alignment; touch-target token fix verified vs Material source |
| 4 | Depth guides | Expand to depth 2–3 | Vertical hairlines run under ancestor caret centers | PASS — offset math verified (11.5px) |
| 5 | Tree row metadata | Inspect rows | Title flexes + ellipsizes; type badge hidden for tasks; no INTERNAL/FEATURE chips; stage chip color-coded by ordinal (incl. 4_BACKLOG muted grey-blue); status + remaining tags right-anchored | PASS — specs + user inspection |
| 6 | Context header | Select a topic | Right pane shows `#N Title` linked to GitHub above Expand/Collapse all | PASS — spec + user inspection |
| 7 | Page header | Observe top row; narrow viewport | Heading reads exactly "Topic Viewer"; controls wrap instead of clipping | PASS — spec asserts h1 text |
| 8 | Banners / empty states | Tree pane before selecting a topic | Empty state centered with icon; error/warn banners styled with icons | PASS — specs cover empty/banner states |
| 9 | Read-only | Inspect all affordances | No inputs that mutate; all links external (`_blank` + noopener) | PASS — template audit, zero write paths |
| 10 | Both repos | Switch repo picker | rel-str and av-proxy-api both load trees; av-proxy-api rows lack status chips (no projectNumber — by design) | PASS — earlier smoke verified; no changes to fetch path |

## Automated evidence

`npx jest src/app/features/topic-viewer --coverage=false` — **4 suites /
34 tests, all passing** (incl. new coverage: h1 text, prefix strip, stage
dot `data-stage`, `aria-current`, `--guides` property, chip `data-stage`).

## Traceability

Inventory items 1–11 → scenarios 1–8; user requirements (430px / no chips /
chevron / prefix / heading / read-only) → scenarios 1, 3, 7, 9.

## Refinement pass

User-facing surface — manual inspection performed by the user on the dev
server across three iterations (left-pane chips removed → dot, chevron
alignment corrected, prefix strip). User sign-off: "ok thats a lot better"
plus directed follow-ups all addressed.

## Regression checklist

- [x] Existing specs still pass (34/34)
- [x] expand-all/collapse-all unchanged (store `expandableIds` now also
  drives caret visibility — equivalent predicate)
- [x] av-proxy-api unaffected (no projectNumber, still loads)
- [x] Nav label still "Topic Viewer"

## Verdict

**PASS** — ready to ship via `/proj ship 619 715`.
