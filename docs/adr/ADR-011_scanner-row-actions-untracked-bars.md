# ADR-011: Scanner Row Actions — On-Demand RH Bars for Untracked Symbols

## Status

Accepted

## Context

Topic #1098 (RH Scanner), Thread #1295 (Scanner Row Actions) adds per-row
actions to the auto-run scanner page: a hover/click chart popup and a
triage-list assignment menu, plus a page-wide new/tracked/all filter.

The scanner's primary output is **untracked** symbols — the discovery use
case is finding candidates not yet in the Tracked Symbol Universe. But the
chart components ST owns all read the synced `symbol-data/{SYMBOL}` bar
subcollections, which the SDS pipeline only writes for universe members.
An untracked scan hit has no synced bars: a card-chart reuse would render
"unavailable" on precisely the rows the feature exists for.

The user wants a *quick look* sized to the data available: tracked rows
get the real gallery card chart; untracked rows get a candlestick chart
with MA 10/20/50.

## Decision

**The hover popup is dual-mode by tracked status:**

- **Tracked rows** render the actual gallery card chart (multi-pane —
  trend bands, strength, zone panes, signal dots) on synced
  `symbol-data` bars via the existing `GalleryCardChartStore` path.
- **Untracked rows** fetch bars on demand through the RH MCP observation
  channel (`get_equity_historicals` via
  `RobinhoodMcpObservationService` — the same client the scanner uses
  for `preview_scan`), rendered as a **candlestick chart with proper
  up/down coloring plus MA 10/20/50 overlays**. Bars are session-cached
  per symbol; nothing is persisted to Firestore and no
  indicator-callable warm-up runs (the MA overlays compute client-side
  from the fetched bars).

Row list-assignment writes **list membership only** — `toggleSymbolInList`
against the exclusive triage set (NEW/PRIMARY/SECONDARY/NEUTRAL/AVOID/
HIDE). Universe enrollment for untracked symbols is **deferred**: the
Tracked Symbol Universe is upstream-owned (SA-side), and no add endpoint
exists today. A list-added untracked symbol remains "new" until the
universe picks it up.

## Considered Options

- **Reuse `gallery-card-chart` + `GalleryCardChartStore`** — rejected:
  its bars come from `LocalBarReadService` (synced shards only), so it
  structurally cannot render untracked symbols. Its indicator-pane
  weight is also the wrong fidelity for a hover preview.
- **Chart only for tracked rows** — rejected: removes the feature's core
  value; discovery symbols are the untracked set.
- **Universe enrollment on list-add (backend trigger)** — wanted but
  deferred: no SA-side add-to-tracked endpoint exists; recorded as a
  follow-up dependency in the PRD.
- **Persist fetched bars to `symbol-data`** — rejected: pollutes the
  canonical synced store with a single-user, single-session fetch of
  unverified provenance; SDS owns that corpus.

## Consequences

- The scanner page gains its first non-`preview_scan` RH tool call;
  auth-error taxonomy (banner + reauth) applies to chart fetches the
  same way — a chart fetch on an expired session surfaces the reauth
  affordance, not a silent empty chart.
- Fetch latency (~1s) lands on hover intent — the popup shows a loading
  state rather than delaying table render.
- Session-scoped cache means a symbol hovered across several recipe
  tables pays one fetch.
- If SA later ships an add-to-tracked endpoint, the "list + track"
  upgrade is a store-method change, not a UI redesign — the row action
  already routes through `SymbolListStore`.
