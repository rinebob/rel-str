**Topic:** Trading Indicator Library  
**Topic Slug:** indicator-lib  
**Thread:** Intraday Bar Strength (IBS)  
**Thread Slug:** intraday-bar-strength  
**Issue:** #1672 — SHARED Blueprint: Intraday Bar Strength (IBS)  
**Thread Parent:** #1665  
**Topic Parent:** #261  
**Task:** #1675 — SHARED: computeIbs + availability  
**Domain:** INDICATOR-LIB  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# Code Review — #1675 SHARED: computeIbs + availability

## Scope

Uncommitted working-tree change:

- `shared/st-ibs.ts` (new — `computeIbs` + availability)
- `shared/st-ibs.spec.ts` (new — 26 specs)
- `tsconfig.json`, `functions/tsconfig.json`, `jest.config.js` (`@st/ibs` alias)
- `functions/scripts/verify/indicator-lib-ibs-1675.{ts,md}` (new — 20 checks)
- `functions/scripts/verify/run-all.ts` + `README.md` (registration)

Repo-root `scripts/verify/README.md` and all other working-tree
modifications are foreign sessions' work — out of scope.

## Pass sequence

```text
First pass complete — 3 parallel axes: 0 critical, 0 major, 4 minor, ~6 nits
Second pass complete — every finding re-checked against the final diff; minors remediated in-gate (Sunday gate, 'D'|'W' narrowing, weekKey rollover, weekday fallback, alias pin); remaining nits consciously deferred
Convergence: PASS — all findings addressed or deferred in-scope; union of the three axes covers the whole change
```

## Standards axis

Compliant across the board: file sizes well under limits, single-
responsibility module, canonical type reuse, no `any`/casts/silent
defaults, alias wiring matches existing `@st/*` entries, spec/verify
files match `st-signals.spec.ts` and `1649` conventions, hour-24 ICU
normalization handled and commented. No SDK calls — contract baseline
skipped.

- **Minor** — TEST-plan alias pin unexercised (spec imported relatively,
  jest mapper untouched). → **Remediated in-gate:** spec now imports
  `'@st/ibs'` and passes through the mapper.
- **Nit** — `weekKey` comment overclaimed (Date.UTC rolls `2026-13-40`
  into a valid date). → Remediated: round-trip component check +
  accurate comment.
- **Nit** — silent `?? 0` weekday fallback (could masquerade as Sunday).
  → Remediated: `?? -1`, same undefined direction without the lie.
- **Nit** — literal-fixture duplication in the verify script. → Deferred
  (cosmetic, scripts tolerate it).

## Spec axis

All IMPL acceptance criteria **met** — signature, formula, zero-range
→ 0.5, daily ET-time gate (strict `<`, boundary inclusive), weekly
weekday gate with ISO-week math, defaults 720/3 overridable, alias in
all three configs. Declared deviation (`IbsTimeframe = StSignalTimeframe`
for `'M'`) judged reasonable but later narrowed in-gate per thermo. No
scope creep.

- **Minor** — missing `@st/ibs` alias-import spec. → Remediated (see
  Standards minor).
- **Nits** — IMPL `'M'` wording (moot after narrowing), `0.2` fixture
  absent (covered by `0.8`), zero-range/availability ordering unpinned.
  → Ordering now pinned by a spec (availability checked first).

## Thermo-nuclear axis

Small, pure, single-purpose module — no structural regression, no
missed code-judo, no boundary leak. `weekKey` duplicates
`isoWeekKey` in `functions/src/` — **forced** layering duplication
(shared can't import functions/src); noted for consolidation if a
shared date module ever lands.

- **Minor** — Sunday weekly-gate dip (weekday 0 < 3 → `undefined` while
  Saturday is defined; non-monotonic). → **Remediated:** Sunday maps to
  weekday 7 — trading-week tail, gate stays monotonic, spec-pinned.
- **Minor** — `'M'` widening was speculative + an identity alias.
  → **Remediated:** `IbsTimeframe` narrowed to `'D'|'W'` per IMPL;
  `'M'` callers become a compile error. `import type` finding moot —
  import removed entirely.
- **Minor** — `weekKey` shape-only validation. → Remediated (round-trip).
- **Nit** — verify-script ET-read duplication. → Accepted: it is the
  independent oracle; catches wiring/ICU drift, documented as such.

## Test results

- `shared/st-ibs.spec.ts`: **26/26 green** (incl. new pins — Sunday
  monotonicity, rollover date, zero-range-precedence ordering).
- Full suite: **6267/6267 green** (pre-existing worker-teardown warning,
  unrelated).
- `npx tsc --noEmit -p tsconfig.spec.json`: clean.
- `functions/scripts/verify/indicator-lib-ibs-1675.ts`: **20/20 checks**
  incl. real wall-clock agreement.

## Verdict

**PASS** — zero critical/major findings; all minors remediated in-gate;
remaining nits are deferred judgement calls within scope.
