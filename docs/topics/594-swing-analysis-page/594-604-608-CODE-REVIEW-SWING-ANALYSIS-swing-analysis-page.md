**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #608  
**Blueprint:** #604  
**Task:** #608  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** CODE-REVIEW  
**Status:** Final  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# Code Review — #608 Dialog compact control styling

## Verdict: PASS (3 rounds — ran until clean)

Scope note: the working-tree diff on this file also carries the user's
uncommitted symbol-input removal (nav-picker feature). The #608 change
itself is the style block + the `save-config-btn` class on the save button;
ship staging will use the HEAD+CSS blob variant again.

## Spec check (ACs)

| AC | Status | Evidence |
|----|--------|----------|
| Param controls render dense — smaller height/font, no full-width inputs | ✔ | `.control` → inline row; number 100→64px, text 200→150px, color 40×28→28×22; gaps/padding tightened throughout |
| Validation bounds unchanged; config sections collapsible | ✔ | `NUMERIC_BOUNDS` + `onNumberParam` clamp untouched; `<details>` structure intact |
| Batch sweep section intact under the manager | ✔ | untouched |

## Round 1 — PASS with notes

- CSS-only change; behavior untouched (clamp, debounce, dispatch identical).
- `.control-checkbox` rule dropped — base `.control` is now already
  row/center, so checkbox labels render correctly; class retained as a
  semantic hook.

## Round 2 — findings → notes

- **[LOW] MDC button metrics** — `min-height/line-height/font-size` on
  `.save-config-btn` compresses the shell; MDC's inner label spans may not
  fully follow. Visual check in QA. Acceptable.
- **[NOTE]** `min-width: 640px` retained — the two-list rows still need
  width (name + summary + actions). Fine.

## Round 3 — CONFIRMED CLEAN

No new findings.

## Tests

`npx jest swing-analysis --coverage=false` — **291/291, 8/8 suites**
(no new specs; structure/behavior unchanged).

## Findings (open)

None.
