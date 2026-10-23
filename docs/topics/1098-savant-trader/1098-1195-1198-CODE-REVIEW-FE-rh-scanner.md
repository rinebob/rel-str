**Topic:** Savant Trader  
**Topic Slug:** savant-trader  
**Thread:** FE Blueprint — Auto-Run Scans  
**Thread Slug:** scanner-auto-run  
**Issue:** #1195  
**Thread Parent:** #1183  
**Topic Parent:** #1098  
**Task:** #1198  
**Domain:** FE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-22  
**Last Updated:** 2026-10-22  

# Code Review — #1198 Store run-all machinery

**Verdict: PASS** — one remediation round. Three axes (standards, spec,
attack) converged on one convergent MEDIUM pair + one MEDIUM spec gap,
all remediated in-review; remaining findings are accepted judgement
calls. Final: 40/40 store specs + 10/10 service + 92/92 client,
zero tsc diagnostics.

Files under review (uncommitted worktree, scoped diff):

- `src/app/features/savant-trader/stores/scanner.store.ts` (`runs` map,
  `armedLaunches`, `authFailed`/`runsLoading` computeds, `launchRecipe`
  with per-recipe seq tokens, `runAllRecipes`/`refreshRecipe`)
- `src/app/features/savant-trader/stores/scanner.store.spec.ts` (new
  `run-all machinery (#1198)` describe — 16 specs)
- `src/app/features/savant-trader/services/scanner.service.ts` + spec
  (`previewScanRaw` pass-through)
- `src/app/core/robinhood-mcp/robinhood-mcp-client.service.ts` + spec
  (`previewScanRaw`/`previewScanRawSpec` — raw wire shape sibling of
  `previewScan`; shared `previewScanArgs`)
- `docs/…/…-IMPL-…scanner-auto-run.md`, `…-TEST-…scanner-auto-run.md`
  (store-surface + spec-list sync)

## Remediated findings

- **MED — `refreshRecipe` left the recipe's armed stagger slot armed →
  double-fire** (convergent: spec axis LOW + attack axis MEDIUM).
  `pendingLaunches` was a `Set<handle>` with no recipe association — a
  refresh click on a queued table fired `preview_scan` immediately, then
  the armed slot re-fired it at its slot. Fixed: `pendingLaunches` is a
  `Map<recipeId, handle>` and `launchRecipe` consumes the recipe's armed
  slot before launching. Spec: "a refresh during the stagger consumes
  the recipe's armed slot".
- **MED — `runsLoading` gate porous mid-wave** (convergent: standards
  LOW + spec LOW + attack MEDIUM). Only `status === 'loading'` counted —
  a fast-settling launch left a ~700ms enabled window before the next
  slot, and a click would re-arm the whole wave. Fixed: new state
  `armedLaunches: string[]` tracks armed-but-unfired slots;
  `runsLoading` = armed or in-flight. Spec asserts the gate stays closed
  between slots.
- **MED — spec blind spot on auth taxonomy** (attack axis). Only AUTH
  `RobinhoodMcpError` and plain `Error` were exercised — an impl of
  `instanceof RobinhoodMcpError → 'auth'` would pass everything while
  wrongly raising reauth for MCP-category failures (e.g. the client's
  own malformed-response throw). Added: non-AUTH `RobinhoodMcpError`
  → `'other'`, `authFailed` stays false.
- Client member ordering — `previewScanRaw`/`previewScanRawSpec` had
  split the file's `x()`/`xSpec()` adjacency; reordered to
  `previewScan` → `previewScanSpec` → `previewScanRaw` →
  `previewScanRawSpec`.
- Duplicated `args: { filters, columns }` across both spec builders —
  extracted `previewScanArgs` so a future arg (limit/cursor) can't
  silently diverge between the single-run and run-all paths.
- Imprecise comment — "a Firebase-side failure is 'other'" under
  `launchRecipe` (a pure MCP path can't produce Firebase errors);
  reworded to non-AUTH.
- Coverage additions: error entry retains prior `result`/`ranAt`;
  runAll-during-in-flight supersession (the TEST doc's interval-overlap
  edge, previously only queued-slot cancellation was pinned); armed-gate
  assertion folded into the `runsLoading` spec.
- Spec comment hardcoded wave arithmetic (4+9=13/18) — numbers were
  correct but fragile; genericized to describe the mechanism.

## Accepted / flagged

- **`authFailed` flicker on retry** — clearing `errorKind` at launch
  means the banner can unmount mid-retry and remount on re-fail.
  Cosmetic, not worth a latch.
- **`launchRecipe` sync-throw seam** — a synchronous throw (or a
  non-Promise mock) would wedge an entry at `loading`. The real service
  delegates to an `async` client method — unreachable in production;
  sloppy mocks fail loudly under fake timers. Consistent with codebase
  hardening norms.
- **`running` vs `runs` name adjacency** — one character apart for
  unrelated concepts; `runs` matches the IMPL vocabulary. Noted, kept.
- **Separate fake-timer describe** — the run-all block re-declares the
  service mock rather than nesting into the existing describe; the
  `beforeEach`/`afterEach` fake-timer scoping justifies the isolation.
- **Errored recipe has no in-table retry** — the table unmounts on
  `status:'error'`, so a failed recipe is retryable only via Run all.
  Deliberate per PRD silent-skip; flagged for #1199's header surface.
- **Docs elsewhere still say "9 recipes"** — the count is correct today
  (catalog is 9); a spec-review agent miscounted 12 by tallying `id:`
  occurrences including a function signature. Not a drift.

## Verification

- 40/40 `scanner.store.spec.ts` (16 new run-all specs), 10/10
  `scanner.service.spec.ts`, 92/92 `robinhood-mcp-client.service.spec.ts`
- `npx tsc --noEmit -p tsconfig.app.json` — clean
- Fake-timer usage per AGENTS.md (`jest.useFakeTimers` +
  `advanceTimersByTimeAsync`; no banned flush patterns)

## Round 2 — post-remediation attack (2026-10-22)

All three axes re-verified the R1 remediations hold and attacked the new
`armedLaunches`/`pendingLaunches` machinery. No HIGH or MEDIUM findings.

Remediated:

- **LOW — queued-but-unfired timer callbacks bypass slot consumption**
  (attack axis). A timer callback is unconditional — if an input task
  (refresh click, remount `ngOnInit`) interposes between timer expiry and
  callback execution, a consumed slot could still fire (double-fire) or a
  stale wave-1 callback could steal wave-2's slot (early launch). Fixed:
  the callback verifies handle ownership —
  `pendingLaunches.get(id) === h` — before launching.
- **LOW — "others untouched" refresh spec asserted only idle-ness**
  (spec axis). Now seeds a sibling result first and asserts the entry's
  object identity survives the refresh.

Accepted:

- `errorKind` clears at launch → `authFailed` can flicker during a retry
  wave (R1-accepted, unchanged).
- Armed timers outlive the page by design (session-persistent store;
  re-entry cancellation covers remount) — consistent with IMPL.
- `?? idleRun()` fallback is typed-unreachable (no
  `noUncheckedIndexedAccess`) — harmless belt for the invariant.
- Hung `previewScanRaw` pins `runsLoading` — self-heals via the next
  wave's seq supersession (and the 90s upstream timeout).

Re-verified clean: the `armedLaunches`↔`pendingLaunches` mutation
discipline is airtight across all sites (paired, synchronous, no
resurrect path); seq tokens, errorKind mapping, and stale-result
retention unchanged; `previewScanArgs` extraction is behavior-neutral.

**R2 verdict: PASS** — 40/40 store specs green post-remediation,
tsc clean, `diff --check` clean.
