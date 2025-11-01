# Dashboard V2 RS Rendering (End-to-End)

This document describes how Dashboard V2 renders Relative Strength (RS) heatmaps using Firestore as the single source of truth. It reflects recent decisions to:

- Use `pairs-data/{BASE}-{SYMBOL}` as the canonical RS time series source.
- Avoid client-side RS computation entirely.
- Initialize with a simple test list during bring-up and support user-owned lists under `users/{uid}/lists/*`.
- Stage curated baselines for defaults (SPY/QQQ/etc.) for later integration.

---

## Overview

- The app loads a selected list (bring-up: a hardcoded test list; normal flow: user lists).
- Pairs are derived as `{BASE}-{SYMBOL}` from the list’s baseline and symbols.
- For each pair, the FE reads the time series from `pairs-data/{PAIR}` and maps `post.rs` (fallback `pre.rs`) to heatmap cells.
- The heatmap header row shows dates; each row shows one pair’s RS values with background colors.

---

## Data Sources

- Firestore (Emulated/Prod):
  - `pairs-data/{BASE}-{SYMBOL}` — canonical RS series for FE consumption.
  - `users/{uid}/lists/{listId}` — user-owned lists (owner-only read/write).
- Curated defaults (planned; backend-owned, read-only):
  - `baselines/{BASE}` (holdings), `baselines/{BASE}/leaders/latest` (optional cache), `catalogs/baselines`.
  - Defined in `docs/planning/5_DATABASE_SCHEMA.md` (section 10).

---

## Firestore Shapes

### pairs-data/{BASE}-{SYMBOL}

- Fields:
  - `meta: { baseline, symbol, interval, window }`
  - `latest: { day, pre?, post? }`
  - `data: Array<{ day, pre?, post? }>`
- FE mapping (V2 heatmap):
  - `date = row.day`
  - Historical days: use `row.post.rs` only (ignore `pre`); skip the day if `post` is not present
  - Latest day (matching `latest.day`): use `row.post.rs` if present, otherwise allow `row.pre.rs` until EOD arrives

Example

```json
{
  "meta": { "baseline": "QQQ", "symbol": "AAPL", "interval": "DAILY", "window": 30 },
  "latest": { "day": "2025-10-24", "post": { "rs": 0.62 } },
  "data": [
    { "day": "2025-10-22", "post": { "rs": 0.45 } },
    { "day": "2025-10-23", "post": { "rs": 0.51 } },
    { "day": "2025-10-24", "post": { "rs": 0.62 } }
  ]
}
```

### users/{uid}/lists/{listId}

- Fields:
  - `name: string`
  - `baseline: string`
  - `symbols: Array<{ symbol: string; company?: string }>`
  - `ranksDataWithColors?: Record<pair, BaselineTargetRankDatum[]>` (FE-managed cache)
- Security: owner-only read/write.

---

## Responsibilities and Key Files

- `src/app/features/dashboard-v2/dashboard-v2.component.ts`
  - Initializes heatmap colors and supported symbols.
  - On auth:
    - Bring-up: initializes a test list:
      ```ts
      const qqqTest: RelStrStockList = {
        name: 'qqq-test-01',
        baseline: 'QQQ',
        symbols: [
          { symbol: 'AAPL', company: 'Apple Inc' },
          { symbol: 'GOOGL', company: 'Alphabet Inc' },
          { symbol: 'TSLA', company: 'Tesla, Inc.' },
        ],
        ranksDataWithColors: {},
      };
      rsAppStore.initializeListV2(qqqTest);
      ```
    - Also loads user lists for the authenticated user.

- `src/app/features/store/stock-list-v2.feature.ts`
  - V2 state and behavior for lists and heatmap data.
  - `initializeListV2(list)` → derives pairs → loads series for each pair → merges into `ranksDataWithColors`.
  - `generateHeatmapDataV2(pair)`:
    - `series = await firstValueFrom(relStrDbService.getPairSeriesLive$(pair))`
    - Maps each `{ date, value }` to a colored `BaselineTargetRankDatum` using `rsCalcsStore.heatmapColors()`.

- `src/app/features/services/rel-str-db-v2.service.ts`
  - `getPairSeriesLive$(pairId)`:
    - Reads `pairs-data/{PAIR}` via `docData`.
    - Returns `Array<{ date: string; value: number }>` where `value = post.rs ?? pre.rs`.
  - User lists CRUD for owner-only paths under `users/{uid}/lists/*`.
  - Curated baseline readers/callables (for future use).

- `src/app/features/dashboard-v2/heatmap/heatmap.component.ts` and `.html`
  - Binds to the selected list’s `ranksDataWithColors`.
  - Header dates from the first pair’s series.
  - Each row shows the pair ID and cells with RS values and background colors.

---

## Rendering Pipeline

1) __List selection__
   - Bring-up path initializes `qqq-test-01`.
   - Normal path loads user lists for the authenticated UID and selects one.

2) __Pairs derivation__
   - `getPairsForList(list)` → `['QQQ-AAPL','QQQ-GOOGL','QQQ-TSLA', ...]`.

3) __Series loading (source of truth = Firestore)__
   - `RelStrDbV2Service.getPairSeriesLive$()` rules:
     - Historical days: include only `post.rs`
     - Latest day: include `post.rs` if present; otherwise include `pre.rs`
   - Color mapping remains unchanged.

4) __Store update__
   - Merge into `selectedStockListV2.ranksDataWithColors[pair]`.

5) __Heatmap render__
   - Header row: `['Symbol/Date', ...dates]`
   - Rows: first cell = pair; subsequent cells = RS values with colors.

---

## Pre/Post Phasing and Update Semantics (Authoritative)

- Strict phasing
  - Pre-close runs (phase `pre`): partner publishes when intraday data is ready.
    - Backend requires intraday fields (`ip` and provider `ipc`) for both baseline and target for the current day.
    - Backend upserts only the current day into `data[]` under `pre`, and updates `latest`. No historical recomputation.
  - Post-close runs (phase `post`): partner publishes when EOD data is ready.
    - Backend requires EOD close (`ac` or `c`) and provider EOD percent-change (`cp`) for both baseline and target for the current day.
    - Backend upserts only the current day into `data[]` under `post`, and updates `latest`. No historical recomputation.

- FE consumption (V2 heatmap)
  - Historical bars: render only `post.rs` to ensure the chart reflects finalized EOD values.
  - Current day behavior:
    - Before pre-close arrives: last visible cell is yesterday’s `post.rs`.
    - When pre-close arrives: add today’s cell using `pre.rs`.
    - When post-close arrives: replace today’s cell with `post.rs`.

- No fallback masking
  - The backend does not substitute intraday for EOD during `post` runs.
  - The frontend does not fallback to `pre.rs` for historical days; only the latest day may temporarily show `pre.rs`.

- Writer behavior
  - `writeUnifiedSeries` performs idempotent upsert per `day`, merging the incoming `pre` or `post` block and trimming to `meta.window`.
  - RS rank is computed per output day using a 5-day window, but only today’s record is added/updated per run.

---

## Debugging and Observability

- Temporary logs (in `stock-list-v2.feature.ts`):
  ```ts
  console.debug('[V2] pair series', pair, 'len=', series?.length ?? 0, 'first=', series?.[0]);
  ```
- When a latest-day cell is missing for a symbol after a `post` run, verify the partner provided `ac/c` and `cp` for that day. The backend will not fallback to `pre` during `post`.

---

## User Lists (Persist and Render)

- Save flow uses authenticated UID in `StockListFormComponent.handleSaveList()`:
  ```ts
  const uid = this.auth.currentUser?.uid;
  ```
- Persist to `users/{uid}/lists/{listId}` with required fields validated.
- Read flow checks for UID match to adhere to rules.

---

## Curated Baselines (Planned)

- See `docs/planning/5_DATABASE_SCHEMA.md` section 10 for:
  - `baselines/{BASE}` with `tickerSymbol`, `name`, `provider`, `holdings`.
  - `baselines/{BASE}/leaders/latest` (Top/Bottom cache).
  - `catalogs/baselines` for baseline buttons.
- Future FE plan:
  - Enumerate targets from `baselines/{BASE}` and render from `pairs-data`.
  - Use a backend callable (`getBaselineLeaders`) for SPY/QQQ Top/Bottom, avoiding client fan-out.

---

## Performance and UX Notes

- Keep `pairs-data.data` window reasonable (e.g., 30–100) for fast initial loads.
- Series are read per visible pair; background updates flow via `docData`.
- Color mapping is constant-time per cell.

---

## Testing

- __Unit (Jest)__
  - Mock `getPairSeriesLive$`, verify mapping to `BaselineTargetRankDatum` and correct color indices.
  - Validate `initializeListV2` merges `ranksDataWithColors` correctly.

- __E2E (Cypress/Playwright)__
  - Seed emulator with `pairs-data/QQQ-{AAPL,GOOGL,TSLA}` docs.
  - Login → Dashboard V2 → verify rows and cells render.
  - Create and persist a list; reload; verify persistence and render.

---

## Current State Summary

- Bring-up flow initializes `qqq-test-01` (QQQ against AAPL, GOOGL, TSLA).
- Heatmap is powered directly by `pairs-data` (post/pre RS only), no client computation.
- User lists are persisted under `users/{uid}/lists/*` and reloaded on login.
- Curated baselines are documented and ready for FE wiring once the callables and docs are seeded.
