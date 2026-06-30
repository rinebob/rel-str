# RH Agent — Signal Persistence Plan

**Status:** Planning  
**Created:** 2026-06-30  
**Related docs:**
- `RH-AGENT-DASHBOARD-RUN-EXPLORER-PLAN.md` (run-centric real-time workflow)
- `RH-AGENT-SIGNAL-GROUPING-PLAN.md` (symbol-centric structure, Phases 1–6 complete)

---

## Problem Statement

The system currently has two separate signal computation paths that diverge:

1. **Stored signals** — computed by the cloud function worker using `rs-bars` (Firestore nightly sync, ~45 day window), written to `rh-agent-symbols/{symbol}/signal-dates/{barDate}`
2. **Chart signals** — computed on-the-fly in the browser by `detectZoneUptickDots()` and other detectors, using price bars fetched from SavantAPI via `HeatmapChartStore`

These diverge because they use different data sources, different amounts of history, and potentially different HTF gating logic. The result: a symbol appears in the run's signal list but shows no uptick dot on its chart — or vice versa. This is a trust problem.

Additionally, the current `signal-dates/{barDate}` path makes it impossible to distinguish signals from different runs on the same date (PDR 8AM vs 10AM vs nightly all overwrite or conflict), and collapses the distinction between real-time intraday signals and final EOD outcomes.

---

## Two Signal Contexts

### 1. Run-Centric (real-time, intraday)

**Purpose:** "What did the agent see during this specific run, right now? Should I act on it today?"

- Time-sensitive — meaningful for active trading decisions
- Multiple runs per day are all valid and distinct (8AM PDR may differ from 10AM PDR)
- Expires at EOD — stale after market close
- Stored at: `rh-agent-symbols/{symbol}/run-ids/{runId}` (see Run Explorer Plan)

### 2. Date-Centric / Signal History (canonical EOD SOT)

**Purpose:** "What was the definitive signal outcome for this symbol on this market date?"

- Canonical and immutable once EOD data is final
- One record per symbol per date — the historical truth
- Used for: chart marker rendering, historical review, pattern analysis, backtesting
- The chart uptick dots and signal dots should render from this, not from live recomputation
- Stored at: `rh-agent-symbols/{symbol}/signal-history/{date}`

---

## Proposed Firestore Schema

### Run-centric (working/real-time)

```
rh-agent-symbols/{symbol}/run-ids/{runId}
{
  symbol,
  runId,
  startedAt,        // ISO timestamp — when the run fired; distinguishes 8AM vs 10AM vs 12PM PDR runs
  marketDate,       // YYYY-MM-DD — the calendar date of the run
  barDate,          // YYYY-MM-DD — the date of the bar that fired the signal
                    // NOTE: for daily bars marketDate === barDate.
                    // For weekly bars these diverge: barDate is the week-open (Monday),
                    // marketDate is the day the run fired (e.g. Wednesday).
  timeframe,        // 'D' | 'W'
  direction,        // 'LONG' | 'SHORT'
  signalType,       // e.g. 'D_ZONE_V2_UPTICK'
  status,           // 'INTERIM' | 'CONFIRMED'
  indicators: { ... }
}
```

### Signal history (canonical EOD SOT)

```
rh-agent-symbols/{symbol}/signal-history/{date}
{
  symbol,
  date,             // YYYY-MM-DD — indexed for collection group queries
                    // For weekly signals: date is the week-open (Monday bar date),
                    // not the Friday close. Weekly signals remain INTERIM until week close.
  timeframe,        // 'D' | 'W'
  direction,        // 'LONG' | 'SHORT'
  signalType,
  status,           // 'CONFIRMED' only — INTERIM signals are not written to signal-history.
                    // Weekly signals are INTERIM until end-of-week (not always Friday).
  indicators: { ... },
  sourceRunId,      // which run produced the canonical record
  canonicalizedAt,  // timestamp when EOD write occurred
}
```

---

## Query Patterns

Both query patterns are supported with a single write path (symbol-primary) plus a Firestore collection group index on `date`:

| Use case | Query |
| --- | --- |
| Chart history for a symbol | `rh-agent-symbols/CSCO/signal-history` ordered by `date desc` |
| All signals for a given date (grouped-review list) | `collectionGroup('signal-history').where('date', '==', '2026-06-29')` |
| 30-day signal list | `collectionGroup('signal-history').where('date', '>=', startDate).where('date', '<=', endDate)` |

Firestore collection group queries use the composite index directly — they do not scan the entire database. This is an efficient and supported pattern.

**Required Firestore index:** composite index on `signal-history` collection group: `(date ASC, symbol ASC)`.

---

## EOD Canonicalization

The nightly run (post-market close) is the natural EOD trigger. When the nightly run completes:

1. Worker computes signals using final EOD price data from SavantAPI (full history, not `rs-bars` snapshot)
2. Writes to `run-ids/{runId}` as usual (run-centric record)
3. Also writes to `signal-history/{date}` — the canonical EOD record for that date

Intraday PDR runs (8/10/12 AM) write only to `run-ids/{runId}`. They are real-time working state, not the canonical EOD record.

---

## Chart Signal Rendering (resolves chart/list divergence)

Once `signal-history` is populated, chart rendering uses a hybrid strategy:

### Historical bars (all dates before today)
- Load markers from `signal-history/{date}` for the symbol
- Render at the correct `barDate` position on the chart
- Canonical, immutable — no recomputation

### Today's bar (current trading day, market open)
- `signal-history` for today does not exist yet — EOD data is not final until after close
- Load marker from the **latest completed run's** `run-ids/{runId}` for today
- This is real-time, may change as PDR runs fire at 8/10/12 AM
- The `startedAt` timestamp on the run doc identifies which intraday run produced the marker
- Show nothing if no run has completed yet today

### Logic summary
```
if (barDate < today) → render from signal-history/{barDate}
if (barDate === today) → render from latest run-ids/{runId} for today
```

The chart component needs to know whether today is a trading day and whether the market is currently open to decide which path to use for today's bar. The live recomputation path is retained only for exploratory chart viewing of symbols not in any signal list.

---

## Migration from `signal-dates`

The existing `signal-dates/{barDate}` collection is `signal-history` in spirit. Migration:

1. Create the new `signal-history` subcollection path and Firestore index
2. Update the nightly worker to write to `signal-history/{date}` in addition to (or instead of) `signal-dates/{barDate}`
3. Backfill: for each existing `signal-dates` doc, copy to `signal-history/{date}` — this is a straightforward symbol+date copy with no reconciliation needed since `signal-dates` is already keyed by date
4. Stop writing to `signal-dates` once all consumers are migrated
5. Keep `signal-dates` readable for reference; do not delete immediately

---

## Relationship to Run-Centric Model

- `run-ids/{runId}` — working state, intraday, real-time review workflow (see Run Explorer Plan)
- `signal-history/{date}` — canonical EOD truth, historical chart rendering, long-term reference
- A run's `runId` is stored as `sourceRunId` in the `signal-history` doc for auditability
- The UI never needs to reconcile the two — different pages use different collections for different purposes

---

## Implementation Order

1. **Run-centric first** — implement `run-ids/{runId}` writes and the run-explorer dashboard workflow (see Run Explorer Plan). This unblocks real-time signal review.
2. **Signal history second** — add `signal-history/{date}` EOD writes from the nightly worker + Firestore index.
3. **Chart rendering third** — wire chart signal markers to read from `signal-history` instead of live recomputation. This fixes the chart/list divergence.
4. **Migration** — backfill `signal-dates` → `signal-history`, cut over consumers, deprecate `signal-dates`.

---

## Open Questions

1. **EOD trigger** — **Resolved:** Nightly run only. Intraday PDR runs use real-time data and not close prices so are invalid as EOD canonical records. If the nightly run fails, retry logic is required rather than falling back to the last PDR run. Retry strategy TBD.
2. **Intraday confirmation** — **Resolved:** Only `CONFIRMED` signals from the nightly run are written to `signal-history`. Intraday PDR signals are by definition based on non-final price data and remain in `run-ids/{runId}` only.
3. **Multiple signals same day** — **Resolved:** Use whatever structure is simplest to implement. From the user's perspective multiple signal types on the same symbol+date are visually indistinguishable. A signals map inside one doc (keyed by signalType) is likely the cleanest — avoids multiple docs per symbol per date.
4. **Weekly signals** — **Resolved:** Weekly signals are `INTERIM` until end-of-week. End-of-week is not always Friday (early market closes, holidays). The nightly run at week-end (whatever day that is) writes the confirmed weekly signal to `signal-history`. The week-open date (Monday's bar date) is used as the `date` key, not the close date.
5. **Nightly run retry logic** — **Open:** if the nightly run fails, what is the retry strategy? Max retries, backoff interval, alert mechanism? TBD before implementing EOD canonicalization.
