# ADR-009: ST data-plane consolidation — canonical signals, universal order tickets, position groups

**status:** proposed  
**issue:** #986 (Idea)  
**topic parent:** #984 — ST Firestore Reorg (`st-firestore-reorg`) · Thread #985 (`data-plane-consolidation`)  
**date:** 2026-10-14  
**decision owners:** savant-trader  
**supersedes:** path-level details of ADR-008 (`st_signal_entries` is absorbed into `st-order-tickets`); preserves ADR-008's core principle that RH is authoritative for orders/positions/fills

## context

The ST data plane grew organically and is now incoherent:

- One signal occurrence is fragmented across four+ collections with **three different ID conventions** — a run-scoped `signalId` on cohort trades, a dedupe-keyed ID on auto-paper trades, and a `{symbol, barDate}` map key in `signal-history`.
- Signal persistence splits between `symbols/{SYM}/run-ids/{runId}` (every run, interim) and `symbols/{SYM}/signal-history/{barDate}` (nightly runs only) — interim signals never reach canonical storage.
- `occurrence-decisions` + `order-intents` duplicate the "accepted → order" fact (the divergence ADR-006 documented; TTL'd at 7 days, already treated as ephemeral).
- Three mutually-exclusive action paths bypass the ticket model entirely: auto-paper ingest writes trades directly to the ledger, `openPassTimer` writes positions directly, and `paperSignalOrder` creates PENDING expression trades.
- Two parallel pass families exist (`paper-trading/passes/` for signal-source trades, `paper-trading/engine/passes/` for strategy-instance trades) with overlapping responsibilities.
- Time-based strategy programs are split across legacy `options-strategy-instances` (4 live docs) and an empty `paper-trading/instances` anchor, and have no live-execution path.
- Root collections span three naming eras (`rh-agent-*` legacy, `savant-trader/data/*` nested tree, `st-*`/`paper-trading`/`portfolio` anchors) so the console shows no coherent domain grouping.
- `runs/{runId}/jobs/{SYM}` accumulates ~926 docs per run forever (1.24M and growing) for a single consumer (auto-paper candidate selection).

Two initiators must be supported symmetrically — ST signals and time-based strategy programs — across two execution modes (live, paper). Robinhood remains authoritative for live orders/positions/fills; nothing local mirrors them.

## decision

### 1. Canonical signal occurrence — one ID everywhere

Every signal occurrence gets a single occurrence-keyed document:

```text
st-signals/{SYM}_{barDate}_{signalType}
    payload:     direction, timeframe, indicators, marketDate
    status:      INTERIM → CONFIRMED        (CONFIRMED when barStatus = historical)
    sourceRunId, runIds[]                   (provenance, not identity)
    ticketIds[], positionGroupIds[]         (downstream lineage)
```

- Date-first ordering makes doc-ID sort chronological per symbol (console + range scans).
- `SignalDateWriter` **upserts** this doc on **every** run (interim included) — one doc per occurrence for its whole lifecycle; re-detection appends to `runIds[]`, nightly upgrades status to CONFIRMED. Replaces both `run-ids` and `signal-history` subcollections.
- The occurrence ID becomes the universal FK: tickets, paper trades, position groups, and analysis all join on it.

### 2. Universal order ticket — all initiators, both modes

```text
st-order-tickets/{liv|pap}_{ticketId}
    origin:         { type: signal | program | manual | management,
                      signalId?, instanceId?, runId? }
    auto:           bool                     (system-generated vs user-created)
    mode:           live | paper             (execution target)
    terms:          { side, instrument | expression, quantity, limits }
    state:          staged → submitted → filled | cancelled | expired
                    (+ cancel_pending — RH cancels are async)
    refId:          idempotency key (maps to RH ref_id — server-enforced unique)
    brokerOrderId?: string                   (live only — RH order id at submit)
    reviewSnapshot?: { orderChecks, collateral }   (from review_* calls)
    fillSummary?:   { averagePrice, filledQty, filledAt } (stamped on observed fill)
    accountTarget, userId, per-transition timestamps
```

- `auto` and `mode` are orthogonal axes: auto-generated live (`program`,`auto:true`,`live`), auto-generated paper (`signal`,`auto:true`,`paper`), manual paper (`manual`,`false`,`paper`) are all valid quadrants.
- `liv_`/`pap_` ID prefix keeps console browsing sane under asymmetric volume (thousands paper vs hundreds live).
- `origin.type: management` covers the existing `position_management` intents (stop_loss, fractional_close) — tickets handle entry AND exit.
- Ticket existence **is** the accept decision. `occurrence-decisions` dies; no rejected-state persistence (gallery → direct order flow).

### 3. Pending intent is a ticket, not a trade

Expression trades today are created `PENDING` and resolved at the noon fill pass — so contract (exp/strike) is unknowable at mint time and doc IDs are immutable. Under the new model:

- Accept/order creates a **staged ticket** (carries the expression template).
- The fill pass resolves the contract, then **mints the trade doc** with full identity:

```text
st-paper-trading/trades/items/{SYM}-{YYMMDD}-{origin}-{EXPR}-{exp}-{strike}-{NN}
    origin ∈ sig | prg | man | mgmt   (mirrors ticket origin.type)
    symbol-first ordering matches st-signals/{SYM}_{barDate}_{type} and
    makes prefix scans chronological per symbol
    e.g. ADPT-260927-sig-CSP-030-45-20261120-P155.00-01
         QQQM-260928-prg-CSP-030-45-20261120-P155.00-01
         AAPL-260928-man-EQ-01               (equity omits contract segments)
```

Group IDs follow the same convention: `st-position-groups/{SYM}-{YYMMDD}-grp-{NN}` (replaces `cohort-260927-ADPT-01`).

- `{NN}` is a same-day sequence suffix — required for future automation opening one CSP/day per group until the equity leg stops out.
- Resolved `strike`, `expiration`, `optionType` are also indexed fields for analysis queries.
- Leg IDs unchanged (`buildLegId`: `PUT-155.00-2026-10-17`).
- Trade docs only ever represent real selected contracts; "things I intend" live in tickets, "things I hold" live in trades.

### 4. Position groups — the management/analytics aggregate

```text
st-position-groups/{id}
    origin:            { type: signal | program | manual, signalId?, instanceId? }
    mode:              live | paper
    memberTicketIds:   []
    memberTradeIds:    []                      (paper)
    brokerOrderIds:    []                      (live → joins to RH positions)
    status, rollups    (count, open/closed, aggregate pnl for paper)
```

- Absorbs `paper-trading/cohorts` (today's cohort IS a position group — signal fan-out header listing spawned trade IDs).
- Mode-agnostic: live groups join via the ticket→`brokerOrderId`→RH chain — equity positions resolve deterministically through RH `tax_lots[].order_id` (the acquiring order id is on each lot), option positions via `option_id`/`chain_id` on orders vs positions (topic #657 probe-verified). Positions opened directly in RH stay ungrouped.
- Live outcome rollups come from `get_pnl_trade_history` / `get_realized_pnl` on demand — no local live-position snapshots.
- Live-mode constraint (probe-verified): MCP `place_option_order` rejects multi-leg — live expressions are single-leg only until RH supports it.
- `instanceId`-keyed groups accumulate a program's positions over time — the per-strategy ledger for time-based live trading.

### 5. Strategy instances — mode-agnostic programs

```text
st-strategy-instances/{id}
    mode: live | paper, openTimePT, phases, exitPolicy, enabled, lastFiredAt
```

Consolidates `options-strategy-instances` (4 live docs) + empty `paper-trading/instances` anchor. Promotion path = flip `mode` paper→live. The existing machinery (`openPassTimer` cron → `runOpenPass`, SDS `selection`/`settlement` consumers) gains a live path by emitting tickets instead of writing the ledger directly.

### 6. Target collection tree

```text
st-symbols/{SYM}                                  (universe + overview + gates)
st-signals/{SYM}_{barDate}_{signalType}           (canonical occurrence)
st-runs/{runId}  └─ /jobs/{SYM}                   (run + job docs, retention policy)
st-order-tickets/{liv|pap}_{id}                   (universal action record)
st-position-groups/{id}                           (grouping aggregate)
st-strategy-instances/{id}                        (mode-agnostic programs)
st-config/{docId}                                 (autoPaper, status, singletons)
st-symbol-lists/{uid}_{KEY}                       (triage lists)
st-paper-trading/{accounts,trades,stats,raw-quotes}/items/{id}
st-portfolio/{buckets,attributions}/items/{id}
st-backtest-runs/{runId}   st-backtest-permutations/{id}
(already conforming: st-screenshots, st-swing-sets, st-swing-configs)
```

Removed: `savant-trader/data/*` (whole tree), `rh-agent-*` (archive → diff → delete), `options-strategy-*`, `paper-trading/cohorts` (→ groups), `paper-trading/instances` (→ instances), `review-list` (the gallery flow makes the marker obsolete). Unchanged input plane: `symbol-data`, `symbol-data-sync-*`, `partner-events`, `split-events`, `endpoint-symbols`, `request-logs`, `app/market-holidays`.

### 7. Flow changes (behavioral deltas only — everything else is rename/move)

1. `st-signals` written on every run; interim signals persist canonically (fixes nightly-only gap).
2. Auto-paper, open pass, and management actions emit `st-order-tickets` before execution (today: bypass).
3. `occurrence-decisions` deleted as a concept.
4. `st-position-groups` replaces cohorts, extended to live + program origins.
5. Time-based programs emit `origin:program` tickets; management passes emit `origin:management` tickets — closing the live-management gap.
6. `jobs` gets a **7-day TTL cleanup** (sole consumers — auto-paper ingest and run-progress UI — only read jobs during/immediately after the run) instead of migration (1.24M docs).
7. **Scope boundary:** the pass *families* (signal-source vs engine-source scheduled functions) are NOT merged in this thread — path constants re-point and entry passes emit tickets, but semantic unification (mark/stats/settlement) is deferred to Thread #987 (pass-family-consolidation), keeping data-plane reorg separate from compute-plane refactor.

## migration phases

1. **Dual-write `st-signals`** alongside `run-ids`/`signal-history`; backfill canonical occurrences from history; verify counts + INTERIM coverage.
2. **`st-order-tickets`** — cutover `order-intents` readers/writers; migrate open tickets; auto-paper/open-pass start emitting tickets (still writing old paths).
3. **`st-position-groups`** — migrate 9 cohorts; stamp `positionGroupId` on member trades.
4. **`st-strategy-instances`** — migrate 4 legacy docs; re-point engine + FE.
5. **Renames** — `paper-trading`→`st-paper-trading`, `portfolio`→`st-portfolio`, `backtest-*`→`st-backtest-*` (copy + cutover; ~800 docs total).
6. **`st-config`/`st-symbol-lists`/`st-review-list`** — small moves.
7. **Cleanup** — archive/delete `savant-trader/data/*`, `rh-agent-*` (after source/target diff), `options-strategy-*`; `jobs` retention job; `NEW`-list backfill for zero-membership tracked symbols.

## consequences

- One occurrence key (`{SYM}_{barDate}_{signalType}`) is the analysis join across signals → tickets → trades → groups. Signal-quality questions become single-key joins.
- "Pending trade" stops being a fake trade state — intent and holding are cleanly separated; console-readable IDs carry the resolved contract.
- Live-time-based management becomes possible without new infra (management tickets + `brokerOrderId` lineage).
- `NEW`-list backfill removes the need for `NO_MEMBERSHIP` support in auto-paper scope (config already widened to `PRIMARY, SECONDARY, MONITOR, NEW`).
- Migration is mostly mechanical (~800 doc renames + path constants); the risky parts are dual-write correctness for signals and the ticket-state machine cutover.
- Resolved during planning: `jobs` = 7-day TTL cleanup; `review-list` = dropped entirely; pass-family merge = deferred to Thread #987; live group membership = deterministic via ticket `positionGroupId`→`brokerOrderId`→RH (RH-only positions stay ungrouped).
- Remaining open questions deferred to impl: `expression-fill` consumer-side shape reading staged tickets; whether `st-review-list`-era FE references need removal (marker deleted).
