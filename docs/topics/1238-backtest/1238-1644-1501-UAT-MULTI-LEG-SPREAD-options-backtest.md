**Topic:** Options Backtest  
**Topic Slug:** options-backtest  
**Thread:** Multi-leg Templates  
**Thread Slug:** multi-leg-templates  
**Issue:** #1644  
**Thread Parent:** #1270  
**Topic Parent:** #1238  
**Task:** #1501  
**Domain:** MULTI-LEG-SPREAD  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-20  

# UAT — #1501 Engine config + eod-selection-pass re-target

## Scope

`StrategyInstanceConfig`/`StrategyInstancePhase` now carry the concrete leg coordinate — signed `targetDelta` (puts negative) + concrete `dte` — replacing `dteMin`/`dteMax` + unsigned delta. `runEodSelectionPass` selects via the shared `selectContractAtCoordinate` (nearest-DTE expiration → signed-delta argmin) with `deltaTolerance` as a signed-distance post-check. `isValidInstance` enforces the new vocabulary (finite signed delta matching `optionType`, positive-integer `dte`). Position/instance IDs keep `{absDelta}-{dte}` segments. The FE strategy-builder form (sole writer) emits one `dte` and signs the unsigned UI delta at write.

## Prerequisites

- Repo `C:\aa\projects\rel-str` on branch `prod`, deps installed.
- For LIVE scenarios: `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`, `GOOGLE_CLOUD_PROJECT=rel-str`, and ADC (`gcloud auth application-default login`).
- Commands run from `C:\aa\projects\rel-str` (verify script from `functions/`).

## Getting to the feature

This task has no reachable UI surface — `StrategyBuilderFormComponent` is not referenced by any route or opener in the app (its legacy page was already replaced; the form is pending retire/repoint work). The exercised surfaces are BE: the nightly selection pass (`openPassTimer`/`sdsConsumerDispatch` → `runEodNightlySelection` → `runEodSelectionPass`), the `st-strategy-instances` repository validator, and the id builders. All scenarios are command-line.

## Automated evidence

| Suite | Command | Expected |
|---|---|---|
| Pass + repository specs | `npx tsx --test tests/functions/options-strategy-engine/eod-selection-pass.test.ts tests/functions/options-strategy-engine/strategy-instance-repository.test.ts` | 22/22 pass |
| FE form + shared specs | `npx jest --coverage=false strategy-builder shared/` | all green |
| Functions build | `cd functions && npm run build` | clean |
| Verify script DRY | `cd functions && npx tsx scripts/verify/options-engine-eod-selection-1501.ts` | 16/16 |
| Verify script LIVE | same + `--live` + env above | 26/26 |

## Scenarios

### S1 — Validator rejects sign/type-mismatched docs (r1 major)

Confirms an unsigned put target can no longer silently mis-select.

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"; $env:GOOGLE_CLOUD_PROJECT="rel-str"
cd functions; npx tsx scripts/verify/options-engine-eod-selection-1501.ts --live
```

- Expected: `ok unsigned put target rejected by real validate path` — the script writes `verify-1501-bad-*` (`optionType: PUT`, `targetDelta: +0.3`) and `getInstance` returns null; warn log `sign does not match optionType put` prints; `ok rejected-doc cleanup verified` confirms deletion.
- Unit evidence: `strategy-instance-repository.test.ts` — `rejects a targetDelta whose sign contradicts optionType` covers unsigned put + negative call; `rejects non-positive, non-integer, and non-finite dte/targetDelta` covers `0`/`-5`/`30.5`/`NaN`.

### S2 — Live selection ≡ shared selector on a real chain

Confirms the pass is a thin coordinate→quote seam over `selectContractAtCoordinate`.

- Steps: same `--live` run as S1.
- Expected: `ok live chain non-empty` (~12,306 SPY contracts on `2026-01-30`), `ok live pass picks same contractId as shared selector`, `ok live result dte matches selector`.

### S3 — Concrete coordinate + null surfaces (DRY)

```powershell
cd functions; npx tsx scripts/verify/options-engine-eod-selection-1501.ts
```

- Expected: 16/16 — signed-put argmin, nearest-DTE expiry preference, no-contract/empty-chain → `null`, tolerance pass/fail, malformed-candidate skip, missing `dte`/`targetDelta` → `null`, signed-call argmin, id segments `-030-30-`.

### S4 — IDs carry concrete dte + absolute delta

- Steps: DRY run tail — `ok position id carries concrete dte` and `ok instance id carries |delta| + concrete dte` (e.g. `…-030-30-…`; `Math.abs` keeps the delta segment unsigned by design).

### S5 — FE write path: signed delta + concrete dte

- Steps: `npx jest --coverage=false strategy-builder` — the form spec asserts `store.create` receives `targetDelta: -0.2` + `dte: 30` + `phases[0]` signed for a CSP and `+0.3`/`dte: 14` for a covered call; the edit-mode spec round-trips stored `-0.2` → form `0.2` → saved `-0.2`; the `dte` control rejects `0` and non-integers (`Validators.min(1)` + `pattern(/^\d+$/)`).

### S6 — Prod doc census — nothing silently skips

```powershell
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"; $env:GOOGLE_CLOUD_PROJECT="rel-str"
npx tsx .devin/tmp/check-instance-signs.ts
```

- Expected: every non-`runState` doc validates. **Observed:** `total docs: 360`, all 360 are manage-domain (`runState`) docs skipped by design — **0 legacy docs exist**, `rejected: 0`. The new gate has no false-positive surface in prod today; it only guards newly written legacy docs.

### S7 — Regression smoke — neighboring engine specs

- Steps: `npx tsx --test tests/functions/options-strategy-engine/*.test.ts` — all suites pass. (Note: `tests/functions/paper-trading/analysis-dataset-writer.test.ts` has 4 pre-existing failures on committed HEAD — `deps.writeChunks` missing from the test fake; foreign #553-task breakage, tracked in the QA issue, not this task's scope.)

## Manual UI/UX refinement pass

**Not applicable — no reachable user-facing surface.** `StrategyBuilderFormComponent` is unreferenced by routes/openers (verified by repo-wide grep — only its own file + spec + a `seenIn` inventory comment in `ds-elements.families.ts` mention it). The validator/write-path contract is spec-pinned; a visual pass becomes relevant only when the dialog is retired or re-pointed (planned legacy-retirement work).

## Findings

- **Pre-existing HEAD breakage:** `analysis-dataset-writer.test.ts` — 4 tests fail (`deps.writeChunks is not a function`); both files unmodified in the working tree — committed-state mismatch from the #553 lineage. Not a #1501 defect; logged here for visibility.
- **360 manage / 0 legacy instance docs in prod** — the legacy reader returns 0 runnable docs, so the nightly pass currently iterates an empty set. Consistent with the migration posture (fresh-start pending the retirement task).

## Traceability

| AC | Scenario |
|---|---|
| Config carries the concrete coordinate; window fields removed | S3 (missing coordinate → null), S4 (id segments), S5 (FE writes) |
| Pass selects via shared fn; no-contract → null | S2 (live parity), S3 (signed argmin + null surfaces) |
| Existing spec updated | S1 + Automated evidence (22/22 pass/repository specs incl. new pinning cases) |
| r1 review remediations (sign parity, dte>0/finite, FE min(1)) | S1, S5 |

## Regression / smoke

- [x] `options-strategy-engine` node:test suites — green (S7)
- [x] `strategy-builder` + `shared/` jest — 1209/1209
- [x] `functions npm run build` — clean
- [x] Prod doc census — 0 rejections (S6)

## Verdict

**PASS** — all scenarios green; no user-facing surface; pre-existing foreign test failure documented and out of scope.

## Results log

| Date | Result | Evidence |
|---|---|---|
| 2026-11-20 | PASS | verify 16/16 DRY + 26/26 LIVE (fresh); node:test 22/22; jest 6127/6127 full suite; build clean; prod census 0 rejections |
