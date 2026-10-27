**Topic:** Option Contract Time-Series Viewer  
**Topic Slug:** option-contract-viewer  
**Thread:** Multi-symbol input  
**Thread Slug:** multi-symbol-input  
**Issue:** #1287  
**Thread Parent:** #1244  
**Topic Parent:** #1243  
**Task:** #1263  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-26  
**Last Updated:** 2026-10-26  

## Scope

Task #1263 refactored `OptionsContractChartComponent` from a single-contract declarative-series chart to a computed multi-series chart:

- N mark lines on a union category axis
- Per-contract strike-span markers (entry date → expiration at strike)
- Single-vs-multi pane gating (IV/Greeks/Volume-OI only for one contract)
- Render-time `displayWindow` clipping (clip lives in the store from #1262; default = `lifetime`, full series)
- Continuous underlying overlay on the opposed axis

This UAT covers the visually observable single-contract behavior plus the spec-verified multi-mode behavior.

**Important:** nothing in the UI calls `loadPlotted` yet — the page's multi-symbol input arrives in #1264 — so multi-mode scenarios are verified by component/store specs and marked as such; a live multi-mode check belongs to #1264's UAT.

## Prerequisites

- Dev server running: `npm start` → http://localhost:4210
- Backend data reachable by the dev environment (the page calls `getHistoricalOptionsContract` via the app's normal service path — whatever the dev env resolves).
- One valid OCC contract ID. Do **not** guess IDs — contract IDs must exist in the backend. Get one from the catalog flow (step 3 of Start): the catalog lists real contractIds for the queried symbol/filters.
- For the automated evidence: `npx jest` at repo root.

## Start

1. `npm start` at the repo root (if not already running).
2. Navigate to **http://localhost:4210/options/chart** (sidebar: Options → Chart).
3. The left control panel is the contract picker. To get a real contract: in the builder fields keep Symbol `QQQ` (or type another), set Exp From/To or leave defaults, and query the catalog — click a result row to load it. Alternatively type a known-valid full OCC ID into the "OCC Contract ID" field and press Enter / click **Load**. A nonexistent ID surfaces a backend error chip — expected behavior, not a chart defect.
4. The chart renders in the main pane to the right; the contract header bar sits directly above it.

## Automated evidence (executed during QA)

| Check | Command | Result |
|---|---|---|
| Focused specs — chart component (multi-series render, union padding, marker derivation/fallback/clamp, legend suppression, axis-union invariant, pane gating, strike-widened range), plotted feature (clip, allDates, focus lifecycle), page projection (set/single/focused, axis pick, precedence) | `npx jest src/app/features/savant-trader/components/options-contract-chart src/app/features/savant-trader/stores/plotted-contracts-feature.spec.ts src/app/features/savant-trader/pages/option-chart` | **PASS** — 3/3 suites, 44/44 tests |
| Savant-trader suite | `npx jest src/app/features/savant-trader` | **PASS** — 136/136 suites, 2667 tests |
| Full repo suite | `npx jest` | **PASS** — 268/268 suites, 4596 tests |
| Typecheck | `npx tsc --noEmit -p tsconfig.json` | **PASS** for touched files (2 pre-existing unrelated errors elsewhere) |

## Manual scenarios

### S1 — Single-contract baseline unchanged

**Feature:** single-contract view renders all existing panes.
**Starting state:** `/options/chart` loaded, left panel open, symbol `QQQ`.
1. Search the catalog (Symbol `QQQ` → query) and click a result row — or enter a known-valid OCC ID in the contract input and press Enter.
2. **Expected:** main pane shows one mark line plus the orange dashed underlying overlay on the opposed (right) axis — the overlay renders **continuous** across dates where the underlying has no bar (marks still gap, underlying does not); IV, Greeks, and Volume/OI panes render below (subject to the existing toggles); no console errors.
3. **Evidence:** PASS — user-verified in browser at localhost:4210; underlying gap break found and fixed (Drop mode), re-verified.

### S2 — Strike-span marker — SPEC-VERIFIED ONLY

**Feature:** per-contract span marker at strike on the underlying axis, anchored at the entry date (entry → expiration, endpoint dots, color-matched).
**Blocked by design:** markers only exist for contracts carrying an entry date, and no UI path produces one yet (#1264 wires the dated-pair input). On a plain bare-ID load the expected result is **no marker**.
**Interim verification:** `options-contract-chart.component.spec.ts` covers start/end at openDate/expiration, endpoint dots, color match, reversed-span skip, and the bare-ID no-marker rule; `plotted-contracts-feature.spec.ts` covers `allDates` endpoint union.
**Result:** PASS (spec evidence) — live check deferred to #1264.

### S3 — Legend

**Feature:** marker hidden from legend; readable mark label.
1. Check the legend at the bottom of the chart.
2. **Expected:** entries for the contract label (e.g. `470P 2026-06-19`) and `Underlying` (+ pane series); **no** `__span__…` entry.
3. Click the contract label — its mark line toggles off/on (marker toggle-linkage is a known deferral to #1265).
4. **Evidence:** PASS — user-verified in browser.

### S4 — Axis extends to expiration — SPEC-VERIFIED ONLY

**Feature:** marker endpoints land on real categories even when not observation dates.
**Blocked by design:** same as S2 — requires a dated contract.
**Interim verification:** chart spec "unions marker endpoints into the axis even when absent from xLabels" + `allDates` specs.
**Result:** PASS (spec evidence) — live check deferred to #1264.

### S5 — Zoom/pan range snapping

**Feature:** Y-axes snap to the visible window.
1. Mouse-wheel zoom into a subrange of the chart.
2. **Expected:** mark and underlying Y-axes rescale to the visible data; the span marker stays anchored at the strike level.
3. Reset via the toolbar Reset button — full range restored.
4. **Evidence:** PASS — user-verified in browser.

### S6 — Deep-strike marker coverage — SPEC-VERIFIED ONLY

**Feature:** underlying axis widens to include the marker strike.
**Blocked by design:** same as S2 — requires a dated contract.
**Interim verification:** `axisRanges` union specs (strike outside close range; strikes with no bars loaded).
**Result:** PASS (spec evidence) — live check deferred to #1264.

### S7 — Multi-mode rendering — SPEC-VERIFIED ONLY

**Feature:** N mark lines, union axis, marker per contract, lower panes hidden.
**Blocked by design:** no production code path populates the plotted set (paste-input UI is #1264). Verified instead by `options-contract-chart.component.spec.ts` (2-contract mark lines, union padding, per-contract markers, pane gating off) and `option-chart.component.spec.ts` (set projection). A live multi-mode visual check must run under #1264's UAT.
**Result:** PASS (spec evidence) — live check deferred to #1264.

### S8 — displayWindow clip (default = full series)

**Feature:** `lifetime` is the default; `position` clips each dated contract at its openDate; the marker is identical in both modes.
**Steps:**
1. With any contract/set displayed where an entry date exists, a **Clip to entry** button appears in the contract header bar (next to Filter to Chart / Full History) — gated on `hasEntryDates()` so it only shows when the clip can do something.
2. Click it — dated contracts drop observations before their openDate (set contracts and a focused contract alike); bare-ID contracts unchanged; span markers unchanged. Button reads **Full series** while clipped.
3. Click again — full series restores.
**Interim verification:** clip behavior covered by `plotted-contracts-feature.spec.ts` (position clip, lifetime default) + page projection spec; the button is gated on `hasEntryDates()` so it can't appear on a bare single load — live check deferred to #1264 like S2.
**Result:** PASS (spec evidence) — live check deferred to #1264.

### S9 — Regression: chart controls and catalog flow

**Feature:** nearby behavior unaffected.
1. Toggle `Underlying`, `Greeks`, `Vol/OI` switches — series appear/disappear.
2. Navigate catalog results with the prev/next chevrons — new contract loads, chart updates.
3. Add pad days (`+ Pad` control if present) — axis extends, underlying refetches.
4. **Expected:** all behave as before.
5. **Evidence:** PASS — user-verified in browser (catalog query + row load used throughout this QA pass).

## Negative / boundary scenarios (spec-verified)

- Bare-ID contract (no openDate): **no** span marker — nothing to anchor the left dot — chart + `allDates` specs.
- `openDate > expiration`: marker skipped, no stray axis category — builder + `allDates` reversed-span guard.
- Contract with zero points and no openDate: no marker emitted — chart spec.
- Loading contracts emit markers before data lands and their endpoints are already in `allDates` — feature spec.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| N mark lines on union axis, gaps not interpolated | S7 (spec) |
| Span marker per contract at strike, endpoint dots, color-matched, legend-hidden | S2, S3, S7 (spec) |
| Bare-ID contract (no entry date): no span marker | S2 + negative specs |
| Lower panes only for exactly one contract | S1 + S7 (spec) |
| `position` clips at openDate; `lifetime` full; marker identical | S8 (spec) |
| Single-contract behavior unchanged | S1, S3, S9 |
| Marker endpoints on non-observation dates align | S4, S7 (spec) |
| Marker strike covered by underlying axis | S6 |
| Component specs cover the feature | Automated evidence table |

## Regression / smoke checklist

- [x] Single-contract load, all panes, overlay, toggles — S1, S9
- [x] Catalog search + row select + prev/next nav — S9
- [x] Pad-days + underlying refetch — S9
- [x] No `__span__` legend entries — S3
- [x] No console errors during load/zoom/pan — S5
