**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #261  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1679  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — #1679 FE: IBS gate in `detectZoneUptickDots` + suppressed-marker partition

**Verdict: PASS** — automated acceptance green (128/128 touched suites +
60/60 consumer suites, `tsc` clean); the visual journey below is the
dev-server eyeball pass per prior indicator Threads.

## Getting to the feature

- **Route:** `/dev/flex-chart` (auth-guarded dev sandbox — `AppRoutes.FLEX_CHART_SANDBOX`)
- **Entry point:** run `npm start`, sign in, navigate directly to `http://localhost:4200/dev/flex-chart`
- **Surface:** the FlexChart Sandbox page — Real data mode, **2D interval** (the only surface in the app that runs client-side `detectZoneUptickDots`; D/W dots are backend markers — #1680 supplies their partition)
- **Controls:** the `ST indicators` picker (header, right side) toggles `ST Trend Rider V1`/`V2`; when enabled, a params strip appears below the header titled `ST Trend Rider V1 dots (2D only)` / `ST Trend Rider V2 dots (2D only)` with a **Show Suppressed Signals** checkbox and an **IBS Threshold** number field.

## Scenarios

| # | Scenario | Steps | Expected | Result |
|---|---|---|---|---|
| S1 | Params strip presence | Enable `ST Trend Rider V1` in the picker | `ST Trend Rider V1 dots (2D only)` strip appears with Show Suppressed Signals (unchecked) + IBS Threshold (0.5); disabling the option removes the strip | ✅ automated — spec asserts strip follows enable state |
| S2 | Ghost dots on 2D | Real mode, symbol **SPY**, click **2D**, check **Show Suppressed Signals** | Dimmed ghost dots appear at IBS-rejected candidates alongside solid dots — same x/y placement, ~35% alpha in the same hue family | ✅ seam spec'd (ghost series id + remapped color + placement identity); eyeball on dev server |
| S3 | Toggle off | Uncheck **Show Suppressed Signals** | Ghost series disappears; emitted dots unchanged | ✅ spec'd |
| S4 | Threshold live change | Set **IBS Threshold** to `0.7` | Suppression set changes on next render — more candidates suppressed at higher T | ✅ spec'd (0.7 reaches the detection call; '2' clamps to 1) |
| S5 | V2 parity | Same journey on `ST Trend Rider V2` | Independent strip + ghost series under `st-zone-v2-uptick-dots-default-suppressed` | ✅ spec'd (V1+V2 suppressed series coexist) |
| S6 | D/W unchanged | Switch to **D** or **W** | Dots render exactly as before — no ghosts (BE `dotMarkers` are the ungated candidate view; #1680 partitions them) | ✅ by construction — suppressed fields only populated on TWO_DAY |
| S7 | Gate semantics | — | Long emits iff `ibs ≥ T` inclusive; short iff `ibs ≤ 1−T` (EPSILON guard); undefined IBS (developing bar pre-noon ET) emits; suppressed candidate consumes the state's only shot (no double-fire) | ✅ 13 detection specs incl. boundaries, pass-through, FIRED-consumption, non-finite guard |
| S8 | Persistence | Set threshold `0.6` + toggle on, reload the page | Both restore from the `paramOverrides` blob; Reset restores defaults | ✅ generic overrides machinery (pre-existing suite) + sanitized keys |

## Notes

- **Where ghosts can appear:** only on the sandbox 2D interval. Prod surfaces (signal-detail, quick-charts, gallery/position-card) consume backend `dotMarkers`, which are deliberately the ungated candidate view — the BE can't compute IBS on its zero-OHLC shim. #1680 supplies the D/W partition; `ChartExtras.uptickDotsV{1,2}Suppressed` + `addSuppressedDots` are already the machinery to receive it.
- **Suppression-rate sanity (#1678 baseline, daily):** SPY D-V1 suppressed 21.6%, D-V2 38.5%, W-V1 15.4%, W-V2 33.3% at T=0.5 — expect a comparable share of ghost dots on the 2D chart.
- **Threshold ≠ BE truth:** the field is display-eval; the backend emits at `StrategyConfig.ibsThreshold` (0.5). Divergent values are a dev aid, not a signal change.
