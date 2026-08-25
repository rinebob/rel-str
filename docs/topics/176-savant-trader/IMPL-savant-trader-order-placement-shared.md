**Topic:** Savant Trader — order execution layer, persistence fixes, and rh-agent → savant-trader rename  
**Issue:** #180  
**Topic Parent:** #176  
**Domain:** SAVANT-TRADER  
**Type:** Implementation Plan  
**Area:** SHARED  
**Status:** Draft  
**Created:** 2026-08-24  
**Last Updated:** 2026-08-24  

---

## Scope

The SHARED area covers the foundational rename and type model that BE and FE both depend on. This must complete before any FE or BE feature work begins.

## Modules

### 1. Feature area rename (FE)

Rename the entire FE feature area directory and all its contents. This is a wide mechanical refactor — no logic changes, verified by the existing test suite.

**What changes:**
- Feature directory: `rh-agent/` → `savant-trader/`
- All files with `rh-agent-` prefix: drop the prefix entirely (e.g., `rh-agent-triage.service.ts` → `triage.service.ts`)
- All classes with `RhAgent` prefix: drop the prefix (e.g., `RhAgentTriageService` → `TriageService`, `RhAgentOccurrenceDecisionStore` → `OccurrenceDecisionStore`)
- Component selectors containing `rh-agent` or `agent`: rename to generic or `savant-trader` equivalents
- Page directories: `agent-dashboard/` → `run-dashboard/`, `agent-triage-report/` → `signal-action-report/`, `observation-dashboard/` → `rh-account-inquiry/`
- Route enum values in `AppRoutes`: `RH_AGENT` → `RUN_DASHBOARD`, `RH_AGENT_ORDER` → `SIGNAL_ORDER`, `RH_AGENT_TRIAGE_REPORT` → `SIGNAL_ACTION_REPORT`, `RH_AGENT_OBSERVATION` → `RH_ACCOUNT_INQUIRY`, `RH_AGENT_BACKTEST` → `STRATEGY_BACKTEST`
- Route paths: `/rh-agent` → `/run-dashboard`, `/rh-agent-order` → `/signal-order`, `/rh-agent-triage-report` → `/signal-action-report`, `/rh-agent-observation` → `/rh-account-inquiry`, `/rh-agent-backtest` → `/strategy-backtest`
- All import paths referencing `rh-agent/` throughout `src/app/`
- Navigation constants and nav menu items referencing old route paths

**What stays unchanged:**
- Generic component names already without prefix (`signal-list`, `trade-row`, `chart-toolbar`, etc.)
- `RobinhoodMcpObservationService` — about Robinhood, not the feature area
- `robinhood-mcp-observation.service.ts` — same

**Verification:** existing test suite passes with no logic changes. This is the primary gate.

### 2. tsconfig path aliases

Rename the path aliases in `tsconfig.json` and `functions/tsconfig.json`:
- `@rh-agent-mcp/contracts` → `@robinhood-mcp/contracts`
- `@rh-agent-mcp/utils` → `@robinhood-mcp/utils`

The underlying shared files (`robinhood-mcp-contracts.ts`, `robinhood-mcp-utils.ts`) stay as-is — they're already accurately named. Update all imports across FE and BE that reference the old aliases.

Also update `jest.config.js` moduleNameMapper entries for the aliases.

### 3. Firestore collection path constants (FE)

Update the `Collection` enum in core constants:
- `RH_TRIAGE_DECISIONS` → deleted (collection not used in practice)
- `RH_OCCURRENCE_DECISIONS` → `ST_OCCURRENCE_DECISIONS` with value `savant-trader/data/occurrence-decisions`
- `RH_REVIEW_FLAGS` → `ST_REVIEW_LIST` with value `savant-trader/data/review-list` (now a doc, not a collection)
- `RH_SYMBOL_LISTS` → `ST_SYMBOL_LISTS` with value `savant-trader/data/symbol-lists`
- `RH_SYMBOL_META` → `ST_SYMBOL_META` with value `savant-trader/data/symbol-meta`
- `RH_RUNS` → `ST_RUNS` with value `savant-trader/data/runs`

Add new collection path constants:
- `ST_DATA_DOC` = `savant-trader/data` (the container doc)
- `ST_ORDER_INTENTS` = `savant-trader/data/order-intents` (new subcollection)
- `ST_TRADING_CONFIG` = `savant-trader/data/trading-config` (new doc — account preference)

Add path helper functions for subcollections under the `data` container doc:
- `stOccurrenceDecisionsPath()` → `savant-trader/data/occurrence-decisions`
- `stOrderIntentsPath()` → `savant-trader/data/order-intents`
- `stSymbolListsPath()` → `savant-trader/data/symbol-lists`
- `stSymbolMetaPath()` → `savant-trader/data/symbol-meta`
- `stRunsPath()` → `savant-trader/data/runs`
- `stReviewListDocPath()` → `savant-trader/data/review-list`
- `stTradingConfigDocPath()` → `savant-trader/data/trading-config`

### 4. OrderIntent type model

Define the `OrderIntent` discriminated union in the feature area's shared types file. This is the contract between the staging store, execution service, and UI.

```typescript
enum InstrumentType { EQUITY = 'equity', ETF = 'etf', OPTION = 'option' }
enum OrderIntentStatus { STAGED, READY, SUBMITTING, SUBMITTED, FILLED, FAILED, CANCELLED }
enum OrderSource { SIGNAL_PIPELINE, MANUAL, POSITION_MANAGEMENT }

interface BaseOrderIntent {
  id: string;
  refId: string;
  source: OrderSource;
  sourceRef?: { type: string; id: string };
  status: OrderIntentStatus;
  accountNumber: string;
  side: 'buy' | 'sell';
  orderType: 'market' | 'limit' | 'stop_market' | 'stop_limit';
  timeInForce: 'gfd' | 'gtc';
  marketHours: 'regular_hours' | 'extended_hours' | 'all_day_hours';
  signalContext?: {
    signalType: string;
    barDate: string;
    timeframe: string;
    direction: string;
    decisionId: string;
  };
  createdAt: string;
  updatedAt: string;
  error?: { message: string; code?: string; retryable: boolean };
  result?: { orderId?: string; state?: string; fillPrice?: string; filledQuantity?: string };
}

interface EquityOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.EQUITY;
  symbol: string;
  quantity?: string;
  dollarAmount?: string;
  limitPrice?: string;
  stopPrice?: string;
  taxLots?: TaxLotSelection[];
}

interface EtfOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.ETF;
  symbol: string;
  quantity?: string;
  dollarAmount?: string;
  limitPrice?: string;
  stopPrice?: string;
  taxLots?: TaxLotSelection[];
}

interface OptionOrderIntent extends BaseOrderIntent {
  instrumentType: InstrumentType.OPTION;
  legs: OptionLeg[];
  quantity: string;
  price?: string;
  stopPrice?: string;
}

type OrderIntent = EquityOrderIntent | EtfOrderIntent | OptionOrderIntent;
```

Only `EquityOrderIntent` and `EtfOrderIntent` are implemented in this Topic. `OptionOrderIntent` is defined but not wired. ETFs and equities share the same order schema (same `place_equity_order` MCP tool) but are distinct instrument types — ETFs have no company fundamentals (earnings, filings, analysts).

### 5. Domain label

Already done in `project-config.json`: `RH-AGENT`, `RH-ACTUAL`, `RH-AGENT-OBSERVATION` replaced with `SAVANT-TRADER`. GitHub label `SAVANT-TRADER` created. Old GitHub labels can be cleaned up after migration.

## Dependencies

- None. This is the foundation — BE and FE areas depend on this completing first.

## Risks

- **Blast radius:** ~120 FE files, ~17 BE files, tsconfig, jest config. The rename is mechanical but tedious. A missed import path will fail the build immediately — TypeScript will catch all of them.
- **Test suite as gate:** if any test breaks after the rename, it means the rename accidentally changed logic. Investigate before proceeding.
