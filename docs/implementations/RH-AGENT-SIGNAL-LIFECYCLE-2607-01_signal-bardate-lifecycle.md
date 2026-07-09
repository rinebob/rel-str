# RH Agent Signal Lifecycle and barDate Conventions

## Context

This document defines how `barDate` is assigned to signals and how the signal lifecycle (interim vs. historical) interacts with the RH Agent run model. The SA partner will supply a `barStatus` property on each bar (`-1`, `0`, or `1`), which is the authoritative source for whether a bar is interim or end-of-period. These decisions are orthogonal to timezone handling but are referenced by the PT timezone standardization PRD.

## Related Documents

- `RH-AGENT-TIMEZONE-2607-01_pt-timezone-standardization.md` — defines `marketDate`, `runDate`, `runId`, and the PT display layer.
- `RH-AGENT-USER-WORKFLOW-2607-01_daily-signal-review.md` — user workflow for signal review, order confirmation, and daily startup cleanup.
- `RH-AGENT-SIGNAL-PERSISTENCE-PLAN.md` — original plan for run-centric vs. date-centric signal storage.
- `RH-AGENT-RUNIDS-2607-01_run-ids-storage-evaluation.md` — evaluation of run-id storage models.
- `RH-AGENT-SYMBOL-ONBOARDING-2607-01_symbol-onboarding.md` — trigger sources and signal persistence behavior per trigger.

## Definitions

| Term | Meaning | Example |
|---|---|---|
| `marketDate` | The trading date of the run. | `2026-07-06` |
| `barDate` | The date of the bar a signal belongs to. | `2026-07-06` (interim) or `2026-07-10` (weekly finalized) |
| `barStatus` | SA-provided bar status. `-1` = opening tick, `0` = interim, `1` = end-of-period/closing. | `1` |
| `signal-history/{barDate}` | Canonical, period-end signals persisted by the nightly run. | `rh-agent-symbols/{symbol}/signal-history/2026-07-06` |
| `run-ids/{runId}` | Transient signals for the latest run. | `rh-agent-symbols/{symbol}/run-ids/2026-07-06_mon_092300_pdr` |
| `run-ids/{runId}` (symbol-added) | Transient signals for a one-symbol onboarding run. | `rh-agent-symbols/{symbol}/run-ids/2026-07-08_tue_143022_symbol-added_CIEN` |

## Signal Lifecycle

### Interim Signals

Interim signals are generated from bars with `barStatus = 0`. They are transient and are overwritten by the next run.

- `barDate` = `marketDate` (the current trading date).
- No projection of future period-end dates.
- Written only to `run-ids/{runId}` (the "latest" collection).
- Status is `INTERIM`.

Examples:
- A PDR run at 9:23 AM PT on July 6 receives `barStatus = 0` for daily bars. Weekly/monthly attributes are not yet present on PRE PDRs, so RS ignores W/M signals during PRE for now.
- A nightly run at 6:00 PM PT on July 6 receives `barStatus = 1` for daily bars but `barStatus = 0` for weekly/monthly bars. It generates daily historical signals and weekly/monthly interim signals.

### Historical Signals

Historical signals are generated from bars with `barStatus = 1`. Only end-of-period bars produce historical signals.

- `barDate` = the actual period-end date:
  - Daily: `barDate` = `marketDate`.
  - Weekly: `barDate` = the Friday of the week (or last trading day of the week).
  - Monthly: `barDate` = the last trading day of the month.
- Written to `signal-history/{barDate}`.
- Status is `CONFIRMED`.

Examples:
- A nightly run on July 6 receives `barStatus = 1` for daily bars and persists daily signals with `barDate = 2026-07-06`.
- A nightly run on Friday July 10 receives `barStatus = 1` for weekly bars and persists weekly signals with `barDate = 2026-07-10`.
- A nightly run on July 31 receives `barStatus = 1` for monthly bars and persists monthly signals with `barDate = 2026-07-31`.

### Transition from Interim to Historical

Interim signals are never promoted. They are discarded as new runs overwrite `run-ids/{runId}`. When an end-of-period bar arrives (`barStatus = 1`), the run creates new historical signals directly in `signal-history/{barDate}`. The `barStatus` from the partner is the authoritative trigger for this transition.

## barDate Rules

### Rule 1: `barStatus` is the authority

The SA partner supplies `barStatus` on each bar. We do not compute or guess whether a bar is end-of-period. `barStatus = 1` means end-of-period; anything else means interim.

### Rule 2: Interim signals use `barDate = marketDate`

For `barStatus = 0` bars, signals use `barDate = marketDate`. No projection of future period-end dates.

### Rule 3: Historical signals use the actual period-end date

For `barStatus = 1` bars, signals use the actual period-end date as `barDate`. This is determined by the partner data or the calendar, not by us.

### Rule 4: Daily signals are always the same

For daily bars, `barDate` always equals `marketDate`, whether interim or historical, because the period is one trading day.

### Rule 5: Weekly/monthly signals differ only when historical

For weekly/monthly bars, `barDate` equals `marketDate` while interim (`barStatus = 0`), and equals the period-end date when historical (`barStatus = 1`).

## Chart Display

The chart should render bars with the **current market date** as the label for the trailing/current bar, and the actual period-end date for finalized historical bars:

- **Daily bars:** label = `barDate` (which always equals `marketDate`).
- **Weekly bars:** current/trailing bar label = `marketDate`; finalized historical bars label = the week’s period-end date (`barDate`).
- **Monthly bars:** current/trailing bar label = `marketDate`; finalized historical bars label = the month’s last trading day (`barDate`).

This avoids projecting future period-end dates for the in-progress bar. The label simply reflects the trading date on which the bar was last updated.

Signal hover tooltips should show `marketDate` for interim signals (which is the run trading date) and `barDate` for historical signals.

## Storage Model

### `run-ids/{runId}` (latest collection)

- Contains the latest run’s signals for quick inspection.
- Includes both interim (`barStatus = 0`) and end-of-period (`barStatus = 1`) signals from that run.
- For `barStatus = 0` entries, `barDate` = `marketDate`.
- For `barStatus = 1` entries, `barDate` = actual period-end date.
- Older run signals are not retained for grouped inspection.

### `signal-history/{barDate}` (canonical history)

- Contains only finalized period-end signals (`barStatus = 1`).
- `barDate` = actual period-end date.
- Used for per-symbol historical lookup.
- Interim signals are never written here.
- `symbol-added` runs do not write here; they only write to `run-ids/{runId}` because they are not nightly EOD runs.

## Decisions

1. **`barStatus` from the partner is the authority.** We do not compute end-of-period ourselves.
2. **Interim `barDate` = `marketDate`.** Do not project future period-end dates.
3. **Historical `barDate` = actual period-end date.** Compute this at persistence time from the `barStatus = 1` bar.
4. **Only `barStatus = 1` signals are persisted to `signal-history`.** Interim signals stay in `run-ids` only.
5. **Ignore W/M signals on PRE runs until SA adds `barStatusWeekly`/`barStatusMonthly` attributes.** Code should be flexible to adopt W/M PRE signals when SA implements them.
6. **Run list shows only the latest run.** Older run signals are accessed via `signal-history` per symbol.
7. **Daily startup workflow (clearing leftover reviews/orders, confirmation steps) is out of scope for this document.** It should be defined in a separate user-workflow planning doc.

## Answered Questions

1. **How do we handle `barStatus = -1` (opening tick) bars?** Treat `-1` the same as `0` for signal persistence and display purposes — both are interim. The only difference is diagnostic (first tick of period vs. subsequent interim tick).
2. **How does the chart determine the period-end date for the current weekly/monthly bar before it is finalized?** It does not. The current/trailing interim bar is always labeled with `marketDate` (which equals `barDate` for interim bars). We never project future period-end dates.
3. **Should the dashboard show both interim and historical signals for a symbol, or only the latest interim?**
   - **Run explorer / grouped review left panel headers:** show only the current (latest interim) signals.
   - **Expanded symbol panel in grouped review:** show the recent signal history for that symbol.
   - **Charts:** always show historical signals, with the current/trailing bar labeled by `marketDate`.

## Next Steps

1. Update `rh-agent-signal-persister.ts` to read `barStatus` and apply the barDate rules.
2. Update the chart service to use the correct bar dates for each timeframe and to distinguish interim vs. end-of-period bars.
3. Verify `signal-history` is only populated from `barStatus = 1` bars.
4. Verify `run-ids` can hold both interim and end-of-period signals from the latest run.
