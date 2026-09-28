**Topic:** Swing Analysis Page  
**Topic Slug:** `swing-analysis-page`  
**Issue:** #628  
**Blueprint:** #604  
**Task:** #609  
**Topic Parent:** #594  
**Domain:** SWING-ANALYSIS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-09-27  
**Last Updated:** 2026-09-27  

# UAT — #609 Config-manager redesign (presets vs. sets, narrow rows, runtime toggle, batch removal)

## How to get there

`npm start` → log in → navigate to the Swing Analysis page (savant-trader
route `/swing-analysis`) → click the ⚙ settings icon → the config-manager
dialog opens.

## What to confirm

### S1 — Presets group

- [ ] Four unnamed canned rows under **Presets**, ordered dev10 → dev5 →
  dev3 → dev2; each shows a color swatch + param summary + `+`.
- [ ] Clicking `+` pushes a copy into the Active list (row count grows).

### S2 — Active rows

- [ ] One narrow row per config: `☐ [color] [dev] [L] [R] [1bar☐] [trig☐] [Save] [Clone] [×]`.
- [ ] No collapsible sections, no Large/Small labels anywhere.
- [ ] Number inputs accept param edits; out-of-range values clamp to the
  validation bounds (devThreshold 0.1–100, depths 2–100).

### S3 — Per-row on/off (runtime-only)

- [ ] Unchecking a row's leading checkbox removes that config's line from
  the chart behind the dialog; the row dims.
- [ ] Editing a param on a disabled row does NOT put swings/stats back —
  it stays empty until re-enabled.
- [ ] Re-checking recomputes and restores the line.

### S4 — Save preset (per-row)

- [ ] `Save` on an active row writes the config to the library; it appears
  under **Presets** (bottom of that group) with `+`/`✎`/`×`.

### S5 — Active header ops

- [ ] **Save set** writes the whole active list as one doc under **Saved
  sets** (shows `N×cfg` badge). Empty active list → button no-ops.
- [ ] **Clone all** duplicates every active row.
- [ ] **Clear** empties the active list (rows gone; chart clears).

### S6 — Saved sets group

- [ ] `+` on a set row **replaces** the whole active list (not append) and
  recomputes all members.
- [ ] `✎` opens an inline rename input; commit via Enter or blur; blank
  clears the name back to the param summary.
- [ ] `×` deletes the doc.

### S7 — Batch sweep removed

- [ ] No batch-sweep section or textarea anywhere in the dialog; no
  console errors on open.

### S8 — Regression smoke

- [ ] Chart, swing table, stats panel all render normally with the default
  two configs; symbol nav + picker still work.
- [ ] `npm start` builds clean — no missing-import errors.

## Traceability

| AC / criterion | Scenario(s) |
|---|---|
| Narrow inline active rows, no details/labels | S2 |
| Runtime-only on/off per row | S3 |
| Unnamed presets, desc devThreshold + user singles | S1, S4 |
| Saved sets keyed by member paramsIds; + replaces configs[] | S5 (Save set), S6 |
| Active header: Save set / Clone all / Clear | S5 |
| Per-row Save = preset; header Save set = set | S4, S5 |
| Batch sweep removed | S7 |
| Validation bounds unchanged | S2 |

## Results

| Scenario | Result | Evidence |
|---|---|---|
| S1 presets | PASS | |
| S2 narrow rows | PASS | |
| S3 on/off toggle | PASS | |
| S4 save preset | PASS | |
| S5 header ops | PASS | |
| S6 sets apply/rename/delete | PASS | |
| S7 batch gone | PASS | |
| S8 regression | PASS | |

## Automated evidence

- `npx jest swing-analysis --coverage=false` — 271/271, 8/8 suites (post-review-fixes)
- `npx jest --coverage=false` — 2034/2034, 149/149 suites (full suite green)
