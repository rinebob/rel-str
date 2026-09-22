# Code Review — #483 Run-container delineation + grid fixes

**Verdict: PASS** — 0 critical, 0 major across all three axes. 346/346 tests green, both tsconfigs clean.

Scope reviewed: `run-section.component.ts/.spec`, `pct-change-grid.component.ts/.spec`, `pct-change.utils.ts/.spec`, `swing-compare.component.ts`.

## What shipped

- `<details class="run-section">` is now the run container; `<summary>` IS the header row — "Run N" + dates + type badge left, "grids (N)" + rotating `expand_more` chevron + ✕ right. Type-colored 5px accent stripe + pill badge (green CALL / red PUT). 1.5px border + shadow per run; run-list gap 14px.
- Cell `[title]` tooltips suppressed via `tooltipsSuppressed()` (`selectedCell() != null`) while a contract chart is active; restored on clear.
- `MIN_CELL_PRICE = 0.02` — cells with either price endpoint < $0.02 excluded from top-5-per-expiration marking AND from the p5/p95 percentile feeding the color ramp. They still render.

## Findings addressed

- **Minor (spec):** tooltip restore after `clearContractSelection` now asserted.
- **Minor (spec):** added targetPrice-penny top-5 exclusion case (previously only startPrice path covered).
- **Nit:** `onToggle` now reads `event.currentTarget` (semantic-correct vs `target`).
- **Nit:** template indentation normalized after the wrapper-div removal.

## Findings NOT addressed (documented decisions)

- **Minor (a11y):** `<button>` inside `<summary>` trips axe's `nested-interactive` rule; functionally guarded by `preventDefault` (mouse + keyboard — the toggle is the summary's activation behavior and cancelled clicks don't toggle). Accepted — moving the ✕ outside the header would recreate the two-row layout the task removes.
- **Minor (design):** penny exclusion checks BOTH endpoints — a real `$0.01→$5` mover gets no top-5 ring and can't set the scale. Per user's wording ("cells with prices at $0.01 … only include if .02 or higher") this is intended; comment at `pct-change.utils.ts` documents it.
- **Nit:** all-penny column → `p5=p95=0` → `NEUTRAL_COLOR` via the `scale===0` guard — verified sane, no change needed.
- **Manual-verify only (jsdom can't):** ✕-click toggle suppression in Safari; `<summary>` keyboard reachability; axe audit if a11y linting ever lands.
