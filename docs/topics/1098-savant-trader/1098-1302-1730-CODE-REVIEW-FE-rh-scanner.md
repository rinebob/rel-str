**Topic:** RH Scanner  
**Topic Slug:** savant-trader  
**Thread:** Scanner Row Actions  
**Thread Slug:** scanner-row-actions  
**Issue:** #1302  
**Thread Parent:** #1295  
**Topic Parent:** #1098  
**Task:** #1730  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-24  
**Last Updated:** 2026-11-24  

# Code Review — #1730 FE-IMPL: scanner polish — popup volume pane, new-default filter, liquidity floor

## Verdict

**PASS**.

```text
First pass complete — 3 axes: no critical/major findings; 2 nits (filter-array line-length consistency, comment understates the config.data mechanism)
Second pass complete — union coverage re-traced across all 4 changed files + 3 spec files; FlexChart contracts verified end-to-end (data passthrough, pane/type unions, percent clamp); no new findings
Convergence: PASS — nothing critical or major; nits are cosmetic and spec-pinned behavior is correct
```

## Scope reviewed

Uncommitted working-tree changes for #1730 (post-#1308 polish, three
independent changes riding the scanner wake):

- `utils/scanner-historicals.util.{ts,spec.ts}` — `volumeColumns(bars)`
- `pages/scanner/scanner-chart-popup.component.{ts,spec.ts}` — volume
  lower pane + `mainPanePercent: 75`
- `pages/scanner/scanner.component.{ts,filter.spec.ts}` — `symbolFilter`
  default `'all'`→`'new'` + tracked-universe-error snap-back effect
- `scanner/scanner-recipes.{ts,spec.ts}` — `MIN_LIQUIDITY_FILTER`
  (`volumeAvg(30, "1d") >= 250000`) on all non-quality recipes

## Findings — first pass

### Standards axis

| Sev | Finding | Disposition |
|---|---|---|
| OK | `type: 'volume'` with precomputed `config.data` — verified at `flex-chart-calculations.ts:19-20`: `config.data` short-circuits before the `indicatorCalculators` lookup; no `'volume'` calculator is registered | correct — the passthrough is the intended seam |
| OK | `'volume'`, `'lower-1'` are real `IndicatorType`/`IndicatorPane` union members; `mainPanePercent: 75` is inside the `[20,95]` clamp; `DEV_INDICATOR_TYPES` is empty so nothing is stripped in prod | — |
| OK | Snap-back `effect` in `scanner.component.ts` — guarded by `!== 'all'`, cannot loop; only fires when `trackedStatus` transitions to `'error'`. Re-clicking `New` during error re-triggers and re-snaps — correct (filter is uncomputable without the universe) | — |
| OK | `volumeColumns` color convention `close >= open → up` matches the candle series (`bearFillColor` paints the `open <= close` UP candle per the html comment) | — |
| NIT | `MIN_LIQUIDITY_FILTER` appended to `near-52w-high`/`near-52w-low`/`gainers`/`losers` as a single-line array while siblings are multi-line | cosmetic — prettier-shaped but inconsistent with the file's own multi-line style |
| NIT | Inline comment says "`'volume'` has no registered calculator" — true, but the mechanism is stronger: `config.data` wins even when a calculator exists | cosmetic |

### Spec axis

| Task expectation | Met |
|---|---|
| Volume pane along the bottom, separate pane | YES — `lower-1` column series, per-point up/down `color`, 75/25 split; pane collapses when no bar carries volume |
| `new` as the default filter | YES — signal default + aria-pressed spec; snap-back to `all` on universe error spec-pinned |
| Liquidity floor weeds dead/thin names | YES — `MIN_LIQUIDITY_FILTER` on all 9 non-quality recipes, quality ×3 exempt; catalog spec pins the invariant; live-verified by user (`Run all` rail counts dropped, ALLZ-class gone) |

### Thermo-nuclear axis

- `volumeColumns` honest-gaps policy: absent/`NaN`/negative emit **no
  point**; a real `volume: 0` bar emits a zero-height column — the
  comment+code agree (a gap for missing data is honest; a fabricated
  zero for missing data would be a lie).
- `mainPanePercent` can't desynchronize pane layout — FlexChart clamps
  at the point of use.
- The effect writes a signal inside an injection-context effect —
  legal on Angular 21, guarded against re-entry.
- `MIN_LIQUIDITY_FILTER` is one shared object reference across recipes —
  safe: `ScanFilter`s are treated as read-only end-to-end.
- Catalog spec iterates `SCANNER_RECIPES` with an explicit quality-id
  set — a future non-quality recipe can't silently ship without the
  floor.

## Test results

```text
Test Suites: 340 passed, 340 total
Tests:       6504 passed, 6504 total
Time:        368.68 s
```

`npx jest --coverage=false` — full suite green, including the new
`volumeColumns` block, the popup volume-pane tests, the filter
default/snap-back specs, and the recipe floor invariant.

## Findings by severity

- Critical: none
- Major: none
- Minor: none
- Nit: 2 (listed above — cosmetic, no action required)
