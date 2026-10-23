# Firestore Data Map — rel-str

**Status:** Living reference — update when collections are added/renamed/retired
**Created:** 2026-10-14
**Last verified against prod:** 2026-10-14 (direct Admin SDK enumeration + doc sampling)

Every Firestore collection in the `rel-str` database, its intent, its
writers/readers, its measured size, and its actual state. Counts marked `~`
are exact at verification time but change continuously.

## Reading guide

- **State: live** — actively written and read in the current system.
- **State: frozen** — legacy copy left behind by a copy-not-delete migration;
  nothing writes it, current code does not read it.
- **State: dead** — empty or fully superseded; safe archival candidate.
- **State: telemetry** — operational logging, not domain data; do not
  analyze or migrate wholesale.

## The three generations (why it looks chaotic)

The database carries three coexisting layout conventions. Each was coherent
when introduced; none was retroactively applied.

| Gen | Convention | Era | Examples |
|-----|-----------|-----|----------|
| 1 | Flat `rh-agent-*` roots | Original ST agent | `rh-agent-symbols`, `rh-agent-runs`, `rh-agent-opportunities` |
| 2 | Nested `savant-trader/data/*` tree | ~2026-08-24 migration (`functions/scripts/migrate-st-collections.js` — copies, never deletes) | `savant-trader/data/symbols`, `…/runs` |
| 3 | Domain-prefixed roots + anchor pattern `{domain}/{kind}/items/{id}` | Current documented convention (AGENTS.md) | `paper-trading/*/items`, `portfolio/*/items`, `st-*`, `options-*`, `backtest-*` |

Consequences visible in prod today:

- `savant-trader/data` and the `paper-trading`/`portfolio` anchor docs are
  **missing parent documents** — they exist only as subcollection
  containers, render italic in the console, and make trees look empty.
- `firestore.rules` still ships rules for collections that no longer exist
  or never existed: `savant-trader/data/symbol-meta` (never existed — code
  comments are stale; the real collection is `symbols`), `signal-dates`
  (deleted via `delete-signal-dates.ts`), `positions/{bucket}/items`
  (pre-`portfolio` anchor name), `tracked-symbols` (absent), and full
  `rh-agent-*` blocks.
- Subcollection names collide across domains: `signal-history` exists under
  both `savant-trader/data/symbols` (live) and `rh-agent-symbols` (frozen);
  `items` under every anchored domain. **Never query by collectionGroup —
  always full path.**

## Domain: ST signals (Savant Trader)

Canonical home: `savant-trader/data/*`. FE reads `symbols` subcollections
directly (`signal.service.ts`) and via `st*` callables.

| Path | Purpose | Writers | Readers | Size | State / notes |
|------|---------|---------|---------|------|----------------|
| `savant-trader/data/symbols/{SYM}` | Tracked universe: config, SA overview, signal gate dates (`lastDaily/WeeklySignalDate+Direction`) | symbol-data-sync, SignalDateWriter, overview sync | dashboard callables, review UI, auto-paper gate | ~926 | live. Parent `data` doc missing → console-invisible |
| `…/run-ids/{runId}` | Per-run signal snapshot (INTERIM intraday + run record) | `SignalDateWriter` every run | review UI, auto-paper ingest, `collectionGroup` dashboard query | ~42.9K (incl. legacy twin share) | live, unbounded growth, no TTL |
| `…/signal-history/{barDate}` | **Canonical EOD signal record** — CONFIRMED entries + `sourceRunId`; one doc per *signaled* date (sparse by design) | `SignalDateWriter` (nightly runs only), `generate-historical-signal-history.ts` | `signal.service.ts` (FE direct), `stSignalHistory` | ~2-3 docs/symbol post-cutover | **live but fragmented** — see issue I-1 |
| `…/runs/{runId}` | Agent run record/status | `RunProgressTracker` | status UI, auto-paper | ~195 | live |
| `…/runs/{runId}/jobs/{SYM}` | Per-symbol job outcome; `createdOpportunity` gates auto-paper candidates | `RunProgressTracker` | auto-paper ingest | ~1.24M | live telemetry — extreme volume |
| `…/status/current` | Agent status singleton | `RunProgressTracker` | status UI | 1 | live |
| `…/symbol-lists/{uid}_{KEY}` | User triage lists (NEW/PRIMARY/…); auto-paper capture scope | FE | ingest pass, UI | 7 | live |
| `…/occurrence-decisions` | User accept/decline per signal occurrence | — | — | 12 | **removed #1017** — ACR workflow deleted (ticket existence = decision); FE readers/writers + rules gone; data pending #1013 deletion |
| `…/review-list` | Triage decisions (ex `rh-agent-triage-decisions`) | — | — | 12 | **removed #1016** — FE/BE readers/writers + rules gone; data pending #1013 deletion |
| `…/order-intents` | Signal→order tickets; **bridges to the real RH account** | FE + screenshot tracking | `paperSignalOrder` callable | 77 | live; `sourceRef` id format inconsistent (`pdr-AAMI-…` vs `pdr_AAMI_…`) |
| `…/trading-config/{docId}` | `autoPaper` ingest config (enabled, lists, signalTypes, ownerUid) | manual | `stAutoPaperIngest` task | 2 | live |

## Domain: paper trading

Anchor layout `paper-trading/{kind}/items/{id}` — `shared/paper-trading-ids.ts`
+ `shared/paper-trading-contracts.ts`.

| Path | Purpose | Writers | Readers | Size | State / notes |
|------|---------|---------|---------|------|----------------|
| `paper-trading/trades/items` | Trade lifecycle aggregate: order, fills, legs, `marks` map, `variantRuns`, PnL | `paperSignalOrder`, auto-paper ingest, mark/exit/settle passes | `listPaperTrades`, UI | ~138 | live; **all `source=signal`, all OPEN/PENDING** |
| `…/cohorts/items` | One accepted signal fanned out (EQ + expression trades) | `paperSignalOrder` | read callables | ~9 | live |
| `…/accounts/items` | Paper cash/equity per user + `acct-auto-paper` | ledger | UI | 2 | live |
| `…/stats/items` | Rollup docs by scope (`all`, `sym-`, `sig-`, `sigtype-`, `dir-`, `sector-`, `ind-`, `captier-`, `sigstatus-`, `cohort-`, `inst-`, `var-`) | `paper-stats-pass` | `getPaperStats`, dashboards | ~323 | live; contains legacy `ALL`/`SPY` stragglers |
| `…/raw-quotes/items` | Verbatim quote payload per fill/mark | ingest + mark passes | audit | ~323 | live |
| `options-strategy-instances` | Gen-2.5 options engine instances | options-strategy-engine | engine callables | 4 | **superseded** by `paper-trading/instances` (currently 0 docs there) |
| `options-strategy-positions` | Gen-2.5 engine positions | same | same | 12 | **superseded**; Aug-2026 positions, migration (`migrate-options-strategy-to-paper.ts`) completeness unverified |
| `options-strategy-stats` | Gen-2.5 engine rollups | same | same | 7 | **superseded** |
| `options-rh-instrument-map` | RH option instrument id mapping | instrument-map resolver | fill passes | 16 | live |

### Signal→trade linkage (verified)

- **Auto-paper** (`stAutoPaperIngest`, nightly/manual triggers only):
  `signalId = {SYM}_{signalType}_{barDate}` dedupe key; 1-share EQ; full
  provenance stamps (`signalType`, `signalBarDate`, `signalStatus`,
  `signalRunId`, `signalIndicators`, `sector`, `industry`, `marketCapTier`,
  `captureList`); `userId='auto-paper'`; trade desc `EQV{n}{L|S}`.
- **Signal-order cohort** (`paperSignalOrder`): `signalId` = run-scoped id
  `{date}_{weekday}_{HHMMSS}_{label}-{SYM}-{tf}-{type}`; `cohortId` set;
  EQ + expression trades (CSP/LC/SC/LP); **no provenance stamps** —
  signalType recoverable only by parsing `signalId`.

## Domain: backtesting

| Path | Purpose | Size | State / notes |
|------|---------|------|----------------|
| `backtest-runs/{runId}` | Job record per orchestrator run | 10 | live-ish; all show `status=running` despite complete permutations (cosmetic bug); all are Jul-2026 `leap-drop` runs |
| `backtest-permutations/{permId}` | Per symbol+strategy+params result: `BacktestMetrics`, `equityCurve`, `reportTier=full` adds `trades[]`+`underlyingBars` | 10 | live |

## Domain: market data (input plane)

| Path | Purpose | Size | State / notes |
|------|---------|------|----------------|
| `symbol-data/{SYM}` + `daily/{year}`, `weekly/all`, `monthly/all`, `intraday` | OHLCV bars — input to signals, backtests, charts | ~927 | live; the canonical bar store |
| `symbol-data-sync-runs` | Nightly sync telemetry | ~404 | telemetry |
| `symbol-data-sync-sequences` | Sync sequence tracking | ~90 | telemetry |
| `partner-events` | Partner Pub/Sub event log | ~1653 | telemetry |
| `endpoint-symbols` | Partner endpoint polling state | 4 | live |
| `request-logs` | Endpoint request telemetry | 9 | telemetry |
| `split-events` | Detected stock splits | 9 | live |
| `app/market-holidays-{region}-{year}` | Trading calendar | 5 | live |

## Domain: RS pairs (separate signal system — not ST)

**Out of scope for the ST consolidation** — left as-is; needs its own pass
later (`pairs-data` carries ~80 subcollections per doc).

| Path | Purpose | Size | State / notes |
|------|---------|------|----------------|
| `pair-registry` | Registered baseline–target pairs | ~1242 | live |
| `pairs-data/{PAIR}` + `signals/{opens,closes}`, `signals-activity`, `archive-{1999..2026}` (+weekly/monthly variants) | RS series, pair signals, per-year archives | ~1239 + ~80 subcols/pair | live; heavily nested — worst console ergonomics in the DB |
| `signals-activity` (root) | Cross-pair activity mirror | 0 | dead — never populated / disabled (`DISABLE_SIGNALS_ACTIVITY_POSITIONS` flag exists) |
| `positions/{bucket}/items` | RS system positions (anchor-style `open`/`{year}-closed` buckets) | 0 | dead; flag-gated off or never enabled |
| `heatmap-snapshots` | Precomputed heatmap shards | ~357 | live |
| `rs-warnings` | RS pipeline warnings | ~3442 | telemetry, noisy |
| `rs-bars-sync-runs` | RS bar sync telemetry | 9 | telemetry |
| `rs-symbol-cache/{marketDate}/symbols/{SYM}` | Cross-job partner-bar cache — same-run jobs reuse fetched bars instead of re-calling partner API | 0 | **live** — runtime cache, empty at rest between runs (`symbol-fetch.ts`, `rs-time-series-jobs.worker.ts`) |
| `tracked-symbols/{SYM}` | Canonical mirror of the upstream partner's tracked-symbol universe | absent | **live-by-fallback** — not materialized in prod; `getTrackedSymbols` falls back to live upstream fetch; `registry-actions` reads it during pair validation |
| `analytics` | RS PnL aggregates | absent | dead — config only |
| `users/{uid}/trades`, `…/pnlDaily` | RS per-user overlays | subcollections | live under `users` (2 docs) |

## Domain: other features

| Path | Purpose | Size | State / notes |
|------|---------|------|----------------|
| `st-swing-sets`, `st-swing-configs` | Saved swing analyses / configs | ~3680 / 3 | live |
| `spread-lists`, `spread-runs` (+jobs) | Spread scanner | 3 / 26 | live |
| `st-screenshots`, `st-screenshot-verify` | Signal lifecycle chart captures | 45 / 1 | live |
| `portfolio/{buckets,attributions}/items` | Portfolio domain (anchor pattern) | 6 / 39 | live |
| `users` | Auth profiles | 2 | live |
| `rh-agent-credentials` | RH MCP credential bundle | 1 | live |
| `configs`, `health-metrics`, `system` | Reserved/never used | 0 | dead shells |

## Domain: frozen Gen-1 legacy (`rh-agent-*`)

All superseded by `savant-trader/data/*` at the ~2026-08-24 migration.
Nothing writes them; nothing reads them — **except they hold the only copy
of deep signal history (issue I-1)**. Rules + indexes still reference them.

| Path | Size | Contents |
|------|------|----------|
| `rh-agent-symbols/{SYM}` + `run-ids`, `signal-history` | 865 + subs | Frozen twin — `signal-history` holds ~190-206 docs/symbol back to 2019 |
| `rh-agent-runs` | ~302 | Frozen run records |
| `rh-agent-opportunities` | ~661 | Superseded signal format (pre signal-history) |
| `rh-agent-triage-decisions` | ~160 | Frozen (now `review-list`) |
| `rh-agent-occurrence-decisions` | ~20 | Frozen |
| `rh-agent-symbol-lists` | 6 | Frozen |
| `rh-agent-status` | 1 | Frozen |

## Known issues

- **I-1 — Canonical signal history is split across generations.** Legacy
  `rh-agent-symbols/{s}/signal-history` holds ~195-206 docs/symbol
  (2019→Aug-2026); the live path holds only post-cutover docs (0-3/symbol
  sampled). The FE reads only the new path → deep history invisible.
  Merge required before legacy is archived.
- **I-2 — `savant-trader/data/*` console unreadability.** ~10
  subcollections under one missing parent doc in a ~100px console column.
  Motivates moving to flat prefixed roots (new convention).
- **I-3 — collectionGroup ambiguity.** `signal-history` and `items` span
  multiple domains; collectionGroup queries silently mix them.
- **I-4 — signal-history write gaps.** Nightly-only canonicalization:
  failed nightly = no doc; INTERIM run-ids entries never promoted to
  CONFIRMED on period close; W/M signals gate on `triggeredBy==='nightly'`.
- **I-5 — Two `signalId` conventions** on signal-source trades (dedupe key
  vs run-scoped), provenance stamps only on the auto-paper path.
- **I-6 — Unbounded telemetry.** `jobs` ~1.24M, `run-ids` ~42.9K,
  `partner-events` ~1.7K, `rs-warnings` ~3.4K; no TTL/prune.
- **I-7 — Dead rules/indexes.** Rules for `symbol-meta`, `signal-dates`,
  `positions/{bucket}`, `tracked-symbols`, all `rh-agent-*`; index entries
  for `collectionGroup: rh-agent-symbols` and `options-strategy-positions`.
- **I-8 — `backtest-runs.status` stuck at `running`** on completed runs.
- **I-9 — Migration completeness unverified** for
  `options-strategy-*` → `paper-trading` (legacy holds 12 real positions).
- **I-10 — No terminal trades yet** — realized PnL analysis has no data;
  shadow exit variants empty (`SIGNAL_SHADOW_VARIANT_KEYS=[]`).

## Conventions (current targets — Gen 3)

From AGENTS.md + observed implementation:

- Domain-prefixed root collections: `st-`, `rh-agent-` (agent pipeline),
  `options-`, `backtest-`, `portfolio` (anchored).
- Anchor pattern for multi-kind domains:
  `{domain}/{kind-anchor}/items/{id}` (e.g. `paper-trading/trades/items`).
- Flat collections with composite doc ids (`{entity}_{key}`) preferred over
  nested trees for enumerable data.
- No catch-all collections mixing unrelated doc types.
- Trade ids: `YYMMDD-{st|sig|man}-{SYMBOL}-{desc}[-HHMM]`.
- Stats scopes: `all`, `inst-`, `var-`, `cohort-`, `sig-`, `sym-`,
  `sigtype-`, `dir-`, `sector-`, `ind-`, `captier-`, `sigstatus-`.

## Open questions

- Was `migrate-options-strategy-to-paper.ts` ever fully run? (I-9)
- Did the Aug-2026 migration skip `signal-history` subcollection copy, or
  did the 2019+ backfill write only to the legacy path afterward? (I-1)
- Is `DISABLE_SIGNALS_ACTIVITY_POSITIONS` set in prod? (explains empty
  `positions`/`signals-activity` roots)
- Should `run-ids`/`jobs` get retention, or are full histories wanted?
- Four overlapping "which symbols exist" sets: `tracked-symbols` (partner
  catalog, currently unmaterialized), `savant-trader/data/symbols` (ST
  universe), `symbol-data` (synced-bars registry), `rh-agent-symbols`
  (frozen). Different roles, but consider whether the ST universe should be
  flags on `symbol-data` rather than a parallel collection.
- `occurrence-decisions` vs `order-intents` — resolved in #1017: the ACR
  decision layer was deleted; ticket existence is the order intent and
  `signalContext.decisionIds` survive as pure provenance join keys.
  (`review-list` exited this trio when it was removed in #1016.)
