# Topics Inventory

Snapshot of all `Topic:` anchor issues in `rinebob/rel-str`, captured 2026-09-26 via `/proj list`.
Regenerate with `/proj list` — this file is a point-in-time reference, not a live view.

25 topics — 24 open, 1 closed. Threads are listed as child items under their Topic. `(legacy)` = pre-Thread Topic whose direct stage hierarchy acts as one implicit legacy Thread.

Open topics are organized under proposed super-groups (derived 2026-09-26 from domain labels and work area — organizational overlay only, no issue changes). Boundary notes:

- #326 (in B) is labeled OPTIONS but is a chart/analysis surface on options data — could sit in A or B.
- #433 (in F) is labeled SIGNAL-REVIEW but is pipeline maintenance — belongs with #159/#162 conceptually.
- #219's Order Placement thread (#279) overlaps #176's broker work — the portfolio/trading boundary is already fuzzy.
- `STRAT-BUILD-UI`, `SAV-TRAD-NAV`, `TESTING`, `INDICATOR-LIB`, `WATCHLIST`, `FLEX-CHART`, `SPREAD-VIEWER`, `PAPER-TRADING` labels are in use but absent from `project-config.json`'s `domainLabels`.

## Open Topics

### A. Options & Spread Engine (pricing backend)

- **[#108 — Options Position Strategy Engine](https://github.com/rinebob/rel-str/issues/108)** · CORE · 1_IDEA · IN PROGRESS
  - *(legacy)*

- **[#139 — Extend Option Strategy Engine to All Spread Types](https://github.com/rinebob/rel-str/issues/139)** · `—` · *(no stage label)* · *(status not set)*
  - *(legacy — no descendants)*

- **[#486 — Current option pricing](https://github.com/rinebob/rel-str/issues/486)** · FEATURE · 1_IDEA · IN PROGRESS
  - [#487 — Today's option pricing view](https://github.com/rinebob/rel-str/issues/487) · 8_LIVE · RESOLVED · CLOSED
  - [#571 — Contract selection](https://github.com/rinebob/rel-str/issues/571) · 1_IDEA · IN PROGRESS

### B. Options & Spread Analysis Surfaces (UI)

- **[#77 — Spread Time Series Viewer](https://github.com/rinebob/rel-str/issues/77)** · `—` · *(no stage label)* · IN PROGRESS
  - *(legacy)*

- **[#106 — Trading Strategy Library](https://github.com/rinebob/rel-str/issues/106)** · FEATURE · 1_IDEA · IN PROGRESS
  - [#253 — Simple Open-Close Long](https://github.com/rinebob/rel-str/issues/253) · 3_BLUEPRINT · RESOLVED · CLOSED

- **[#137 — Strategy Builder UI](https://github.com/rinebob/rel-str/issues/137)** · `—` · 4_BACKLOG · IN PROGRESS
  - *(legacy)*

- **[#326 — Option chain percent change grid](https://github.com/rinebob/rel-str/issues/326)** · FEATURE · 4_BACKLOG · IN PROGRESS
  - [#327 — Option chain percent change grid](https://github.com/rinebob/rel-str/issues/327) · 8_LIVE · RESOLVED · CLOSED
  - [#357 — Misc fixes for option pct change grid](https://github.com/rinebob/rel-str/issues/357) · 4_BACKLOG · IN PROGRESS
  - [#359 — Pivot-signal selector](https://github.com/rinebob/rel-str/issues/359) · 8_LIVE · RESOLVED · CLOSED
  - [#361 — Save param configuration](https://github.com/rinebob/rel-str/issues/361) · 8_LIVE · IN PROGRESS · CLOSED
  - [#400 — Contract chart popup](https://github.com/rinebob/rel-str/issues/400) · 8_LIVE · RESOLVED · CLOSED
  - [#504 — Corpus-backed chain data](https://github.com/rinebob/rel-str/issues/504) · 3_BLUEPRINT · RESOLVED · CLOSED

### C. Indicator Library & Swing Analysis (ST suite)

- **[#261 — Trading Indicator Library](https://github.com/rinebob/rel-str/issues/261)** · FEATURE · 1_IDEA · IN PROGRESS
  - [#262 — Standard Deviation Lines](https://github.com/rinebob/rel-str/issues/262) · 3_BLUEPRINT · IN PROGRESS
  - [#304 — Trend Rider Zero Cross](https://github.com/rinebob/rel-str/issues/304) · 3_BLUEPRINT · IN PROGRESS
  - [#322 — ST ZigZag Indicator](https://github.com/rinebob/rel-str/issues/322) · 8_LIVE · RESOLVED

- **[#594 — Swing Analysis Page](https://github.com/rinebob/rel-str/issues/594)** · FEATURE · 2_PLAN · IN PROGRESS · *(re-parented out of #261 on 2026-09-26)*
  - [#383 — Dual ST ZigZag Overlay](https://github.com/rinebob/rel-str/issues/383) · 8_LIVE · RESOLVED
  - [#414 — Misc fixes & polish — swing analysis](https://github.com/rinebob/rel-str/issues/414) · 3_BLUEPRINT · IN PROGRESS
  - [#416 — Auto run/save swings](https://github.com/rinebob/rel-str/issues/416) · 8_LIVE · RESOLVED · CLOSED
  - [#443 — Persist swing configurations](https://github.com/rinebob/rel-str/issues/443) · 2_PLAN · IN PROGRESS
  - [#445 — Bulk swing seed script](https://github.com/rinebob/rel-str/issues/445) · 8_LIVE · RESOLVED · CLOSED
  - [#451 — Add previous/next symbols capability to Swing Analysis](https://github.com/rinebob/rel-str/issues/451) · 8_LIVE · RESOLVED · CLOSED
  - [#541 — N-config swing overlay](https://github.com/rinebob/rel-str/issues/541) · 1_IDEA · RESOLVED · CLOSED *(absorbed into #599)*
  - [#595 — Prior work — swing analysis absorbed from #261](https://github.com/rinebob/rel-str/issues/595) · 8_LIVE · RESOLVED · CLOSED
  - [#599 — Misc fixes — swing analysis](https://github.com/rinebob/rel-str/issues/599) · 3_BLUEPRINT · IN PROGRESS
  - *(+ tasks #334–338 under Blueprint #598; topic-level QAs #363, #375, #378, #436, #459, #529)*

- **[#221 — Export ST indicators to PineScript for TradingView](https://github.com/rinebob/rel-str/issues/221)** · FEATURE · 3_BLUEPRINT · IN PROGRESS
  - *(legacy)*

### D. Trader Workflow Screens

- **[#213 — Quick Charts visual polish — price pane prominence and bar clarity](https://github.com/rinebob/rel-str/issues/213)** · FEATURE · 1_IDEA · IN PROGRESS
  - *(legacy)*

- **[#215 — Signal Review — instant company overview popup](https://github.com/rinebob/rel-str/issues/215)** · FEATURE · 1_IDEA · IN PROGRESS
  - *(legacy)*

- **[#465 — Watchlist management](https://github.com/rinebob/rel-str/issues/465)** · FEATURE · 2_PLAN · IN PROGRESS
  - [#466 — Misc issues](https://github.com/rinebob/rel-str/issues/466) · 2_PLAN · IN PROGRESS
  - [#492 — Unified list infrastructure](https://github.com/rinebob/rel-str/issues/492) · 7_QA · IN PROGRESS

- **[#468 — Flex Chart Maintenance](https://github.com/rinebob/rel-str/issues/468)** · FEATURE · 3_BLUEPRINT · IN PROGRESS
  - [#469 — Fix Log Scale Y-Axis](https://github.com/rinebob/rel-str/issues/469) · 8_LIVE · IN PROGRESS · CLOSED
  - [#538 — Roll log y-axis scale to all consumers](https://github.com/rinebob/rel-str/issues/538) · 8_LIVE · RESOLVED · CLOSED

### E. Execution & Portfolio

- **[#176 — Robinhood Trading UI](https://github.com/rinebob/rel-str/issues/176)** · FEATURE · 5_IMPLEMENT · IN PROGRESS
  - *(legacy)*

- **[#219 — Portfolio Dashboard](https://github.com/rinebob/rel-str/issues/219)** · FEATURE · 1_IDEA · IN PROGRESS
  - [#274 — Portfolio Dashboard — Init Impl](https://github.com/rinebob/rel-str/issues/274) · 8_LIVE · IN PROGRESS · CLOSED
  - [#276 — Portfolio Dashboard — Analytics Suite](https://github.com/rinebob/rel-str/issues/276) · 1_IDEA · IN PROGRESS
  - [#279 — Portfolio Dashboard — Order Placement](https://github.com/rinebob/rel-str/issues/279) · 3_BLUEPRINT · IN PROGRESS · CLOSED

- **[#553 — Paper Trading Infra](https://github.com/rinebob/rel-str/issues/553)** · FEATURE · 4_BACKLOG · IN PROGRESS
  - [#554 — Core Infra](https://github.com/rinebob/rel-str/issues/554) · 4_BACKLOG · IN PROGRESS

- **[#576 — Portfolio Allocation](https://github.com/rinebob/rel-str/issues/576)** · FEATURE · 2_PLAN · IN PROGRESS
  - [#577 — Allocation Manager Page](https://github.com/rinebob/rel-str/issues/577) · 2_PLAN · IN PROGRESS

### F. Platform & Plumbing

- **[#159 — Refactor data pipeline to PDR-driven triggers, consolidate local bar store writers, migrate charts to local reads](https://github.com/rinebob/rel-str/issues/159)** · CORE · 4_BACKLOG · IN PROGRESS
  - *(legacy)*

- **[#162 — Migrate RS Heatmap chart data to local Firestore](https://github.com/rinebob/rel-str/issues/162)** · TECH DEBT · 1_IDEA · IN PROGRESS
  - *(legacy)*

- **[#178 — Unified Navigation for Trading Features](https://github.com/rinebob/rel-str/issues/178)** · APP · 1_IDEA · IN PROGRESS
  - *(legacy)*

- **[#217 — Testing Audit & Modernization](https://github.com/rinebob/rel-str/issues/217)** · CORE · 1_IDEA · IN PROGRESS
  - *(legacy)*

- **[#300 — Misc fixes, refactoring and improvements](https://github.com/rinebob/rel-str/issues/300)** · TECH DEBT · 1_IDEA · IN PROGRESS
  - [#301 — Misc fixes, refactoring and improvements](https://github.com/rinebob/rel-str/issues/301) · 1_IDEA · IN PROGRESS

- **[#433 — Signal Pipeline Maintenance](https://github.com/rinebob/rel-str/issues/433)** · MAINT · 3_BLUEPRINT · IN PROGRESS
  - [#434 — Misc fixes](https://github.com/rinebob/rel-str/issues/434) · 3_BLUEPRINT · IN PROGRESS

## Closed Topics

- **[#114 — Options Strategy Engine — Hybrid Quote Provider (AV EOD + Robinhood MCP)](https://github.com/rinebob/rel-str/issues/114)** · `—` · *(no stage label)* · RESOLVED · CLOSED *(group A)*
  - *(legacy — no descendants)*

## Known drift (as of snapshot)

- `#261` — stored `1_IDEA`; after the 2026-09-26 swing-analysis re-parent to #594, derived stage is `3_BLUEPRINT` (threads #262/#304/#322).

- `#77`, `#114`, `#139` — no stage label; `#139` also has no Status, Category, or descendants.
- `#137` — stored `4_BACKLOG` but no open descendants (sole child #154 closed at 7_QA).
- `#159` — stored `4_BACKLOG`; derived `3_BLUEPRINT`. Area statuses resolve to RESOLVED while aggregate Status is IN PROGRESS.
- `#176` — stored `5_IMPLEMENT`; derived `3_BLUEPRINT`.
- `#221` — stored `3_BLUEPRINT`; derived `4_BACKLOG`.
- `#468` — both Threads shipped/closed; Topic still OPEN at `3_BLUEPRINT`.
- `#504`, `#462`, `#463`, `#464` — carry two stage labels each.
- Threads `#274`, `#279`, `#361`, `#469` — closed with Status still `IN PROGRESS`.
- Threads `#322`, `#383` — open but carrying terminal `8_LIVE`.
