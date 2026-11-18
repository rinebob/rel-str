**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1497  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Blueprint:** #1489  
**Task:** #1497  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# CODE-REVIEW — BE Task: Shared selection fn + parity harness (#1497)

## Verdict

**PASS** — three parallel axes (standards, spec, thermo-nuclear). Spec and
thermo returned changes-requested on two convergent semantic findings;
both remediated in-cycle and re-verified. Live parity re-ran **46/46**
after the fixes.

## Scope reviewed

- `shared/options-common.ts` — `selectContractAtCoordinate` +
  `ContractSelectionCoordinate` / `SelectedContractAtCoordinate` + private
  strict helpers (+~190 lines)
- `shared/options-common.spec.ts` — new, 15 tests
- `scripts/verify/options-backtest-selection-replay-1497-selection-parity.ts` —
  new live parity harness (+ run-all.ts registration, needsAdc)

## Findings → resolution

| # | Axis | Severity | Finding | Resolution |
|---|---|---|---|---|
| 1 | spec + thermo | moderate | `marketDate`/expiration validation was ISO-shape-only; SA's `isValidIsoDate` round-trips calendar validity — `'2026-02-30'`/`'2026-13-40'` must throw / be ineligible, not normalize | Replicated `isValidIsoDate` round-trip (`new Date(t).toISOString().slice(0,10) === v`); used in both `selectContractAtCoordinate` throw path and `strictIsoDaysBetween`. Spec pins added for impossible marketDate + impossible expiration |
| 2 | spec + thermo | moderate | Type filter used `normalizeOptionType` — a superset of SA's literal `'put'`/`'call'` (accepts 'C'/'P'/mixed-case). Corpus-canonical so invisible live, but a latent drift surface | Literal `contract.type === coordinate.type` with a comment owning the decision (adapters normalize upstream); spec pins 'P'/'Put' rejection |
| 3 | thermo + standards | minor | Harness `res?.data?.data ?? []` turned a malformed-200 into an empty chain → **vacuous pass on `no_match` days** ("both null" while verifying nothing) | Assert `res.ok === true && Array.isArray(data.data)`; else the day lands in `chainFailures` |
| 4 | thermo | minor | `0/0 checks passed` exit-0 silent-pass possible (all-no_chain/empty fixture) | `check('assertions ran', checks > 0)` floor before summary |
| 5 | spec | nit | "Equidistant deltas" test wasn't equidistant — float: `0.1` vs `0.0999…98` is a strict win, not the |Δ| tiebreak | Re-pinned with `-0.40`/`-0.60` vs `-0.50` — identical float distance, tiebreak genuinely exercised |
| 6 | standards | minor | File header still claimed "enums and OCC id helpers" only — prior review flagged this exact drift on the sibling file | Header rewritten; documents the `import type` cycle constraint too |
| 7 | standards | nit | `calendarDaysBetween` collided with exported `functions/common/pt-date-utils` helper of different leniency | Renamed `strictIsoDaysBetween` |
| 8 | spec | nit | Harness header promised "dte/expiration/strike" but checked dte+strike only | Now asserts all four + delta — deeper drift catches |
| 9 | standards | nit | `startDate: '2025-01-01'` burns a guaranteed-404 shard (coverage starts 2026) | `'2026-01-01'` |
| 10 | standards | nit | `import { HistoricalOptionContract }` value import in spec vs repo-wide `import type` convention | Fixed |
| 11 | spec | nit | Harness `check()` emits one FAIL per cell for a shared bad day; unknown miss status would fall into no_match branch | Unknown-status guard → INFO; per-cell dup FAILs accepted (names each affected cell) |
| 12 | spec | minor | IMPL §5 return type says `SelectedOptionContract`; shipped `SelectedContractAtCoordinate` (drops meaningless `score`, mirrors `DayPick` fields) | Better shape — confirm-intent accepted; IMPL §5 updated as-built at ship-docs |

## Confirm-intent (resolved, no code change)

- **`SelectedContractAtCoordinate` emits `mark` only** vs SA `DayPick`'s
  iv/bid/ask/volume/openInterest — §5's intent is contract *selection*,
  not pick-document emission; the mapper (#1499) reads `PickDocDay`
  fields off corpus docs, not off this type.
- **contractId trimmed for compare/emit** (SA uses raw) — equivalent on
  OCC ids; trim is strictly safer.
- **NaN-coordinate inputs** return the first eligible row deterministically
  — identical to SA (grid-derived coords can't produce NaN); documented
  in the docstring.
- **no_match-day chain-fetch failure → INFO vs pick-day → FAIL** asymmetry —
  kept: a `no_match` day whose chain can't be fetched verifies nothing
  either way; flagging it FAIL would be flake-asymmetry. `no_chain`
  informational is correct (no picker input existed).

## Live evidence (post-remediation)

```
46/46 checks passed — QQQ × {put -0.20Δ@45, call +0.20Δ@45, put -0.50Δ@180}
× first/mid/last pick days of the 2026 shard (2026-01-02 / 2026-06-10 /
2026-11-16): contractId + dte + expiration + strike + delta all match
corpus at full float precision (e.g. delta -0.20089 ≡ -0.20089).
```

Unit: `shared/options-common.spec.ts` — 15/15. `functions` tsc: clean.

## Advisory notes for downstream tasks

- `eod-selection-pass`/`expression-fill-pass` re-targets (#1501/#1502):
  candidates must carry canonical `'call'`/`'put'` type values —
  normalize RH/AV variants **upstream** of the fn (literal-equality
  filter is SA parity).
- The fn is mark-agnostic by design (identity-only eligibility); live
  fill price stays a separate fill-time concern.
