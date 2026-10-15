**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #988  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Domain:** DATA-PIPELINE  
**Type:** IMPL  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-10-14  
**Last Updated:** 2026-10-15  

# IMPL — Data Plane Consolidation: SHARED (contracts, paths, ID builders)

## Purpose

Everything else in this thread depends on the shared contract layer: collection path constants, document type shapes, and ID builders. Both BE (functions) and FE (Angular) need them; this area defines the canonical shapes once and delivers them on each side.

## Components

### 1. Path constants — `functions/src/common/st-collections.ts` (BE) + FE constants

Add alongside existing constants (keep old ones during migration):

```text
st-symbols/{SYM}
st-signals/{SYM}_{barDate}_{signalType}
st-runs/{runId}   st-runs/{runId}/jobs/{SYM}
st-order-tickets/{liv|pap}_{id}
st-position-groups/{SYM}-{YYMMDD}-grp-{NN}
st-strategy-instances/{id}
st-config/{docId}
st-symbol-lists/{uid}_{KEY}
st-paper-trading/{accounts|trades|stats|raw-quotes}/items/{id}
st-portfolio/{buckets|attributions}/items/{id}
st-backtest-runs/{runId}   st-backtest-permutations/{id}
```

FE mirrors the subset it reads/writes (`src/app/features/savant-trader/common/constants.ts` + service-local paths). Firestore path rule: anchored kinds keep `{domain}/{kind}/items/{id}` (even segments); flat collections use doc-id composition.

### 2. Type shapes

Delivered as **single shared sources** in `shared/` behind `@st/*` path aliases
(`@st/types`, `@st/signals`, `@st/order-tickets`, `@st/position-groups`,
`@st/strategy-instances`) rather than BE/FE mirror files — BE and FE shapes
are structurally identical by construction, and the BE surface is re-exported
from `functions/src/common/` where a barrel is needed (same pattern as #997).
Review deltas vs the original draft are marked `*` below.

**`StSignal`** — `shared/st-signals.ts`:

```ts
interface StSignal {
  symbol: string; signalType: string; barDate: string;   // identity (doc id)
  marketDate: string;                                    // first-detection run date
  direction: TradeSide; timeframe: StSignalTimeframe;    // 'long'|'short', 'D'|'W'|'M'
  indicators: Record<string, number | string | null>;    //* narrowed scalar payload
  status: StSignalStatus;                                // 'INTERIM'|'CONFIRMED', barStatus-driven
  sourceRunId: string; runIds: string[];                 // provenance
  ticketIds: string[]; positionGroupIds: string[];       // downstream lineage
  createdAt; updatedAt;
}
// plus normalizeStSignalDirection(): 'LONG'/'SHORT' → TradeSide — legacy
// StSignalEntry.direction is uppercase; writers must map through it. *
```

**`StOrderTicket`** — `shared/st-order-tickets.ts`:

```ts
interface StOrderTicket {
  id: string;                                            // {liv|pap}_{id}
  origin: { type: 'signal'|'program'|'manual'|'management';
            signalId?: string; instanceId?: string; runId?: string;
            positionGroupId?: string };
  auto: boolean; mode: 'live' | 'paper';
  terms: { symbol: string;                               //* required — ticker being ordered
           side: 'buy'|'sell'; instrument?; expression?;
           quantity?; dollarAmount?; limits?;
           legs?: StTicketLeg[];                         //* option contract identity
           expressionTemplate?: SignalExpressionTemplate;//* staged paper recipe
           orderType?; timeInForce?; marketHours?;       //* RH order params
           taxLots?: { lotId; quantity }[] };            //* lot-specified sells
  state: 'staged'|'submitted'|'cancel_pending'|'filled'|'cancelled'|'expired'|'failed';//*
  refId: string;                                         // RH ref_id idempotency
  brokerOrderId?: string;                                // live only
  reviewSnapshot?: { orderChecks; collateral };
  fillSummary?: { averagePrice; filledQty; filledAt };
  lastError?: { category: string; message: string };
  accountTarget; userId;
  bucketId?; signalContext?; tracking?; terminalAt?;     //* order-intents migration
  createdAt; updatedAt; submittedAt?; filledAt?; cancelledAt?;
}
```

`validateStTicketTerms` requires exactly one of `quantity`/`dollarAmount`,
each positive and finite (`quantity` integral). *

**`StPositionGroup`** — `shared/st-position-groups.ts`:

```ts
interface StPositionGroup {
  id: string;                                            // {SYM}-{YYMMDD}-grp-{NN}
  origin: { type: 'signal'|'program'|'manual'; signalId?; instanceId? };
  mode: 'live'|'paper';
  userId: string;                                        //* ownership scoping
  memberTicketIds: string[]; memberTradeIds: string[]; brokerOrderIds: string[];
  status: 'open'|'closed';
  rollups: { openCount; closedCount; realizedPnl? };
  createdAt; updatedAt;
}
```

**`StStrategyInstance`** — `shared/st-strategy-instances.ts`: extends existing
`StrategyInstanceConfig` with `mode: 'live'|'paper'`, `paperAccountId?` (*,
required when `mode='paper'` — was `PaperStrategyInstance.paperAccountId`),
`enabled`, `lastFiredAt`. `enabled=false` wins over `lifecycleState`; when
enabled, `PAUSED`/`STOPPED` manage existing positions but open no new ones.

**`PaperTrade` extensions** — `positionGroupId`, resolved `strike`/`expiration`/`optionType` top-level fields (indexed for analysis); `PENDING` excluded from `PAPER_TRADE_WRITABLE_STATUSES` (tickets hold pending intent); `signalTimeframe`/`signalStatus` typed as `StSignalTimeframe`/`StSignalStatus` (*).

### 3. ID builders — `functions/src/common/st-ids.ts` (+ FE equivalents where minted client-side)

```ts
signalOccurrenceId(sym, barDate, signalType)  // {SYM}_{barDate}_{signalType}
ticketId(mode, seq)                            // {liv|pap}_{...}
tradeId(sym, date, origin, expr, exp?, strike?, nn)  // {SYM}-{YYMMDD}-{origin}-{expr}[-{exp}-{strike}]-{NN}
groupId(sym, date, nn)                         // {SYM}-{YYMMDD}-grp-{NN}
```

Builders are pure functions — unit-testable, reused by every writer.

### 4. Mapping helpers

- `source → origin.type` (`signal_pipeline`→`signal`, `position_management`→`management`) for the 77-doc intent migration.
- `status:'paper'` (legacy intent status) → `mode:'paper'` + state derivation.
- `barStatus` → `INTERIM|CONFIRMED` (existing logic — reuse, don't duplicate).

## Dependencies

- None — this is the root of the dependency graph. Lands first.

## Risks / notes

- FE and BE type shapes must stay structurally identical — add a shared shape test (or a single source contract package if the repo's `@paper-trading/contracts` pattern extends cleanly; otherwise explicit mirrors + tests).
- Doc-ID segment limits: `{NN}` suffix must handle >9 same-day occurrences (`%02d` min, don't cap at 2 digits).
- Timestamp types differ BE (`FieldValue`) vs FE (ISO strings) — keep types loose (`unknown | string`) at the shared layer.
