# Robinhood MCP — Scanners

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 8 tools in this group.

### create_scan

**Safety:** account write · **Status:** probed

Create a new saved scanner (screener) on the user's account — or, with scan_id, update an existing one by appending a new configuration version. Filters can be enum-based (from get_scanner_filter_specs) or expression-based (a raw market-data expression built from get_scanner_datapoints). Returns the scan's id, title, applied filters, and live market results.

Prefer an enum filter_type whenever one covers the request: enum filters are pre-validated and render as standard, user-editable filters in Legend. Build a raw expression only when no enum filter covers the request, and validate it with preview_scan before saving it here. This is the only tool that saves expression filters — update_scan_filters rejects them — so to change a scan that has an expression filter, call this tool with that scan's scan_id and the full desired filter set.

Columns display values, filters screen. To show a datapoint in results without restricting matches, pass it in columns — never fake it with a no-op filter like ">= 0", which pollutes the scan's filter list. A column is a display_name plus an expression, or a standard column's display name alone. A couple of contextual columns supporting the filters make a scan read better in Legend.

Two execution paths:
- New scan, enum-only filters (or none), no columns: composes multiple Beacon operations — create the scan, apply the preset configuration if non-INITIAL, apply filters, set the title. If a step after the initial create fails, the scan still exists in its partial state; the response surfaces what was applied, and update_scan_filters / update_scan_config can fix the rest.
- scan_id set, any expression filter present, or any columns present: a single transactional Beacon call that persists the filters and columns as a new ACTIVE configuration version (on the given scan, or on a brand-new one). All-or-nothing — an expression the market-data provider rejects means NOTHING is persisted, and the provider's validation error is returned. Earlier versions of a scan are never edited. A non-INITIAL preset cannot be combined with this path.

Parameters:
- scan_id (optional) — update this existing scan instead of creating one. REPLACE semantics: the new version holds exactly the filters and columns passed, so read the current set via get_scans first and send the complete intended set. Cortex-managed scans are rejected.
- preset (optional) — starting preset for a new scan. Default: DAILY_GAINERS when no filters supplied, INITIAL when filters supplied. Valid values: INITIAL, DAILY_GAINERS, DAILY_LOSERS, HIGH_OPTIONS_VOLUME_IV, UPCOMING_EARNINGS.
- filters (optional for a new scan, required with scan_id) — array of filter specs, enum and/or expression. Call get_scanner_filter_specs for enum filters; call get_scanner_datapoints before composing an expression.
- columns (optional) — extra result columns on top of the filters' own columns and the standard defaults. An expression matching a standard column's canonical form is saved as that standard column, canonical name included (e.g. "optionsPutDayVolume" always saves as "Total put volume"). When re-sending a column the scan already has, send it by display_name ALONE if it comes from one of the scan's filters or is a standard column, and by display_name plus its expression only if it is a column you yourself added with an expression. Do not echo back the expression get_scans reports for a filter-created or standard column: that is rejected with "column already exists from a filter".
- title (optional) — custom human-readable name for the scan.

Example: to make "stocks with RSI > 70 and volume > 1M", call with
  preset = "INITIAL"
  filters = [
    {"filter_type": "FILTER_TYPE_RSI", "predicate": ">", "values": ["70"], "interval": "1d", "length": 14},
    {"filter_type": "FILTER_TYPE_VOLUME", "predicate": ">", "values": ["1000000"], "interval": "1d"}
  ]
  title = "High RSI + High Volume"

Example: to save "stocks where put option volume exceeds call option volume" (no enum filter compares two datapoints), showing both volumes and the ratio as context, call with
  filters = [
    {"expression": "optionsPutDayVolume > optionsCallDayVolume", "predicate": "=", "values": ["True"], "display_title": "Put exceeds call"}
  ]
  columns = [
    {"display_name": "Put volume", "expression": "optionsPutDayVolume"},
    {"display_name": "Call volume", "expression": "optionsCallDayVolume"},
    {"display_name": "Put/Call ratio", "expression": "optionsPutDayVolume / optionsCallDayVolume"}
  ]
  title = "Put hedging screen"
  (the first two save under their canonical standard names, "Total put volume" and "Total call volume")

Example: to tighten that saved screen later without creating a second scan, call with
  scan_id = "<its scan_id from get_scans>"
  filters = [the scan's current filters, copied from get_scans (expressions verbatim, enum filters by filter_type_enum), with the desired change applied]
  columns = [the scan's current extra columns, copied from get_scans, if they should be kept]

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| scan_id | string | no | Optional. Update an existing scan by appending the given filters (and columns) as a NEW configuration version, which becomes the active one — earlier version… |
| preset | string | no | Starting preset for the new scan. One of: INITIAL (no preset; only valid if filters are provided), DAILY_GAINERS, DAILY_LOSERS, HIGH_OPTIONS_VOLUME_IV, UPCOM… |
| filters | null \| array | no | Custom filters, enum-based and/or expression-based. Enum filter: filter_type (FILTER_TYPE_... enum from get_scanner_filter_specs) plus predicate/values and o… |
| columns | null \| array | no | Optional result columns to display on top of what the filters and the standard default columns already show. Each column: display_name plus either an express… |
| title | string | no | Optional custom title for the saved scan. If omitted: a new scan gets Beacon's default title for the preset, and a scan_id update keeps the scan's existing t… |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.result: object
data.result.scan_id: string
data.result.scan_title: string
data.result.total_items: number
data.result.results: array<unknown>
data.result.sorted_by: string
data.result.cortex_managed: boolean
guide: string
```

**Captures:**

- [sc-create](captures/sc-create.json) — success — Create a probe scan — harvest scan_id. RESIDUE: no delete_scan tool exists; remove manually in app.

**Notes:**

- Create a probe scan — harvest scan_id. RESIDUE: no delete_scan tool exists; remove manually in app.

### get_scanner_datapoints

**Safety:** read-only · **Status:** probed

List the market-data datapoints available for building raw expressions: functions (with signatures) and fields, each with a category and description. Expressions serve two purposes — filters (screen on the expression's value) and columns (display it in results) — on preview_scan, create_scan and update_scan_config. Call this before constructing one; do not guess datapoint names or signatures.

For filters, use expressions only for screens no enum filter covers: check get_scanner_filter_specs first, and prefer an enum filter_type whenever one fits. For columns, a standard column referenced by display_name alone needs no expression at all.

Scoping a scan to a set of instruments is done here, not with an enum filter: the descriptive category's symbol field restricts a scan to named tickers or to an index's members. See the guide for the exact predicates.

Requires a category, since the full catalog is too large to return at once. Pass "technical", "price_volume", "fundamental", "options", "volatility", "quote" or "descriptive"; the response lists every category with a description so you can pick a different one if needed.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| category | string | yes | Which part of the catalog to return. One of: technical (chart studies - rsi, macd, adx, bollinger, pivots), price_volume (prices, changes, moving averages, v… |

**Response shape** (union over 9 success capture(s)):

```
data: object
data.datapoints: array<object>
data.datapoints[].name: string
data.datapoints[].kind: string
data.datapoints[].signature: string
data.datapoints[].description: string
data.datapoints[].value_type: string
data.datapoints[].examples: array<string>
data.categories: array<object>
data.categories[].name: string
data.categories[].description: string
data.categories[].datapoint_count: number
data.categories[].aliases: array<string>
data.argument_types: array<object>
data.argument_types[].name: string
data.argument_types[].argument_names: array<string>
data.argument_types[].values: array<string>
data.argument_types[].note: string
guide: string
```

**Captures:**

- [ro-scan-dp-01](captures/ro-scan-dp-01.json) — success — category=technical - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-02](captures/ro-scan-dp-02.json) — success — category=price_volume - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-03](captures/ro-scan-dp-03.json) — success — category=fundamental - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-04](captures/ro-scan-dp-04.json) — success — category=options - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-05](captures/ro-scan-dp-05.json) — success — category=volatility - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-06](captures/ro-scan-dp-06.json) — success — category=quote - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-07](captures/ro-scan-dp-07.json) — success — category=descriptive - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-08](captures/ro-scan-dp-08.json) — success — category=function - one of the nine documented slices (each a distinct payload).
- [ro-scan-dp-09](captures/ro-scan-dp-09.json) — success — category=field - one of the nine documented slices (each a distinct payload).

**Notes:**

- category=technical - one of the nine documented slices (each a distinct payload).
- category=price_volume - one of the nine documented slices (each a distinct payload).
- category=fundamental - one of the nine documented slices (each a distinct payload).
- category=options - one of the nine documented slices (each a distinct payload).
- category=volatility - one of the nine documented slices (each a distinct payload).
- category=quote - one of the nine documented slices (each a distinct payload).
- category=descriptive - one of the nine documented slices (each a distinct payload).
- category=function - one of the nine documented slices (each a distinct payload).
- category=field - one of the nine documented slices (each a distinct payload).

### get_scanner_filter_specs

**Safety:** read-only · **Status:** probed

List every valid scanner filter type and how to use it. Call this before constructing filters for create_scan or update_scan_filters — do not guess filter_type names.

This tool takes no parameters.

**Parameters (live inputSchema):**

_No parameters._

**Response shape** (union over 1 success capture(s)):

```
data: object
data.filter_specs: array<object>
data.filter_specs[].filter_type: string
data.filter_specs[].display_name: string
data.filter_specs[].filter_group: string
data.filter_specs[].value_type: string
data.filter_specs[].unit_type: string
data.filter_specs[].supported_predicates: array<string>
data.filter_specs[].options: array<string>
data.filter_specs[].supported_lengths: array<number>
data.filter_specs[].supported_intervals: array<string>
data.filter_specs[].supported_plots: array<string>
guide: string
```

**Captures:**

- [ro-scanfilters-01](captures/ro-scanfilters-01.json) — success — Filter catalog - source of filter_type for preview_scan.

**Notes:**

- Filter catalog - source of filter_type for preview_scan.

### get_scans

**Safety:** read-only · **Status:** probed

List the authenticated user's saved scanners (also called screeners). A scan is a saved set of filters and columns that filters the market for instruments matching specific criteria (e.g. "RSI > 70 and Volume > 1M"). The user creates these in Legend or via the create_scan tool.

Returns one entry per scan with its id, title, active filters, configured columns, sort order, and a flag indicating whether the scan is managed by Cortex (Legend's AI agent). Cortex-managed scans are read-only via MCP — they can be run with run_scan but not modified with update_scan_filters or update_scan_config.

This tool takes no parameters.

**Parameters (live inputSchema):**

_No parameters._

**Response shape** (union over 1 success capture(s)):

```
data: object
data.scans: array<unknown>
guide: string
```

**Captures:**

- [ro-scans-01](captures/ro-scans-01.json) — success — Saved scans - source of scan_id for run_scan.

**Notes:**

- Saved scans - source of scan_id for run_scan.

### preview_scan

**Safety:** simulation · **Status:** probed

Run a filter set against live market data and return the matching instruments WITHOUT saving a scan. Nothing is persisted and no scan_id is returned. A preview behaves exactly like creating a scan with these filters would — same filters, same default columns, same live evaluation — so it is the way to validate a filter set before create_scan or update_scan_filters.

Expression-based filters run here and save through create_scan (update_scan_filters rejects them). An expression filter sets expression (and omits filter_type): either a value expression with a numeric predicate (expression "dayVolume / volumeAvg(candleCount=30, candlePeriod=\"1d\", session=\"all\")", predicate PREDICATE_GREATER_THAN_OR_EQUAL, values ["1.5"]), or a boolean screen carrying the whole comparison inside the expression (expression "tradeAllDay.price > closeAvg(candleCount=50, candlePeriod=\"1d\", session=\"all\")", predicate PREDICATE_EQUAL, values ["True"]). An invalid expression comes back as a validation error from the market-data provider instead of failing a later save.

Prefer an enum filter_type whenever one covers the request — enum filters are pre-validated and render as standard, user-editable filters in Legend. Call get_scanner_filter_specs first; build a raw expression only when no enum filter covers the request.

Columns display values, filters screen. To show a datapoint in results without restricting matches, pass it in columns — never fake it with a no-op filter like ">= 0", which pollutes the scan's filter list. A column is a display_name plus an expression, or a standard column's display name alone ({"display_name": "Market cap"}). Scans read best with a few contextual columns supporting the filters (e.g. a put/call screen showing both raw volumes).

Parameters:
- filters (required, non-empty) — the complete filter set to evaluate.
- columns (optional) — extra result columns on top of the filters' own columns and the standard defaults. Note: an expression matching a standard column's canonical form is shown as that standard column, canonical name included.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| filters | null \| array | yes | Filters to evaluate, enum-based and/or expression-based. Enum filter: filter_type from get_scanner_filter_specs plus predicate/values and optional interval/l… |
| columns | null \| array | no | Optional result columns to display on top of what the filters and the standard default columns already show. Each column: display_name plus either an express… |

**Response shape** (union over 5 success capture(s)):

```
data: object
data.result: object
data.result.total_items: number
data.result.results: array<object>
data.result.results[].ticker: string
data.result.results[].instrument_id: string
data.result.results[].instrument_type: string
data.result.results[].columns: object
data.result.results[].columns.% Change: string
data.result.results[].columns.Asset type: string
data.result.results[].columns.Last: string
data.result.results[].columns.Name: string
data.result.results[].columns.Net change: string
data.result.results[].columns.Symbol: string
data.result.results[].columns.Volume: string
data.result.results[].columns.Forward P/E: string
data.result.results[].columns.Market cap: string
data.result.results[].columns.RSI: string
data.result.results[].columns.P/C volume: string
data.result.sorted_by: string
data.result.filters_applied: array<object>
data.result.filters_applied[].filter_type: string
data.result.filters_applied[].filter_type_enum: string
data.result.filters_applied[].predicate: string
data.result.filters_applied[].values: array<string>
data.result.filters_applied[].expression: string
data.result.filters_applied[].interval: string
data.result.filters_applied[].plot: string
guide: string
```

**Errors observed:** 2 capture(s), 2 distinct shape(s)

**Captures:**

- [dep-prev-scan-01](captures/dep-prev-scan-01.json) — success — filters objects with enum filter_type harvested from get_scanner_filter_specs.
- [dep-prev-scan-02](captures/dep-prev-scan-02.json) — success — filters + columns objects both exercised.
- [dep-prev-scan-03](captures/dep-prev-scan-03.json) — error — filter interval/length/plot/display_title exercised on a parameterized RSI filter.
- [dep-prev-scan-04](captures/dep-prev-scan-04.json) — success — Expression filter (numeric-predicate form) + display_title; column expression/visible/order.
- [dep-prev-scan-05](captures/dep-prev-scan-05.json) — success — Boolean-comparison expression form per schema doc: predicate "=" + values ["True"]. May reject the literal predicate - error names valid wire enums.
- [dep-prev-scan-06](captures/dep-prev-scan-06.json) — error — filter interval/length/plot on an enum filter (display_title dropped - expression-only per dep-prev-scan-03 error).
- [dep-prev-scan-07](captures/dep-prev-scan-07.json) — success — plot on a filter that supports it (Close, from supported_plots). dep-prev-scan-06 proved plot is NOT validated pre-flight: RSI + plot produced a malformed DXFeed expression.

**Notes:**

- filters objects with enum filter_type harvested from get_scanner_filter_specs.
- filters + columns objects both exercised.
- filter interval/length/plot/display_title exercised on a parameterized RSI filter.
- Expression filter (numeric-predicate form) + display_title; column expression/visible/order.
- Boolean-comparison expression form per schema doc: predicate "=" + values ["True"]. May reject the literal predicate - error names valid wire enums.
- plot on RSI (no supported_plots): server does NOT validate plot pre-flight - produced a malformed DXFeed expression. Kept as bug evidence.
- plot on a filter that supports it (Close, from supported_plots). dep-prev-scan-06 proved plot is NOT validated pre-flight: RSI + plot produced a malformed DXFeed expression.

### run_scan

**Safety:** read-only · **Status:** error-only

Execute a saved scanner (also called screener) and return live market results. A scan's filters are evaluated against current market data at request time — results are real-time, not cached.

Returns the scan's title, the total number of matching instruments, a list of instrument rows (with ticker, instrument_id, type, and one cell per visible column), plus the active sort and filters. The agent should present results as a table and mention this is live data.

Parameters:
- scan_id (required) — the scan identifier from get_scans or create_scan. Returns an error if the scan does not exist or does not belong to the calling user.

Use get_scans first to discover available scan_ids if the user has not specified one.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| scan_id | string | yes | The scan identifier to execute. Get this from get_scans or create_scan. |

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-run-scan-01](captures/dep-run-scan-01.json) — error — scan_id exercised with synthetic id - account has no saved scans (create_scan is a mutation); expect not-found error.

**Notes:**

- scan_id exercised with synthetic id - account has no saved scans (create_scan is a mutation); expect not-found error.

### update_scan_config

**Safety:** account write · **Status:** probed

Change the sort order of a saved scan's results table, and/or replace its extra result columns. The scan's filters are always preserved.

Parameters:
- scan_id (required) — the scan to modify.
- sorting_column (required unless columns is provided) — display name of the column to sort by. Must match a column on the scan; the error response lists available columns when no match is found.
- sorting_direction — "asc" or "desc". Required with sorting_column.
- columns (optional) — REPLACE the scan's extra result columns (beyond the filters' own columns and the standard defaults). The scan keeps its current filters verbatim and gets a new configuration version — earlier versions are preserved. To add one column, pass the complete intended set (current columns from get_scans plus the new one). When re-sending a column the scan already has, send it by display_name ALONE if it comes from one of the scan's filters or is a standard column, and by display_name plus its expression only if it is a column you yourself added with an expression. Do not echo back the expression get_scans reports for a filter-created or standard column: that is rejected with "column already exists from a filter". Columns display values, filters screen — to show a datapoint without restricting results, this is the tool, never a no-op filter.

Restrictions:
- Cortex-managed scans (cortex_managed: true in get_scans) are rejected.
- Omitted/empty columns means sorting-only. To remove every extra column, use create_scan with this scan's scan_id and its current filters.
- An expression matching a standard column's canonical form is saved as that standard column, canonical name included.

Returns the scan with the changes applied and fresh live results.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| scan_id | string | yes | The scan to modify. Get this from get_scans or create_scan. Cortex-managed scans are rejected. |
| sorting_column | string | no | Display name of the column to sort by (e.g. "Volume", "% Change", "RSI"). Must match a column on the scan — call get_scans / run_scan first to see available … |
| sorting_direction | string | no | "asc" or "desc" (ascending or descending). Required with sorting_column. |
| columns | null \| array | no | REPLACE the scan's extra result columns (the ones beyond what its filters and the standard defaults contribute): the scan keeps its current filters verbatim … |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.result: object
data.result.scan_id: string
data.result.scan_title: string
data.result.total_items: number
data.result.results: array<unknown>
data.result.sorted_by: string
data.result.cortex_managed: boolean
guide: string
```

**Captures:**

- [sc-update-config](captures/sc-update-config.json) — success — Sort the probe scan — set SCAN_ID from sc-create.

**Notes:**

- Sort the probe scan — set SCAN_ID from sc-create.

### update_scan_filters

**Safety:** account write · **Status:** probed

Replace the filters on an existing saved scan. The complete filter set provided replaces whatever filters the scan had — this is REPLACE semantics, not merge. To add a single filter to an existing scan, the agent must first read the scan (via get_scans or run_scan), then call this tool with all the existing filters plus the new one.

Parameters:
- scan_id (required) — the scan to modify. Get from get_scans or create_scan.
- filters (required) — the complete new filter set. Send [] to clear all filters. Each filter has filter_type (FILTER_TYPE_... enum), predicate, values, optional interval/length. Call get_scanner_filter_specs for valid combinations.

Restrictions:
- Cortex-managed scans (cortex_managed: true in get_scans) are rejected with a user-friendly error.
- Returns an error and does not apply any change if any filter fails validation.

Returns the scan with its new filters and fresh live results.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| scan_id | string | yes | The scan to modify. Get this from get_scans or create_scan. Cortex-managed scans (cortex_managed: true in get_scans output) are rejected. |
| filters | null \| array | yes | The complete set of filters the scan should have after the update. REPLACE semantics — to add a filter, supply all existing filters plus the new one. To remo… |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.result: object
data.result.scan_id: string
data.result.scan_title: string
data.result.total_items: number
data.result.results: array<object>
data.result.results[].ticker: string
data.result.results[].instrument_id: string
data.result.results[].instrument_type: string
data.result.results[].columns: object
data.result.results[].columns.% Change: string
data.result.results[].columns.Asset type: string
data.result.results[].columns.Last: string
data.result.results[].columns.Market cap: string
data.result.results[].columns.Name: string
data.result.results[].columns.Net change: string
data.result.results[].columns.Relative volume: string
data.result.results[].columns.Symbol: string
data.result.results[].columns.Volume: string
data.result.sorted_by: string
data.result.filters_applied: array<object>
data.result.filters_applied[].filter_type: string
data.result.filters_applied[].filter_type_enum: string
data.result.filters_applied[].predicate: string
data.result.filters_applied[].values: array<string>
data.result.filters_applied[].expression: string
data.result.cortex_managed: boolean
guide: string
```

**Captures:**

- [sc-update-filters](captures/sc-update-filters.json) — success — Set an enum filter — shape proven by dep-prev-scan-01 (filter_type_enum required, not display label).

**Notes:**

- Set an enum filter — shape proven by dep-prev-scan-01 (filter_type_enum required, not display label).

