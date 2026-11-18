**Topic:** Paper Trading Infra  
**Topic Slug:** paper-trading-infra  
**Thread:** Historical Signal Replay  
**Thread Slug:** historical-signal-replay  
**Issue:** #1572  
**Thread Parent:** #906  
**Topic Parent:** #553  
**Task:** #1574  
**Domain:** PAPER-TRADING  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# CODE REVIEW — #1574 Signal-replay exit engine

Three-axis gate review of the curated exit engine: `ma-close-{N}` +
`target-{pct}` grammar/evaluators, `variantLevel`, `isIndependentCloser`,
`selectGoverningRun`/`smaAt`/`smaIndicatorsFor` (new
`exits/governing-policy.ts`), the eval-pass policy hook, the atomic
`applyGoverningPick` repo seam, the `eval-pass-deps.ts` wiring split,
the `PickerVariantFamily` FE narrowing, specs, and the verify
script/guide/registry entries.

## Standards

0 critical · 2 major · 3 minor · 3 nit on first pass — all majors and
actionable minors fixed in-gate. SDK usage verified against real
contracts (doc paths, `.update` shapes, `OhlcBar`, loader surface);
test conventions conform (`node:test`/`assert`, no `setTimeout`, all
assert).

| Finding | Severity | Disposition |
|---|---|---|
| `eval-pass.ts` crossed the documented 400-line threshold (406→439 during fixes) | **major** | **Fixed in-gate** — production wiring extracted to `eval-pass-deps.ts` (eval-pass 383 lines, deps file 89). |
| Pick writes outside the file's per-trade error isolation — one Firestore hiccup aborted the nightly pass | **major** | **Fixed in-gate** — pick write inside try/catch; in-memory `evalRuns` still evaluate, mirror heals next pass. |
| `as never` on `sma20Bars` fixtures (3 sites) | minor | **Fixed** — casts dropped; the literal satisfies `OhlcBar`. |
| `updateGoverningVariant` repo seam untested | minor | Superseded — seam removed in favor of atomic `applyGoverningPick` (see Spec R1/M2). |
| Stale `governingVariant` if the process died between `applyExit` and the attribution write | minor | **Reduced** — closer's run-EXITED + mirror now land in ONE atomic `applyGoverningPick`; the residual window (applyExit → doc update) matches the pre-existing governing-close pattern, documented. |
| `evalOne(run, false, false)` positional booleans | nit | Left — readable at both call sites; options-object refactor deferred. |
| `variantLevel` ∥ `evaluateVariant` parallel per-family math | nit | Deferred — a family-descriptor table would unify trigger/level/role; filed as follow-up polish, not this task. |
| SMA fetch ran before the mark gate | nit | **Fixed** — enrichment is mark-gated and pass-level per-symbol cached. |

## Spec

All 8 acceptance criteria verified present and pin-faithful. No
#1575/#1576 items leaked in (no mint callable, delete cascade, or
ingest widening). Two first-pass findings — one was a real
implementation bug, one converged with the same defect:

| Finding | Severity | Disposition |
|---|---|---|
| **Breach-day hole**: candidacy tested the level against today's `mark`, but the contract pin says "deepest below the trade's high **watermark**". Under the mark-side reading a breached stop could never be picked or fire — losers stranded OPEN forever (only `target-*` could close). | **major** (impl deviated from pin) | **Fixed in-gate** — side test now vs the trade watermark (peak from run `workingState` + entry + mark); a breached stop below the peak stays a candidate, fires, and closes. New specs + 2 new verify checks pin the semantics. |
| Same-day double-close: `target-50` + `target-100` both fire → second `applyExit` throws "not open"; attribution array-order-dependent | **major** | **Fixed in-gate** — `closedThisPass` latch; post-close triggers record shadow `exitEvent`s. |
| `getBars` unmemoized per trade | nit | **Fixed** — per-symbol pass cache. |
| Double `summary.errors` on bars-load failure | nit | Accepted — trade-level + per-run messages both carry distinct context. |

## Thermo-nuclear

One critical, four majors on first pass — all addressed:

| Finding | Severity | Disposition |
|---|---|---|
| Same-day multi-fire re-attempts the ledger (C1) | **critical** | **Fixed** — `closedThisPass` latch (see Spec). |
| Terminal-breach hole (M1) | **major** | **Fixed** — watermark candidacy (see Spec). This was the review's most valuable catch: the literal "below mark" reading made the entire stop layer attribution-only. |
| Flag-diff + mirror = 3 non-atomic round-trips (M2) | **major** | **Fixed** — single `applyGoverningPick(tradeId, fullRuns, mirror)` `.update`. Second pass caught that the first fix wrote an actives-only array (would have erased EXITED run history) — corrected to the full flag-corrected array. |
| `pick === undefined` stale mirror (M3) | **major** | **Accepted + documented** — reachable only when zero stop candidates remain; any closer fire rewrites the mirror via the atomic close write. |
| `getBars` over-fetch — reads weekly/monthly docs too | **major→minor** | Partially fixed — per-symbol pass cache eliminates the N-trades multiplier; the loader's extra doc reads are shared infra, not this task's surface. |
| `Policy` interface / family-descriptor table | minor | Deferred — one policy exists; premature abstraction flagged, not built. |
| `ma-close` `<` vs trailing `<=` boundary | minor | Pin-literal kept ("below SMA"); documented. |

## Second pass

Ran per gate protocol over the post-fix diff. It caught one **new
critical**: the atomic pick write initially passed the actives-only
`evalRuns` to `variantRuns`, which would have deleted every EXITED run
from the trade doc — corrected to the full flag-corrected array
(`fullRuns`), and the closer's attribution + run-state were folded into
the same atomic write. One new spec asserts the full-array shape via
the spy. Re-verified: tsc clean, 68/68 focused, 348/348 batch, 35/35
verify. Converged — no third pass needed.

## Test results

- `tsx --test` focused trio (exit-variants + governing-policy +
  exit-eval-pass): **68/68** — new coverage: breach-day candidacy +
  real close, same-day latch, pick-undefined mirror, watermark
  exclusion, atomic-write shape.
- `npm run test:paper-trading` batch: **348/348**.
- `verify paper-trading-curated-exit-engine-1574`: **35/35**.
- `functions` tsc + build: clean. Root tsc: only pre-existing foreign
  errors (`bulk-swing-sweep`, portfolio-dashboard specs).
- FE `strategy-builder-form.component.spec.ts`: 48/48.

## Verdict

**PASS** — all critical/major findings fixed in-gate and re-verified;
remaining minors are documented or deferred with rationale.
