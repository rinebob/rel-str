**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1012  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# CODE-REVIEW — #1012 BE-CONFIG: firestore rules + indexes for st-* paths

## Verdict: **PASS** (1 round)

## Scope reviewed

- `firestore.rules` — 12 new canonical root match blocks (+133 lines): st-symbols, st-signals, st-runs(+jobs), st-order-tickets, st-position-groups, st-strategy-instances, st-config, st-symbol-lists, st-backtest-runs, st-backtest-permutations, st-paper-trading (anchored), st-portfolio (anchored). Pre-existing st-* coverage (st-screenshots, st-swing-sets, st-swing-configs, st-scanner) left untouched.
- `firestore.indexes.json` — 17 new composite indexes (+139 lines): 5 st-signals, 6 st-order-tickets, 2 items (shared anchored group), 1 st-position-groups, 1 st-symbols, 1 st-symbol-lists, 1 st-backtest-permutations.
- `tests/functions/firestore-rules-indexes-1012.test.ts` — new content-level spec (13 assertions), `node:test` + `tsx --test` per `rh-agent-mcp-boundary.test.ts` convention.
- `functions/package.json` — `test:st-rules-indexes` script registration.

## Standards

**Policy parity verified 1:1.** Every new block mirrors the rule of the legacy collection it replaces — user-scoped CRUD for order-tickets/strategy-instances/symbol-lists (incl. the legacy no-userId read/delete escape on lists), authed-read for backend-owned roots, archive/qualityDesignation-only updates on backtest-runs, and the get/list split on st-portfolio so missing-doc transaction probes keep working. No policy drift introduced mid-soak.

**Field presence verified against contracts.** `st-order-tickets` (userId, mode, state, origin.positionGroupId), `st-position-groups` (userId), `st-config` (`status`/`autoPaper`/`{uid}` doc-id split), and `st-paper-trading` anchor set (accounts/trades/stats/raw-quotes — the only kinds `collections.ts` routes to the canonical root) all checked against `shared/st-*.ts` contracts and `functions/src` writers. FE `trading-config.service` stamps `userId` on its doc — the create/update clauses hold post-cutover.

**Index coverage traced to real queries, not just the AC.** Beyond the AC's three tuples, the audit carried the legacy index surface that st-* paths replace: `signal-history`/`signals`/`run-ids` group indexes → st-signals; `occurrence-decisions` userId queries → st-order-tickets (fold per #1017); shared `items` indexes automatically cover both paper-trading roots. Live queries confirmed: `(mode,state)` staged-expression read, `items (signalId,source)` for `listTradesBySignal`, `st-symbols (enabled,createdAt)` for the new-symbol FE query, `st-backtest-permutations (runId,completedAt)` for `watchPermutations`.

**Index spec format verified.** `arrayConfig: "CONTAINS"` used for the `runIds` array-contains index; dotted field paths (`origin.runId`, `terms.symbol`) valid.

## Spec

| Acceptance criterion | Result |
|---|---|
| Rules cover all new st- collections | **Met** — all 13 `ST_*_ROOT` exports have match blocks; spec asserts each |
| st-signals (marketDate,status) | **Met** — plus the 4 legacy-surface indexes the root absorbs |
| tickets (mode,state,origin) | **Met** — (mode,state) live query + (mode,state,origin.positionGroupId) + 3 userId-scoped |
| trades (positionGroupId,contract fields) | **Met** — items (positionGroupId,expiration,optionType,strike) serves group + contract-key queries |
| "Blocked by: #997" | N/A — #997 shipped long ago; no actual dependency remained |

## Thermo-nuclear

- **Soak-window parity is the right call.** Rules replicate legacy policies rather than "improving" them — a divergence would create asymmetric behavior between mirrored roots. Documented nits are deliberate parity, not defects.
- **No emulator needed.** Content-level assertions + a single emulator boot to prove the rules file compiles is the right weight for config changes — no rules-unit-test harness was pulled in for a one-time migration task.
- **Index count (17) is justified, not bloat.** Each new index maps to an existing live query or an index the legacy path already carried; nothing speculative beyond the AC-called origin tuple.

## Findings

**Critical:** none.
**Major:** none.

**Minor/Nit:**

1. *(deliberate parity)* Update clauses on user-scoped roots don't pin `request.resource.data.userId == resource.data.userId` — a user could re-stamp `userId` on their own doc (self-lockout only, no escalation). Legacy rules share this shape; `st-swing-configs` is the only rule that pins immutability. Widening post-#1013 is a candidate cleanup.
2. *(forward-looking)* `(mode,state,origin.positionGroupId)` has no live query today — declared per the AC's "origin refs" call-out for the group-scoped heal flow.
3. *(convention)* Equality-conjunction indexes `(userId,origin.runId)`, `(userId,origin.signalId)`, `(userId,terms.symbol)`, `items (signalId,source)` are technically servable by single-field index merges — declared because the repo declares equality composites (occurrence-decisions precedent) and composite scans are faster.
4. *(test style)* Rules assertions are whitespace-sensitive regexes — same style as `rh-agent-mcp-boundary.test.ts`; acceptable for a content gate.
5. *(verification)* No `functions/scripts/verify/` script — rules cannot be audited via admin SDK and indexes only exist post-deploy. Post-deploy index-build time is a ship-note for QA.

## Test results

- `test:st-rules-indexes` — **13/13 pass** (covers root coverage, policy shapes, default-deny-last, exact index field ordering + direction/arrayConfig).
- `firebase emulators:exec --only firestore` — rules compile clean (booted, no syntax errors).
- Indexes JSON parses; zero duplicate (collectionGroup,scope,fields) entries.
- Full repo suite not run — config-only change; no code paths touched. The task's own spec is the meaningful gate.

## Review-round remediation (this session)

- `hasIndex` helper originally asserted field paths but not `order`/`arrayConfig` — a wrong-direction index would have falsely passed. Fixed: direction is now asserted per-field (`"barDate:DESC"`, `"runIds:CONTAINS"`).
- Re-audit pass found 9 missed indexes beyond the initial AC read (legacy signal-path surface on st-signals, decision fold-in on tickets, `items (signalId,source)`, `st-position-groups (userId,createdAt)`) — added before this review.

**Next:** `/proj qa 984 1012`
