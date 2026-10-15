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
**Last Updated:** 2026-10-14  

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

**`StSignal`** — `functions/src/common/st-signals.ts`:

```ts
interface StSignal {
  symbol: string; signalType: string; barDate: string;   // identity (doc id)
  marketDate: string;                                    // first-detection run date
  direction: 'long' | 'short'; timeframe: 'D' | 'W' | 'M';
  indicators: Record<string, unknown>;                   // signal payload
  status: 'INTERIM' | 'CONFIRMED';                       // barStatus-driven
  sourceRunId: string; runIds: string[];                 // provenance
  ticketIds: string[]; positionGroupIds: string[];       // downstream lineage
  createdAt; updatedAt;
}
```

**`StOrderTicket`** — `functions/src/common/st-order-tickets.ts` + FE `order-ticket.service.ts` mirror:

```ts
interface StOrderTicket {
  id: string;                                            // {liv|pap}_{id}
  origin: { type: 'signal'|'program'|'manual'|'management';
            signalId?: string; instanceId?: string; runId?: string;
            positionGroupId?: string };
  auto: boolean; mode: 'live' | 'paper';
  terms: { side; instrument?; expression?; quantity?; dollarAmount?; limits? };
  state: 'staged'|'submitted'|'cancel_pending'|'filled'|'cancelled'|'expired';
  refId: string;                                         // RH ref_id idempotency
  brokerOrderId?: string;                                // live only
  reviewSnapshot?: { orderChecks; collateral };
  fillSummary?: { averagePrice; filledQty; filledAt };
  lastError?: { category: string; message: string };
  accountTarget; userId;
  createdAt; updatedAt; submittedAt?; filledAt?; cancelledAt?;
}
```

**`StPositionGroup`** — `functions/src/common/st-position-groups.ts`:

```ts
interface StPositionGroup {
  id: string;                                            // {SYM}-{YYMMDD}-grp-{NN}
  origin: { type: 'signal'|'program'|'manual'; signalId?; instanceId? };
  mode: 'live'|'paper';
  memberTicketIds: string[]; memberTradeIds: string[]; brokerOrderIds: string[];
  status: 'open'|'closed';
  rollups: { openCount; closedCount; realizedPnl? };
  createdAt; updatedAt;
}
```

**`StStrategyInstance`** — extends existing `StrategyInstanceConfig` with `mode: 'live'|'paper'`, `enabled`, `lastFiredAt` (shape already exists in engine contracts; add mode + move path).

**`PaperTrade` extensions** — `positionGroupId`, resolved `strike`/`expiration`/`optionType` top-level fields (indexed for analysis); remove `PENDING` from the writable status set (tickets hold pending intent).

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
