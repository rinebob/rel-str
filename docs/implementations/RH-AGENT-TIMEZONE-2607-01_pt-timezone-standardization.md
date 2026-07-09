# RH-AGENT-TIMEZONE-2607-01 — PT Timezone Standardization

## Status

Implementation complete. All phases implemented; documentation updated 2026-07-08 to reflect the `common/` extraction and the `symbol-added` trigger.

## Created

2026-07-06

## Last updated

2026-07-08

## Related

- `RH-AGENT-THERMO-2607-01_rh-agent-thermonuclear-review-remediation.md`
- `RH-AGENT-SIGNAL-PERSISTENCE-PLAN.md`
- `RH-AGENT-RUNIDS-2607-01_run-ids-storage-evaluation.md`
- `RS-BARS-STORAGE-2607-01_rs-bars-schema-evaluation.md`
- `RH-AGENT-SYMBOL-ONBOARDING-2607-01_symbol-onboarding.md`

## Problem Statement

The RH Agent and symbol-data-sync subsystems use inconsistent timezone handling for market dates, run IDs, and chart rendering. The primary bug is the widespread use of `new Date().toISOString().slice(0, 10)` and similar patterns, which return **UTC date** instead of the user's local **Pacific Time (PT)** date. Because the user is the sole operator and is in PT, every user-facing date and identifier must be rendered in PT.

### Concrete symptoms

1. **symbol-data-sync-runs has the wrong date in its run ID.**
   - Example: `syncRunId = "2026-07-07_1783386009228"` for a run that started at 6:00 PM PT on July 6.
   - The `marketDate` field is also `2026-07-07`, which propagates into the nightly RH Agent run.

2. **Chart interim/partial bars render with the wrong date.**
   - Example: at 9:38 PM PT on July 6, charts show a partial bar dated `2026-07-07` for all symbols and timeframes.
   - The nightly EOD bar for July 6 is already present, but the frontend thinks "today" is July 7 and injects a second, synthetic bar for July 7.

3. **Run IDs are inconsistent across collections.**
   - `rh-agent-runs` uses `2026-07-06_mon_092300` (PT-based, includes day-of-week and time).
   - `symbol-data-sync-runs` uses `2026-07-07_1783386009228` (UTC-based, meaningless epoch suffix).

4. **Dashboard schedule string was misleading.**
   - The UI showed "Schedule: 12 PM PT, Monday-Friday" but the actual Cloud Scheduler is at 6 PM PT Mon-Fri. Fixed by updating the fallback cron to `0 1 * * 2-6` and deriving the display string from the `rhAgentGetStatus` response.

5. **Signal bar dates can drift from the intended market date.**
   - Because the nightly run receives a UTC-derived `marketDate`, signals and partial bars can be stamped with the next calendar day.

## Guiding Principle

Separate the **source of truth for logic** from the **user-facing display layer**.

| Concern | Source of Truth | Display Layer |
|---|---|---|
| Server timestamps (`startedAt`, `completedAt`, Pub/Sub publish time) | UTC | Format to PT |
| Cron schedules | UTC (Cloud Scheduler requirement) | Convert to PT |
| Market date / run ID | A stable, normalized calendar string | Render and generate in PT |
| Bar dates | Calendar strings from the data provider | Interpret and display in PT |

> **Rule of thumb:** if a human reads it, it is PT. The underlying storage and logic can be UTC or a normalized calendar string, but the user never sees raw UTC dates or meaningless epoch suffixes.

### Why this matters

The user is the sole operator and is located in PT. The run list, chart labels, signal bar dates, and schedule text are all user-facing surfaces, so they must be PT. The system’s internal logic (ordering runs, comparing timestamps, cron parsing) may use UTC for correctness, but the user-facing layer always converts to PT before rendering.

## Definitions

| Term | Meaning | Source of Truth | Display Layer | Example |
|---|---|---|---|---|
| `marketDate` | The **trading date** of the data being processed or the signal being generated. This is the date the market activity actually took place. | Normalized calendar string `YYYY-MM-DD`. For our runs, generated from PT. For partner messages, accepted from the partner and normalized. | Rendered in PT. | `2026-07-06` |
| `runDate` | The **calendar date on which the agent run occurred**. Usually the same as `marketDate`, but conceptually distinct. | Derived from the run start time in PT, or parsed from the `runId` date portion. | Rendered in PT. | `2026-07-06` |
| `runId` / `syncRunId` | Stable string identifier for a run. Encodes the `runDate`, PT time of day, day-of-week, and trigger. | Generated from PT run time + trigger. | Read directly; always PT. | `2026-07-06_mon_092300_pdr` |
| `barDate` | Calendar string of the bar a signal belongs to. For **interim signals**, `barDate` = `marketDate`. For **historical signals**, `barDate` = the actual period-end date. See the signal lifecycle doc for full rules. | Calendar string. | Displayed in PT. | `2026-07-06` (interim) or `2026-07-10` (weekly finalized) |
| `startedAt` / `completedAt` | Firestore server timestamps. | Always UTC. | Formatted to PT. | `2026-07-07T01:23:45Z` |
| `schedule` | Cron expression. | Always UTC. | Converted to PT description. | `0 1 * * 2-6` → "6:00 PM PT, Monday-Friday" |

### Key distinction

- **`marketDate`** = "What trading day is this data/signal for?"
- **`runDate`** = "On what day did the agent run?"
- **`runId`** = "The exact run, including its date, time, and trigger."

For the nightly sync at 6:00 PM PT on July 6, `marketDate` = `2026-07-06` and `runDate` = `2026-07-06`. The `runId` is `2026-07-06_mon_180009_nightly`.

For a PDR run at 9:23 AM PT on July 6, `marketDate` = `2026-07-06` and `runDate` = `2026-07-06`. The `runId` is `2026-07-06_mon_092300_pdr`.

The bug we are fixing is that the code was deriving `marketDate` from the run timestamp (UTC), causing `marketDate` to become `2026-07-07` even though the trading data was for July 6.

## Current State

### Backend: places that compute "today" or market date

| File | Function / Line | Current behavior | Impact |
|---|---|---|---|
| `functions/src/symbol-data-sync/symbol-data-sync.ts` | `todayIso()` at line 120 | UTC date | Wrong `marketDate` (trading date) and `runDate` (run occurrence date) |
| `functions/src/symbol-data-sync/symbol-data-sync.ts` | `enqueueAllSymbols()` at line 167 | Builds `syncRunId` from UTC date + `Date.now()` | Run ID is based on wrong date and has meaningless epoch suffix |
| `functions/src/symbol-data-sync/symbol-data-sync.ts` | `toDate` in `syncSymbolToSymbolData()` at line 235 | UTC date | Bars may be fetched up to wrong trading date |
| `functions/src/common/pt-date-utils.ts` | `getMarketDatePT()` | PT date | Correct; used by both RH Agent and symbol-data-sync |
| `functions/src/common/pt-date-utils.ts` | `getRunIdPT(runDate, trigger)` | Uses PT time for suffix, PT date from caller | Correct for all RH Agent runs and sync run IDs |
| `functions/src/common/rh-agent-run-creation.ts` | `createDailyRun()` | Creates run doc with PT `runDate` and run ID | Correct; accepts explicit `runDate` from callers |
| `functions/src/rh-agent-cloud-function/rh-agent-data-loader.ts` | `verifyDataFreshness()` at line 154 | Compares `barDate` to `marketDate` | Works if `marketDate` is correct |
| `functions/src/rh-agent-cloud-function/rh-agent-signal-persister.ts` | `createSignalEntry()` at line 81 | Uses `marketDate` for signal date | Wrong if `marketDate` is UTC |
| `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts` | PDR trigger at line 67 | Uses `payload.marketDate` from partner | Must be validated/converted to PT |

### Frontend: places that compute "today"

| File | Function / Line | Current behavior | Impact |
|---|---|---|---|
| `src/app/features/rh-agent/services/rh-agent-chart.service.ts` | `todayIso()` at line 63 | UTC date | Injects partial bars for wrong date |
| `src/app/features/rh-agent/services/rh-agent-chart.service.ts` | `needsIntradayFetchFromResult()` at line 209 | Compares last bar to UTC "today" | Always thinks EOD bar is stale after 5 PM PT |
| `src/app/features/rh-agent/pages/agent-review/rh-agent-review.component.ts` | Uses UTC date | UTC date | Review page may load wrong date |
| `src/app/features/rh-agent/stores/rh-agent-dashboard.store.ts` | Uses UTC date | UTC date | Dashboard filters may be off |
| `src/app/features/rh-agent/stores/rh-agent-triage.store.ts` | Uses UTC date | UTC date | Triage date persistence may be off |
| `src/app/features/rh-agent/utils/rh-agent-chart-indicators.ts` | Uses UTC date | UTC date | Indicator calculation may be off |
| `src/app/features/rh-agent/utils/rh-agent.utils.ts` | `todayDate()` at line 11 | PT date | Correct, but not used by chart service |
| `src/app/features/rh-agent/utils/rh-agent.utils.ts` | `getScheduleDescription()` at line 101 | Converts UTC cron to PT | Correct, but dashboard uses hardcoded fallback |

### Existing correct utilities

- **Backend:** `getMarketDatePT()` in `functions/src/common/pt-date-utils.ts` returns `YYYY-MM-DD` in PT.
- **Frontend:** `todayDate()` in `src/app/features/rh-agent/utils/rh-agent.utils.ts` already returns `YYYY-MM-DD` in PT.
- **Frontend:** `getScheduleDescription()` already converts a UTC cron expression to a PT display string.

The problem is not a lack of utilities; it is inconsistent use of them and scattered copy-pasted UTC-date code.

## Proposed Changes

### 1. Shared PT date helpers

#### Backend

Create a dedicated `functions/src/common/pt-date-utils.ts` with:

```typescript
export function getMarketDatePT(now?: Date): string;
export function getRunDatePT(now?: Date): string;
export function getRunIdPT(runDate: string, trigger: RhAgentTriggeredBy, now?: Date): string;
export function formatTimestampPT(ts: Date | { toDate(): Date } | string): string;
export function isValidMarketDate(dateStr: string): boolean;
export function normalizeMarketDate(dateStr: string, fallback?: string): string;
```

This module lives in `functions/src/common/` so both `rh-agent-cloud-function` and `symbol-data-sync` can import it without creating a cross-module dependency.

- `getMarketDatePT()` returns the PT **trading date** (`YYYY-MM-DD`) for runs generated by our system. For a run at 6:00 PM PT on July 6, this returns `2026-07-06`.
- `getRunDatePT()` returns the PT **calendar date** (`YYYY-MM-DD`) on which the run is occurring. For most runs this equals `getMarketDatePT()`, but it is exposed separately so the distinction is explicit in the code.
- `getRunIdPT(runDate, trigger)` returns `YYYY-MM-DD_dow_HHMMSS_trigger`, using the run date.
- `formatTimestampPT()` converts a UTC timestamp to a PT display string.
- `normalizeMarketDate()` accepts a partner date string and returns a stable calendar string representing the trading date. If the partner string is ambiguous, treat it as PT because the user is the PT operator.
- `isValidMarketDate()` guards against clearly invalid strings.

#### Frontend

Promote `todayDate()` and `getScheduleDescription()` from `rh-agent.utils.ts` into a dedicated service or shared utility, and add:

```typescript
export function todayDate(): string;           // already exists
export function yesterdayDate(): string;
export function formatTimestampPT(ts: Date | Timestamp | string): string;
export function getScheduleDescription(cron: string): string; // already exists
```

Deprecate and remove all inline `new Date().toISOString().slice(0, 10)` helpers.

### 2. Conversion layer

Every user-facing surface must route through the PT conversion layer. No component should call `new Date().toISOString()` or `toDate()` directly to produce a display string.

Backend conversion layer:
- `getMarketDatePT()` — returns the PT **trading date** for data/signals generated by our system.
- `getRunDatePT()` — returns the PT **calendar date** on which the run is occurring.
- `getRunIdPT(runDate, trigger)` — generates a run ID from the PT run date/time + trigger.
- `formatTimestampPT(ts)` — UTC Firestore timestamp → PT display string.
- `normalizeMarketDate(dateStr)` — accept a partner date string and return a stable calendar string representing the trading date. If the partner string is ambiguous, treat it as PT because the user is the PT operator.
- `formatRunIdDisplay(runId)` — run ID is already PT, so this is identity; exists for clarity.

Frontend conversion layer:
- `todayDate()` — PT calendar date (used for "today" in the UI and for chart partial bars).
- `formatTimestampPT(ts)` — UTC/JS timestamp → PT display string.
- `getScheduleDescription(cron)` — UTC cron → PT human-readable description.
- `formatMarketDate(dateStr)` — calendar string → PT display (mostly identity, but centralizes the convention).

> **All components read from this layer.** Direct `Date` manipulation for display is forbidden.

### 3. Standardize run ID format

All run identifiers across both collections use the same format:

```
YYYY-MM-DD_dow_HHMMSS_trigger
```

Examples:
- `2026-07-06_mon_092300_pdr`
- `2026-07-06_mon_180009_nightly`
- `2026-07-06_mon_101500_manual`
- `2026-07-08_tue_143022_symbol-added_CIEN`

Where:
- `YYYY-MM-DD` is the PT **run date**.
- `dow` is the three-letter lowercase day of week.
- `HHMMSS` is the PT time of run creation.
- `trigger` is one of `pdr`, `nightly`, `manual`, `symbol-added`.
- For `symbol-added`, the symbol is appended to the run ID to keep each one unique.

### 4. Backend changes

#### `functions/src/symbol-data-sync/symbol-data-sync.ts`

- Replace `todayIso()` with `getMarketDatePT()` for the **trading date** (`marketDate`) of the bars being synced.
- Compute `runDate` from `getRunDatePT()`.
- Replace `syncRunId = `${marketDate}_${Date.now()}`` with `getRunIdPT(runDate, 'nightly')`.
- Use `marketDate` for the `toDate` parameter in `syncSymbolToSymbolData()`.
- Pass `marketDate` and `runDate` into `startRhAgentRun()` so both are available in the run document and downstream workers.

#### `functions/src/common/rh-agent-run-creation.ts`

- `getMarketDate()` returns the PT **trading date** (`marketDate`).
- `getRunDatePT()` is the canonical helper for the **run occurrence date**.
- `createDailyRun()` uses `getRunIdPT(finalRunDate, triggeredBy)` and includes the trigger suffix.
- `createDailyRun()` accepts an explicit `runDate` parameter so callers (e.g., `symbol-added`) can ensure the run ID and run document use the same date.

#### `functions/src/symbol-data-sync/symbol-data-symbol-added.ts`

- Uses `getMarketDatePT()` for the trading date and `getRunDatePT()` for the run date.
- Builds the unique run ID as `${getRunIdPT(runDate, 'symbol-added')}_${symbol}`.
- Passes `runDate` explicitly into `createDailyRun()` to avoid a midnight-boundary race between the run ID and the run document.

#### `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts`

- When a PDR message arrives, treat `payload.marketDate` as the **trading date** and normalize it using `normalizeMarketDate()`.
- Compute `runDate` from `getRunDatePT()` (the current PT calendar date).
- Generate the run ID from `runDate`, not from `marketDate`.
- If the partner string is ambiguous, treat it as PT because the user is the PT operator.
- If the payload is missing or invalid, fall back to `getMarketDatePT()` for the trading date.
- Log both the original partner value and the normalized `marketDate` for debugging.

#### `functions/src/rh-agent-cloud-function/rh-agent-data-loader.ts`

- Use the normalized `marketDate` (the **trading date**) for trimming bars.
- Keep `verifyDataFreshness()` comparison string-based against `marketDate`.
- Convert any timestamp display to PT through `formatTimestampPT()`.

#### `functions/src/rh-agent-cloud-function/rh-agent-signal-persister.ts`

- Use the normalized `marketDate` (the **trading date**) for signal entries.
- Read `barStatus` from the partner-provided bar (`-1` = opening tick, `0` = interim, `1` = end-of-period). The partner owns this distinction; the code does not compute it. For signal persistence, `-1` and `0` are both treated as interim.
- Apply the `barDate` rules from the signal lifecycle doc: interim signals use `barDate = marketDate`; historical signals use the actual period-end date.
- `barDate` remains a calendar string; the display layer renders it in PT.

### 5. Frontend changes

#### `src/app/features/rh-agent/services/rh-agent-chart.service.ts`

- Replace `todayIso()` with `todayDate()` from `rh-agent.utils.ts`.
- Update `needsIntradayFetchFromResult()` to compare the last bar date to PT today.
- Ensure weekly/monthly synthesis keys (`isoWeekKey`, `monthKey`) operate on PT dates.
- Verify that `toPrice()` uses the correct date interpretation.

#### `src/app/features/rh-agent/pages/agent-review/rh-agent-review.component.ts`

- Replace inline UTC-date logic with `todayDate()`.

#### `src/app/features/rh-agent/stores/rh-agent-dashboard.store.ts`

- Replace inline UTC-date logic with `todayDate()`.

#### `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`

- Replace inline UTC-date logic with `todayDate()`.

#### `src/app/features/rh-agent/utils/rh-agent-chart-indicators.ts`

- Replace inline UTC-date logic with `todayDate()`.

#### `src/app/features/rh-agent/services/rh-agent-run.service.ts`

- Update `getScheduleDescription()` usage to use the shared utility.

#### Dashboard schedule display

- Remove the hardcoded `'0 20 * * 1-5'` fallback in `rhAgentGetStatus`.
- Read the actual schedule from a configuration document or derive it from the deployed Cloud Scheduler.
- Use `getScheduleDescription()` to render the human-readable PT schedule.

### 6. Configuration / schedule accuracy ✅

- The actual agent schedule is now written to the `rh-agent-status/current` document by `RunProgressTracker.checkRunCompletion()` on every run completion, using the shared `RH_AGENT_SCHEDULE_CRON` constant (`0 1 * * 2-6`).
- `rhAgentGetStatus` reads `schedule` from the status doc and falls back to the constant only when the field is absent (newly created doc or pre-existing doc before this change).
- The dashboard schedule chip now computes a prominent summary directly from the known nightly cron (`0 1 * * 2-6`) and the current PT time, showing the last run (with type) and the next PDR window and next nightly run. This avoids displaying any stale `schedule` value that may be sitting in `rh-agent-status/current`.
- The `schedule` field is still written into `rh-agent-status/current` on run completion for future use / external integrations, but the dashboard UI no longer depends on it for the primary schedule display.
- Other schedule surfaces to consider in the future:
  - Nightly symbol-data sync: 6:00 PM PT, Monday-Friday.
  - PDR windows: 8:00 AM, 10:00 AM, 12:00 PM PT (subject to partner message arrival).
  - Manual runs: on-demand.

## Affected Files

### Backend

- `functions/src/symbol-data-sync/symbol-data-sync.ts`
- `functions/src/rh-agent-cloud-function/rh-agent-shared.ts`
- `functions/src/rh-agent-cloud-function/rh-agent-date-utils.ts` (new)
- `functions/src/rh-agent-cloud-function/rh-agent-trigger.ts`
- `functions/src/rh-agent-cloud-function/rh-agent-data-loader.ts`
- `functions/src/rh-agent-cloud-function/rh-agent-signal-persister.ts`
- `functions/src/rh-agent-cloud-function/rh-agent-callables.ts`
- `functions/src/rh-agent-cloud-function/rh-agent-collections.ts` (schedule constant)
- `functions/src/rh-agent-cloud-function/rh-agent-run-progress.ts` (schedule write)

### Frontend

- `src/app/features/rh-agent/services/rh-agent-chart.service.ts`
- `src/app/features/rh-agent/services/rh-agent-run.service.ts`
- `src/app/features/rh-agent/services/rh-agent.types.ts` (schedule constant)
- `src/app/features/rh-agent/utils/rh-agent.utils.ts`
- `src/app/features/rh-agent/utils/rh-agent-chart-indicators.ts`
- `src/app/features/rh-agent/stores/rh-agent-dashboard.store.ts`
- `src/app/features/rh-agent/stores/rh-agent-triage.store.ts`
- `src/app/features/rh-agent/pages/agent-review/rh-agent-review.component.ts`
- `src/app/features/rh-agent/pages/agent-dashboard/rh-agent-dashboard.component.ts`
- `src/app/features/rh-agent/components/agent-status-bar/agent-status-bar.component.ts`
- `src/app/features/rh-agent/components/run-history-panel/run-history-panel.component.ts`
- `src/app/features/rh-agent/components/run-metrics-strip/run-metrics-strip.component.ts`
- `src/app/features/rh-agent/components/signal-table/signal-table.component.ts`

### Documentation

- This document.
- `docs/implementations/RH-AGENT-THERMO-2607-01_rh-agent-thermonuclear-review-remediation.md` should reference this task.
- `docs/planning/rh-agent/RH-AGENT-SIGNAL-PERSISTENCE-PLAN.md` should be updated if any date semantics change.

## Implementation Plan

### Phase 1 — Create shared utilities ✅

1. Create `functions/src/rh-agent-cloud-function/rh-agent-date-utils.ts` with PT helpers.
2. Update `rh-agent-shared.ts` to re-export or delegate to the new helpers.
3. Add comprehensive unit tests for PT helpers, including DST edge cases. (Tests written; user deferred running them.)

### Phase 2 — Fix backend run / sync identifiers ✅

1. Update `symbol-data-sync.ts` to compute both `marketDate` (trading date) and `runDate` (run occurrence date) in PT, and use `runDate` for the new `syncRunId` format.
2. Update `rh-agent-shared.ts` `generateRunId()` to use `runDate` and include the trigger suffix.
3. Update `rh-agent-trigger.ts` PDR handler to normalize partner-provided `marketDate` (trading date) and compute `runDate` separately for the run ID.
4. Update `rh-agent-callables.ts` manual run handler to accept the trading date override and compute `runDate` separately.

### Phase 3 — Fix signal and bar date handling ✅

1. Update `rh-agent-data-loader.ts` to use the normalized `marketDate` calendar string for trimming and freshness checks.
2. Update `rh-agent-signal-persister.ts` to use the normalized `marketDate` for signal entries.
3. Verify weekly signal confirmation logic (7-day offset) still works with calendar strings.

### Phase 4 — Fix frontend chart and stores ✅

1. Update `rh-agent-chart.service.ts` to use `todayDate()` and PT-aware comparisons. Added `toDatePt()` helper so chart x-axis Date objects render as the correct PT calendar date.
2. Update `rh-agent-dashboard.store.ts`, `rh-agent-triage.store.ts`, `rh-agent-review.component.ts`, and `rh-agent-chart-indicators.ts` to use shared PT helpers (`todayDate()`, `daysAgoPt()`, `toDatePt()`).
3. Update dashboard schedule display to use the actual schedule from `rhAgentGetStatus` and `getScheduleDescription()`; updated fallback cron to `0 1 * * 2-6` (6 PM PT Mon-Fri).

### Phase 5 — Verify and document

1. Run unit tests for new helpers.
2. Manually verify:
   - A sync run at 6 PM PT gets the correct PT date and run ID.
   - A manual run at 9 PM PT gets the correct PT date and run ID.
   - Charts after 5 PM PT do not inject a partial bar for the next day.
   - Dashboard schedule string matches the actual Cloud Scheduler.
3. Update relevant docs and close this task.

### Phase 6 — Schedule accuracy and UI ✅

1. Add a shared `RH_AGENT_SCHEDULE_CRON` constant in the backend and frontend.
2. Write the schedule cron into `rh-agent-status/current` on every run completion so `rhAgentGetStatus` has a canonical source.
3. Build PT scheduling helpers (`getNextPdrWindowPt`, `getNextNightlyPt`, `formatTimePt`) to compute the next run windows in the browser.
4. Make the dashboard schedule chip display a prominent summary of the last run (with type) and the next PDR and nightly runs, so users do not need to hover or infer the schedule.

## Migration and Backfill

- **Existing run documents:** do not rename or migrate. Old `rh-agent-runs` and `symbol-data-sync-runs` IDs remain as-is. New runs use the standardized format.
- **Existing signal docs:** do not backfill. The `marketDate` and `barDate` fields in existing docs reflect whatever was computed at the time. New writes will be correct.
- **symbol-data-sync-runs collection:** after the new format is stable, old docs can optionally be deleted or archived by a one-time admin script.

## Risks and Edge Cases

### Daylight Saving Time

- `America/Los_Angeles` includes DST transitions. The PT helpers must use `Intl.DateTimeFormat` with `timeZone: 'America/Los_Angeles'` so that the library handles DST correctly.
- The 6 PM PT nightly sync in winter is 2:00 UTC; in summer it is 1:00 UTC. The cron expression remains `0 1 * * 2-6` (summer) or equivalent; the code converts the trigger time to PT.

### Partner marketDate mismatch

- The PDR message may include a `marketDate` that is UTC, ET, or already PT.
- The normalization step must log the original value and the normalized value so we can detect partner-side drift.
- If the normalized date is a weekend or holiday, we still process it (per the user’s preference to rely on the provider for market-day logic), but we log it prominently.

### Cloud Scheduler cron

- Firebase Cloud Scheduler uses UTC. The deployed schedule must be expressed in UTC, and the code must convert the trigger time to PT.
- The dashboard display should show the PT equivalent, not the raw UTC cron.

### Existing manual `date` override

- `rhAgentManualRun` accepts a `date` override. The override is treated as the user’s intended **PT trading date** (`marketDate`). It is stored as a calendar string and displayed in PT. If a user passes a date that is invalid or outside normal trading, the function still runs (existing behavior), but the date is normalized and logged.

## Related Documents

- `RH-AGENT-SIGNAL-LIFECYCLE-2607-01_signal-bardate-lifecycle.md` — defines the `barDate` rules and signal lifecycle (interim vs. historical). This timezone PRD supports those rules but does not own them.

## Testing Strategy

- Unit tests for `getMarketDatePT()` (trading date) at specific times:
  - 9:00 AM PT → current PT date
  - 6:00 PM PT → current PT date (not UTC next day)
  - 11:30 PM PT → current PT date
  - During DST transition → correct PT date
- Unit tests for `getRunDatePT()` (run occurrence date):
  - Same as marketDate at 6:00 PM PT
  - Same as marketDate at 11:30 PM PT
- Unit tests for `getRunIdPT()`:
  - Correct format
  - Correct day-of-week
  - Correct trigger suffix
  - Uses `runDate`, not `marketDate`
- Unit tests for `normalizeMarketDate()`:
  - Valid PT date passes through
  - UTC date string converts to PT
  - Invalid string returns fallback
- Frontend tests for `rh-agent-chart.service.ts`:
  - Last bar date equal to PT today → no partial bar injected
  - Last bar date before PT today → partial bar injected for PT today
  - After 5 PM PT with EOD bar present → no July 7 partial bar

## Design Decision: Single User Timezone

The user asked whether a selectable timezone is natural and easy. The answer is that it is **another level of complexity** and is not warranted for this system. This is a single-user application operated by one person in PT. Making the timezone configurable would require:
- A per-user preference store.
- Timezone-aware formatting on every date surface.
- Additional test matrices for every supported timezone.
- Ambiguity resolution when the user changes their timezone and old data is reinterpreted.

**Decision:** Hardcode PT as the user-facing timezone. The conversion layer is built for PT only. If the system ever becomes multi-user or multi-region, the conversion layer can be extended to accept a timezone parameter, but the default remains PT for the existing user.

## Open Questions

1. Should the PDR trigger reject a partner `marketDate` that is more than one day away from PT today, or always normalize it?
2. Should the dashboard schedule be read from a config doc, or hardcoded with the actual deployed schedules?
3. Should the manual run `date` override accept only PT dates, or preserve the current "any string" behavior?
4. Do we want to backfill or rename the `symbol-data-sync-runs` collection after the format change?

## Answers to Open Questions

1. **PDR `marketDate` handling:** Always normalize. PDR messages are real-time and should be very close to PT today. No rejection threshold is needed.
2. **Dashboard schedule:** Show both. Maintain a config doc with the **scheduled** cron, and read the **actual** deployed schedule from Cloud Scheduler or the function deployment metadata. Display both so the user can see scheduled vs. actual at a glance.
3. **Manual run `date` override:** Accept only PT dates. The user is the sole initiator and is in PT.
4. **Backfill `symbol-data-sync-runs`:** No backfill. Old run format data is not relevant. A full cleanup of the collection can happen separately later.

## Decisions Needed

1. **Confirm the run ID format** `YYYY-MM-DD_dow_HHMMSS_trigger` for both `rh-agent-runs` and `symbol-data-sync-runs`.
2. **Confirm the PT-only rule** for all market dates, run IDs, and user-facing dates.
3. **Confirm no app-side market-day guard** — rely on the partner for market-day decisions.
4. **Confirm dashboard schedule source** — config doc + actual deployed schedule.
5. **Confirm interim `barDate` = `marketDate`** — do not project future period-end dates for interim signals.

## Next Steps

1. Review and approve this PRD.
2. Create a branch for implementation.
3. Begin Phase 1 (shared utilities).
4. Update this document as decisions are made.
