**Topic:** Options Trading Support  
**Topic Slug:** options  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #958  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #962  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# Code Review — #962 Option submit path (review_option_order → place_option_order, store routing, confirm dialog)

## Scope reviewed

- `services/order-execution.service.ts` + spec — `submitOptionOrder`, shared `submitReviewThenPlace` primitive, option wire-args builder, `unwrapOrderRecord`/`mapOrderRecord` parse layer, `positionType` on captures
- `stores/order-ticket.store.ts` + spec — OPTION → `submitOptionOrder` routing; snackbar block removed
- `components/order-confirm-dialog/` (ts/html/new spec) — option summary rows

## Verdict: PASS (after in-review remediation)

Two round-1 MAJOR findings were remediated and re-verified; what remains is minor/nit/deferred.

## Findings & resolutions

### Round 1

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| MAJOR | Standards | `buildOptionOrderArgs` leaked the shared equity `orderType` union onto the option wire: `stop_limit` dropped `price`, `stop_price` shipped on non-stop types, `stop_loss` passed verbatim; `quantity:''` reached the tool | `wireType` mapped (`stop_loss`→`stop_market`, equity parity); `price` gated on limit/stop_limit, `stop_price` on stop_market/stop_limit; `submitOptionOrder` pre-validates `legs.length>0` + positive finite quantity before any tool call. New specs cover both |
| MAJOR | Thermo | Option fills never parsed — `parseOptionPlaceResult` read `average_price`/`cumulative_quantity`; captured option records carry `processed_quantity`/`processed_premium` (opt-place-fill.json), so dead-with-fills stayed safe only via the ambiguity rule | `mapOrderRecord` reads `cumulative_quantity`→`processed_quantity`→`filled_quantity`; equity fallback now unwraps first (fixes a false-UNCONFIRMED edge on nested `{order:{…}}` payloads without `symbol`) |
| MAJOR | Standards (judgement) | File at ~929 lines vs §1 "<300 target, never 1k" | Waived for this task — under 1k, single-responsibility (execution only), shared-flow refactor avoided duplicating ~90 lines. Wire-codec tail noted as future split candidate |
| minor | Thermo/Standards | Equity parse fallback read raw `parsed`, not the unwrapped record — asymmetric with brokerOrder path | Folded into `mapOrderRecord`/`unwrapOrderRecord` fix above |
| minor | Standards | Dialog rendered `ticket().marketHours` while the wire pins `regular_hours` — display could lie | `marketHours` computed returns `regular_hours` for OPTION |
| minor | Spec | `captureOrderSnapshot` firing on option submits is beyond the literal AC | Kept deliberately — #746 lifecycle capture exists for placed orders; `PositionType.OPTION_SINGLE` exists for exactly this. Recorded as a scope decision |
| nit | Thermo | `as OptionOrderTicket` cast redundant (union narrows); `sideLabel` mixed ticket side with leg effect; stale "equity" docstring | Cast removed; `sideLabel` derives from `leg.side` + `positionEffect`; docstring updated |

### Round 2 (post-remediation pass)

| Sev | Axis | Finding | Resolution |
|---|---|---|---|
| MEDIUM | Standards | Pre-validation parsed leniently — `parseFloat('2.5')`/`'2abc'` pass while RH requires integer contracts; `legs>1` reached RH's live multi-leg rejection; priced/stopped types missing `price`/`stop_price` and market+`gtc` all hit the broker | Tightened to `legs.length !== 1`, `Number.isInteger(qty)`, `price>0` on limit/stop_limit, `stopPrice>0` on stop types, `gfd` required on market; shared `optionWireType` helper so validation and args-build can't drift on the mapping. Spec now sweeps all seven reject shapes |
| minor | Spec/Thermo | `optionLimitPrice`/`optionPremium` rendered a persisted `price` on non-priced order types; `stopPrice` hid option stop triggers — same display-vs-wire class as the marketHours pin | Both gate on the wire type (limit/stop_limit → price rows; stop_market/stop_limit → stop row); premium currency-formats `1.2-2` |
| nit | Thermo | Dead OPTION arm in `symbol()`; `processed_quantity` and the `marketHours` pin lacked spec coverage | Arm removed; specs added for `processed_quantity` dead-with-fills, divergent `marketHours` pin, market-order row hiding |
| LOW (waived) | Standards | Option-specific RH rejections ("aren't supported", "infinite risk") classify retryable under the shared pattern lists | Waived — pattern lists are equity-shared, and default-retryable is the established safe posture (store surfaces the error verbatim; only explicit retry loops consume `retryable`) |

### Deferred — sibling-task scope, not #962

- **`order-ticket.component.ts` OPTION edit/cancel surface** (thermo MAJOR): `editedPartial` writes quantity/price only for EQUITY/ETF, and `onCancel`/`onModify` call `cancelEquityOrder` unconditionally. Unreachable today — `buildOptionSignalTicket` has no production caller until #963. **Pinned as a #963/#964 caller contract** in IMPL-948: the option ticket editor must write `quantity`/`price` for OPTION, and cancel/modify paths must route by `instrumentType` (precedent: `portfolio-dashboard.component.ts:207`).
- Repeated OPTION checks across dialog computeds (nit judgement) — acceptable; a row-model refactor is #963-era churn.
- Sell/close-leg spec cases — v1 can't produce them; the legs/quantity guard covers the reachable abuse.

## Test results

- Focused: **123/123** across `order-execution.service.spec` (34 option cases incl. arg-shape `toEqual`, review short-circuit, UNCONFIRMED/DEAD/unrecognized states, `data.order` unwrap, early validation, stop-limit gating, option-single capture), `order-ticket.store.spec` (option routing, STAGED revert, no snackbar), `order-confirm-dialog.component.spec` (option summary, equity regression, malformed OCC)
- Full suite: **3663 pass / 43 fail** — identical failure count to the pre-task baseline; both failing suites are unrelated in-flight work (`shared/screenshot-capture-contracts.spec.ts` stale vs #844 enum additions; `order.component.spec.ts` missing `Functions` provider via `ScreenshotService`)
- Typecheck `tsc -p tsconfig.app.json --noEmit`: clean

## Remaining risk

Option-ticket editing/cancelling is not yet user-reachable — the wire contract is pinned by exact arg assertions plus live RH captures (`docs/topics/657-rh-mcp/captures/opt-place-*.json`); real broker round-trip gets exercised at #963/#964 UAT.
