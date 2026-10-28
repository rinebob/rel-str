**Topic:** Scanner Chart View  
**Topic Slug:** scanner-chart-view  
**Thread:** Chart View Extension  
**Thread Slug:** chart-view-extension  
**Issue:** #1294  
**Thread Parent:** #1233  
**Topic Parent:** #1232  
**Task:** #1257  
**Domain:** CHART-REVIEW  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-27  
**Last Updated:** 2026-10-27  

# UAT — #1257 ScannerService.saveLatestRun + discovery call sites

## Scope

The cache-write seam for the scan-source feature (F3 of FE Blueprint #1249):
`ScannerService.saveLatestRun(recipeId, result)` writes/overwrites
`st-scanner/latest-runs/items/{recipeId}`, wired into the two discovery
paths only. No user-facing UI yet — the cache is consumed by #1258's scan
dropdown. The acceptance surface is executable specs + a live Firestore
write observation.

Delivered by this task:

- `ScannerService.saveLatestRun` — `setDoc` at the deterministic recipeId
  path, `serializeScanLatestRun` record, `truncated` via `isScanTruncated`,
  every failure mode resolving through `console.warn` (construction,
  serialization, path, auth, and `setDoc` all inside the try)
- `ScannerStore.launchRecipe` success → write (covers `runAllRecipes` +
  `refreshRecipe`)
- `ScannerStore.runScan` success → write via the `{results, total_items}`
  adapter (same shape built for `parseScanRows`)
- `evaluateTracked` — never writes (prune is a different artifact)
- Spec pins: deterministic path + serialized doc, truncation flag,
  warn-only on write/malformed/unauth failure, exactly-once per accepted
  completion, no write on stale/superseded/failed/blocked runs

## Prerequisites

- Repo: `rel-str`, current work branch
- `npm install` already run (jest + tsx available)
- Scenarios S1–S4: credential-free
- Scenario S5 (live write): running app (`npm start`), a signed-in
  Firebase session, the scanner page reachable, and Firestore console
  access for the `rel-str` project

## Test scenarios

### S1 — Service + store spec suite (primary executable evidence)

- **Feature:** all acceptance criteria are spec-pinned
- **Steps:** `npx jest src/app/features/savant-trader/services/scanner.service.spec.ts src/app/features/savant-trader/stores/scanner.store.spec.ts --coverage=false`
- **Expected:** all pass — including: `saveLatestRun` writes the
  serialized doc at `st-scanner/latest-runs/items/{recipeId}`; `truncated`
  via `isScanTruncated`; warn-only on `setDoc` rejection, malformed
  result, and unauthenticated state; `runScan`/`refreshRecipe` each invoke
  `saveLatestRun` exactly once; `evaluateTracked` never calls it; stale
  `runScan` and stale launch completions write nothing; failed and
  blocked discovery paths write nothing
- **Result:** ☑ PASS — 58 tests green (2026-10-27)

### S2 — Call-site completeness (code inspection)

- **Feature:** the cache fires on discovery paths only — no stray or
  missing call sites
- **Steps:** `grep saveLatestRun src/app/features/savant-trader/stores/scanner.store.ts`
- **Expected:** exactly 2 matches — `launchRecipe` success (~line 244)
  and `runScan` success (~line 355); no call inside `evaluateTracked`
- **Result:** ☑ PASS — 2 matches, both on discovery paths (2026-10-27)

### S3 — Contract/alias verify script (regression against #1254)

- **Feature:** the write target's contract, paths, and rules still hold
- **Steps:** `npx tsx scripts/verify/scanner-chart-view-latest-run-1254.ts`
- **Expected:** 13 `OK` lines + `=== ALL CHECKS PASSED ===`, exit 0
- **Result:** ☑ PASS — 13 checks green (2026-10-27)

### S4 — Typecheck

- **Feature:** seam + specs compile under the app tsconfig
- **Steps:** `npx tsc --noEmit -p tsconfig.app.json`
- **Expected:** clean, exit 0
- **Result:** ☑ PASS — clean (2026-10-27)

### S5 — Live Firestore write (end-to-end, user-performed)

- **Feature:** a real discovery run lands a real cache document
- **Starting state:** app running (`npm start`), signed in, scanner page
  (`/trading/scanner`) reachable with a healthy Robinhood session
- **Steps:**
  1. Open the scanner page; wait for the run-all wave, or click a
     recipe's refresh action for a single recipe (e.g. `quality-large`)
  2. Wait for the recipe to complete successfully
  3. In the Firestore console, open
     `st-scanner/latest-runs/items/{recipeId}`
  4. Confirm the doc exists with fields `recipeId`, `ranAt` (ISO string,
     near now), `totalItems`, `truncated`, and `rows` (array of
     `{ticker, instrument_id, instrument_type, columns}` objects)
  5. Re-run the same recipe — `ranAt` advances; the doc is overwritten,
     not duplicated (exactly one doc per recipeId)
- **Expected:** doc present, fields shaped per `ScanLatestRun`, overwrite
  semantics confirmed; the run itself is unaffected by the write
- **Cleanup:** none needed — the doc is the intended artifact; delete it
  in the console only if a clean-slate check of S5 is wanted
- **Result:** ☑ PASS — user confirmed docs exist for every recipe in
  Firestore (2026-10-27)

**Execution note:** the first attempt failed with
`FirebaseError: Missing or insufficient permissions` — the #1254 rules
allowlist was committed but never deployed. Resolved by deploying HEAD's
`firestore.rules` (`firebase deploy --only firestore:rules`, committed
file only — the working tree's uncommitted #1013 rules deletions were
NOT included). After the deploy, writes succeeded with no warns. Warn-only
behavior proved live: the failed writes surfaced as console.warn only and
the scan runs completed unaffected — an accidental end-to-end validation
of the failure-path AC.

## Automated verification summary

| Check | Command | Result |
|---|---|---|
| Service + store specs | `npx jest …/scanner.service.spec.ts …/scanner.store.spec.ts` | ✅ 58 tests |
| Call-site grep | `grep saveLatestRun scanner.store.ts` | ✅ 2 discovery paths only |
| Verify script (#1254 regression) | `npx tsx scripts/verify/scanner-chart-view-latest-run-1254.ts` | ✅ 13 checks |
| Typecheck | `npx tsc --noEmit -p tsconfig.app.json` | ✅ clean |
| Full suite | `npx jest --coverage=false` | ✅ 269 suites / 4,648 tests |

## Traceability

| Task AC | Scenario(s) |
|---|---|
| `saveLatestRun` writes serialized doc to deterministic recipeId path | S1, S5 |
| `runScan` success writes cache (PreviewScanResult adapter) | S1, S2 |
| `launchRecipe` success writes cache (covers runAll/refresh) | S1, S2, S5 |
| `evaluateTracked` does NOT write (explicit spec assertion) | S1, S2 |
| Cache write failure → console.warn only; run unaffected | S1 |
| `truncated` populated via `isScanTruncated` | S1, S3 |

## Regression / smoke checklist

- [x] No code path outside `launchRecipe`/`runScan` calls `saveLatestRun`
      (grep — 2 matches; `evaluateTracked` clean, spec-pinned)
- [x] Superseded/stale completions cannot write (both `runSeq` and
      `recipeSeqs` sides pinned in store specs)
- [x] Failed and blocked discovery runs write nothing (AUTH-rejection,
      per-recipe failure, all-failed wave, and empty-universe specs)
- [x] Warn-only is structural — `void` call sites can never reject
      (malformed-result spec pins construction-inside-try)
- [x] Contract/paths/rules unchanged (#1254 verify script green)
- [x] No UI surface introduced — scanner page behavior unchanged by the
      seam (no component/template edits in the diff)

## Refinement pass

Not applicable — no user-facing surface (service/store seam; the cache
doc is consumed by #1258's dropdown, not rendered here).
