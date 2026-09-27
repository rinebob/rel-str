**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #614  
**Task:** #607  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — #607 Dialog: two-list config manager

## Scope

The settings dialog is now a two-list config manager: Available (Presets +
Saved library) and Active (N live configs with edit/clone/remove/save-to-
library). Legacy snapshot-save path removed from the store; dialog Save
writes slim `st-swing-configs` docs.

## Scenarios

### 1. Unit specs — config-manager block

- `npx jest swing-analysis --coverage=false`
- Expected: all pass — 9 config-manager specs (presets, saved rows, name +
  param-summary fallback, activate, delete, clone, remove, lazy load,
  empty state, dialog error surface) + 2 store race regressions.
- **Result: PASS** — 291/291, 8 suites (2026-09-27).

### 2. UI — dialog structure

- `npm start`, open Swing Analysis, open settings (gear).
- Expected: Available section (Presets: Large, Small + Saved group),
  Active section with editable `<details>` rows, no dual-mode checkbox,
  no "Save Analysis" button (replaced by Save-to-library row).
- **Result: PASS** — user-confirmed on dev server 2026-09-27.

### 3. UI — activate + clone + remove round-trip

- Click `+` on the Large preset → a third config section appears and the
  chart gains a third overlay. Clone slot 0 → fourth section. Remove a
  section → it disappears, chart overlays shrink accordingly.
- **Result: PASS** — user-confirmed on dev server 2026-09-27.

### 4. UI — save to library + param-summary fallback

- In an active row, type a name in "Save to library" and click Save → the
  doc appears under Saved with the typed name. Save another config with
  a blank name → row shows `dev10 L10 R10 1barN trigY`-style summary.
  Docs land in `st-swing-configs` (slim shape, paramsId-keyed).
- **Result: PASS** — user-confirmed on dev server 2026-09-27.

### 5. UI — delete saved row

- `×` on a Saved row → the row disappears; the doc is gone on dialog
  reopen. Active configs unchanged.
- **Result: PASS** — user-confirmed on dev server 2026-09-27.

### 6. UI — error surface

- Any failure (e.g., Firestore rules deny a write) shows inside the
  dialog (`.dialog-error`), not just the page banner behind the overlay.
- **Result: spec-verified** — `dialog-error` renders `store.error`.

## Refinement pass

- Two-list layout reads cleanly; rows are compact. Verified visually with
  user confirmation for structure (item 2).

## Traceability

| AC | Scenario |
|----|----------|
| Available: Presets + Saved, `+` activates | 1, 2, 3 |
| Active: edit-expand, clone, save-to-library, remove | 1, 3, 4 |
| Param-summary fallback for unnamed saves | 1, 4 |
| Library loads on dialog open | 1 |
| Legacy store APIs removed | 1 |

## Findings

- Stale Firebase auth token on a long-lived dev session caused a
  Missing or insufficient permissions denial on the first
  loadConfigs — hard-reload resolved; not a code defect.
  Firestore rules were confirmed already-deployed.
- No functional findings.
