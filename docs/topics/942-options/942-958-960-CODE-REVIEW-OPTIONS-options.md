**Topic:** Options Trading Support  
**Topic Slug:** options  
**Thread:** Single-leg option orders  
**Thread Slug:** single-leg-option-orders  
**Issue:** #958  
**Thread Parent:** #943  
**Topic Parent:** #942  
**Task:** #960  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-12  
**Last Updated:** 2026-10-12  

# Code Review — #960 MCP client option chain/instrument methods

Three-axis review (Standards / Spec / Thermo-nuclear) scoped strictly to
this task's hunks. The three touched files also carry unrelated
uncommitted work (account display-name, `partially_filled_rest_cancelled`,
time_in_force/market_hours) — excluded via a hunk-filtered scoped diff.

## Standards

Pattern conformance is exact — `getOptionChains`/`getOptionInstruments`
follow the `run(spec)` + `extractList` + `toNumber` + `RobinhoodMcpError`
convention identically to the neighboring specs; every parsed field name
was verified verbatim against the captured payloads. Fixtures are real
typed shapes; no type-erasure, no dead code, no duplicated types.

| Severity | Finding | Disposition |
|---|---|---|
| minor | New `toEqual` literals lacked the file's `satisfies OptionChain`/`satisfies OptionInstrument` convention | **Fixed** — `satisfies` added + types imported |
| nit | `state: 'active'` is the tool default — redundant pin | **Kept** — self-documenting for the order-entry flow; comment now says it's also the default |
| nit | Client file now ~730 lines — past the 400-line guidelines smell | **Documented** — pre-existing trajectory, not this task's scope; candidate for a future spec-builder split |

## Spec

All four acceptance criteria **MET**:

- **AC1** — `underlying_symbol` arg asserted; `expiration_dates` sorted
  ascending via string-sort on ISO dates (tested out-of-order input).
- **AC2** — `chain_symbol` + `expiration_dates` CSV + 4dp `strike_price`
  + `type` + `state:'active'` all asserted verbatim in arg shape;
  parse yields instrumentId + full contract identity.
- **AC3** — `extractList` tolerates envelope variance; malformed → `[]`;
  id-less instruments skipped — all tested.
- **AC4** — every parsed field name verified against
  `captures/ro-opt-chains-01.json` and `ro-opt-instr-02.json`; parser
  comments cite the captures.

IMPL deviations justified: `occSymbol` dropped (payload carries no OCC
symbol — contract identity is chain_symbol+expiration+type+strike);
`chainId` added to `OptionInstrument` (real payload data, needed for
multi-chain disambiguation downstream).

| Severity | Finding | Disposition |
|---|---|---|
| medium | `tradability` neither sent nor parsed — IMPL resolves "the single active **tradable** result"; `tradability:'tradable'` is a legal server-side filter | **Fixed** — pinned `tradability:'tradable'` alongside `state:'active'` |
| low | `OptionInstrumentFilters` can't express `chainId`/`cursor` — multi-chain underlyings can't follow the tool's per-chain guide | **Documented** — deliberate v1 scope (chainSymbol only); flag to #961: add `chainId?: string` if multi-chain resolution lands |
| low | `strike_price` sends `'NaN'`/`'Infinity'` verbatim | **Fixed** — `Number.isFinite` guard + spec |

## Thermo-nuclear

No material findings. Two axes independently flagged `tradability`
(fixed above). Verified clean: no `in`-narrowing consumers armed by the
new types; batch-safety of public specs; `.map(String).sort()` is
mutation-free; conditional `settleOnOpen` spread is honest-optional.

| Severity | Finding | Disposition |
|---|---|---|
| minor | Silent first-page truncation — `dep-opt-instr-10` proves one expiration without a type filter can exceed the ~100-instrument page (100 + `data.next`); nothing surfaced it, and the plan's "flag if a page boundary ever matters" was unimplementable | **Fixed** — `console.warn` on non-null `data.next` + spec |
| nit | `settle_on_open: null` → `settleOnOpen: false` conflated absent-vs-PM-settled | **Fixed** — `typeof === 'boolean'` guard + spec |
| nit | Id-less chain entries kept as `chainId: ''` — asymmetric with the instruments id-skip | **Fixed** — id-less chains skipped + spec |
| nit | No symbol case-normalization (lowercase ticker → silent `[]`) | **Deferred** — consistent with the rest of the typed client; signal symbols arrive uppercase |
| nit | Spec gaps: `data.next` parse, `settle_on_open` absent, NaN strike | **Fixed** — three specs added |

## Test results

- `robinhood-mcp-client.service.spec.ts`: **73/73 green** (13 new specs).
- `tsc -p tsconfig.app.json --noEmit`: clean.
- Full suite: **3502 pass / 43 fail** — identical to the #959 baseline;
  both failing suites (`order.component.spec.ts` `Functions` provider,
  `screenshot-capture-contracts.spec.ts` `PositionType` enum) trace to
  unrelated uncommitted screenshot work — zero failures from this diff.

## Verdict: PASS

All four ACs met with capture-verified parsers; the medium `tradability`
gap and the first-page-truncation observability gap were remediated
in-review and pinned by specs. Deferred to #961: `chainId` filter for
multi-chain underlyings; symbol case-normalization.
