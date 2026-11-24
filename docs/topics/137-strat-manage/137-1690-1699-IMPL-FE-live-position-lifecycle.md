**Topic:** Strategy Manager  
**Topic Slug:** strat-manage  
**Thread:** Live Position Lifecycle  
**Thread Slug:** live-position-lifecycle  
**Issue:** #1699  
**Thread Parent:** #1690  
**Topic Parent:** #137  
**Domain:** FE  
**Type:** IMPL  
**Status:** Draft  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# IMPL-FE: dashboard + manage surface remediation

## Architecture overview

Make the dashboard render the now-real position data honestly, and close the dead-end monitoring gaps:

1. **Signed net Current** — `currentValue` renders as the signed net mark (credit = negative cost-to-close, debit = positive liquidation value); `currentValueAsOf` surfaces staleness.
2. **Debit-aware premium** — the premium column shows signed net premium: credit collected / debit paid, never `$0.00` on a live position.
3. **Multi-leg display** — leg-aware rendering so a 4-leg position isn't one strike + one expiration.
4. **Population-aware tables** — STRATEGY/SIGNAL filter on the position's trigger/source; signal stock trades never appear (options surface); group-rollup view deferred until signal options exist.
5. **Row → destination links** — each row deep-links to its manage instance and/or analysis page.
6. **Variant-name fix consumption** — bind the canonical `variantDisplayName` (SHARED).

Blocked by BE (marks/settle must write real data) and SHARED (contracts).

## Boundary

- FE owns: dashboard store/component, column contracts consumption, links, display transforms, specs.
- Consumes SHARED: `variantDisplayName`, signed-field semantics.
- Consumes BE: marked/settled `PaperTrade`→`Position` fields, `AnalysisResultDoc` (unchanged + `firstFiredAt`).
- Not here: pass logic, stats computation, signal-review surfaces (#553).

## Files

- `src/app/features/savant-trader/pages/options-strategy-dashboard/` — component/template for column semantics, leg display, links, population filter.
- `src/app/features/savant-trader/stores/options-strategy-dashboard.store.ts` — population filtering, derived fields.
- `src/app/features/savant-trader/services/options-strategy.types.ts` — contract fields (`currentValueAsOf`, signed premium semantics, leg detail shape).
- Manage table (`options-strategy-manage` component area) — consumes `variantDisplayName`; Results dialog alignment on the signed numbers.
- `manage-create-strategy.component.ts` `suggestedName` — a second, private implementation of the name convention; rebind it to `variantDisplayName` on a lite variant (legs from `legInputs`, not `name()` — reading `draftVariant` would cycle through `name()`'s suggestion effect).

## Contracts

- `currentValue` — signed net mark; display labels ("cost to close" vs "value") may fork on posture — presentation only.
- `premium` — signed net premium (credit `+` / debit `−` or labeled paid/collected) — replaces the `premiumCollected`-only field.
- `trigger`/`source` — the population discriminator on the position row contract.
- Leg detail — the per-leg strike/expiration/DTE shape the row exposes (expand vs popover decided at impl; primary leg stays the sort anchor).
- Analysis link — `{instanceId}` → `/options/strategy/backtest/analysis/:listDocId` compatible target.

## Decisions

- SIGNAL table = signal-source **option** positions only (trigger filter); stock trades never render here — their surface is #553's.
- Zombie rows: none needed — the settlement pass settles expired-but-OPEN rows on first run; any residual display issue is observed then.
- Stats/table scope: tables become population-aware (A) since signal option positions are schema-identical; stock trades stay out by construction.
- Group-rollup display (Position Group view for "both" signals) — explicitly deferred; flat option-position rows in v1.

## Sequence / phases

1. Column semantics — signed Current + `asOf` staleness + debit-aware premium (needs BE marks live).
2. Leg display + row links + variant-name consumption.
3. Population-aware tables + scope labeling.

## Prior art / regression

- `options-strategy-dashboard.component` + store — existing tables/stat cards.
- `tradeToPosition` signed `currentValue` — the dashboard's existing field now carries honest data; template mostly re-binds.
- Manage table's variant-name column — bind canonical name-gen; CDS "50-40 30" shuffle dies.
- Analysis route `/options/strategy/backtest/analysis/:listDocId` — `{instanceId}` identity already compatible.

## Verify relay

- `npx jest` FE specs: signed formatting, posture-forked labels, population filter, link targets, leg rendering, name display.
- UAT scenarios on the real deployed surface post-deploy (UAT doc at QA time — route `/options/strategy-dashboard`, entry via nav).

## Risks / open seams

- Negative `currentValue` readability — credit liabilities need a display convention that doesn't read as an error (color/sign semantics — decide at impl).
- BE data must exist before columns are meaningful — phase-order the FE tasks behind P1.
- Population filter semantics when signal stock trades exist but aren't shown — label honestly ("option positions").
