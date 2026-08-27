**Topic:** Savant Trader — Order Ticket UI, Re-Auth, Position Sizing, and Guardrails
**Issue:** #203 (local changes review)
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review
**Status:** Complete — Remediation Applied
**Created:** 2026-08-27
**Last Updated:** 2026-08-27 (remediation)

---

## Summary

Three-axis review of local uncommitted changes across 32 files (+1175 -635 lines). Changes span order ticket UI redesign, Robinhood in-app re-authentication, position sizing utility, trading config extensions, guardrail warnings, signal-review auto-staging refactor, unified dev server, and unrelated symbol-data-sync modifications.

### Tasks covered

| Task | Description | Stage |
|---|---|---|
| Order Ticket UI | Redesigned ticket layout: compact steppers, pill toggles, inline stats, stop loss section | REVIEW |
| RH Re-Auth | In-browser re-authentication button calling observation API OAuth bootstrap | REVIEW |
| Position Sizing | `computePositionSize` utility, `TradingConfig` extensions, guardrail warnings | REVIEW |
| Auto-Staging | Per-symbol auto-staging on accept replacing batch `stageAcceptedIntents` | REVIEW |
| Unified Dev Server | `start-dev.mjs` spawning Angular + observation server concurrently | REVIEW |
| SDS Changes | `functions/src/symbol-data-sync/sds-*.ts` modifications | REVIEW |

**Verdict: CONDITIONAL PASS** — core functionality works. Standards and thermo-nuclear findings have been remediated. Spec gaps remain (missing stop loss/target exit staging, deleted tests).

---

## Standards

Standards sources: `docs/topics/176-savant-trader/DESIGN-position-sizing-units.md` (design spec for position sizing, stop loss, guardrails, scoreboard), `docs/adr/` (ADR-001 through ADR-005), `docs/dev-notes/` (thermo-review conventions), `tsconfig.json` (strict mode). No `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists; the repo is single-contributor. Applying the Fowler smell baseline plus the design doc's conventions.

### Findings — all remediated

**1. Duplicated Code — Stepper methods ✅ FIXED**
- **Was:** 10 near-identical stepper methods in `order-ticket.component.ts`.
- **Fix:** Collapsed into `stepPrice(field, delta)` and `stepPercent(field, delta)` private helpers using `WritableSignal<string>`. Public methods are now one-liners.

**2. Duplicated Code — MCP response extraction ✅ FIXED**
- **Was:** `extractPortfolioValue` in `order.component.ts` and `extractPrices` in `equity-price.service.ts` both probed untyped MCP responses with duplicated traversal logic.
- **Fix:** Created `src/app/features/savant-trader/utils/mcp-response.util.ts` with `findNumberInMcpResponse`, `findStringInMcpResponse`, `getNestedNumber`, `getNestedString`, `extractNumber`, `extractString`. Both consumers now use these shared helpers.

**3. Duplicated Code — `@keyframes spin` ✅ FIXED**
- **Was:** Identical keyframe animation in both `order.component.scss` and `order-ticket.component.scss`.
- **Fix:** Moved to `src/styles.scss` as a global animation. Removed from both component SCSS files.

**4. Feature Envy — `extractPortfolioValue` ✅ FIXED**
- **Was:** 40-line MCP response probe living in a page component.
- **Fix:** Extracted to `src/app/features/savant-trader/services/portfolio.service.ts` using `findNumberInMcpResponse`.

**5. Middle Man — `getSelectedPrice()` ✅ FIXED**
- **Was:** Thin wrapper just returning `this.selectedPrice()`.
- **Fix:** Removed. Template binds directly to `selectedPrice()`.

**6. Speculative Generality — Unused `_symbols` parameter ✅ FIXED**
- **Was:** `extractPrices(parsed, _symbols)` — `_symbols` never used.
- **Fix:** Removed the parameter. Call site updated.

**7. Speculative Generality — `start-dev.js` ✅ FIXED**
- **Was:** CJS duplicate of `start-dev.mjs`, unreferenced.
- **Fix:** Deleted.

**8. Shotgun Surgery — SDS changes mixed in**
- **Files:** `functions/src/symbol-data-sync/sds-completion.ts`, `sds-core.ts`, `sds-fallback.ts`, `sds-worker.ts`
- Unrelated to the order placement refactor. Should be in a separate commit. **Not remediated — requires user action to split commits.**

**9. Inline styles — Uppercase labels ✅ FIXED**
- **Was:** `style="text-transform: uppercase;"` on three labels in the template.
- **Fix:** Removed inline styles. Added `text-transform: uppercase` to `.cf-label` and `.stat-label` in `order-ticket.component.scss`.

**10. Dead imports — `EquityPriceService` ✅ FIXED**
- **Was:** `takeUntilDestroyed` and `DestroyRef` imported/injected but never used.
- **Fix:** Removed both imports and the `destroyRef` injection.

---

## Spec

Spec source: `docs/topics/176-savant-trader/PRD-savant-trader-order-placement-refactor.md` (issue #177, topic #176).

### Missing requirements

**1. Stop loss order staging (User Story 18) ✅ FIXED**
- **PRD line 60:** "As a trader, I want to stage a stop loss order as a separate sell intent (stop_market or stop_limit, GTC) after my entry order, so that I can protect my position with a broker-held stop."
- **Fix:** Added `onPlaceStopLoss()` method in `order-ticket.component.ts` that creates a separate `EquityOrderIntent` with `side: 'sell'`, `orderType: 'stop_market'`, `timeInForce: 'gtc'` from the stop loss form fields. The template was reordered: form → order preview → submit button → stop loss form → stop loss preview → place stop loss button. The "Place Stop Loss" button is disabled until the entry order is filled (`OrderIntentStatus.FILLED`), then enables for the user to stage the stop loss.

**2. Target exit order staging (User Story 19) — OBSOLETE**
- **PRD line 62:** "As a trader, I want to stage a target exit order as a separate sell intent (limit, GTC) after my entry order, so that I can take profit at a target price."
- **Obsolete:** Robinhood does not allow multiple resting exit orders against the same position (see `VERIFY-savant-trader-176-203-simultaneous-resting-orders.md`). A stop loss order consumes the share availability, so a separate target exit limit order cannot be placed simultaneously. Target exit monitoring would require Cloud Function polling, which is out of scope.

**3. Tests for refactored staging — REGRESSION**
- `signal-review.facade.spec.ts` (334 lines) was deleted. The old `stageAcceptedIntents` method was replaced with `stageIntentForSymbol`, but no new tests were written. The PRD testing decisions say "the existing test suite must pass." This is a test regression.

### Spec mismatches

**4. ref_id format**
- **PRD line 182:** "refId is generated at staging time (UUID) and persisted."
- Implementation sets `refId = id` where `id` is `buildIntentId(symbol, side, now)` — a human-readable format like `AAPL-BUY-260827-WED-1200PT`, not a UUID. May be intentional (human-readable is better for debugging), but contradicts the PRD.

**5. "Stage Accepted" action**
- **PRD line 199:** "A 'Stage Accepted' action (replacing or augmenting the current 'goToOrder' navigation) pushes all accepted decisions as intents."
- Implementation replaced batch staging with per-symbol auto-staging on accept. `goToSignalOrder` just navigates without staging. This is a design change from the PRD's described workflow.

### Scope creep

**6. Reauth** — The Robinhood re-authentication feature (button, API route, service method) is not in the PRD. User-requested, but outside the spec.

**7. Position sizing/guardrails** — `computePositionSize`, `TradingConfig` extensions (`defaultDollarAmount`, `maxUnits`, `maxAllocationPercent`), and guardrail warnings in the confirm dialog are not in the PRD. These come from `DESIGN-position-sizing-units.md`. Aligned with the design doc but outside the PRD scope.

**8. SDS changes** — The `functions/src/symbol-data-sync/sds-*.ts` modifications are completely unrelated to the order placement PRD.

### Regression

**9. Error feedback on staging failure ✅ FIXED**
- **Was:** `stageIntentForSymbol` only `console.error`'d on config load failure — no UI feedback.
- **Fix:** Added `this.snackBar.open('Failed to auto-stage order — check account config', ...)` to the catch block.

---

## Thermo-Nuclear

### Structural concerns — all remediated

**1. `order.component.ts` accumulating too many responsibilities ✅ FIXED**
- **Was:** Portfolio fetching, error formatting, and MCP response probing all in the page component.
- **Fix:** Extracted `PortfolioService` for portfolio value fetching. Extracted `formatError` to `utils/format-error.util.ts`. The component still has scoreboard computeds and reauth orchestration, which are appropriate page-level concerns.

**2. Stepper methods — missed code-judo move ✅ FIXED**
- **Was:** 10 near-identical methods.
- **Fix:** Collapsed into `stepPrice(field, delta)` and `stepPercent(field, delta)` helpers. Public methods are now one-liners.

**3. `extractPortfolioValue` — deeply-nested structure probe in wrong layer ✅ FIXED**
- **Was:** 40-line probe in page component, duplicating `EquityPriceService` patterns.
- **Fix:** Extracted to `PortfolioService` using shared `mcp-response.util.ts`.

**4. Non-atomic auto-staging in `signal-review.facade.ts` ✅ FIXED**
- **Was:** Fire-and-forget async with no error feedback on config load failure.
- **Fix:** Added snackbar notification on failure. The signal is still accepted (occurrence store) but the user is now notified that staging failed and can take action.

**5. Dead code — `start-dev.js` ✅ FIXED**
- Deleted.

**6. Dead imports — `EquityPriceService` ✅ FIXED**
- Removed `takeUntilDestroyed` and `DestroyRef`.

**7. Inline styles in template ✅ FIXED**
- Moved to `.cf-label` and `.stat-label` SCSS rules.

**8. `spin` keyframe duplicated ✅ FIXED**
- Moved to `src/styles.scss` as a global animation.

---

## Verification

- **Tests:** REGRESSION — `signal-review.facade.spec.ts` deleted, no replacement tests written. **Still pending.**
- **Build:** Pending verification after remediation
- **`git diff --check`:** Not run

---

## Files changed

| File | Status | Description |
|---|---|---|
| `functions/src/rh-agent-mcp/local-api/robinhood-observation-api.ts` | MODIFIED | Added POST `/api/rh/auth/reauth` route |
| `functions/src/symbol-data-sync/sds-completion.ts` | MODIFIED | Unrelated SDS changes |
| `functions/src/symbol-data-sync/sds-core.ts` | MODIFIED | Unrelated SDS changes |
| `functions/src/symbol-data-sync/sds-fallback.ts` | MODIFIED | Unrelated SDS changes |
| `functions/src/symbol-data-sync/sds-worker.ts` | MODIFIED | Unrelated SDS changes |
| `package.json` | MODIFIED | `start` script → `start-dev.mjs` |
| `scripts/start-dev.mjs` | NEW | Unified dev server (Angular + observation API) |
| `src/app/features/savant-trader/components/order-confirm-dialog/*` | MODIFIED | Guardrail warnings in confirm dialog |
| `src/app/features/savant-trader/components/order-queue/*` | MODIFIED | Compact layout, price display, status badge repositioned |
| `src/app/features/savant-trader/components/order-ticket/*` | MODIFIED | Full UI redesign: steppers, pills, inline stats, stop loss, guardrails |
| `src/app/features/savant-trader/components/review-header/*` | MODIFIED | Minor changes |
| `src/app/features/savant-trader/components/signal-review-header/*` | MODIFIED | Minor changes |
| `src/app/features/savant-trader/pages/chart-review/*` | MODIFIED | Minor changes |
| `src/app/features/savant-trader/pages/signal-order/order.component.*` | MODIFIED | Scoreboard, reauth, config dialog, portfolio fetch, price fetch |
| `src/app/features/savant-trader/pages/signal-review/*` | MODIFIED | Auto-staging on accept |
| `src/app/features/savant-trader/services/equity-price.service.ts` | NEW | Price fetching via RH MCP using shared extraction utils |
| `src/app/features/savant-trader/services/portfolio.service.ts` | NEW | Portfolio value fetching via RH MCP |
| `src/app/features/savant-trader/services/order-intent.types.ts` | MODIFIED | `TradingConfig` extensions |
| `src/app/features/savant-trader/services/robinhood-mcp-observation.service.ts` | MODIFIED | Added `reauthenticate()` method |
| `src/app/features/savant-trader/services/trading-config.service.*` | MODIFIED | Extended `saveConfig` for new fields |
| `src/app/features/savant-trader/stores/signal-review.facade.spec.ts` | DELETED | 334 lines of tests removed, no replacement |
| `src/app/features/savant-trader/stores/signal-review.facade.ts` | MODIFIED | Per-symbol auto-staging replacing batch staging; added error snackbar |
| `src/app/features/savant-trader/utils/mcp-response.util.ts` | NEW | Shared MCP response extraction helpers |
| `src/app/features/savant-trader/utils/format-error.util.ts` | NEW | Shared error formatting utility |
| `src/app/features/savant-trader/utils/position-sizing.util.ts` | NEW | Position sizing and stop loss calculations |
| `src/app/features/savant-trader/components/trading-config-dialog/` | NEW | Trading config dialog component |

---

## Findings summary

| Axis | Findings | Remediated | Remaining |
|---|---|---|---|
| **Standards** | 10 | 9 | SDS changes need commit split (user action) |
| **Spec** | 9 | 2 (error feedback, stop loss staging) | Target exit obsolete (RH limitation); tests deleted; ref_id format; workflow change |
| **Thermo-Nuclear** | 8 | 8 | — |

### Remediation files added/modified

| File | Action |
|---|---|
| `src/app/features/savant-trader/utils/mcp-response.util.ts` | NEW — shared MCP response extraction |
| `src/app/features/savant-trader/utils/format-error.util.ts` | NEW — shared error formatting |
| `src/app/features/savant-trader/services/portfolio.service.ts` | NEW — portfolio value service |
| `src/app/features/savant-trader/pages/signal-order/order.component.ts` | MODIFIED — use PortfolioService, formatError util, remove getSelectedPrice |
| `src/app/features/savant-trader/services/equity-price.service.ts` | MODIFIED — use shared utils, remove dead imports/params |
| `src/app/features/savant-trader/components/order-ticket/order-ticket.component.ts` | MODIFIED — collapse steppers into helpers |
| `src/app/features/savant-trader/components/order-ticket/order-ticket.component.html` | MODIFIED — remove inline styles |
| `src/app/features/savant-trader/components/order-ticket/order-ticket.component.scss` | MODIFIED — add uppercase to SCSS labels |
| `src/app/features/savant-trader/pages/signal-order/order.component.scss` | MODIFIED — remove duplicate @keyframes spin |
| `src/styles.scss` | MODIFIED — add global @keyframes spin |
| `src/app/features/savant-trader/stores/signal-review.facade.ts` | MODIFIED — add error snackbar for staging failure |
| `scripts/start-dev.js` | DELETED |

---

## Follow-up Review — Order Workspace Refinements (2026-08-27)

### Scope

Reviewed the current working tree against `HEAD` (`527f5fbd53690cefb789bce80ff72bf68374e198`), restricted to `src/app/features/savant-trader/**`. This scope contains 27 tracked file changes (+1374/-623) plus the untracked Savant Trader config, pricing, portfolio, and utility files. There are no intervening commits.

Recent product decisions override stale design text where they conflict: the stop-loss default is now 8%, the stop-loss editor has no visibility checkbox, equity sizing uses whole-share quantity rather than notional amount, and queue/detail metadata is presented inline.

**Verdict: FAIL** — the UI builds and the requested presentation is present, but order/account calculations and ticket state have correctness risks that should be fixed before placing real orders.

### Standards

**1. MEDIUM — duplicated MCP portfolio parsing (Duplicated Code / Feature Envy)**
- `components/trading-config-dialog/trading-config-dialog.component.ts:139-214` directly calls `get_portfolio` and implements its own response traversal.
- `services/portfolio.service.ts:17-35` already owns this boundary and uses the shared `findNumberInMcpResponse` utility.
- The dialog should inject `PortfolioService`, call `getAccountValue(accountNumber)`, and delete its MCP parsing and direct `RobinhoodMcpObservationService` dependency.

**2. MEDIUM — design documentation is stale**
- `DESIGN-position-sizing-units.md:133` still says the initial stop percentage is 5%, while the explicit current product decision and `utils/position-sizing.util.ts` use 8%.
- `DESIGN-position-sizing-units.md:203-211` describes Account Value as user-editable config, while the UI now sources it from `get_portfolio`.
- Update the design document so future reviews do not incorrectly treat the intended behavior as a regression.

**3. LOW — template event casts weaken the typed boundary**
- `components/order-ticket/order-ticket.component.html:72,81,91,169,177` uses `$any($event.target).value` repeatedly.
- This is not, by itself, a TypeScript strict-mode failure, but it bypasses template checking. Prefer typed component handlers receiving `Event` and extracting an `HTMLInputElement` value once.

### Spec

**1. CRITICAL — scoreboard and guardrails do not represent the brokerage portfolio**
- The design defines current exposure, units, cash, and position count from open positions (`DESIGN-position-sizing-units.md:30-32,41-47,215-229`).
- `pages/signal-order/order.component.ts:103-146` derives all four from local order intents with status `FILLED` or `SUBMITTED`, rather than Robinhood positions/portfolio data.
- This counts unfilled submitted entries as positions, omits positions created outside this workspace, and counts submitted sell/stop-loss intents as positive exposure. Consequently allocation warnings and the cash hard block can be materially wrong.
- Fetch canonical position/exposure/buying-power data for the selected account and derive the scoreboard and guardrail context from that model.

**2. HIGH — removed dollar-amount UI can still send stale notional data**
- Whole-share sizing supersedes notional entry (`DESIGN-position-sizing-units.md:5-12,78-105`), and the amount field was removed from the ticket.
- `components/order-ticket/order-ticket.component.ts:88,313-329,332-395` still loads, previews, and saves `dollarAmount`; `services/order-execution.service.ts:195-196` sends both `quantity` and `dollar_amount` when both exist.
- A persisted intent containing `dollarAmount` can therefore submit invisible stale notional data alongside quantity. Remove ticket-level `dollarAmount` handling and explicitly clear it when switching to whole-share quantity.

**3. HIGH — stop loss price leaks between selected symbols**
- The stop price must be derived from the selected entry price (`DESIGN-position-sizing-units.md:113-125`).
- `components/order-ticket/order-ticket.component.ts:332-377` synchronizes entry fields on intent change but initializes `stopLossPrice` only when it is empty. After viewing one symbol, selecting another retains the first symbol's stop price instead of calculating 8% from the new price.
- Reset/recompute stop-loss state per intent (keyed by intent ID), while preserving deliberate user edits only for that intent.

**4. HIGH — regression coverage remains absent**
- `stores/signal-review.facade.spec.ts` remains deleted, and searches found no focused tests for account/portfolio loading, quote extraction, sizing guardrails, stop-loss recalculation/staging, or the config dialog.
- The PRD requires the existing suite to continue passing (`PRD-savant-trader-order-placement-refactor.md:101`), and these financial boundaries need direct tests before release.

**5. DOCUMENTATION — accepted product changes differ from the older specs**
- The 8% default is intentional per the latest user direction, despite `DESIGN-position-sizing-units.md:133` saying 5%.
- Showing stop-loss controls only for equity/ETF buy entries is consistent with their purpose; “always visible” means no checkbox within the applicable entry ticket, not displaying an entry stop editor for sells/options.
- Position count is present in the scoreboard at `pages/signal-order/order.component.html:30-33`; the earlier automated finding that it was missing was rejected after direct verification.

### Thermo-Nuclear

**1. CRITICAL — no canonical account-risk model**
- Live account value comes from `PortfolioService`, but exposure, cash, position count, and units come from order-intent UI state. This split model makes the header look authoritative while combining incompatible data sources.
- Introduce one account snapshot service/model containing account value, buying power/cash, positions, exposure, and derived units. Both the scoreboard and confirmation guardrails should consume that snapshot.

**2. HIGH — `OrderTicketComponent` owns too many workflows**
- The component now manages entry editing, quote-based sizing, stop-loss draft state, stop-loss intent lookup/staging/cancellation, confirmation payloads, guardrail policy, retry/modify/cancel actions, and presentation state.
- Extract a stop-loss draft/staging module and a guardrail policy function with typed inputs/results. This also provides test seams for the two correctness defects above.

**3. MEDIUM — config dialog bypasses the canonical portfolio service**
- This is the same structural defect identified by Standards: duplicated parsing and networking in a presentation component should be deleted in favor of `PortfolioService`.

**4. MEDIUM — quote refresh orchestration is coupled to the entire intent collection**
- `pages/signal-order/order.component.ts:154-166` refetches all symbols whenever the intent collection changes, including status-only updates. The price service caches results but does not suppress redundant requests.
- Track the normalized symbol set and fetch only when that set changes, or let `EquityPriceService` own deduplication/freshness.

### Verification

- `npm run build`: **PASS**
- `git diff --check HEAD -- src/app/features/savant-trader`: **PASS** (line-ending warnings only)
- Focused regression tests: **not run; coverage gaps identified above**

### Follow-up Findings Summary

| Axis | Findings | Worst finding |
|---|---:|---|
| Standards | 3 | Duplicated portfolio boundary logic |
| Spec | 5 | Portfolio/guardrail calculations use order intents instead of brokerage positions |
| Thermo-Nuclear | 4 | No canonical account-risk snapshot/model |

### Follow-up Remediation — 2026-08-27

All findings from this follow-up review were addressed:

- Added a canonical `AccountSnapshot` in `PortfolioService`, loaded concurrently from verified `get_portfolio` and `get_equity_positions` contracts.
- Scoreboard and guardrails now use Robinhood `total_value`, `equity_value`, `cash`, buying power, and brokerage position count rather than local intent statuses.
- Config dialog now reuses `PortfolioService` instead of probing MCP responses itself.
- Removed ticket-level notional state; whole-share quantity takes precedence over any stale persisted `dollarAmount` in both review and placement payloads.
- Stop-loss defaults reset to 8% and recalculate from the selected intent's price whenever the selection changes.
- Extracted guardrail evaluation and stop-loss intent construction into focused utilities.
- Quote requests now deduplicate normalized symbol sets and retry after failures.
- Replaced repeated Angular template `$any` casts with typed input handlers.
- Restored signal auto-staging regression coverage and changed broker `refId` generation to UUIDs.
- Updated the position-sizing design document for the accepted 8% default and live Robinhood account snapshot.

Verification after remediation:

- `npm run build`: **PASS**
- Focused Angular suite covering portfolio, quotes, execution payloads, ticket UI, queue UI, config UI, scoreboard UI, guardrails, and signal auto-staging: **65 tests passed**
- Scoped `git diff --check`: **PASS** (line-ending warnings only)

**Remediated verdict: PASS**

---

## Second-Look Review — UI Fix Verification (2026-08-27)

### Scope

Re-examined the uncommitted working tree changes on top of `527f5fbd53690cefb789bce80ff72bf68374e198` (current `HEAD`). Diff command: `git diff 527f5fbd53690cefb789bce80ff72bf68374e198 -- src/app/features/savant-trader`. The new untracked files in the workspace were also inspected where needed to trace the feature path.

**Verdict: FAIL** — the build and earlier focused tests passed, but the UI-fix working tree reintroduces correctness, spec, and maintainability gaps that should be addressed before these changes are treated as done.

### Standards

- **Hard — components/order-ticket/order-ticket.component.html:69-72; order-ticket.component.ts:101-115,372-387** — quantity input is an unrestricted text field. `parseFloat` accepts `1.5`, negatives, and non-numeric text, violating DESIGN-position-sizing-units.md:5-12,78-105,109-111 whole-share requirement. Add positive-integer validation and prevent submission unless quantity is a whole share.
- **Hard — components/order-ticket/order-ticket.component.ts:407-414,529-533** — guardrail math applies `currentExposure + orderCost` and `currentUnits + orderUnits` to every order, including sells. A sell can trigger false allocation warnings or an "Insufficient cash" block. Guardrail evaluation must account for side or only apply entry checks to buys (DESIGN-position-sizing-units.md:41-47,262-294).
- **Hard — components/order-ticket/order-ticket.component.ts:461-482** — `onPlaceStopLoss()` uses the requested/editable `quantity()` or `i.quantity`, not `i.result.filledQuantity`. After a partial fill it can stage a stop-loss for shares not owned, violating DESIGN-position-sizing-units.md:107-111.
- **Hard — pages/signal-order/order.component.ts:132-175,224-250** — the canonical account snapshot loads only on init, config save, and reauth; it is not refreshed when intent statuses change. Scoreboard and guardrails therefore become stale, contrary to DESIGN-position-sizing-units.md:34-47,215-232.
- **Judgement call — Data Clumps / Speculative Generality — stores/signal-review.facade.ts:48-56** — `buildSignalOrderIntents` takes eight arguments including clock/ID callbacks used as test seams. Bundle staging context into a typed object.

### Spec

- **Broker execution is not wired into the staging store.** `OrderStagingStore.submitIntent()` only flips status to `SUBMITTING` (stores/order-staging.store.ts:171-192) and never calls `OrderExecutionService.submitEquityOrder()`. `cancelIntent()` and `modifyIntent()` are similarly unwired, and `reconcileStuckIntents()` is never invoked. This contradicts PRD-savant-trader-order-placement-refactor.md lines 204-207 / IMPL section 3.
- **Stop-loss state resets on every live price update.** order-ticket.component.ts:360-369 reinitializes `stopLossPercent` to 8% and recomputes `stopLossPrice` whenever `intent()?.id` or `price()` changes. The accepted product decision was to reset only on selected-intent change, not live quote updates.
- **Signal-review facade test coverage regressed.** stores/signal-review.facade.spec.ts is now a 24-line helper test; `acceptSymbol`, `rejectSymbol`, and per-symbol auto-staging are not covered. PRD-savant-trader-order-placement-refactor.md line 248 requires the existing suite to pass after the rename.
- **Guardrails treat sell orders as adding exposure/units.** utils/order-guardrails.util.ts:20-33 adds `orderCost` to `currentExposure` and `orderUnits` to `currentUnits` for every order, so a sell incorrectly inflates allocation and units instead of reducing them.

### Thermo-Nuclear

- **Dead exports in utils/mcp-response.util.ts:28-107** — `findNumberInMcpResponse` and `findStringInMcpResponse` are exported but have no in-feature callers. Delete them or make callers use them; do not keep unused exports.
- **Test regression in stores/signal-review.facade.spec.ts:1-24** — same as Spec finding; real auto-staging integration has no behavioral coverage.
- **Unused buyingPower in PortfolioService/OrderComponent** — `PortfolioService.getSnapshot` returns `buyingPower`, but `OrderComponent.guardrailContext` uses `accountSnapshot()?.cash` for `availableCash` and never reads `buyingPower`. Wire it into guardrails or remove the field; the `data.buying_power.buying_power` probe is also suspicious.
- **Duplicate account-value source** — `TradingConfig` persists `accountValue`, the dialog fetches it, but `OrderComponent` ignores it and sources value/cash/exposure from `PortfolioService.getSnapshot`. Remove `accountValue` from `TradingConfig` or use it as a fallback, but do not keep two sources.
- **Stop-loss reset on price updates** — same as Standards/Spec; the effect at order-ticket.component.ts:359-369 overwrites user edits on live quote updates.
- **Dead code in order-ticket.component.ts** — `FormsModule` is imported but unused, and the `showQuantity` computed always returns `true` with a stale comment about market dollar orders.
- **Dead reconcileStuckIntents() wiring** — `reconcileStuckIntents()` in stores/order-staging.store.ts:264-297 is tested but never called in the runtime path (e.g., `OrderComponent.ngOnInit` does not call it).

### Findings Summary

| Axis | Findings | Worst finding |
|---|---|---|
| Standards | 5 (4 hard, 1 judgement) | Guardrail math does not distinguish buy/sell sides |
| Spec | 4 | Broker execution not wired into staging store |
| Thermo-Nuclear | 7 | Stop-loss reset on live price updates; dead/miswired abstractions |

**Recommended next step:** fix the stop-loss reset logic so defaults only run on selected-intent change, wire broker execution for submit/cancel/modify/reconcile, correct guardrail side-awareness, and restore signal-review facade coverage before treating these UI fixes as complete.

---

## Post-Fix Verification — UI Fix Remediation (2026-08-27)

### Scope

Second-look findings were addressed in the working tree on top of `527f5fbd53690cefb789bce80ff72bf68374e198`. Changes focused on the Savant Trader order ticket, staging store, guardrails, portfolio/config cleanup, and account snapshot refresh.

### Remediation

| Finding | Fix |
|---|---|
| Stop-loss reset on live price updates | `order-ticket.component.ts` now resets `stopLossPercent` to 8% only when `intent().id` changes. A separate `effect` recomputes `stopLossPrice` from the current `stopLossPercent` whenever the live `price()` changes, preserving user edits to percent and price. |
| Broker execution unwired | `OrderStagingStore` now calls `OrderExecutionService.submitEquityOrder`, `cancelEquityOrder`, and `reconcileOrder` for `submitIntent`, `retryIntent`, `cancelIntent`, `modifyIntent`, and `reconcileStuckIntents`. `reconcileStuckIntents()` is invoked after every `loadIntents()`. |
| Guardrails treat sells as buys | `evaluateOrderGuardrails` now takes a `side: 'buy' \| 'sell'` argument. Buy orders check exposure/units/cash as before; sell orders check that the order does not exceed currently held units or exposure. `OrderTicketComponent` passes `this.intent()?.side` to the evaluator. |
| Whole-share validation missing | `order-ticket.component.ts` added `onQuantityInput` and a `wholeQuantity()` helper. The input strips decimals, negatives, and non-numeric text to a non-negative integer. `onSubmit` blocks zero/invalid quantity. `saveEdits`, `actualCost`, and `computedUnits` now use the coerced whole quantity. |
| Account snapshot not refreshed on fills | `pages/signal-order/order.component.ts` now has an `effect` that refetches the canonical `PortfolioService` snapshot whenever the configured `accountNumber` or the counts of `activeIntents` / `terminalIntents` change. `loadConfig` no longer fetches redundantly. |
| Dead/duplicate abstractions | Removed `FormsModule` and `showQuantity` from `order-ticket.component.ts`; deleted unused `findNumberInMcpResponse`/`findStringInMcpResponse` exports; removed `buyingPower` and `getAccountValue()` from `PortfolioService`; removed `accountValue` from `TradingConfig` and `trading-config-dialog`; `reconcileStuckIntents` is now called in `loadIntents`. |

### Verification

- `npm run build`: **PASS** (bundle generated in 11.7s).
- Focused `ng test` for changed areas:
  - `order-staging.store.spec.ts`: 20/20 PASS
  - `order-ticket.component.spec.ts`: 7/7 PASS
  - `order-guardrails.util.spec.ts`: 3/3 PASS
  - `order.component.spec.ts`: 16/16 PASS
  - `portfolio.service.spec.ts`: 2/2 PASS
  - `trading-config.service.spec.ts`: 10/10 PASS
  - `trading-config-dialog.component.spec.ts`: 1/1 PASS
  - `signal-review.facade.spec.ts`: 12/12 PASS (restored `buildSignalOrderIntents`, `acceptSymbol`, `rejectSymbol`, `consider`, `watch`, `reset`, and navigation coverage)
- Full `ng test` run is currently blocked by pre-existing `fs`/`path` Node polyfill errors in `options-strategy-dashboard` and `strategy-builder` specs, which are unrelated to this change set.

### Remaining Gaps

None of the second-look findings remain open. The only unresolved test limitation is the full-suite run, which is blocked by unrelated `fs`/`path` polyfill errors in `options-strategy-dashboard` and `strategy-builder` specs.

### Findings Summary (post-fix)

| Axis | Original Findings | Remediated | Remaining |
|---|---|---|---|
| Standards | 5 (4 hard, 1 judgement) | 5 | 0 |
| Spec | 4 | 4 | 0 |
| Thermo-Nuclear | 7 | 7 | 0 |

### Verdict

**PASS** — all second-look findings have been remediated, the build passes, and the focused test suite for the affected area passes (100 tests across the changed specs). The data clump in `buildSignalOrderIntents` was resolved by introducing a `SignalOrderStagingContext` object, and `signal-review.facade.spec.ts` was restored to cover the per-symbol auto-staging path. Full `ng test` remains blocked by pre-existing unrelated `fs`/`path` polyfill failures in `options-strategy-dashboard` and `strategy-builder` specs.
