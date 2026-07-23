# Options Contract Viewer — Implementation Plan

## ADR Reference
[ADR-002: Options Contract Viewer Dashboard](../adr/ADR-002_options-contract-viewer.md)

## Milestone 1: Single Contract

### Backend

1. **New callable** `getHistoricalOptionsContract` in `functions/src/options-contract.callables.ts`
   - Wraps existing `callPartnerHistoricalOptionsContractV2` from `partner-proxy.ts`
   - Params: `{ symbol, contractID }` (no date range — full lifetime)
   - Returns `PartnerHistoricalOptionsContractV2Response` as-is
   - `onCall` with `{ region: 'us-central1', cors: true }`
   - No caching, no extra auth (matches existing callables)

2. **Export** from `functions/src/index.ts`

### Frontend Types

3. **FE partner types** in `src/app/core/models/partner.types.ts`
   - `HistoricalOptionsContractV2Observation` — mirrors BE interface
   - `PartnerHistoricalOptionsContractV2Response` — mirrors BE interface
   - `GetHistoricalOptionsContractRequest` — `{ symbol, contractID }`
   - `GetHistoricalOptionsContractResponse` — wraps the V2 response

4. **CallableName** enum in `src/app/core/common/constants.ts`
   - Add `GET_HISTORICAL_OPTIONS_CONTRACT = 'getHistoricalOptionsContract'`

5. **AppRoutes** enum in `src/app/core/common/interfaces.ts`
   - Add `OPTION_CHART = 'option-chart'`

### Frontend Service + Store

6. **`options-contract.service.ts`** in `src/app/features/rh-agent/services/`
   - Wraps callable via `httpsCallable`
   - Returns `Observable<PartnerHistoricalOptionsContractV2Response>`
   - Parses OCC ID to extract symbol + contract ID

7. **`options-contract-viewer.store.ts`** in `src/app/features/rh-agent/stores/`
   - SignalStore with state:
     - `contractIdInput: string`
     - `loading: boolean`
     - `error: string | null`
     - `contractData: PartnerHistoricalOptionsContractV2Response | null`
     - `underlyingBars: OHLCDatum[]`
     - `showUnderlying: boolean`
     - `showGreeks: boolean`
     - `showVolumeOI: boolean`
   - Methods:
     - `loadContract(occId: string)` — fetches contract + auto-fetches underlying
     - `toggleUnderlying()`
     - `toggleGreeks()`
     - `toggleVolumeOI()`
   - Computed:
     - `observations` — parsed series array
     - `dte` — days to expiration from today
     - `dataQualityFlags` — gaps, NaN IV, zero volume counts

### Frontend Chart Component

8. **`options-contract-chart.component.ts/.html/.scss`** in `src/app/features/rh-agent/components/options-contract-chart/`
   - Syncfusion chart with category axis (indexed by observation position, not dates)
   - Zoom/pan/scrollbar — same Syncfusion services as flex-chart
   - **Main pane:**
     - Option `mark` — primary line, left Y-axis
     - `bid` / `ask` — faint bounds, left Y-axis
     - Underlying `close` — faint line, right Y-axis, toggleable
   - **Lower-1 pane:** IV line
   - **Lower-2 pane:** Delta + gamma lines (theta/vega off by default, toggle via `showGreeks`)
   - **Lower-3 pane:** Volume columns + OI line (toggle via `showVolumeOI`)
   - Crosshair with tooltip showing date + values

### Frontend Page

9. **`option-chart.component.ts/.html/.scss`** in `src/app/features/rh-agent/pages/option-chart/`
   - OCC ID text input + "Load" button
   - Contract header: contract ID, symbol, type, strike, expiration, DTE, observation count, data quality flags
   - Chart component
   - Toggle controls: underlying, Greeks, volume/OI
   - Loading/error states

### Routing

10. **Route in `src/app/core/core-routes.ts`**
    - `{ path: AppRoutes.OPTION_CHART, loadComponent: () => import('...option-chart.component'), canActivate: [authGuard] }`

11. **Export** from `src/app/features/rh-agent/index.ts`

## Deferred

- Multi-contract add UI (per-contract toggles + "view all" in lower panes)
- Chain picker (symbol → expiration → strike → type)
- Black-Scholes candlestick interpolation (IV + underlying OHLC → option OHLC, mark as close)
- Snapshot save / caching
