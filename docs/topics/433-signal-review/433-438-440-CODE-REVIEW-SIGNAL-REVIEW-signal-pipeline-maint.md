**Topic:** Signal Pipeline Maintenance  
**Topic Slug:** signal-pipeline-maint  
**Thread:** Misc fixes  
**Thread Slug:** misc-fixes  
**Issue:** #438  
**Thread Parent:** #434  
**Topic Parent:** #433  
**Task:** #440  
**Domain:** SIGNAL-REVIEW  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-09-20  
**Last Updated:** 2026-09-20  

# Code Review — #440: Order queue row data + staged group aggregates

## Summary of axes

**Standards** — mostly clean. OnPush + signals throughout; `computePositionSize` reused rather than re-implemented (formula parity verified line-by-line against `position-sizing.util.ts`); no `any`; file sizes in range. Two majors found and fixed in-round (below): a misleading test title asserting half its claim, and an untyped `Record<string, unknown>` fixture bypassing the ticket union.

**Spec conformance** — the issue's original ACs (header chips, top-header staged total) were superseded by user redirect mid-implementation; the reviewed design is the agreed one: per-row `shares / units / dollars` + a `.staged-agg` aggregate in the Staged group header. All revised ACs met: real ticket data only (no `???`, `—`, `MARKET`, or bare `$100` placeholders), NaN-guarded parsing, omission-not-placeholder for missing fields, options excluded from aggregates, empty staged group hides the aggregate. One residual spec gap — AC3's "mark the default-dollar fallback as estimate" — was real and is now fixed (`isDefaultEstimate` → `~` prefix + `.estimated` + tooltip, and default-derived tickets are excluded from aggregates entirely).

**Thermo-nuclear** — no criticals; two HIGH findings found and fixed in-round:

- **Fractional quantity truncation (fixed):** `Math.round(q)` rendered `quantity: '0.33'` as "0 sh · $0" — fractional_close tickets and DRIP/fractional positions carry real decimal quantities. `sharesFor`/`dollarsFor` now use the parsed value verbatim.
- **Staged sells inflating the buy total (fixed):** `stagedAggregate` now splits into `{ buy, sell }` buckets; the sell bucket renders separately (`.staged-agg-sell`) only when nonzero.

Also fixed in-round: aggregate exclusion of tickets carrying neither quantity nor dollarAmount (pure default estimates don't pollute totals); zero-value aggregate hidden; `'1 contract'` pluralization; `StatusGroup.status` promoted from dead field to the staged discriminant (`group.status.includes(TicketStatus.STAGED)` instead of string-matching `'Staged'`); template string literals replaced with exposed enums (`Source.*`, `TicketStatus.*`); `'an ticket'` comment grammar.

## Findings by severity

### Critical — none

### Major / High — found and fixed in-round

- **Fractional rounding** (`sharesFor`/`dollarsFor` `Math.round(q)`) → decimal quantity displayed verbatim; `q × price` unrounded. Spec added: `'0.33'` → `0.33 sh · $66`.
- **Side-blind aggregate** → `stagedAggregate: { buy, sell }`; sell bucket labeled and styled separately. Spec added: staged sell renders `sell 4 sh · 5u · $500` alongside the buy total.
- **Misleading spec title** (`spec.ts:94`) → renamed + now asserts *both* submitted tickets.
- **Untyped fixture** → `TicketOverrides = Partial<Omit<EquityOrderTicket,'instrumentType'>> & { instrumentType?; legs?: OptionLeg[] }`; all keys type-checked against real ticket shapes.

### Medium — assessed

- **`dollarsFor` prefers `quantity × price` over stored `dollarAmount`** when both exist — correct: a worked ticket submits a share order; notional-at-current-price is the honest display (stored `dollarAmount` is a pre-sizing target). Pinned by spec (`10 sh, $1,200 @120`, not the stale `1500`).
- **Price-load timing** — fields populate when `prices` resolves (parent fetches on ticket load). Advisory: `pricesLoading` could be passed in for a pending state — logged as a polish follow-up, not a blocker.
- **`0 sh · Nu · $X` when price is missing** — dollarAmount-only ticket contributes dollars/units but no shares to the aggregate. Documented behavior: the stored dollar amount is real ticket data; shares aren't computable without a price.

### Minor — fixed

- Dead `StatusGroup.status` → now the staged discriminant.
- Raw enum string literals in template → exposed `Source`/`TicketStatus` enums.
- `'?'` fallback in `symbolFor` (empty option legs) — left; legs are required by the type, unreachable in practice.
- All-option staged group → aggregate hidden (zero-gated).
- `defaultDollarAmount <= 0` → units render `0u` → guarded to 0 in aggregate, `null` (omitted) per row.

## Verification

- `npx jest order-queue.component.spec.ts` — **37/37 green** (15 aggregate/row-display specs covering: buy/sell split, option exclusion, non-staged exclusion, empty/uncountable groups, NaN fields, fractional quantity, whole-share sizing, both-fields precedence, estimate marking).
- `npx tsc --noEmit -p tsconfig.spec.json` — clean.

## Advisory follow-ups (not blockers)

- Pass `pricesLoading` into the queue so unpriced rows can render a pending state rather than silently populating late.
- `positionToTicket` stamps `createdAt: new Date()` — open positions show today's date. Pre-existing; the `dateFor` fallback made it visible.

## Verdict

**PASS** — implementation matches the revised design, all review findings of substance are resolved in-round, tests pin the real semantics.
