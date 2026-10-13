# Robinhood MCP — Alerts

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 6 tools in this group.

### create_alert

**Safety:** account write · **Status:** probed

Create a price or indicator alert on an equity or crypto symbol. Confirm the symbol and condition with the user before calling — this is a real write; when it fires the user gets their usual Robinhood notification.

Parameter rules:
- price_above / price_below / price_crosses: threshold is the trigger price. Do not send indicator.
- sma_above, sma_below, sma_crosses, ema_above, ema_below, ema_crosses, vwap_above, vwap_below, vwap_crosses, rsi_above, rsi_below, rsi_crosses (the indicator's own value vs your target): threshold is the target indicator value AND indicator is required.
- price_above_sma, price_below_sma, price_crosses_sma, price_above_ema, price_below_ema, price_crosses_ema, price_above_vwap, price_below_vwap, price_crosses_vwap, price_above_boll_upper, price_below_boll_lower, price_crosses_boll_mid, macd_above_signal, macd_below_signal, macd_crosses_signal (price vs indicator line): indicator only — do not send threshold.
- Pick the family by WHAT crosses WHAT: sma_crosses means the SMA's own value crosses your numeric threshold; price_crosses_sma means the market price crosses the SMA line and takes no threshold. "Alert me when the price crosses the 50-day SMA" is price_crosses_sma, never sma_crosses — a mixed-up sibling still creates a well-formed but wrong alert.
- indicator fields: period + interval_secs for sma/ema/rsi; interval_secs only for vwap (must be 300 / 5m bars); fast_period + slow_period + signal_period + interval_secs for macd; period + std_dev + ma_type + interval_secs for boll.
- Crypto symbols support price conditions only.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbol | string | yes | The equity symbol or crypto asset the alert watches, e.g. AAPL or BTC. |
| asset_class | string | no | Optional: equity or crypto, pinning which asset the symbol names. When omitted the symbol is resolved as an equity first, then as crypto. |
| condition_type | string | yes | The alert condition: price_above, price_below, price_crosses, sma_above, sma_below, sma_crosses, ema_above, ema_below, ema_crosses, vwap_above, vwap_below, v… |
| threshold | string | no | Decimal string: the trigger price for price conditions, or the target indicator value for sma_above-style conditions. Not used for price-vs-indicator-line co… |
| indicator | null \| object | no | Indicator configuration. Required for every indicator condition; not used for price conditions. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.alert: object
data.alert.alert_id: string
data.alert.asset_class: string
data.alert.symbol: string
data.alert.display_name: string
data.alert.enabled: boolean
data.alert.condition_type: string
data.alert.condition: object
data.alert.condition.target_price: string
data.alert.created_at: string
data.alert.updated_at: string
guide: string
```

**Captures:**

- [al-create](captures/al-create.json) — success — Create a far-below-market alert — harvest alert_id for update/delete.

**Notes:**

- Create a far-below-market alert — harvest alert_id for update/delete.

### delete_alert

**Safety:** account write · **Status:** probed

Permanently delete a price or indicator alert, with a server-enforced confirmation step: a call without confirm deletes nothing and returns a preview of exactly what would be deleted; show that preview to the user, and only after they approve call again with confirm=true. There is no undo. If the user only wants to stop notifications for a while, disable the alert with update_alert (enabled=false) instead of deleting it.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| alert_id | string | yes | The alert to delete — take it from get_alerts or create_alert; never construct one. |
| confirm | boolean | no | Set true only after the user approved the preview returned by a prior call without confirm. Omitted or false = preview only: nothing is deleted. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.deleted: boolean
data.alert: object
data.alert.alert_id: string
data.alert.asset_class: string
data.alert.symbol: string
data.alert.display_name: string
data.alert.enabled: boolean
data.alert.condition_type: string
data.alert.condition: object
data.alert.condition.target_price: string
data.alert.created_at: string
data.alert.updated_at: string
guide: string
```

**Captures:**

- [al-delete](captures/al-delete.json) — success — Delete the probe alert — confirm:true is the documented operator-consent flag.

**Notes:**

- Delete the probe alert — confirm:true is the documented operator-consent flag.

### get_alert_log

**Safety:** read-only · **Status:** probed

Read the log of fired alerts — what fired, when, and at what price or indicator value — with read/unread state. Poll this to learn whether any alert has fired; alert events are not pushed to the agent.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| asset_class | string | no | Optional: equity or crypto, limiting the log to one asset class. Omitted = all classes. |
| since | string | no | Optional RFC3339 timestamp: only events triggered at or after this instant. Omitted = the full retention window. |
| cursor | string | no | Opaque pagination token from a prior response's next_cursor. Omit for the first page. When passing a cursor, repeat the same asset_class, since, and limit as… |
| limit | integer | no | Max events per page, 1-100. Omitted = 20. Raise it (e.g. to 100) to collect a full mark_alerts_read batch in one page. |

**Response shape** (union over 4 success capture(s)):

```
data: object
data.events: array<unknown>
data.total_unread_count: number
guide: string
```

**Captures:**

- [ro-alertlog-01](captures/ro-alertlog-01.json) — success — Alert log, default page (20).
- [ro-alertlog-02](captures/ro-alertlog-02.json) — success — asset_class=equity.
- [ro-alertlog-03](captures/ro-alertlog-03.json) — success — asset_class=crypto.
- [ro-alertlog-04](captures/ro-alertlog-04.json) — success — since bound + limit=5 (min-page for cursor discovery).

**Notes:**

- Alert log, default page (20).
- asset_class=equity.
- asset_class=crypto.
- since bound + limit=5 (min-page for cursor discovery).

### get_alerts

**Safety:** read-only · **Status:** probed

List the price/indicator alerts the user currently has configured (equities and crypto only), optionally filtered to one symbol. Use to look up alert_id values for update_alert/delete_alert, or to check what's currently being watched.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| symbol | string | no | Filter to one asset's alerts, e.g. AAPL or BTC. Omit for all alerts. |
| asset_class | string | no | Only alongside symbol: equity or crypto, pinning which asset the symbol names. When omitted the symbol is resolved as an equity first, then as crypto. Cannot… |
| cursor | string | no | Pagination cursor from a previous response's next_cursor. Omit for the first page. |

**Response shape** (union over 4 success capture(s)):

```
data: object
data.alerts: array<unknown>
data.alert_limit_reached: boolean
guide: string
```

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-alerts-03](captures/dep-alerts-03.json) — error — asset_class WITHOUT symbol - schema says "cannot be used without symbol"; expect validation error.
- [ro-alerts-01](captures/ro-alerts-01.json) — success — All alerts.
- [ro-alerts-02](captures/ro-alerts-02.json) — success — symbol+asset_class=equity.
- [ro-alerts-03](captures/ro-alerts-03.json) — success — symbol+asset_class=crypto.
- [ro-alerts-04](captures/ro-alerts-04.json) — success — symbol only - exercises equity-first resolution order.

**Notes:**

- All alerts.
- symbol+asset_class=equity.
- symbol+asset_class=crypto.
- symbol only - exercises equity-first resolution order.
- asset_class WITHOUT symbol - schema says "cannot be used without symbol"; expect validation error.

### mark_alerts_read

**Safety:** account write · **Status:** probed

Mark fired alerts as read so already-handled events are not reported to the user twice. Call it after relaying fired alerts from get_alert_log.

Parameter rules:
- Provide exactly one of alert_log_ids or all_through.
- alert_log_ids marks specific events; all_through marks every event triggered at or before that instant, across ALL symbols — not only the ones just discussed.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| alert_log_ids | null \| array | no | Fired-alert event ids from get_alert_log's alert_log_id (never alert_id). At most 100 per call — the server enforces the exact cap and rejects oversized batc… |
| all_through | string | no | RFC3339 timestamp: mark every event triggered at or before this instant as read, across all symbols. Set it to the triggered_at of the newest event you relay… |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.marked: boolean
data.scope: string
data.alert_log_id_count: number
guide: string
```

**Captures:**

- [err-markalerts-bad-id](captures/err-markalerts-bad-id.json) — success — Deliberate error: nonexistent alert log ids — harmless; cannot match real alerts.

**Notes:**

- Deliberate error: nonexistent alert log ids — harmless; cannot match real alerts.

### update_alert

**Safety:** account write · **Status:** probed

Change an existing price or indicator alert: enable/disable it, adjust its threshold or indicator settings, or switch its condition within the same family. Confirm the change with the user before calling — this is a real write.

Parameter rules:
- At least one of enabled, condition_type, threshold, or indicator is required; only the fields you send change, the rest keep their stored values.
- condition_type may only change within the alert's current condition family — e.g. price_above -> price_below, or sma_above -> price_above_sma (both sma family). To change the indicator family or the symbol, create a new alert instead.
- threshold/indicator rules per condition family match create_alert; conditions comparing price to an indicator line take no threshold.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| alert_id | string | yes | The alert to change — take it from get_alerts or create_alert; never construct one. |
| enabled | null \| boolean | no | Set false to pause the alert or true to re-enable it. Omitted = unchanged. |
| condition_type | string | no | New condition for the alert — same vocabulary as create_alert. Omitted = unchanged. |
| threshold | string | no | New trigger price or target indicator value, as a decimal string. Omitted = unchanged. |
| indicator | null \| object | no | New indicator configuration — replaces the stored one wholesale, so send the complete configuration when provided. Omitted = unchanged. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.alert: object
data.alert.alert_id: string
data.alert.asset_class: string
data.alert.symbol: string
data.alert.display_name: string
data.alert.enabled: boolean
data.alert.condition_type: string
data.alert.condition: object
data.alert.condition.target_price: string
data.alert.created_at: string
data.alert.updated_at: string
guide: string
```

**Captures:**

- [al-update](captures/al-update.json) — success — Change the trigger — set ALERT_ID from al-create.

**Notes:**

- Change the trigger — set ALERT_ID from al-create.

