**Topic:** Savant Trader — UAT cleanup + initial order tickets (Round 2)
**Issue:** #212
**Topic Parent:** #176
**Domain:** SAVANT-TRADER
**Type:** Code Review (Interim — issue is in 7_QA, not 5_IMPLEMENT)
**Status:** Complete
**Created:** 2026-09-03
**Last Updated:** 2026-09-03

---

## Summary

Three-axis review of the second round of uncommitted Savant Trader UAT cleanup (#212 / topic #176). This diff covers order ticket form restructuring, stop loss lifecycle changes, account number redaction, price stepper behavior, queue display improvements, and a new UAT doc for order processing permutations.

13 files changed (+246/-153 lines).

### Diff scope

- **Order ticket form:** Fields stacked vertically (type, qty, cost/units, limit, stop, TIF, hours). Limit/stop price fields default to current price. Price steppers changed to $0.25 increment with round-ending avoidance. Stop loss form hidden until entry fills; stop loss values initialized from fill price. Submit Stop Loss button moved inside the stop loss form.
- **Account redaction:** Account number redacted in scoreboard (`agentic ••••XXXX`) and in preview/stopLossPreview JSON. Full account number still visible in dialogs.
- **Order queue:** Date column added, group expand/collapse, side/createdAt sorting within groups.
- **Specs:** Stop loss tests updated to use FILLED intents with fill price results.
- **Docs:** New `UAT-ORDER-PROCESSING.md` with lifecycle reference, sequential batch processing scenario, and permutation tests.

### Verification

| Check | Result |
|---|---|
| `npm run build` (Angular, dev config) | **PASS** — exit 0 |
| `ng test` (order-ticket.component.spec.ts) | **7/7 PASS** |
| Pre-existing failures | None in this diff's scope |

### Verdict: CONDITIONAL PASS

The diff meets the #212 UAT cleanup acceptance criteria. Build passes, tests pass. However, three issues should be fixed before committing:

1. **Preview JSON shows redacted account** — the `preview` computed returned `••••XXXX` instead of the real account number, contradicting the PRD's "live preview of what will be sent" contract. The UI header redaction is correct and stays; the preview data should show the real account number because that's what's actually sent to Robinhood. **Fixed** — preview and stopLossPreview now return the real account number.
2. **Stop-loss default doesn't reset on selection change** — the `if (this.stopLossPrice()) return;` guard prevented recalculation when switching between filled intents. **Fixed** — now tracks `lastStopLossIntentId` and recalculates directly from the new fill price on intent change, with no intermediate zero step.
3. **`dateFor` will throw on missing `createdAt`** — no null guard on `intent.createdAt.slice(0, 10)`. **Fixed** — added `?.` guard with `'—'` fallback.

The remaining findings are judgement-call smells or deferred architectural concerns.

---

## Standards

### Documented-standard violations (hard)

None. The repo's only documented standard is `AGENTS.md` (build/deploy commands, IPv6 workaround — no coding-style rules).

### Baseline Fowler smells (judgement calls)

1. **Duplicated Code — account redaction.** The `••••${acct.slice(-4)}` pattern is duplicated in three locations: `order-ticket.component.ts` (preview + stopLossPreview) and `order.component.ts` (accountName). Extract a `redactAccount` helper.

2. **Duplicated Code — stepper markup.** The Limit $, Stop $, Stop Loss $, and Stop Loss % steppers are identical in shape in `order-ticket.component.html`. A reusable stepper component would remove the repetition.

3. **Repeated Switches — queue grouping.** Six near-identical `intents: sortIntents(all.filter(...))` blocks in `order-queue.component.ts`. A status-to-group map would consolidate.

4. **Repeated Switches — group dot colors.** One-off `.group-staged .group-dot` through `.group-cancelled .group-dot` rules in `order-queue.component.scss`. A Sass map would remove the cascade.

5. **Primitive Obsession — money as string.** `defaultDollarAmount: number` coerced with `String(...)` to fit a string field in `signal-review.facade.ts`. A typed money value would be cleaner.

---

## Spec

**Spec source:** `PRD-savant-trader-order-placement-refactor.md` (Issue #177, parent #176)

### Missing / partial requirements

1. **Queue row no longer shows status.** PRD §191 says rows should show "source badge, symbol, side, order type, quantity, status." The diff removes the per-item status badge — status is only visible in the group header. **Partial** — acceptable since grouping by status makes the per-row badge redundant, but the PRD explicitly lists it.

2. **Stop loss is `stop_market` only.** PRD §174 defines stop loss as `stop_market | stop_limit`. The implementation always uses `stop_market` with no user toggle. **Partial** — can be deferred, `stop_market` is the common case.

3. **Dollar amount not editable in ticket.** PRD §48 requires "quantity or dollar amount" as an editable parameter. The redesigned ticket only exposes a Qty stepper. **Partial** — the auto-calc from `defaultDollarAmount` covers the common case, but advanced users can't switch to notional mode.

### Scope creep (requested by user during UAT, not in PRD)

- Account number redaction in UI header and preview JSON (PRD §216 only asked for log redaction)
- Queue group expand/collapse, date column, side/createdAt sorting
- $0.25 price steppers with round-ending avoidance
- Limit/stop defaulting to current price
- `defaultDollarAmount` added to trading config (PRD §209-211 defines config as `{ accountNumber, updatedAt }` only)

All of these were explicitly requested during UAT sessions. They are intentional scope additions, not accidental creep.

### Implemented but looks wrong

1. **Preview didn't match what will be sent.** PRD §192 calls the ticket preview a "live preview of what will be sent." The `preview` computed returned `accountNumber: '••••XXXX'`, which does not match the actual Robinhood payload. **Fixed** — preview now returns the real account number. The UI header redaction is a separate display concern and stays as-is.

2. **Stop-loss default didn't reset on selection change.** The `entryFillPrice` effect had `if (this.stopLossPrice()) return;` — because `stopLossPrice` is a single component-level signal, switching to a different filled intent wouldn't reset the default if the field already had a value from the previous intent. **Fixed** — now tracks `lastStopLossIntentId` and recalculates directly from the new fill price on intent change.

3. **Stepper nudge is internally inconsistent.** Starting from $100.00, the first +$0.25 click gives $100.27 (not $100.25) because of the round-ending nudge. The increment is no longer exactly $0.25 when the starting price ends in 0 or 5. This is by design (user requested "never round endings") but the two requirements are in tension — document the behavior or pick one. **Acceptable as-is** — user explicitly requested both behaviors.

---

## Thermo-Nuclear

### Contract/Interface issues

1. **Hidden coupling: stop-loss intent pulled from store.** `OrderTicketComponent` reads `this.stagingStore.intents()` directly to find the linked stop-loss intent (line 173-180) instead of receiving it as an input. The parent `OrderComponent` already owns the store and could pass it in. This makes the ticket harder to test in isolation.

2. **Order-construction logic in review facade.** `SignalReviewFacade` now builds and stages order intents (lines 58-99, 445-474). Order-construction logic belongs in a dedicated `SignalOrderBuilder` or service, not the review facade. This is pre-existing from the first round but is growing.

3. **`preview()` hard-codes `dollarAmount: undefined`.** Line 316 — contradicts the "live preview of what will be sent" contract. If the intent has a `dollarAmount`, the preview should show it.

### Implementation quality

1. **`OrderTicketComponent` is 639 lines.** It conflates order math, stop-loss logic, store mutations, dialogs, guardrails, and formatting. Consider extracting stop-loss logic into a separate component or service.

2. **`acceptSymbol` is non-atomic.** Persists the ACCEPT decision (line 365) before checking whether an account is configured (lines 452-455). A missing account leaves an accepted signal with no staged order. Pre-existing from first round.

3. **`ngOnInit` subscribes without unsubscribing.** `OrderComponent.ngOnInit` subscribes to `configService.loadConfig()` (lines 167-176) but never stores or unsubscribes from the subscription. Minor — the observable completes after one emit — but not clean.

### Test coverage gaps

1. **Ticket spec doesn't cover:** cancel, modify, retry, invalid quantity, no-account guard, stop-loss validation, guardrail warnings, or option/ETF paths. Only 7 tests total.

2. **Facade spec doesn't test:** `buildIntentId`, `removeStagedIntentForSymbol`, or the case where `acceptSymbol` succeeds but `stageIntentForSymbol` fails.

3. **Queue grouping and batch-remove** have no test coverage in this diff.

### Error handling/edge cases

1. **`dateFor` will throw on missing `createdAt`.** `order-queue.component.ts` line 180 calls `intent.createdAt.slice(0, 10)` without guarding. **Fix before commit.**

2. **Stop-loss bidirectional sync can clobber manual input.** `onStopPriceInput` updates `stopLossPercent`, which triggers the percent `effect` (lines 391-401) to rewrite `stopLossPrice`. If the user types a price, the percent updates, then the effect overwrites their price with a recomputed value. The `untracked` wrapper prevents the reactive loop but the logical clobber remains.

3. **`saveEdits` drops option quantity.** Only saves `quantity` for equity/ETF intents (lines 413-419). Option quantity edits are silently dropped. Pre-existing but worth noting.

### Signal reactivity correctness

1. **Potential infinite loop in facade effect.** `SignalReviewFacade` constructor effect reads `groupStore.activeRunId()` then writes to `groupStore.setActiveRun(...)` (lines 198-203). Writing a signal that the effect depends on can create an infinite reactive loop. The write should be wrapped in `untracked`. Pre-existing from first round.

2. **`fetchAccountSnapshot` has no cancellation.** Rapid signal changes can launch overlapping fetches. Minor — the last one wins — but not clean.

3. **Ticket effects correctly use `untracked`.** All local-signal writes inside sync effects are properly wrapped (lines 328-343, 360-374, 377-387). No issues here.

---

## Disposition

### Fixed before commit (3 items)

| # | Finding | Axis | Fix |
|---|---------|------|-----|
| F1 | Preview JSON showed redacted account | Spec | Preview and stopLossPreview now return the real account number. UI header redaction stays — redaction is a display concern, not a data concern. |
| F2 | Stop-loss default didn't reset on selection change | Spec | Now tracks `lastStopLossIntentId` and recalculates directly from the new fill price on intent change — no intermediate zero step. |
| F3 | `dateFor` threw on missing `createdAt` | Thermo-nuclear | Added `?.` guard with `'—'` fallback. |

### Deferred to #205 (decision pipeline simplification)

See `BACKLOG-savant-trader-205-deferred-from-212.md` for the full list with file references.

| # | Finding | Axis | Notes |
|---|---------|------|-------|
| D1 | Order-construction logic in review facade | Thermo-nuclear | Extract to `SignalOrderBuilder` service |
| D2 | `OrderTicketComponent` is 639 lines | Thermo-nuclear | Extract stop-loss logic |
| D3 | `acceptSymbol` is non-atomic | Thermo-nuclear | Needs transactional design |
| D4 | Potential infinite loop in facade effect | Thermo-nuclear | Wrap write in `untracked` |
| D5 | `fetchAccountSnapshot` no cancellation | Thermo-nuclear | Add AbortController or switchMap |
| D6 | Stop-loss bidirectional sync clobber | Thermo-nuclear | Needs debounce or flag-based guard |
| D7 | `saveEdits` drops option quantity | Thermo-nuclear | Add option branch |
| D8 | `ngOnInit` subscription leak | Thermo-nuclear | Use takeUntilDestroyed |
| D9 | Hidden coupling: stop-loss from store | Thermo-nuclear | Pass as input from parent |

### Deferred to future cleanup

See `BACKLOG-savant-trader-212-deferred.md` for the full list with file references.

| # | Finding | Axis | Notes |
|---|---------|------|-------|
| C1 | Duplicated account redaction | Standards | Extract `redactAccount` helper |
| C2 | Duplicated stepper markup | Standards | Reusable stepper component |
| C3 | Repeated switches in queue grouping | Standards | Status-to-group map |
| C4 | Repeated switches in group dot colors | Standards | Sass map |
| C5 | Primitive obsession — money as string | Standards | Typed money value |
| C6 | Test coverage gaps | Thermo-nuclear | Expand ticket/facade/queue specs |

### Accepted as-is (UAT-requested scope)

| # | Finding | Axis | Notes |
|---|---------|------|-------|
| A1 | Account redaction in UI header | Spec | User requested — not in PRD but intentional |
| A2 | Queue collapse, date column, sorting | Spec | User requested — UI polish |
| A3 | $0.25 steppers with round-ending avoidance | Spec | User requested — intentional behavior |
| A4 | Limit/stop default to current price | Spec | User requested — UX improvement |
| A5 | `defaultDollarAmount` in trading config | Spec | User requested — needed for auto-calc |
| A6 | Stop loss hidden until entry fills | Spec | User requested — better UX than PRD |
| A7 | Queue row status badge removed | Spec | Acceptable — group header shows status |
| A8 | Stop loss `stop_market` only | Spec | Acceptable — common case, `stop_limit` can be added later |
| A9 | Dollar amount not editable in ticket | Spec | Acceptable — auto-calc covers common case |
