**Topic:** Portfolio Dashboard  
**Topic Slug:** portfolio  
**Thread:** Portfolio Dashboard — Update Stop Loss  
**Thread Slug:** portfolio-dashboard-update-stop-loss  
**Issue:** #884  
**Thread Parent:** #829  
**Topic Parent:** #219  
**Task:** #886  
**Domain:** PORTFOLIO  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# CODE-REVIEW — Full order params on StopLossFormComponent (#886)

## Verdict: **PASS**

## Scope

Uncommitted working-tree diff, 11 files: `stop-loss-form.component.{ts,html,scss,spec.ts}`, `stop-loss-dialog.component.{ts,spec.ts}`, `order-ticket.component.{ts,html,spec.ts}`, PRD + IMPL doc amendments. +294/−20 (before review remediation; −15 more after the dead-path removal).

## What the task did

The shared `StopLossFormComponent` gains the full stop-order parameter surface: `timeInForce`/`marketHours` as `model()` inputs (defaults `gtc`/`regular_hours`), a new exported `StopLossSubmit` payload `{ stopPrice, timeInForce, marketHours }`, `showOrderParams` to hide the pill groups when a parent owns them, and `initialStopPrice` for update-mode prefill. TIF (Day/GTC) and Hours (Regular/Extended/All Day) pill groups match the order ticket's markup.

**Post-UAT broker constraint (verified live against RH):** `400 {"non_field_errors":["Extended hours orders cannot have stop price."]}` — stop orders are regular-hours only. The diff therefore renders Extended/All Day disabled with a hint, pins `marketHours: 'regular_hours'` at both submission seams (`onPlaceStopLoss`, dialog `onSubmit`), and does NOT bind the entry ticket's `marketHours` into the form. Review remediation additionally unbound `timeInForce` — see findings. PRD US16 and the IMPL risk note were amended in place to record the constraint.

## Axis summaries

### Standards — PASS (no hard violations)

Contract check verified: `submitEquityOrder` → `buildPlaceArgs` forwards `time_in_force`/`market_hours` verbatim to the RH MCP tools (`order-execution.service.ts:185-186`); the service's own spec covers the arg mapping, so component-level mocks are covered per guidelines §10.

Judgement calls recorded: `StopLossSubmit` mirrors the canonical unions as literals (deliberate — `shared/` has no precedent for feature imports; the honest fix is hoisting the unions to `shared/` and aliasing in `order-ticket.types.ts`, deferred); `initialStopPrice` and the `marketHours` model are forward-built for Task 4 in the same thread; jasmine-style spies in new specs match the host files' convention (AGENTS prefers `jest.*` for new specs — mild).

**Remediated during review:** file-size violation (`order-ticket.component.ts` crossed the 1k bar at 1004 — the dead-path removal returned it to 996); stale IMPL line 35 rewritten to match the unbound design; latent verbatim `marketHours` passthrough in dialog `onSubmit` pinned to `'regular_hours'`.

### Spec — PASS (all AC accounted for against the amended spec)

Every acceptance criterion verified present: `model()` inputs + pill markup parity, `showOrderParams` gate, `initialStopPrice` seed + percent derivation, enriched `preview` + `StopLossSubmit` emit, `[showOrderParams]="false"` on the order ticket, add-mode dialog threading, and the amendment (disabled pills + hint + regular-hours pin).

**Key catch remediated during review:** the `[(timeInForce)]` binding was a silent regression — the ticket's TIF pills render only while the entry is STAGED, but the form renders only once it FILLS, so no TIF control is ever co-visible with the form; the bound `gfd` default would have produced Day stops against the "stops are always GTC" product decision (pre-#886 stops were always GTC). Binding removed; the stop now pins `gtc`/`regular_hours` with the form's own defaults shown in its preview.

Residual minors for later tasks: `initialStopPrice` seeds once and won't re-derive percent if `referencePrice` lands after the seed (matters for Task 4's picker if the form instance is reused across candidates — remount per selection, or key the seed to the value); TEST doc's "preview reflects ticket selections" has no spec asserting the embedded form's `preview()` output — model-level sync is asserted instead, and the binding it would test no longer exists by design.

### Thermo-nuclear — PASS (both majors remediated)

- **MAJOR (fixed):** `onPlaceStopLoss`'s `stopPrice?: number` fallback (`canPlaceStopLoss` + parallel `stopLossPrice` signal) was a dead path — the only production caller always passes `$event.stopPrice`, and both new specs exercised only the dead path via the init-effect seed. Parameter made required, `canPlaceStopLoss` deleted (zero remaining references), specs now pass explicit prices on the real path.
- **MAJOR (fixed):** file size — same removal brought the file from 1004 to 996, back under the bar. The ~100-line deferred staged-stop state duplication remains a legitimate extraction target when the staged flow next changes hands.
- **MINOR (fixed):** union drift — `order-ticket.component.ts` now uses `EquityTimeInForce`/`EquityMarketHours` from its own feature types instead of redeclaring literals.
- **MINOR (fixed):** preview honesty — `orderType` in the form's preview now reads `stop_loss` (matching built tickets), not `stop_market`.
- **MINOR (fixed):** type-erased spec fixture — the payload type now imports `StopLossSubmit` instead of redeclaring it.
- Recorded nits: effect+`initialSeeded` is `ngOnInit` in disguise (documented once-only contract; revisit at Task 4 picker); dialog's `[disabled]="state() !== 'editing'"` inside `@case('editing')` is dead (pre-existing); pill-group markup duplicated between templates with a parity spec instead of a shared component (accepted — two instances, diverging already); spec asserting a `marketHours` payload the locked UI can't produce now meaningfully guards the submission-seam pin.

## Test results

- Focused suites (form + dialog + order-ticket): **86/86 pass**.
- `ng build`: **clean**.
- Full suite: 3195/3196 pass — sole failure `shared/screenshot-capture-contracts.spec.ts` (`PositionType` gained option values while the spec asserts stock-only) — **another thread's in-flight mismatch, unrelated to this diff**.

## Live verification (pre-review UAT)

Five real protective stops placed at RH through the Add Stop dialog after the regular-hours lock — including the broker-side confirmation of the extended-hours rejection that motivated it.
