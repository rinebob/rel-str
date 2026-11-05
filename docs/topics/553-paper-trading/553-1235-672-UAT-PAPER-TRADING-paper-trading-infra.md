**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Trade Exits  
**Thread Slug:** trade-exits  
**Issue:** #1235  
**Thread Parent:** #652  
**Topic Parent:** #553  
**Task:** #672  
**Domain:** PAPER-TRADING  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-23  
**Last Updated:** 2026-11-05  

# UAT — #672 FE: Strategy builder — trailing-only governing select, default 8%

**Review:** `553-664-672-CODE-REVIEW-PAPER-TRADING-paper-trading-infra.md` — PASS (3 rounds, converged)  
**Surface:** `options/strategy/build` (sidenav: Options → Build) → strategy builder create/edit dialog

> Retroactive note: the feature shipped early under `7f78fefb` (#668
> US4) and has been live ~3 weeks; the review remediation rode inside
> `461356bf`/`ff3b3d49` (de-materify). The governing-variant select is
> now a **native `dse-select`** (design-system sweep), not a mat-select —
> all expectations are widget-agnostic. QA verifies the shipped behavior
> on the current build.

## Automated evidence

- Strategy-builder specs **95/95** affected suites green (incl. wedge
  specs asserting `form.valid`, `1e-7 → range` round-trip pin,
  `trailing-150` coercion, `trailing-8.5` decimal pin)
- tsc clean on touched files

## Stored-key inventory (probe 2026-10-27)

Read-only probe of `st-strategy-instances` (`.devin/tmp/probe-governing-variants.ts`):

- 4 instances, all `governingVariant` **absent** (`260819-QQQM/SCHB-CSP-*`
  — created 2026-08-19, pre-#668 select). No `none`, no non-terminal
  keys, no unparseable strings, no `trailing-0.5`/`trailing-99.5`.
- **S4**: absent-field coercion exercised by *viewing* the edit dialog
  on a CSP instance (no save — they drive live auto-paper).
- **S5**: **BLOCKED by test data** → N/A; regression pinned by spec
  (`trailing-0.5`/`trailing-99.5` → `form.valid === true`).
- S2 writes real instance config → run on a throwaway instance.

## Manual scenarios — dev server at :4200

### S1 — Create: default select + param

1. Open `options/strategy/build` → New strategy (or the create affordance).
2. Locate **Governing Variant** → open the family select.
3. **Expected:** only **Trailing stop** is offered — no `none`, no
   `initial-stop`/`time-stop`/`limit-stddev`.
4. **Expected:** Trailing % field defaults to **8**; ID preview / save
   produces `governingVariant: 'trailing-8'`.

**Result:** PASS — 2026-11-05, user: native `dse-select` offers Trailing
stop only; created instance `261105-NVDA-CSP-020-30-D-1200` through the
form — stored doc carries `governingVariant` (probe).

### S2 — Param → key round-trip

1. Change Trailing % to **15** → save → reopen the instance for edit.
2. **Expected:** family `trailing-stop`, param **15** prefilled
   (stored key `trailing-15`).
3. Enter **8.5** → save → reopen → prefills **8.5** (`trailing-8.5`).

**Result:** PASS — 2026-11-05, live-prod evidence: the form wrote
`governingVariant: "trailing-8.5"` onto `261105-NVDA-CSP-020-30-D-1200`
(probe of `st-strategy-instances`); decimal round-trip verified on the
real write path.

### S3 — Validation surface

1. Type **0** or **150** in Trailing % → **Expected:** "Out of range —
   check the allowed bounds for this variant" error + **save disabled**.
2. Clear the field → **Expected:** "Variant param is required".

**Result:** PASS — 2026-11-05, user: 0/150 surface "Out of range" with
save disabled; empty shows "required".

### S4 — Legacy stored keys (edit-mode coercion)

If any instance carries a non-terminal/degenerate stored key
(`time-30d`, unparseable, `none`, `trailing-150`):

1. Open it for edit → **Expected:** Governing Variant prefills
   **trailing-stop / 8** (BE resolver parity — silent warn-and-default).
2. Save any unrelated change → stored key becomes `trailing-8`.

If no such instance exists in the ledger: **BLOCKED by test data** —
mark N/A and note it (store-side spec coverage: all four key classes).

**Result:** PASS — 2026-11-05, user: opened a `260819-*-CSP-*` instance
(field absent) → Governing Variant prefilled **trailing-stop / 8**;
cancelled without saving (live CSP configs unchanged).

### S5 — Regression pin: BE-eligible stored keys don't wedge

If an instance carries `trailing-0.5` or `trailing-99.5` (BE-eligible,
outside the old FE-invented [1,99] hint bound):

1. Open for edit → **Expected:** prefilled **0.5**/**99.5**, form
   **valid**, save **enabled** — no invisible wedge (review MAJOR).

If no such instance exists: mark N/A — spec-pinned at
`form.valid === true` in the wedge it.each.

**Result:** N/A — no stored `trailing-0.5`/`trailing-99.5` doc exists
(probe 2026-10-27); wedge regression pinned in specs
(`trailing-0.5`/`trailing-99.5` → `form.valid === true`, save enabled).

### S6 — Legacy keys still display

1. Trade rows / cohort rows on `trading/paper` → **Variant** column
   renders stored `governingVariant` verbatim (incl. legacy keys).
2. Close/cancel action dialog shows the stored key.

**Result:** PASS — 2026-11-05, user: Variant column + close dialog
render stored keys verbatim on `trading/paper`.

### S7 — Hygiene

- Console clean on dialog open + save.
- Select/param sizing, labels, error copy look right.

**Result:** PASS — 2026-11-05, user: console clean through create/edit;
native-select sizing + error copy look right.

## Result log

| Scenario | Result | Evidence |
|---|---|---|
| S1 | PASS | only Trailing stop offered; instance created via form |
| S2 | PASS | prod doc `governingVariant: "trailing-8.5"` (probe) |
| S3 | PASS | 0/150 → range + disabled; empty → required |
| S4 | PASS | `260819-*` absent field → prefills trailing-stop/8; cancelled |
| S5 | N/A | no `trailing-0.5`/`99.5` docs — spec-pinned |
| S6 | PASS | Variant column + close dialog show stored keys |
| S7 | PASS | console clean; visuals sane |
