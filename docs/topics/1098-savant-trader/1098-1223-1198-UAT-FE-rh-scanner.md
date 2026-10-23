**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** Auto-Run Scans  
**Thread Slug:** scanner-auto-run  
**Issue:** #1195  
**Thread Parent:** #1183  
**Topic Parent:** #1098  
**Task:** #1198  
**Domain:** FE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# UAT — #1198 Store run-all machinery

QA issue: #1223. Review doc:
`1098-1195-1198-CODE-REVIEW-FE-rh-scanner.md` (PASS, 2 rounds — R1:
armed-slot double-fire + porous `runsLoading` + auth-taxonomy spec gap;
R2: queued-but-unfired timer callback ownership + weak "others
untouched" spec; converged on accepted LOWs).

## Scenario results

### 1. Focused suites green — PASS

`npx jest scanner.store.spec scanner.service.spec
robinhood-mcp-client.service.spec --coverage=false` (fresh run,
post-R2-remediation): **3/3 suites, 141/141 tests** — 40 store (16
run-all), 10 service, 91+1 client (`previewScanRaw` raw-shape +
error-path pins added in R1). Zoneless NG0914 warnings are the
repo-wide known non-failure.

### 2. `tsc --noEmit` — PASS

Zero diagnostics on the app project (`tsconfig.app.json`), re-verified
post-R2.

### 3. Semantics vs. issue checklist + IMPL §2 + TEST plan — PASS

| Checklist | Evidence |
|---|---|
| `runs: Signal<Record<recipeId, RecipeRunState>>` — `{status, result, ranAt, errorKind}`, independent entries | Initial state seeds one `idle` entry per `SCANNER_RECIPES` id (spec'd); transitions patch only the target recipe |
| `runAllRecipes()` — every recipe fires `preview_scan`, ~1s stagger, failures isolated | `setTimeout(i * 1000)` per recipe; per-second stepping spec asserts the stagger; failure spec asserts `status:'error'` + `errorKind:'other'` on one entry, others unaffected, `store.error` untouched |
| `refreshRecipe(id)` — single immediate re-run | Spec'd: immediate call, no stagger; unknown id no-op; sibling entry identity preserved |
| `authFailed` — true when any run lands auth-shaped error | `errorKind:'auth'` iff `toError(e).category === AUTH`; non-AUTH `RobinhoodMcpError` stays `'other'` (spec'd); `authFailed` computed over the map |
| Results persist across page navigation | Root-provided store; second-injection spec asserts entries survive |
| Store specs per TEST plan | 16 run-all specs cover every TEST-doc item plus R1/R2 additions |

R1/R2 review-added semantics, all spec'd:

- **Armed-slot consumption** — `pendingLaunches: Map<recipeId, handle>`;
  `launchRecipe` consumes the slot; refresh-during-stagger spec proves
  no double-fire.
- **Wave re-entry** — `runAllRecipes` clears prior timers before
  re-arming; spec'd (wave-2 → exactly one call set, not two).
- **In-flight supersession** — per-recipe `recipeSeqs` tokens; stale
  completions dropped last-write-wins (overlapping-relaunch spec).
- **`runsLoading` covers armed + in-flight** — `armedLaunches` state
  slice keeps the gate closed between stagger slots (spec'd).
- **Stale-result retention** — loading and error entries keep prior
  `result`/`ranAt` (spec'd).
- **Timer ownership guard (R2)** — a queued-but-unfired callback
  verifies `pendingLaunches.get(id) === h` before launching; closes the
  input-task interposition sliver.

Client/service seams: `previewScanRaw` returns the un-flattened
`PreviewScanResult` (spec'd — `'rows' in result === false`), shares
`previewScanArgs` + `parseScanResult` + error path with `previewScan`;
service pass-through spec'd.

### 4. Diff footprint — PASS

`git status` scoped to #1198:

- MOD: `core/robinhood-mcp/robinhood-mcp-client.service.{ts,spec.ts}`
  (`previewScanRaw`/`previewScanRawSpec`/`previewScanArgs`),
  `services/scanner.service.{ts,spec.ts}` (pass-through + pin),
  `stores/scanner.store.{ts,spec.ts}` (run map + machinery + 16 specs)
- DOC: IMPL/TEST (semantics sync), CODE-REVIEW (2 rounds)

All files are scanner-scoped or thread docs. Non-scanner files in
`git status` (`stores/gallery-*`, `group.store`, `occurrence-decision`,
`paper-trading`, `signal-review.facade`, `symbol-history`, `triage`,
order components, CHANGELOG) are concurrent-session work — grep-verified
zero scanner/recipe/previewScan references; excluded.

### 5. Manual verification — N/A for this task

The machinery is not yet driven by a page (that's #1199 — `ngOnInit` →
`runAllRecipes`, 15-min interval, stacked tables). All verification is
spec-level with fake timers stepping the stagger; E2E journeys land in
the #1199 UAT.

## Verdict: **PASS**

#1198 delivers the session-persistent per-recipe run lifecycle the
auto-run overview consumes: staggered launch, isolated failures, auth
taxonomy, slot consumption, re-entry cancellation, and last-write-wins
supersession. QA issue #1223 → RESOLVED.
