**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1489  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1501  
**Domain:** MULTI-LEG-SPREAD  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-04-29  
**Last Updated:** 2026-11-20  

# Code Review — #1501 Engine config + eod-selection-pass re-target

## Scope

`StrategyInstanceConfig`/`StrategyInstancePhase` move from `{targetDelta unsigned, dteMin, dteMax}` to `{targetDelta signed, dte concrete}`; `runEodSelectionPass` retargets from `selectOptionContract` (band + weighted score) to `selectContractAtCoordinate` (nearest-DTE expiration → signed-delta argmin — the #1497 SA-parity algorithm); `deltaTolerance` retained as a signed-distance post-check; FE strategy-builder (sole live writer) emits one concrete `dte` and signs the unsigned UI delta at write; ids keep `-{absDelta}-{dte}-` segments; new verify script `options-engine-eod-selection-1501` registered in `run-all.ts` + both READMEs.

## Pass log

- First pass — three axes in parallel: **3 majors, 6 minors, ~12 nits** (deduplicated below).
- Second pass — serial coverage check over the same diff: confirmed both majors end-to-end (selector eligibility at `options-common.ts:227` admits `dte === 0` where the retired selector rejected `dte <= 0`; orchestrator feeds `selection.dte` into `computeOvernightDeltaSimulation` → `timeToExpiration = dte/365 = 0` → degenerate Black-Scholes grid persisted); confirmed `result.selected` is observability-only and `runEodSelectionPass` has exactly three callers (orchestrator, spec, verify). No new findings.
- Convergence: clean — a third pass is unnecessary; remaining items are minors/nits.

## Axes summary

**Standards:** re-target is clean — zero engine-domain `dteMin`/`dteMax` leftovers (remaining hits are manage-variant band vocabulary, `selectOptionContract` callers awaiting #1502, and point-in-time docs); validator removal complete; imports used; test conventions followed; verify script matches siblings.

**Spec:** all three ACs met — concrete coordinate on config + phases with windows removed; pass calls the shared selector with `null` on missing coordinate / no eligible contract / signed-tolerance breach; rewritten spec covers all required seams; FE write path signs correctly in `updateIdPreview` + `buildConfig` + `phases[0]`; prefill uses `Math.abs`; tests exercise the real pass function.

**Thermo-nuclear:** sign handling is correct end-to-end (`Math.abs` at both id builders, idempotent `signedDelta`, signed tolerance distance — for properly-signed configs identical to the old absolute semantics; tie-breaks deterministic and spec'd). The real exposure is the doc-validation boundary: `isValidInstance` is now the only gate for the new vocabulary and is too weak for it.

## Findings

### Major

- **M1 — Sign-vs-type mismatch passes validation and silently mis-selects.** `strategy-instance-repository.ts:113-122` checks `typeof === 'number'` only. A doc with `optionType: 'put'` + `targetDelta: +0.3` validates, then the selector argmins `|delta − 0.3|` over puts → picks the least-negative (near-zero-delta) put every night with no warning. Realistic path: console-edited docs or a field-migrated-but-not-sign-flipped legacy doc. `deltaTolerance` catches it only when configured. Fix: sign parity check in `isValidInstance` (put ⇒ `< 0`, call ⇒ `> 0`).

- **M2 — `dte: 0` is user-reachable and newly admits 0-DTE picks.** FE control allows `Validators.min(0)` (`strategy-builder-form.component.ts:162`); `isValidInstance` accepts any number; the new selector admits `dte ≥ 0` rows where the retired `selectOptionContract` rejected `dte <= 0`. A `dte: 0` instance now selects same-day-expiring contracts and `computeOvernightDeltaSimulation` receives `timeToExpiration = 0` → degenerate grid persisted to `daily-analysis`. Fix: `Validators.min(1)` on the FE control + `Number.isFinite(dte) && dte > 0` (integer per `manage-instance-reader.ts:94-98` convention) in `isValidInstance`.

- **m4-class — non-finite values pass `typeof` validation.** `NaN`/`Infinity` on `dte` or `targetDelta` pass; a NaN coordinate makes every selector comparison fail → first eligible row wins (documented degenerate behavior) and `deltaTolerance` is neutered (`NaN > tol` false). Closed by the same `Number.isFinite` guards as M2.

### Minor

- **m3 — unpriceable argmin winner now throws instead of degrading.** Old `requireMark: true` made unpriceable contracts ineligible and the next-best won; the new selector drops mark eligibility (SA parity) but `mapAvContractToOptionQuote`/`resolveMark` still throws. Contained by the orchestrator's per-instance try/catch → instance skips the night, no silent wrong pick. Defensible (fail loud > silently different contract) but untested — needs a pinning test whichever way it lands.
- **m5 — LIVE verify-doc delete not in `finally`** (`options-engine-eod-selection-1501.ts:238-251`): a mid-stage throw leaks `verify-1501-*` into the live-actionable collection (mitigated by `enabled:false`). Wrap set→delete in try/finally and assert `!(await ref.get()).exists` after delete (the current `ok(..., true)` at :252 is tautological).
- **Spec test gaps (n8):** no covered-call argmin case in the pass spec (only verify DRY check 8); no mixed-vocabulary reject test; no FE spec round-tripping a negative PUT delta through `prefillFromInstance` (`Math.abs` unexercised for negatives); no test for the m3 throw path.
- **Fixture flat/phase `dte` mismatch** — `options-strategy-engine-contracts.spec.ts:179-180` and `paper-trading-engine-migration-562.ts:57-58` use flat `30` / phase `26`, contradicting the documented "phases[0] mirrors the flat fields" invariant; align or comment.

### Nits

- `options-strategy-engine-contracts.ts:173` — doc comment still says `options-strategy-instances/{instanceId}` (stale since the `st-strategy-instances` cutover).
- `eod-orchestrator.ts:43` — "delta/DTE rules" band-era wording.
- `strategy-builder-form.component.ts:9` — unused `AbstractControl` import (adjacent to removed validator).
- `shared/strategy-instance-id.spec.ts` — unsigned `targetDelta: 0.2` CSP fixtures (output identical — `formatDelta` abs()s — but fixtures no longer reflect canonical signed data).
- `strategy-instance-repository.ts` — `phases[]` elements validated only for string `spreadType`; stale-vocab phase fields normalize silently (harmless — BE reads flat fields).
- `strategy-builder.service.ts` — `updateDoc` merge leaves stale `dteMin`/`dteMax` keys on edit-saves of legacy docs (cosmetic; nothing reads them).
- `position-ids.ts:36` — `String(dte)` unpadded vs `formatDte` padStart(2) in instance ids (pre-existing, preserved).
- `eod-selection-pass.ts` — coordinate guard is `=== undefined`; `null` slips through for code callers (doc validation catches it).
- `options-engine-eod-selection-1501.ts` — static `getInstance` import eagerly loads `firebase-admin-init`; move inside `live()` for true run-all safety; `asOf = '2026-01-30'` will age (sibling convention — note only).
- `seed-options-strategy-instances.ts` — still targets retired `paper-trading/instances/items` anchor (pre-existing; canonical reads are `st-strategy-instances`).
- Historical PRD/IMPL/TEST/CODE-REVIEW docs retain `dteMin`/`dteMax` — point-in-time records per convention.

### Diff-hygiene note (not a defect)

The review diff was generated over the dirty working tree: `robinhood-mcp-session-manager.test.ts` (#1639 KMS), the `settlement-pass.test.ts` hunks at lines ~321-370 (#728), and the variant-name hunks in `contract-list-writer.test.ts`/`manage-open-pass.test.ts` are foreign work — they must be excluded when this task's files are eventually staged.

## Test results

- `npx jest --coverage=false` full suite: **324/324 suites, 6126/6126 tests** green.
- Focused sweep during implementation: 245/245 engine+paper specs; 49/49 strategy-builder specs; `cd functions && npm run build` clean; FE `tsc` clean.
- `options-engine-eod-selection-1501` verify: **16/16 DRY** (fake chain, run-all safe), **24/24 LIVE** (real SPY chain ≈12,306 contracts — pass ≡ shared selector; real doc validated via `getInstance` and deleted).

## Verdict (r1): **FAIL**

All three ACs were met and the new code paths were correct for well-formed docs — but the task introduced signed-delta semantics while leaving the validator too weak to guard them (M1/M2/m4 cluster). Per gate rules, majors block.

## Remediation + re-review (r2)

All r1 findings remediated; a focused re-review sub-agent verified every claim independently — **PASS on all five**.

| Finding | Fix |
|---|---|
| M1 sign-mismatch | `isValidInstance` now rejects `targetDelta` whose sign contradicts `optionType` (`put ⇒ < 0`, `call ⇒ > 0`; `Math.sign(0)=0` rejects 0 too) — `strategy-instance-repository.ts:113-137` |
| M2 `dte: 0` reachable | FE control `Validators.min(1)` + `pattern(/^\d+$/)` + HTML `min="1" step="1"`; validator requires positive integer `dte` |
| m4 non-finite | `Number.isFinite(targetDelta)` + `Number.isInteger(dte)` — NaN/Infinity/30.5 all reject |
| m3 unpriceable throw | Behavior pinned as-is (fail loud; orchestrator catches per-instance) — `assert.rejects` spec added |
| m5 verify-doc leak | `set`→`getInstance`→`delete` now in try/finally with post-delete `exists` assert; `firebase-admin-init`/`getInstance` imports moved inside `live()` (DRY-safety confirmed — no admin SDK on the static path) |
| Spec gaps | Added: sign-mismatch reject + bad-dte reject matrix (repo spec), covered-call argmin + unpriceable-throw (pass spec), negative-PUT prefill round-trip (form spec) |
| Cheap nits | Collection-name comment corrected to `st-strategy-instances`; orchestrator `@returns` reworded; `AbstractControl` import dropped; two fixtures' flat/phase `dte` aligned to 30; `strategy-instance-id.spec` CSP fixtures signed |
| Re-review nits closed | Verify `.md` updated (10 LIVE checks, 26/26 row); `badRef` block gained the same post-delete `exists` assert |

Re-review confirmations: no legitimate fixture/doc shape newly rejected (`side` correctly absent from the sign check — `targetDelta` is a contract coordinate, signed per contract regardless of LONG/SHORT; corroborated by `OptionLeg`'s documented signed convention and `options-replay-start-forms-1498.ts`'s existing "put with positive delta" reject). Manage-domain `runState` docs never reach the check (filtered pre-validation).

**New verify evidence:** `options-engine-eod-selection-1501` — 16/16 DRY + **26/26 LIVE** (real SPY chain; real sign-mismatched doc rejected by `getInstance` → deleted). BE specs 22/22 in the two touched files; jest strategy-builder+shared 1209/1209; `npm run build` clean. Pre-existing committed failure in `analysis-dataset-writer.test.ts` (`deps.writeChunks` — foreign #553-task breakage on HEAD, both files unmodified) is unrelated and left for its owner.

## Verdict (r2): **PASS**

Commit staging must exclude the foreign hunks listed above (`robinhood-mcp-session-manager.test.ts`, `settlement-pass.test.ts` #728 hunks, `contract-list-writer`/`manage-open-pass` name hunks, and all other dirty-tree files not in this task's scope).
