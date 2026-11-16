**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Pass Family Consolidation  
**Thread Slug:** pass-family-consolidation  
**Issue:** #1569  
**Thread Parent:** #987  
**Topic Parent:** #984  
**Task:** #1562  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-16  
**Last Updated:** 2026-11-16  

# UAT — #1562 BE-IMPL: src-{source} stats scope family

## Scope

Acceptance criteria under test (from #1562):

1. `statsScopeSource` in `shared/paper-trading-ids.ts` returns `src-{SOURCE}` — unit pins added.
2. `tradeScopes` in `paper-stats-pass.ts` emits the source scope for every trade — strategy + signal unit tests assert presence.
3. The stats pass writes `stats-src-STRATEGY`/`stats-src-SIGNAL` docs in prod — verified via the new verify script (manual trigger is fine).
4. No changes to legacy writers, ledger, read path.
5. `SCOPE_RE` accepts `src-*` — verified, no code change needed.

This task is data-plane only: it writes new stats documents. No UI code
changed; no new app surface exists. The docs become enumerable anywhere
`listStats`/`getPaperStats` enumerate scopes — the user-facing selector
that consumes them is later task #1564.

## Prerequisites

- Repo: `C:\aa\projects\rel-str`, branch `prod`.
- Node deps installed (`npm i` in repo root and `functions/`).
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (IPv4 DNS workaround — required for Firestore calls).
- For scenario 4 only: **ADC** — `gcloud auth application-default login` against project `rel-str`, plus permission to read/write `st-paper-trading` collections in prod Firestore. The script seeds two trades, runs the real pass, then cleans up its seed docs and restores shared stats docs to a consistent recomputed state.

## Getting to the feature

There is no app route for this task — the deliverable is Firestore data.
The two surfaces a tester can inspect:

- **Firestore console:** project `rel-str` → path
  `st-paper-trading/stats/items/{doc}` — look for `stats-src-STRATEGY`,
  `stats-src-SIGNAL`, `stats-src-MANUAL` alongside `stats-all`.
- **Programmatic surface:** `handleGetPaperStats({ scope: 'src-STRATEGY' })`
  — the same callable seam the dashboard will call.

## Start instructions

```powershell
cd C:\aa\projects\rel-str
# Scenarios 1-3 (unit suites — no credentials needed)
npx jest shared/paper-trading-ids.spec.ts --coverage=false
npx tsx --test tests/functions/paper-trading/paper-stats-pass.test.ts
npx tsx --test tests/functions/paper-trading/read-callables.test.ts
# Scenario 4 (prod — needs ADC)
cd functions
npx tsx scripts/verify/paper-trading-stats-src-scopes-1562.ts
```

## Test scenarios

### S1 — `statsScopeSource` builder pins (AC1)

- **Confirms:** the id builder maps each `PaperTradeSource` to its
  `src-{SOURCE}` scope.
- **Steps:** `npx jest shared/paper-trading-ids.spec.ts --coverage=false`
- **Expected:** 46/46 pass, including
  `statsScopeSource(PaperTradeSource.STRATEGY) === 'src-STRATEGY'`,
  `SIGNAL → src-SIGNAL`, `MANUAL → src-MANUAL`. (Enum values are
  lowercase; the builder uppercases to produce the documented id —
  same precedent as `statsScopeSymbol`.)
- **Result:** PASS — 46/46 (2026-11-16).

### S2 — `tradeScopes` fan-out per source family (AC2)

- **Confirms:** every non-cancelled trade rolls into exactly one `src-*`
  scope plus its other populated dimensions.
- **Steps:** `npx tsx --test tests/functions/paper-trading/paper-stats-pass.test.ts`
- **Expected:** 10/10 pass, including *emits the source scope for every
  source family (#1562)*, the insertion-order assertion
  (`['all','sym-QQQM','src-STRATEGY']` when only required dims present),
  and the unchanged cancelled-trade and per-scope error-isolation tests.
- **Result:** PASS — 10/10 (2026-11-16).

### S3 — Read path accepts `src-*` (AC5)

- **Confirms:** `SCOPE_RE` accepts `src-STRATEGY` and the callable
  returns the requested doc; malformed scopes still rejected.
- **Steps:** `npx tsx --test tests/functions/paper-trading/read-callables.test.ts`
- **Expected:** 22/22 pass, including *accepts the src-* scope family
  (#1562)* and the unchanged *rejects malformed scope strings* test.
- **Result:** PASS — 22/22 (2026-11-16).

### S4 — Prod write path end-to-end (AC3, AC5)

- **Confirms:** the real `runPaperStatsPass` writes canonical
  `stats-src-*` docs in prod; reads work through both the `getStats`
  repository seam and the `handleGetPaperStats` callable; the source
  scopes partition `stats-all`.
- **Starting state:** prod Firestore with existing paper trades.
- **Steps:**
  `cd functions && npx tsx scripts/verify/paper-trading-stats-src-scopes-1562.ts`
- **Expected (15 checks):** seed strategy + signal trades land; the pass
  runs; `stats-src-STRATEGY`, `stats-src-SIGNAL`, `stats-src-MANUAL`
  docs exist (manual tolerated absent if no manual trades); each has the
  canonical shape (`scope`, `equityCurve`, counts) read via `getStats`;
  `handleGetPaperStats({scope:'src-STRATEGY'})` returns it; the
  omitted-scope enumeration surfaces the src-* docs; src-* open +
  closed counts each sum exactly to `stats-all`'s; seeded docs cleaned
  up and shared stats recomputed.
- **Cleanup:** the script deletes its seeded trades/stats and re-runs
  the recompute so prod is left consistent.
- **Result:** PASS — 15/15 (2026-11-16).

### S5 — Scope discipline: no sibling-surface edits (AC4)

- **Confirms:** the diff touches only the task's files — no legacy stats
  writer, ledger, or read-path changes.
- **Steps:** `git diff HEAD --stat` restricted to the task's file list;
  confirm `runStatsPass`, `ledger.ts`, `stats-increments.ts`, callable
  bodies are untouched.
- **Expected:** diff confined to `paper-trading-ids.ts`, its spec,
  `paper-stats-pass.ts`, the two test files, the new verify script +
  run-all/README registrations, `DATA-MAP.md`. (The working tree
  contains unrelated parallel-session work; it is not part of this task.)
- **Result:** PASS — 8 files, all in-scope (2026-11-16).

### S6 — Regression: broader paper-trading suite + typecheck

- **Confirms:** no neighboring paper-trading behavior regressed.
- **Steps:** `npm run test:paper-trading` (tsx suite) and
  `cd functions && npm run typecheck`.
- **Expected:** all tests pass; `tsc --noEmit` clean.
- **Result:** PASS — 284/284, typecheck clean (2026-11-16).

## Refinement pass

Not applicable — no user-facing surface. The change writes new stats
docs; no UI code, copy, layout, or interaction changed. The src-* docs
may appear in any existing generic `listStats` enumeration as data —
that is the intended mechanism, not a UI change. The dashboard selector
consuming them is task #1564's surface.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| 1. `statsScopeSource` → `src-{SOURCE}` + unit pins | S1 |
| 2. `tradeScopes` emits per trade (strategy + signal) | S2 |
| 3. Prod `stats-src-STRATEGY`/`stats-src-SIGNAL` written | S4 |
| 4. No legacy-writer/ledger/read-path changes | S5 |
| 5. `SCOPE_RE` accepts `src-*` | S3, S4 |

## Regression / smoke checklist

- [x] Existing scope dims unchanged (all/inst/var/cohort/sig/sym/sigtype/dir/stamp slices) — S2 covers via unchanged pins
- [x] CANCELLED trades excluded from every scope — S2
- [x] Per-scope error isolation preserved — S2
- [x] Malformed scope strings still rejected — S3
- [x] `stats-all` written even with zero trades — S2
- [x] src-* partition sums to `stats-all` in prod — S4
- [x] Paper-trading tsx suite green — S6
- [x] Functions typecheck clean — S6

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 builder pins | PASS | jest 46/46 |
| S2 tradeScopes fan-out | PASS | tsx 10/10 |
| S3 read path src-* | PASS | tsx 22/22 incl. `accepts the src-* scope family (#1562)` |
| S4 prod end-to-end | PASS | verify script 15/15 |
| S5 scope discipline | PASS | diff = 8 task files; no ledger/writer/read-path edits |
| S6 regression | PASS | tsx 284/284; tsc clean |
