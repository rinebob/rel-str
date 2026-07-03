# Split-Adjusted Data Issue in Weekly/Monthly Charts

## Status
Open — to be investigated in the next session.

## Symptom
Weekly and monthly charts show long, unadjusted bars on some symbols. Daily charts for the same symbol look correct. Examples observed:

- GOOG (weekly/monthly) — large gap/down bar in 2022
- ANET (weekly/monthly) — long bars in 2023/2024
- XLK (weekly/monthly) — long bars in late 2022
- WDC (weekly/monthly) — large spike in Sep 2020

Screenshots attached to the Jul 3 2026 session.

## Affected UI
- Agent Review single-pane chart (`signal-detail.component.ts`)
- Switching to **W** or **M** interval reveals the long bars
- Switching to **D** interval shows normal candles

## Data Flow
- Agent Review reads from `rs-bars/{symbol}` via `RhAgentChartService.loadBars$()`.
- The `rs-bars` doc stores `daily`, `weekly`, and `monthly` arrays separately.
- The frontend passes the requested interval array directly to the chart.

## Hypothesis
The `rs-bars` nightly sync writes weekly/monthly bars that are **not split-adjusted**, or it aggregates them from unadjusted daily bars. Since daily charts appear normal, the daily array is likely adjusted, but the weekly/monthly arrays are not.

## Finding
- **GOOG** — confirmed upstream SavantAPI data issue. The weekly/monthly bars returned by SA are not split-adjusted. Fix needs to come from SA; not a frontend or `rs-bars` sync bug.

## Files to Inspect
- Backend: `functions/src/rh-agent-cloud-function/rs-bars-sync.ts` (or wherever the nightly sync writes weekly/monthly bars)
- Frontend: `src/app/features/rh-agent/services/rh-agent-chart.service.ts`
- Data source: `rs-bars/{symbol}` Firestore docs

## Next Steps
1. Pull an `rs-bars` doc for one affected symbol (e.g., GOOG) and compare the daily, weekly, and monthly OHLC values around a split date.
2. Determine if the daily array is split-adjusted while weekly/monthly are not.
3. If only weekly/monthly are unadjusted, fix the sync to regenerate them from adjusted daily bars.
4. If the daily array is also unadjusted, fix the upstream data source / adjustment logic.
5. Rebuild and re-test the same symbols in Agent Review single-pane W and M modes.

## Notes
- Agent Review single-pane daily-bar bug was fixed in the same session (`signal-detail.component.ts` + template). The split-adjustment issue is separate.
- Commit this work with the commit skill in the next session.
