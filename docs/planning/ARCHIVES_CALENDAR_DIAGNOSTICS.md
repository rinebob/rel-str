# Calendar‑Aware Weekly/Monthly Archives & Diagnostics

> **Transition Note:** This document describes a more complex, calendar-gated writing strategy for WEEKLY/MONTHLY archives (e.g., only write weekly/monthly docs on specific last-trading-day dates) that was **never implemented in production** and was ultimately abandoned as unworkable. It is retained only as historical background. For current behavior, see `RS_ARCHIVE_BACKFILL.md` and the code; do **not** treat this file as a specification for how archives are written today.

> In the current architecture, archives are written primarily by a **unified ingestion engine** that runs once per trading day in response to a TS_UNIVERSE‑style universe-ready signal from Savant (see `docs/partner/rs-partner-integration.md`). This file may still be useful to reason about potential calendar invariants, but the specific calendar-gated write strategies described below should generally be disregarded.

## Purpose

This document explains how rel-str implements calendar-aware weekly and monthly archive writing and diagnostics, so an equivalent capability can be ported to SavantAPI (SA). It focuses on:

- The **canonical calendar** model and storage.
- How the **writer** uses the canonical calendar to decide when to write weekly/monthly archives.
- How **diagnostics** validate existing archives against the same calendar.

---

## Scope and Expectations for SA

This document describes **rel-str's** choices and invariants. It is **not** prescribing how SA must store its own data internally. In particular:

- rel-str currently keeps **in-progress weekly/monthly bars out of the archive shards**, and exposes them via `pair.latest*` fields instead.
- SA is free to store **both partial and final bars** in its own time-series (including year shards) as long as it can also provide, for each symbol/pair:
  - A well-defined **canonical weekly close series** aligned with `weeklyLastTradingDays`.
  - A well-defined **canonical monthly close series** aligned with `monthlyLastTradingDays`.

The important contract is that SA can expose a canonical set of closes that respects the same calendar model; how SA stores in-progress bars internally is up to SA.

---

## 1. Canonical Calendar: Single Source of Truth

### 1.1 Canonical calendar document

Firestore stores one document per year:

- Collection: `app`
- Doc ID: `market-holidays-US-<YEAR>`

Shape (simplified):

```ts
interface CanonicalCalendarYear {
  year: number;
  region: 'US';
  source: 'SA'; // provenance of holidays
  holidays: MarketHolidayItem[]; // raw upstream data
  weeklyLastTradingDays: { [weekKey: string]: string };   // 'YYYY-MM-DD(Mon)' -> 'YYYY-MM-DD'
  monthlyLastTradingDays: { [monthKey: string]: string }; // 'YYYY-MM' -> 'YYYY-MM-DD'
  lastUpdatedAt: FirebaseFirestore.Timestamp;
}
```

Key points:

- **`weeklyLastTradingDays`** maps a **week anchor** (typically the Monday of the week) to the canonical last trading day of that week.
- **`monthlyLastTradingDays`** maps `YYYY-MM` to the canonical last trading day of that month.
- This document is **pure calendar** – it does not depend on any particular pair/symbol.

### 1.2 Building the canonical calendar

Function: `buildCanonicalCalendarForYear(year, holidays)` in `calendar.ts`.

Inputs:

- `year: number` (e.g. `2025`).
- `holidays: MarketHolidayItem[]` from SA.

Algorithm (high level):

1. Iterate through every calendar day of the year.
2. Determine if a day is a **trading day**:
   - Not a weekend.
   - Not in the SA holidays list.
3. For each trading day `day`:
   - Compute `weekKeyFromYmd(day)` → Monday (or chosen anchor) of the week, e.g. `2025-12-15`.
   - Update `weeklyLastTradingDays[weekKey] = max(weeklyLastTradingDays[weekKey], day)`.
   - Compute `monthKey = day.slice(0, 7)` → `YYYY-MM`.
   - Update `monthlyLastTradingDays[monthKey] = max(monthlyLastTradingDays[monthKey], day)`.

This yields canonical per-week and per-month last trading days, fully determined by the global trading calendar.

### 1.3 Writing the canonical calendar to Firestore

Admin HTTP function: `refreshMarketHolidaysAdmin` in `admin-tasks.ts`.

Steps:

1. Auth-check using an `ADMIN_BACKFILL_TOKEN`.
2. Parse `year` from query/body.
3. Call SA market-holidays endpoint for that year:

   ```ts
   const upstream = await callPartnerMarketHolidays({ year });
   const holidays = Array.isArray(upstream.holidays) ? upstream.holidays : [];
   ```

4. Build canonical calendar:

   ```ts
   const canonical = buildCanonicalCalendarForYear(year, holidays);
   ```

5. Upsert Firestore doc:

   ```ts
   const docId = `market-holidays-US-${year}`;
   const docRef = db.collection(APP_COLLECTION).doc(docId);

   await docRef.set(
     {
       year,
       region: 'US',
       holidays,
       source: 'SA',
       weeklyLastTradingDays: canonical.weeklyLastTradingDays,
       monthlyLastTradingDays: canonical.monthlyLastTradingDays,
       lastUpdatedAt: FieldValue.serverTimestamp(),
     },
     { merge: true },
   );
   ```

### 1.4 Loading the canonical calendar

Function: `loadCanonicalCalendarYear(year)` in `calendar.ts`.

- Reads `app/market-holidays-US-<year>`.
- Returns a `CanonicalCalendarYear` object with `weeklyLastTradingDays` and `monthlyLastTradingDays`, or `null` if the doc is missing.

This provides a **shared, authoritative calendar** for both writer and diagnostics.

---

## 2. Writer Logic – Calendar-Aware Archives

Core function: `writeUnifiedSeries` in `pairs-writer.ts`.

### 2.1 Inputs relevant to the calendar

Key inputs:

- `interval: DAILY | WEEKLY | MONTHLY`.
- `archiveEntries`: list of pre-aggregated bars (per-day/per-week/per-month) that will be written.
- `windowToDay?: string` (optional):
  - For live runs: the last daily bar day in the series.
  - For backfills: the admin-provided `to` date, clamped to real **today UTC**.

### 2.2 Determining the current period anchor

We derive a **logical current day** for the run:

```ts
const todayUtc = currentUtcYmd();
const runToDay = windowToDay ? min(windowToDay, todayUtc) : todayUtc;
const runToYear = Number(runToDay.slice(0, 4));
const runToWeekKey = weekKeyFromYmd(runToDay); // e.g. 2025-12-15
const runToMonth = runToDay.slice(0, 7);       // e.g. 2025-12
```

This prevents future dates (e.g. in a backfill) from ever being treated as "current".

### 2.3 Loading canonical calendar in the writer

For years 2025 and later, the writer tries to load the canonical calendar:

```ts
let canonical: CanonicalCalendarYear | null = null;
if (runToYear >= 2025) {
  canonical = await loadCanonicalCalendarYear(runToYear);
}
```

If available, `canonical.weeklyLastTradingDays` and `canonical.monthlyLastTradingDays` are used to gate **current** week/month archive writes.

### 2.4 Weekly archive writing behavior

The writer distinguishes **past** weeks from the **current** week using `runToWeekKey`.

Let:

- `weekKey = weekKeyFromYmd(entry.day)` for each weekly entry.

Behavior:

1. **Past weeks** (`weekKey < runToWeekKey`):
   - Treat SA’s weekly bar as authoritative:
     - Write the weekly archive document for `entry.day`.
     - Mark `isIntervalClose = true`.
   - This is intentionally lenient: for historical weeks, we assume SA’s weekly aggregation is the ground truth.

2. **Current week** (`weekKey === runToWeekKey`):
   - Requires canonical calendar for the year:

     ```ts
     const expectedClose = canonical?.weeklyLastTradingDays?.[runToWeekKey];
     if (expectedClose && entry.day === expectedClose) {
       writeDoc({ isIntervalClose: true, ... });
     } else {
       // Do not write a current-week weekly doc.
     }
     ```

   - If canonical calendar is **missing** for that year:
     - **No** weekly doc is written for the current week.
     - We refuse to trust SA’s weekly bar for the CURRENT week in the absence of canonical calendar data.

This ensures that only true end-of-week days are ever written as the final weekly for the current week.

### 2.5 Monthly archive writing behavior

Similar approach using months:

- Let `monthKey = entry.day.slice(0, 7)`.

Behavior:

1. **Past months** (`monthKey < runToMonth`):
   - Trust SA’s monthly bar as the canonical close.
   - Write the monthly archive doc and set `isIntervalClose = true`.

2. **Current month** (`monthKey === runToMonth`):
   - Use `canonical.monthlyLastTradingDays[monthKey]`:

     ```ts
     const expectedMonthEnd = canonical?.monthlyLastTradingDays?.[monthKey];
     if (expectedMonthEnd && entry.day === expectedMonthEnd) {
       writeDoc({ isIntervalClose: true, ... });
     } else {
       // Do not write a current-month monthly doc.
     }
     ```

   - If canonical calendar is missing:
     - No monthly doc is written for the current month.

---

## 3. Diagnostics Logic – Validating Archives

Entrypoint: `diagnosePairArchivesAdmin` in `diagnostics.ts`.

### 3.1 High-level flow

1. Parse request:
   - `env` (emu/prod), `cleanup` (boolean), `intervals`, `fromDay`, `toDay`.
   - `pairs` list (or default to all registered pairs).
2. For each pair and each interval in `intervals`:
   - Call `findInvalidArchiveDocsForInterval(pairId, interval, window)`.
   - Collect `invalidArchiveDocs` for that pair/interval.
   - If `cleanup = true`, delete the invalid docs.
3. Return JSON summary:
   - Per pair: `intervals[]` with:
     - `latestArchiveDay`, `latestArchiveDocId`.
     - `latestFieldDay` (from DAILY archives).
     - `issues[]` (e.g. `invalid_archive_docs_present`, `latest_monthly_archive_not_expected_close`).
     - `invalidArchiveDocs[]` with `{ year, docId, day, reason }`.

### 3.2 Shared calendar context inside diagnostics

In `findInvalidArchiveDocsForInterval` we:

- Derive `startYear` and `endYear` from the diagnostics window.
- Try to load a `HolidaySet` via `loadUsHolidaySetForWindow(window)` (used as fallback when canonical is missing or pre-2025).
- Maintain `canonicalByYear = new Map<number, CanonicalCalendarYear | null>()`.
- Helper `getCanonicalForYear(year)`:

  ```ts
  const getCanonicalForYear = async (year: number): Promise<CanonicalCalendarYear | null> => {
    if (canonicalByYear.has(year)) return canonicalByYear.get(year) ?? null;
    if (year < 2025) {
      canonicalByYear.set(year, null);
      return null;
    }
    try {
      const cal = await loadCanonicalCalendarYear(year);
      canonicalByYear.set(year, cal ?? null);
      return cal ?? null;
    } catch (e) {
      // log warning, cache null
      canonicalByYear.set(year, null);
      return null;
    }
  };
  ```

### 3.3 Computing expected weekly closes for diagnostics

We build `expectedWeeklyDays: Set<string>`.

Pseudocode:

```ts
const expectedWeeklyDays = new Set<string>();

if (interval === Interval.WEEKLY) {
  const weeklyLastTradingDayByWeek = new Map<string, string>();

  for (let y = startYear; y <= endYear; y++) {
    const yearStart = `${y}-01-01`;
    const yearEnd = `${y}-12-31`;
    const lowerBound = max(window.fromDay, yearStart);
    const upperBound = min(window.toDay, yearEnd);
    if (lowerBound > upperBound) continue;

    const canonical = await getCanonicalForYear(y);
    if (canonical) {
      // 2025+ with canonical calendar
      for (const [, lastDay] of Object.entries(canonical.weeklyLastTradingDays || {})) {
        if (!lastDay) continue;
        if (lastDay < lowerBound || lastDay > upperBound) continue;
        // Do not require a stored weekly doc for the in-progress week
        if (lastDay >= window.toDay) continue;
        expectedWeeklyDays.add(lastDay);
      }
      continue;
    }

    // Pre-2025 or canonical missing: fallback to daily+holiday heuristic
    const dailyColName = getArchiveCollectionName(Interval.DAILY, y);
    const dailyColRef = pairRef.collection(dailyColName);

    const dailySnap = await dailyColRef
      .where('day', '>=', lowerBound)
      .where('day', '<=', upperBound)
      .select('day')
      .get();

    for (const doc of dailySnap.docs) {
      const raw = doc.data() || {};
      const day = typeof raw.day === 'string' ? raw.day.slice(0, 10) : undefined;
      if (!day) continue;

      if (!holidaySet) {
        // Old heuristic: max daily per week
        const dt = new Date(`${day}T00:00:00.000Z`);
        const dow = dt.getUTCDay();
        const offsetFromMonday = (dow + 6) % 7;
        dt.setUTCDate(dt.getUTCDate() - offsetFromMonday);
        const weekKey = fmtYMD(dt);
        const prev = weeklyLastTradingDayByWeek.get(weekKey);
        if (!prev || day > prev) weeklyLastTradingDayByWeek.set(weekKey, day);
      } else if (isEndOfWeekTradingDay(day, holidaySet)) {
        expectedWeeklyDays.add(day);
      }
    }
  }

  if (!holidaySet) {
    for (const [, lastDay] of weeklyLastTradingDayByWeek.entries()) {
      if (lastDay >= window.toDay) continue; // in-progress week
      expectedWeeklyDays.add(lastDay);
    }
  }
}
```

So for **2025+**:

- Expected weekly closes are driven directly by `weeklyLastTradingDays` from the canonical calendar doc.
- The fallback daily/holiday heuristic is only used for pre-2025 or when canonical docs are missing.

### 3.4 Computing expected monthly closes for diagnostics

We build `monthlyLastTradingDayByMonth: Map<string, string>` and `currentMonthKey = window.toDay.slice(0, 7)`.

Pseudocode:

```ts
const monthlyLastTradingDayByMonth = new Map<string, string>();
const currentMonthKey = window.toDay.slice(0, 7);

if (interval === Interval.MONTHLY) {
  for (let y = startYear; y <= endYear; y++) {
    const yearStart = `${y}-01-01`;
    const yearEnd = `${y}-12-31`;
    const lowerBound = max(window.fromDay, yearStart);
    const upperBound = min(window.toDay, yearEnd);
    if (lowerBound > upperBound) continue;

    const canonical = await getCanonicalForYear(y);
    if (canonical) {
      // 2025+ with canonical calendar
      for (const [monthKey, lastDay] of Object.entries(canonical.monthlyLastTradingDays || {})) {
        if (!lastDay) continue;
        if (lastDay < lowerBound || lastDay > upperBound) continue;
        const key = String(monthKey).slice(0, 7);
        const prev = monthlyLastTradingDayByMonth.get(key);
        if (!prev || lastDay > prev) {
          monthlyLastTradingDayByMonth.set(key, lastDay);
        }
      }
      continue;
    }

    // Pre-2025 or canonical missing: fallback to daily+holidays
    const dailyColName = getArchiveCollectionName(Interval.DAILY, y);
    const dailyColRef = pairRef.collection(dailyColName);

    const dailySnap = await dailyColRef
      .where('day', '>=', lowerBound)
      .where('day', '<=', upperBound)
      .select('day')
      .get();

    for (const doc of dailySnap.docs) {
      const raw = doc.data() || {};
      const day = typeof raw.day === 'string' ? raw.day.slice(0, 10) : undefined;
      if (!day) continue;

      const monthKey = day.slice(0, 7);
      if (!holidaySet) {
        const prev = monthlyLastTradingDayByMonth.get(monthKey);
        if (!prev || day > prev) monthlyLastTradingDayByMonth.set(monthKey, day);
      } else if (isEndOfMonthTradingDay(day, holidaySet)) {
        const prev = monthlyLastTradingDayByMonth.get(monthKey);
        if (!prev || day > prev) monthlyLastTradingDayByMonth.set(monthKey, day);
      }
    }
  }
}
```

### 3.5 Validating each existing archive doc

Once expected closes are known, diagnostics scans existing weekly/monthly archives and validates them.

For each year in the window:

```ts
const colName = getArchiveCollectionName(interval, y);
const colRef = pairRef.collection(colName);

const snap = await colRef
  .where('day', '>=', lowerBound)
  .where('day', '<=', upperBound)
  .get();

for (const doc of snap.docs) {
  const raw = doc.data() || {};
  const day = typeof raw.day === 'string' && raw.day.length >= 10
    ? raw.day.slice(0, 10)
    : ymdFromShardId(doc.id, y);
  if (!day) continue;
  if (day < window.fromDay || day > window.toDay) continue;

  const isIntervalClose = !!raw.isIntervalClose;

  if (interval === Interval.WEEKLY) {
    const dt = new Date(`${day}T00:00:00.000Z`);
    const dow = dt.getUTCDay();
    const isFriday = dow === 5;

    if (isFriday && isIntervalClose) {
      seenWeeklyCloseDays.add(day);
    }

    const reasonParts: string[] = [];
    if (!isFriday) {
      reasonParts.push('dow_not_friday');
    } else if (!expectedWeeklyDays.has(day)) {
      reasonParts.push('unexpected_weekly_archive_day');
    }
    if (!isIntervalClose) {
      reasonParts.push('interval_close_flag_missing_or_false');
    }

    if (reasonParts.length > 0) {
      results.push({ year: y, docId: doc.id, day, reason: reasonParts.join('|') });
    }
  } else if (interval === Interval.MONTHLY) {
    const monthKey = day.slice(0, 7);
    const expectedMonthEnd = monthlyLastTradingDayByMonth.get(monthKey);

    // Only months strictly before the current month can have valid closes.
    if (monthKey < currentMonthKey && expectedMonthEnd && day === expectedMonthEnd && isIntervalClose) {
      seenValidMonthlyCloseDays.add(day);
      continue;
    }

    const reasonParts: string[] = [];
    if (monthKey < currentMonthKey) {
      if (!expectedMonthEnd) {
        reasonParts.push('no_expected_month_end_for_month');
      } else if (day !== expectedMonthEnd) {
        reasonParts.push('not_last_trading_day_of_month');
      }
      if (!isIntervalClose) {
        reasonParts.push('interval_close_flag_missing_or_false');
      }
    }

    if (reasonParts.length > 0) {
      results.push({ year: y, docId: doc.id, day, reason: reasonParts.join('|') || 'invalid_monthly_archive_doc' });
    }
  }
}
```

### 3.6 Emitting missing expected closes

After scanning docs, diagnostics compares expected closes vs observed valid closes.

- Weekly:
  - For each `expectedDay` in `expectedWeeklyDays`:
    - If `expectedDay` not in `seenWeeklyCloseDays`:
      - Emit `{ docId: '(missing)', day: expectedDay, reason: 'missing_weekly_archive_for_day' }`.

- Monthly:
  - For each `monthKey -> expectedMonthEnd` in `monthlyLastTradingDayByMonth` where `monthKey < currentMonthKey`:
    - If `expectedMonthEnd` not in `seenValidMonthlyCloseDays`:
      - Emit `{ docId: '(missing)', day: expectedMonthEnd, reason: 'missing_monthly_archive_for_month' }`.

These synthetic `(missing)` entries are informational only and never deleted (even in cleanup mode).

---

## 4. Porting Ideas for SavantAPI (SA)

To build a similar capability on SA side:

1. **Central canonical calendar**
   - Implement the same `buildCanonicalCalendarForYear` logic using SA’s own holiday/trading calendar.
   - Store `weeklyLastTradingDays` and `monthlyLastTradingDays` in a single canonical data object per year.

2. **Audit SA’s upstream aggregates**
   - For each symbol/pair, compare SA’s own WEEKLY and MONTHLY bars to the canonical calendar:
     - WEEKLY: bar dates should match `weeklyLastTradingDays[weekKey]`.
     - MONTHLY: bar dates should match `monthlyLastTradingDays[YYYY-MM]`.
   - Emit diagnostics for:
     - `unexpected_weekly_archive_day`.
     - `missing_weekly_archive_for_day`.
     - `not_last_trading_day_of_month`.
     - `missing_monthly_archive_for_month`.

3. **Optionally tighten rel-str writer for 2025+**
   - Today, rel-str trusts SA for **past** weeks/months and only uses canonical maps to gate the **current** week/month.
   - A stricter model (for future evolution) would be:
     - For 2025+ **all** weeks/months (past and current), only write archives when the SA bar date matches the canonical last trading day.
   - That would make rel-str writer and diagnostics both strictly canonical and fully deterministic from the calendar.

---

## 5. Code Path Reference

- `functions/src/webhooks/calendar.ts`
  - `buildCanonicalCalendarForYear(year, holidays)`
  - `loadCanonicalCalendarYear(year)`
  - `isTradingDay`, `isEndOfWeekTradingDay`, `isEndOfMonthTradingDay`, `weekKeyFromYmd`

- `functions/src/webhooks/admin-tasks.ts`
  - `refreshMarketHolidaysAdmin`
  - `recomputeRegisteredBackfill` (legacy archive backfill orchestrator that passes `windowToDay` into `writeUnifiedSeries`; superseded for new work by `recomputeRsBackfillAdmin` under `rs/time-series`)

- `functions/src/webhooks/pairs-writer.ts`
  - `writeUnifiedSeries` (uses `windowToDay`, loads canonical calendar, and gates weekly/monthly writes)

- `functions/src/webhooks/diagnostics.ts`
  - `diagnosePairArchivesAdmin` (HTTP entrypoint)
  - `findInvalidArchiveDocsForInterval` (core weekly/monthly validation logic using canonical calendar + holiday fallback)
