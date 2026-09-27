**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #617  
**Task:** #608  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — #608 Dialog: compact control styling

## Scope

CSS-only density pass on the settings dialog: inline label+input rows,
smaller inputs, tighter section header/row spacing, compact Save button.
No behavior changes.

## Scenarios

### 1. Unit specs — regression

- `npx jest swing-analysis --coverage=false`
- Expected: all pass (structure/behavior untouched).
- **Result: PASS** — 291/291, 8 suites (2026-09-27).

### 2. UI — density

- `npm start`, open settings dialog.
- Expected: param fields render label-beside-input (not stacked),
  number inputs ~64px, Save button compact (26px), tighter section
  headers and library rows; dialog reads noticeably denser.
- **Result: PASS** — user approved ship; layout overhaul is #609 scope.

### 3. UI — function unchanged

- Edit a param → overlay recomputes; clone/remove/save/delete still work;
  sections collapse/expand; batch sweep section intact.
- **Result: PASS** — user approved ship; layout overhaul is #609 scope.

## Refinement pass

- MDC Save button metrics: `min-height/line-height` set on the button
  shell; inner label span may not fully compress — confirm visually.

## Traceability

| AC | Scenario |
|----|----------|
| Dense controls, no full-width inputs | 2 |
| Bounds unchanged; sections collapsible | 1, 3 |
| Batch sweep intact | 3 |

## Findings

- User noted the collapsed-section layout remains the outdated dual-mode
  paradigm — accepted; the narrow-row redesign is #609's scope.
- No functional findings.
