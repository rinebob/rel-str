**Topic:** Savant Design System  
**Topic Slug:** savant-design-system  
**Issue:** #1311  
**Topic Parent:** #1024  
**Task:** #1214  
**Domain:** DESIGN-SYSTEM  
**Type:** UAT  
**Status:** Complete  
**Created:** 2025-11-05  
**Last Updated:** 2025-11-05  

# UAT — #1214 FE literal sweep: savant-trader surfaces

## Scope

Hardcoded color literals in `src/app/features/savant-trader/**` converted
to `var(--ds-*)` semantic references, per `ui-color-sites.json`. 366
literal sites → ~252 converted, ~94 remain: tagged exceptions
(chart/canvas-rendered configs, categorical identity hues, one-off
non-themable surfaces) and inventory false positives (issue refs like
`#717`, HTML entities like `&#9660;` inside comments — not colors).

## Acceptance results

| # | Criterion | Result | Evidence |
|---|-----------|--------|----------|
| AC1 | Inventory re-run: sites consumed or tagged | **PASS** | `node scripts/inventory-ui-colors.mjs` regenerated; ST `kind=literal` sites 366 → 114, every remainder inside a `literal-sweep exception #1214` block or a comment-string FP |
| AC2 | No new literals in swept files | **PASS** | scoped `git diff` — every added declaration uses `var(--ds-*)`; literal lines exist only inside tagged exception blocks |
| AC3 | `--ds-up`/`--ds-down` semantics preserved | **PASS** | direction colors (profit/long/buy/positive vs loss/short/negative/put) mapped to `up`/`down` only |
| AC4 | Visual spot-check, dark + light | **DEFERRED** | user-directed — deferred to phase-level walkthrough after #1215–#1217; scenarios D1–D3 below are the task's deferred checklist |
| AC5 | Existing specs green | **PASS** | `npx jest src/app/features/savant-trader` — 137/137 suites, 2,720 tests; `npx sass` compile of `styles.scss` clean; all 27 used `var(--ds-*)` names resolve in the compiled token layer |

## Deferred visual walkthrough checklist (phase-level)

Run on `http://localhost:4210`, dark theme first, then flip light via
header toggle. One line = one surface.

- **D1** `/options/pct-change` — grid surfaces/borders, live-state
  badge, direction colors, run-section cards, top-gainer outlines
- **D1b** `/options/pct-change` → open frame-swing dialog (click a
  swing in the run detail) — SVG pivot colors, panel surfaces, labels
- **D1c** `/options/pct-change` → hover/click a contract cell →
  contract-mini-chart popup — badge colors (call=accent, put=down),
  price/delta legend colors
- **D2** `/options/chain` — chain grid header/cell surfaces, borders,
  ATM accent row, month separators; click a cell → chain-cell-popup
  dark tooltip + copy button hover
- **D3** `/trading/paper` — order ticket status chips (staged/queued/
  resting-purple exception/filled/failed), buy/sell direction colors,
  order queue status dots; open order-confirm dialog (buy=up color,
  warning banner = warning pair)
- **D4** `/trading/gallery` — gallery cards (direction chip, weekly-
  purple tf-chip exception, status borders), gallery-group long/short,
  actioned failed/settled/rejected colors
- **D5** `/signals/review` — signal-review-header pill colors
  (review-purple exception / order=up), symbol-actions trade pill
  (green), symbol-list-actions 7-hue ACR ramp (all exceptions — must
  look unchanged)
- **D6** `/signal-history` — long/short/zone/strength summary chips
  (up/down/accent/warning)
- **D7** `/trading/analysis` — origin/status pills, open-banner, tags,
  analysis-stats positive/negative, analysis-table same; histogram
  renders (all chart colors are literals — unchanged)
- **D8** `/analysis/swings` — page subtitle/loading/error states;
  swing-settings dialog (panels, controls, save button); stats panel
- **D9** `/options/strategy/build` — strategy-builder form error
  banner (error red + surface text), validation errors
- **D10** `/options/strategy/backtest` — run-history trigger chips
  (pdr=accent, nightly=purple exception); underlying chart unchanged
- **D11** `/dev/flex-chart` — sandbox surfaces (tokenized) + chart
  colors unchanged (exceptions)
- **D12** `/tools/account` — observation-result-panel `.json-output`
  deliberately still dark-terminal (exception — confirm intentional)
- **D13** `/options/spread-chart` — chart unchanged (exceptions)
- **D14** `/trading/scanner` + `/trading/live` — headers/toolbars;
  trade button text (was `#fff` → `--ds-surface`, dark theme shows
  dark text on green — improved contrast, flag if unreadable)

## Regression / smoke

- Flip `[data-theme]` between dark/light on `/trading/paper` —
  status chips, borders, and muted text must re-theme (no stranded
  light-tuned literals)
- Confirm exception areas unchanged: chart series colors, indicator
  lines, hedge/review purple accents, nightly-trigger purple,
  ACR 7-hue ramp

## Findings

- Minor: `--ds-surface` as text-on-solid (token-role bend) — parked
  for #1162 component pass
- Nit: ~20 inventory FPs (issue refs + `&#96xx;` entities) remain in
  the literal count — cosmetic
