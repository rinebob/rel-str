# Robinhood MCP — Watchlists

> Part of the [canonical tool discovery](rh-mcp-tool-discovery-canonical-657-658-689.md) — 11 tools in this group.

### add_option_to_watchlist

**Safety:** account write · **Status:** probed

Add option contracts to the user's options watchlist. Works for both equity options (AAPL, NVDA) and index options (SPX, NDX, RUT). Source option_ids from get_option_instruments. Confirm with the user before calling — this is a real write.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| option_ids | null \| array | yes | Option contract UUIDs to add. Each becomes a single-leg position on the user's options watchlist. Source from get_option_instruments. |
| position_type | string | no | "long" (default) or "short". Applies to every option_id in this call. For mixed long/short adds, issue two calls. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.option_ids: array<string>
data.position_type: string
data.list_id: string
data.operation: string
data.status: string
guide: string
```

**Captures:**

- [wl-add-opt](captures/wl-add-opt.json) — success — Add NFLX 70C to the options watchlist — NOTE: schema has no list_id (options land in a dedicated option watchlist).

**Notes:**

- Add NFLX 70C to the options watchlist — NOTE: schema has no list_id (options land in a dedicated option watchlist).

### add_to_watchlist

**Safety:** account write · **Status:** probed

Add items to a watchlist. Exactly one of symbols (stocks/ETFs), currency_pair_ids (crypto), or index_ids (market indexes like SPX, NDX) is required — mutually exclusive. For options use add_option_to_watchlist (separate dedicated watchlist). Futures still require the Robinhood app. Already-present items are no-ops. Confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the watchlist to add items to. |
| symbols | null \| array | no | Stock symbols to add (e.g. ['AAPL', 'NVDA']). US stocks and ETFs only. Mutually exclusive with currency_pair_ids and index_ids. |
| currency_pair_ids | null \| array | no | Currency-pair UUIDs to add (e.g. the object_id from get_watchlist_items where object_type=currency_pair, or the id from get_currency_pairs). Mutually exclusi… |
| index_ids | null \| array | no | Market-index UUIDs to add (the id field from get_indexes; SPX, NDX, DJI, etc.). Mutually exclusive with symbols and currency_pair_ids. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.symbols: array<string>
data.object_type: string
data.list_id: string
data.operation: string
data.status: string
guide: string
```

**Captures:**

- [wl-add-eq](captures/wl-add-eq.json) — success — Add equity symbol to the probe list — set WL_ID from wl-create.

**Notes:**

- Add equity symbol to the probe list — set WL_ID from wl-create.

### create_watchlist

**Safety:** account write · **Status:** probed

Create a new custom watchlist for the user — a real write. When the user has already specified the name, call this directly; ask for a name first only when they have not. Do not use this to follow a Robinhood-curated list (use follow_watchlist).

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| display_name | string | yes | Name for the new watchlist (e.g. 'Tech Stocks'). Must be unique among the user's watchlists. |
| icon_emoji | string | no | Emoji shown next to the name (one character). |
| display_description | string | no | Short description shown under the name. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.watchlist: object
data.watchlist.id: string
data.watchlist.display_name: string
data.watchlist.display_description: string
data.watchlist.icon_emoji: string
data.watchlist.owner_type: string
data.watchlist.item_count: number
data.watchlist.allowed_object_types: array<string>
guide: string
```

**Captures:**

- [wl-create](captures/wl-create.json) — success — Create a probe watchlist — harvest list_id for the rest of the lifecycle. RESIDUE: no delete_watchlist tool exists; the list must be removed manually.

**Notes:**

- Create a probe watchlist — harvest list_id for the rest of the lifecycle. RESIDUE: no delete_watchlist tool exists; the list must be removed manually.

### follow_watchlist

**Safety:** account write · **Status:** probed

Follow a Robinhood-curated list so it appears in the user's watchlists. Confirm with the user before calling. Use only for curated lists; the user already owns their custom lists.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the Robinhood-curated list to follow. Obtain from get_popular_watchlists. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.follower: object
data.follower.list_id: string
data.follower.user_id: string
data.follower.owner_type: string
data.follower.created_at: string
data.list_id: string
data.action: string
data.status: string
guide: string
```

**Captures:**

- [wl-follow](captures/wl-follow.json) — success — Follow the curated 'Trending stocks' list — set POPWL_ID from ro-popwl-01.

**Notes:**

- Follow the curated 'Trending stocks' list — set POPWL_ID from ro-popwl-01.

### get_popular_watchlists

**Safety:** read-only · **Status:** probed

Discover Robinhood-curated lists the user can follow (e.g. '100 Most Popular', 'Daily Movers'). Use to find a list_id, then pass it to follow_watchlist.

**Parameters (live inputSchema):**

_No parameters._

**Response shape** (union over 1 success capture(s)):

```
data: object
data.lists: array<object>
data.lists[].id: string
data.lists[].display_name: string
data.lists[].item_count: number
data.lists[].is_badged: boolean
guide: string
```

**Captures:**

- [ro-popwl-01](captures/ro-popwl-01.json) — success — Popular/public watchlists.

**Notes:**

- Popular/public watchlists.

### get_watchlist_items

**Safety:** read-only · **Status:** probed

List the items in a watchlist. Items may be stocks/ETFs, crypto pairs, futures, indexes — distinguished by object_type. For the options watchlist, use get_option_watchlist instead — this tool returns a generic shape that drops the strategy-specific fields and the upstream rejects it with 400 anyway. Does not return live prices; call get_quotes with the symbol(s) for that.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the watchlist whose items to fetch. Obtain from get_watchlists or get_popular_watchlists. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.items: array<object>
data.items[].object_id: string
data.items[].object_type: string
data.items[].symbol: string
data.has_futures_contracts: boolean
guide: string
```

**Errors observed:** 1 capture(s), 1 distinct shape(s)

**Captures:**

- [dep-watchlist-items-01](captures/dep-watchlist-items-01.json) — success — list_id harvested from get_watchlists (list "ETFs", item_count=2).
- [err-watchlist-bad-id](captures/err-watchlist-bad-id.json) — error — Deliberate error: well-formed nonexistent list UUID.

**Notes:**

- list_id harvested from get_watchlists (list "ETFs", item_count=2).
- Deliberate error: well-formed nonexistent list UUID.

### get_watchlists

**Safety:** read-only · **Status:** probed

List the user's watchlists, including both user-created custom lists and Robinhood-curated lists the user follows. Use to look up list_id values for other watchlist tools.

**Parameters (live inputSchema):**

_No parameters._

**Response shape** (union over 1 success capture(s)):

```
data: object
data.watchlists: array<object>
data.watchlists[].id: string
data.watchlists[].display_name: string
data.watchlists[].icon_emoji: string
data.watchlists[].owner_type: string
data.watchlists[].item_count: number
data.watchlists[].allowed_object_types: array<string>
guide: string
```

**Captures:**

- [ro-watchlists-01](captures/ro-watchlists-01.json) — success — User watchlists - source of list_id.

**Notes:**

- User watchlists - source of list_id.

### remove_from_watchlist

**Safety:** account write · **Status:** probed

Remove items from a watchlist. Exactly one of symbols (stocks/ETFs), currency_pair_ids (crypto), or index_ids (market indexes) is required — mutually exclusive. For options use remove_option_from_watchlist. Items not on the list are no-ops (not errors). Confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the watchlist to remove items from. |
| symbols | null \| array | no | Stock symbols to remove (e.g. ['AAPL']). Mutually exclusive with currency_pair_ids and index_ids. |
| currency_pair_ids | null \| array | no | Currency-pair UUIDs to remove. Mutually exclusive with symbols and index_ids. |
| index_ids | null \| array | no | Index UUIDs to remove. Mutually exclusive with symbols and currency_pair_ids. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.symbols: array<string>
data.object_type: string
data.list_id: string
data.operation: string
data.status: string
guide: string
```

**Captures:**

- [wl-rm-eq](captures/wl-rm-eq.json) — success — Remove OOMA from the probe list.

**Notes:**

- Remove OOMA from the probe list.

### remove_option_from_watchlist

**Safety:** account write · **Status:** probed

Remove option contracts from the user's options watchlist. Specify the same position_type used when the contract was added (defaults to "long"). Contracts not on the list are no-ops. Confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| option_ids | null \| array | yes | Option contract UUIDs to remove. The position_type must match how each contract was added (most likely "long"). |
| position_type | string | no | "long" (default) or "short". Must match how the contract was originally added. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.option_ids: array<string>
data.position_type: string
data.list_id: string
data.operation: string
data.status: string
guide: string
```

**Captures:**

- [wl-rm-opt](captures/wl-rm-opt.json) — success — Remove the NFLX 70C — position_type must match how it was added.

**Notes:**

- Remove the NFLX 70C — position_type must match how it was added.

### unfollow_watchlist

**Safety:** account write · **Status:** probed

Stop following a Robinhood-curated list. The list itself is unchanged — it just no longer appears in the user's watchlists. Confirm with the user before calling.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the Robinhood-curated list to unfollow. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.list_id: string
data.action: string
data.status: string
guide: string
```

**Captures:**

- [wl-unfollow](captures/wl-unfollow.json) — success — Unfollow it again — clean lifecycle round-trip.

**Notes:**

- Unfollow it again — clean lifecycle round-trip.

### update_watchlist

**Safety:** account write · **Status:** probed

Rename a custom watchlist or change its icon/description. Robinhood-curated lists cannot be renamed; the call will fail with 404. Provide at least one of display_name, icon_emoji, display_description.

**Parameters (live inputSchema):**

| param | type | required | description |
|---|---|---|---|
| list_id | string | yes | UUID of the watchlist to update. Obtain from get_watchlists. |
| display_name | string | no | New name for the watchlist. |
| icon_emoji | string | no | New emoji. |
| display_description | string | no | New description. |

**Response shape** (union over 1 success capture(s)):

```
data: object
data.watchlist: object
data.watchlist.id: string
data.watchlist.display_name: string
data.watchlist.display_description: string
data.watchlist.icon_emoji: string
data.watchlist.owner_type: string
data.watchlist.item_count: number
data.watchlist.allowed_object_types: array<string>
guide: string
```

**Captures:**

- [wl-update](captures/wl-update.json) — success — Rename the probe list.

**Notes:**

- Rename the probe list.

