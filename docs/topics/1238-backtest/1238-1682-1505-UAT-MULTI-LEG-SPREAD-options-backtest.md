**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1682  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1505  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — FE Task: Replay run dialog — variant/template sections (#1505)

## Scope

The Selection Replay "New Replay" dialog gains the two-section variant
layout: a named-variant dropdown bound to `REPLAY_VARIANTS`, and a custom
section that opens the shared `OptionsVariantBuilderDialogComponent`
(first live entry point for the `#1504` builder). Named selections close
with `{variantId, symbols, startDate}`; composed selections close with
`{legs, variantName?, symbols, startDate}` — the request form matches the
selection path and `templateId` is never emitted.

Task acceptance criteria:

1. Request form matches selection path (variantId vs legs).
2. Multi-symbol runs unchanged.
3. Existing dialog specs updated.

Review-round fixes this UAT also confirms: `customResult` narrowed to the
`VariantLegsResult` member (named-form misfire path deleted); "custom
needs a result" enforced by the single `canSubmit()` gate; builder opened
with `submitLabel: 'Apply'`; `variantName` key omitted when absent;
QA-finding fix: variant dropdown options reduced to name-only with a
description + leg-signature caption (F1).

## Prerequisites

- Repo checkout on branch `prod`; dev server already running on
  `http://localhost:4200` with the tester signed in (route is behind
  `authGuard`).
- Concrete values used throughout:
  - Named variants: `csp-45-20` ("45DTE 20Δ put (CSP)" — the default),
    `pcs-45-20-5` (2-leg put credit spread)
  - Builder base shape: `put-credit-spread` (2 option legs, band-bounded
    pickers)
  - Scratch legs example: PUT Δ −0.20 / 45 DTE / SHORT + PUT Δ −0.10 /
    45 DTE / LONG
  - Symbols: `QQQ`; multi-symbol `QQQ, SPY`
  - Start date: 2026-01-05 (inside materialized pick coverage)

## Getting to the feature

Route: `/options/strategy/backtest`. Entry point: sidenav **Backtest**
link. Surface: the backtest dashboard's **Selection Replay** section —
the **+ New Replay** button in the run-controls card opens
`OptionsReplayNewRunDialogComponent`. From the dialog's custom section,
the **Compose…** button stacks `OptionsVariantBuilderDialogComponent`
over it.

## Automated evidence (executed this session)

- `npx jest options-replay-new-run-dialog --coverage=false` — **20/20**
  (named/custom request forms, builder open config + both result shapes,
  custom-required guard, cancel, date defaults/clamps, symbol
  validation, union key-absence pins).
- `npx jest --coverage=false` — **328 suites / 6235 tests** green.
- `npx tsc --noEmit -p tsconfig.app.json` — clean.

## Scenarios

Every step names the exact control. "Dropdown" = the labeled `<select>`;
"radio" = the two section radios at the top of the dialog.

### S1 — Dialog opens on the named section; dropdown is name-only with a caption
- **Confirms:** template picker replaced; named mode default; the F1 fix
  (select options show the variant **name only** — the description moved
  to a caption line under the field).
- **Steps:**
  1. Sidenav **Backtest**.
  2. In the **Selection Replay** section, click **+ New Replay**.
  3. Open the **Variant** dropdown and scan the option list.
- **Expected:**
  - Title reads **New Selection Replay**; two radios at top —
    **Named variant** (checked) and **Compose from template or scratch**.
  - The Variant dropdown shows ~13 options, each a short name like
    `45DTE 20Δ put (CSP)` or `45DTE 20/5Δ put credit spread` — **no long
    description text inside the options**.
  - Under the dropdown, a muted caption shows the selected variant's
    description (e.g. for `csp-45-20`: "Sell one 45DTE 20-delta put each
    trading day — cash-secured put ladder.") plus a monospace leg line
    (`short put Δ-0.2 45DTE` for the default).
  - Changing the dropdown selection updates both caption lines.
- **Result:** ☒ PASS — 2026-11-22, user-verified live

### S2 — Named variant run
- **Confirms:** `{variantId, symbols, startDate}` request; run appears.
- **Steps:**
  1. In the dialog, set the Variant dropdown to `45DTE 20/5Δ put credit
     spread` (`pcs-45-20-5`).
  2. Symbols field: type exactly `QQQ`.
  3. Date selects: Year `2026`, Month `Jan`, Day `5`.
  4. Click **Start Replay**.
- **Expected:** dialog closes; the run list gains an SPY-style row for
  `QQQ` whose snapshot name reflects the named variant (run enters the
  worker queue — pending/queued status is fine).
- **Result:** ☒ PASS — 2026-11-22, user-verified live

### S3 — Custom: base-template composition
- **Confirms:** builder opens over the dialog with **Apply**; a legs
  result lands on the custom section.
- **Steps:**
  1. Click the **Compose from template or scratch** radio.
  2. Click **Compose…**.
  3. In the builder, select base-template mode → shape
     `put-credit-spread`.
  4. Change one leg's Δ picker to a different in-band value (e.g. −0.20
     → −0.25 if in band).
  5. In the name field type `my pcs`, click **Apply**.
- **Expected:** builder closes; the parent dialog now shows, next to
  Compose…, the text **2 legs · my pcs**; the **Compose from template or
  scratch** radio is checked.
- **Result:** ☒ PASS — 2026-11-22, user-verified live

### S4 — Custom: from-scratch composition submits inline legs
- **Confirms:** `{legs, variantName?, symbols, startDate}` request.
- **Steps:**
  1. Click **Compose…** → builder from-scratch mode.
  2. Add leg 1: type `put`, side `short`, Δ `0.20`, DTE `45`.
  3. Add leg 2: type `put`, side `long`, Δ `0.10`, DTE `45`.
  4. Leave the name field empty; click **Apply**.
  5. Symbols `QQQ`; click **Start Replay**.
- **Expected:** run starts; the summary showed **2 legs** with no name
  suffix; the request carried legs but no `variantId`/`templateId`/
  `variantName`.
- **Result:** ☒ PASS — 2026-11-22, user-verified live

### S5 — Named builder Apply routes back to the named section
- **Confirms:** a `{variantId}` builder result flips the parent to named.
- **Steps:**
  1. Radio **Compose from template or scratch** → **Compose…**.
  2. In the builder's named mode pick `30DTE 30Δ put (CSP)`
     (`csp-30-30`) → **Apply**.
- **Expected:** parent shows the **Named variant** radio checked and the
  dropdown set to `csp-30-30` (caption updates to that variant).
- **Result:** ☒ PASS — 2026-11-22, user-verified live

### S6 — Builder cancel leaves the selection untouched
- **Confirms:** dismiss without Apply changes nothing.
- **Steps:**
  1. Radio **Compose from template or scratch** → **Compose…**.
  2. Close the builder via its Cancel (no Apply).
- **Expected:** the custom radio stays checked; summary still reads
  **No composition yet**; **Start Replay** remains disabled.
- **Result:** ☒ PASS — 2026-11-22, user-verified live

### S7 — Custom without a composition cannot submit (negative)
- **Confirms:** the `canSubmit()` gate.
- **Steps:** click the **Compose from template or scratch** radio and do
  nothing else.
- **Expected:** **Start Replay** is disabled; beside Compose… the muted
  text **No composition yet** shows; no red error styling.
- **Result:** ☒ PASS — 2026-11-22, user-verified live

### S8 — Whitespace-only symbols rejected (negative)
- **Confirms:** unchanged symbol validation.
- **Steps:**
  1. On the **Named variant** radio (Start Replay must be enabled —
     whitespace passes `required`, so the button stays clickable).
  2. Clear the Symbols field, type ` , , ` (spaces + commas).
  3. Click **Start Replay**.
- **Expected:** red text **At least one symbol is required** under the
  Symbols field; the dialog stays open.
- **Note:** a fully empty field shows the same message on blur via the
  native `required` validator — no click needed. If the button is
  disabled instead, the custom radio is still selected without a
  composition (S7's gate) — flip back to Named first.
- **Result:** ☒ PASS — 2026-11-22; first attempt hit the disabled-button
  state (custom mode, no composition); whitespace + click verified —
  also spec-pinned end-to-end ("whitespace symbols surface the required
  message in the DOM after Start Replay")

### S9 — Date clamping and leap years
- **Confirms:** unchanged Y/M/D dropdown behavior.
- **Steps:**
  1. Open the Year dropdown: it offers **only `2026`** — by design
     (`EARLIEST_COVERAGE_YEAR = 2026` and the floor is
     `max(now−10y, 2026)`; pick-doc coverage starts 2026, so nothing
     earlier can ever produce a run).
  2. Set Month `Jan`, Day `31`.
  3. Change Month to `Feb` → Day must now show `28`.
- **Expected:** day clamps to the month length; impossible dates are
  unconstructable. Leap-year behavior (Feb offering 29) can't be driven
  live until a leap year enters the covered range — it is spec-pinned
  instead ("day dropdown honors leap years — Feb 2024 offers 29 days",
  plus the year-loses-a-leap-day clamp spec).
- **Result:** ☒ PASS — 2026-11-22; only-2026 year list confirmed +
  Jan 31 → Feb 28 clamp live; leap path spec-pinned

### S10 — Multi-symbol request unchanged
- **Confirms:** one request, one run per symbol.
- **Steps:**
  1. Named variant `45DTE 20Δ put (CSP)`, Symbols `QQQ, SPY`, date
     2026-01-05.
  2. **Start Replay**.
- **Expected:** the run list gains one QQQ entry and one SPY entry.
- **Result:** ☒ PASS — 2026-11-22, user-verified live

### S11 — Legacy templateId runs still list (regression)
- **Confirms:** the run list tolerates pre-variant docs.
- **Steps:** with the run list populated, find a run created before this
  change (a `templateId` doc — snapshot column shows a legacy template
  name) and open its contract list.
- **Expected:** the row renders normally; the contract list opens as a
  one-leg position.
- **Result:** ☒ PASS — 2026-11-22, user-verified live

## Manual UI/UX refinement pass

- **Dialog layout:** radios sit in one row with readable spacing; named
  dropdown is full-width; custom row keeps Compose… + summary on one
  line at the 560px dialog width.
- **Nested stacking:** the builder opens cleanly over the run dialog
  (overlay-on-overlay); closing Apply returns focus/scroll to the run
  dialog; backdrop dims only the run dialog beneath.
- **Summary legibility:** "N legs · name" and muted "No composition
  yet" are readable at 13px; no layout jump when the summary appears.
- **Keyboard:** Tab order radios → variant select / Compose… → symbols →
  date selects → Cancel → Start Replay; Enter doesn't double-submit.
- **Width contract:** run dialog stays within its `560px`/`90vw` frame;
  builder stays within ~480px DS pane — no horizontal scrollbars on a
  1366px-wide window.
- **Result:** ☒ PASS — 2026-11-22, user-verified ("looks really good");
  F1 select-unreadability remediated in-gate during the pass

## Findings

- **F1 — Variant dropdown unreadable (FAIL → fixed in-gate).** Options
  rendered `name — description` on a single line inside a native
  `<select>`; ~13 long strings were illegible (reported 2026-11-22).
  Fixed: options now show the variant **name only**; a muted caption
  under the field renders the selected variant's description plus a
  monospace leg signature (`short put Δ-0.2 45DTE`), updating live on
  selection change. Spec-pinned in
  `options-replay-new-run-dialog.component.spec.ts`. Re-verify via S1.
- **F2 — Run-list permutation legibility (routed to backlog).** The
  Selection Replay run list can't carry the symbol × shape × Δ × DTE
  permutation density — run rows identify composition only by a raw
  snapshot-name string. Adjacent-surface design work, filed as
  `#1685 — CHORE: Replay run-list legibility` under Blueprint `#1490`
  (coordinate with `#1507`). Not a defect of this diff — the dialog
  change doesn't touch the list — so it does not gate this task.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Request form matches selection path (variantId vs legs) | S2, S4, S5 |
| Multi-symbol runs unchanged | S10 |
| Existing dialog specs updated | Automated evidence (20/20) |
| Two-section layout replaces template picker | S1, S3 |
| `templateId` never emitted | S2, S4 |
| Custom-required guard | S6, S7 |
| Symbols/date behavior preserved | S8, S9 |
| Legacy templateId docs tolerated | S11 |

## Regression / smoke

- `npx jest src/app/features/savant-trader/backtest --coverage=false` —
  **220/220** (all backtest suites incl. run list, contract list,
  dashboard caller).
- Nearby surfaces checked: legacy `BacktestNewRunDialogComponent`
  (options-chain backtest dialog) untouched; run-controls filter card
  untouched; `backtest-dashboard` caller unchanged.

## Verdict

**PASS** — all 11 scenarios + manual UI/UX refinement pass green
(user-verified live); one in-gate defect fixed (F1 select readability),
one adjacent-surface finding routed to `#1685`.

## Results log

| Date | Scenario / check | Result | Evidence |
|---|---|---|---|
| 2026-11-22 | Automated evidence — focused suite | PASS | 20/20 → 21/21 post-F1-fix |
| 2026-11-22 | Automated evidence — full suite | PASS | 328/328, 6235 tests |
| 2026-11-22 | Automated evidence — typecheck | PASS | tsc exit 0 |
| 2026-11-22 | S1 two-section layout + name-only select | PASS | user-verified live (F1 fixed in-gate) |
| 2026-11-22 | S2–S7, S10, S11 | PASS | user-verified live ("all remaining uat passes") |
| 2026-11-22 | S8 whitespace symbols | PASS | live + DOM-pin spec; first attempt hit disabled-button state (custom mode) |
| 2026-11-22 | S9 date clamps | PASS | only-2026 year list by design; Jan 31 → Feb 28 live; leap path spec-pinned |
| 2026-11-22 | Manual UI/UX refinement pass | PASS | user-verified ("looks really good"); F2 → #1685 |
