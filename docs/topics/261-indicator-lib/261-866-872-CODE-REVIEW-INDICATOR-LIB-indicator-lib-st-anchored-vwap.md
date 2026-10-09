**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** ST Anchored VWAP  
**Thread Slug:** st-anchored-vwap  
**Issue:** #866  
**Thread Parent:** #835  
**Topic Parent:** #261  
**Task:** #872  
**Domain:** INDICATOR-LIB  
**Type:** Code Review  
**Status:** Complete  
**Created:** 2026-10-08  
**Last Updated:** 2026-10-08  

# Code Review — FE: Sandbox controls for ST Anchored VWAP params (incl. historyStart date picker) (#872)

## Scope

Modified: `st-anchored-vwap.indicator.ts` (10th param `historyStart`, `input` metadata on every param, `extractConfig` passthrough), `st-anchored-vwap.types.ts` (`historyStart?: number` → `string`), `st-anchored-vwap.engine.ts` (calendar-date filter; `Candidate`/`pivotTime` collapsed), `flex-chart.types.ts` (`IndicatorParamDef.input` discriminator), `indicator-registry.ts` (empty-string guard in `buildDefaultConfig` name), `date.util.ts` (new shared `parseIsoDateLocal`), and the sandbox component `.ts` / `.html` / `.scss` (params panel, `mat-datepicker`, clear button, override merge). New specs: `date.util.spec.ts`. Modified specs: the indicator, engine, invariants and sandbox specs. IMPL and TEST plan docs re-synced.

The working tree carries several other threads' uncommitted changes; only the #872 hunks were reviewed.

## Summary of axes

### Standards

- **Size and responsibility:** the sandbox changes live behind one override-mutation seam (`setAvwapOverride`) and one commit handler (`onAvwapParam`); the template iterates the declared `params`, so a future param needs no template change. `historyStart` is a string end to end — no conversion layer.
- **Reuse:** `parseIsoDateLocal` went into the shared `date.util.ts` beside the existing date helpers (new `date.util.spec.ts` covers it); `formatLocalDate` was reused rather than re-rolled; the datepicker anchor + toggle + clear pattern mirrors `option-chain.component`.
- **Contracts:** `IndicatorParamDef.input` is a declared discriminator instead of key-name sniffing; the params union `number | string | boolean` is respected throughout.
- **No `any`, no casts** beyond the standard `(event.target as HTMLInputElement)` on DOM events.

### Spec

Task #872 acceptance criteria:
- Controls for all ten declared params, gated on `avwapEnabled()`: **met** (panel renders only when the indicator is enabled; pinned by spec).
- Overrides merge onto `buildDefaultConfig` for the AVWAP entry only; emptied control deletes the override and the default flows through: **met** — this test caught a real first-pass bug (`Number('')` is `0`, which would have pinned the param instead of clearing it).
- `historyStart` as a `mat-datepicker` plus visible ISO text input, local `YYYY-MM-DD` commit, clear button, picker/text sync both ways: **met** (option-chain pattern: rendered-but-invisible anchor so the overlay positions correctly; the visible input stays a plain ISO box so the locale adapter can't reformat it).
- Color params render as `type="color"`: **met**.
- Controls are sandbox-local; no shared settings UI: **met**.
- `historyStart` is a calendar **date** per the PRD: **met only after remediation** — see J1.

### Thermo-nuclear (Dr. Reed lens)

- **The MAJOR finding:** `historyStart` was implemented as epoch milliseconds compared against `bar.x.getTime()`. Production `x` is `toDatePt()` — a Pacific-Time-midnight instant — while synthetic bars build `x` as browser-local midnight, and the spec fixtures carried placeholder `date` labels (`d0`, `d1`…) that made the two representations indistinguishable in tests. An epoch boundary therefore sits at the wrong calendar edge for any user west of PT, and the fixture shape guaranteed no test could see it. The PRD says `historyStart` is a *date*.
- **Remediation (all three axes agreed on direction):** `historyStart` is now ISO `'YYYY-MM-DD'` end to end. The engine filters `bars[s.pivotBar].date >= era` lexicographically — calendars, not instants — which also deleted the `Candidate`/`pivotTime` plumbing. A regression test pushes every bar's `x` to 2030 and asserts the window is unchanged.
- **Boundary-trim smell found and fixed in-loop (J2).**
- **Test quality:** the windowing spec now asserts on real ISO dates derived from the fixture's `x` (`isoOf`), and the "pushed epochs" test is the clean kill for the original bug class.

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| J1 | major | `historyStart` compared epoch ms to `bar.x.getTime()`; production `x` is PT-midnight, test `x` is browser-local, so the boundary shifted by the user's timezone — and every spec fixture used placeholder `date` labels, hiding it. PRD defines the param as a calendar date. | **Fixed in review** — `historyStart?: string` (ISO), engine compares `bars[pivotBar].date` lexicographically, `parseIsoDateLocal` validates, `Candidate`/`pivotTime` deleted, all fixtures emit real ISO `date`s, regression test pins "filters on session date, never the epoch of `x`". |
| J2 | minor | `era` kept the untrimmed `historyStart` while validation trimmed internally — `' 2026-01-16'` would lexicographically sit below every ISO date and silently widen the window to everything. | **Fixed in review** — the engine compares the trimmed string. |
| J3 | minor | Stale comment claimed `extractConfig` "parses it to local-midnight ms" after the contract became a passthrough string. | **Fixed in review.** |
| J4 | minor | Engine/indicator/invariants spec fixtures used `date: 'd${i}'` labels — the shape that made J1 invisible. | **Fixed in review** — fixtures emit ISO `date` consistent with `x`. |
| N1 | nit | The era compare trusts `bar.date` is canonical `YYYY-MM-DD` without re-validating per bar — true by the `PriceBar` contract, and re-validating would be O(n) waste. | Accepted. |
| N2 | nit | `MatNativeDateModule` provides the default `NativeDateAdapter` — correct here (local-midnight Dates), but a future `MatDateFnsModule` migration would silently change parse semantics under the visible text input. | Accepted — documented in the anchor comment. |

## Test results

- **Focused:** `npx jest st-anchored-vwap flex-chart-sandbox indicator-registry date.util` — 7 suites, all pass (indicator 34, engine 34, invariants 12, sandbox 29, registry 4, synthetic-data 4, date.util 12 — ~135 tests).
- **Types:** `tsc` app and spec: **0 errors**.
- **AOT:** `ng build --configuration development`: **clean** post-remediation (covers the new template bindings).
- **Full suite:** `npx jest` — **3,259 passed, 5 failed (2 suites)**, both other threads' work:
  - `shared/screenshot-capture-contracts.spec.ts` — stale `PositionType` pin expecting `['stock']` while `shared/paper-trading-contracts.ts` (another thread's uncommitted edit) added three option types. Same failure recorded in the #871 review; unchanged.
  - `order-execution.service.spec.ts` — 4 tests where the spec and `order-execution.service.ts` disagree on `getEquityOrders`'s signature; **both files carry another thread's uncommitted edits** (`git status` confirms both modified, plus `robinhood-mcp-client.service.*`). Mid-flight WIP, not #872.

**Gate deviation, stated plainly:** two red suites, both attributable to other threads' uncommitted work, neither intersecting the #872 diff. The verdict is scoped to #872; QA should re-run the suite.

## Verdict

**PASS** — one major finding (J1, the date-vs-epoch contract) remediated in-loop with a regression test that cannot silently regress; three minors fixed in review; two nits accepted. The manual sandbox check remains open for QA (controls render, picker commits, × clears).
