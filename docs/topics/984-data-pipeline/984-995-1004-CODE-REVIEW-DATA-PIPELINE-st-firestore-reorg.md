**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #995  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1004  
**Domain:** DATA-PIPELINE  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# CODE REVIEW — BE-IMPL: st-position-groups (#1004)

## Change set

- `functions/src/position-groups/st-position-group-writer.ts` — canonical `st-position-groups` writer (mirrors `StOrderTicketWriter`): `create()` allocates `{SYM}-{YYMMDD}-grp-{NN}` via `create()`+ALREADY_EXISTS, adopting on same-origin+members-covered (retry) or advancing seq (distinct group); `ensure()` restores a known-id doc; `addMembers()` txn read-merge-update union; `get()`; `buildGroupDoc()` single shape constructor. Fail-soft throughout.
- `functions/src/position-groups/live-position-join.ts` — pure join: equity holdings via `tax_lots[].order_id ∈ brokerOrderIds`; option positions via `option_id`/`chain_id` vs member leg `optionId`s; `collectGroupMembership` extracts join inputs from member tickets.
- `functions/src/position-groups/legacy-cohorts.ts` — pure `cohortToGroup` mapper + `parseCohortId`: `cohort-{YYMMDD}-{SYM}-{NN}` → `{SYM}-{YYMMDD}-grp-{NN}`; `tradeIds`→`memberTradeIds` verbatim; `origin.signalId` via member-ticket lineage (not the legacy gallery id); `userId`/rollups/status derived from member trades.
- `functions/src/common/firestore-utils.ts` — shared `isAlreadyExists` + `unionIds` (was duplicated across both writers + migration).
- `functions/src/paper-trading/callables.ts` — group created before member ticket emits (`pap_{tradeId}` members known deterministically); `origin.positionGroupId` on every emit; `dims.positionGroupId` on equity + pending trades; `positionGroupId` in response; retry path returns stored id + `ensure()` rebuild with derived rollups/status; legacy cohort write retained for the soak.
- `functions/src/paper-trading/ledger.ts` — `FillDimensions.positionGroupId`, `PaperTradeOverrides` entry, doc-build stamps in `applyEntryFill` + `createPendingTrade`.
- `shared/paper-trading-contracts.ts` — `PaperTrade.positionGroupId`, `PaperSignalOrderResponse.positionGroupId`, `LIFECYCLE_OPEN_TRADE_STATUSES` (PENDING/OPEN/ASSIGNED — single lifecycle-open definition shared by mapper, rebuild, audit).
- `shared/st-order-tickets.ts` — `origin.positionGroupId` comment now covers member tickets (not just management).
- `functions/scripts/migrate-cohorts-1004.ts` — dry-run-default cohort migration: `--apply`/`--id`, member-trade join for userId/rollups, `refId` ticket join for memberTicketIds + canonical signal lineage, merge-safe union write (preserves existing members/`createdAt`/`origin`/rollups), `updatedAt`-insensitive unchanged detection, `positionGroupId` + `origin.positionGroupId` back-stamps.
- `functions/scripts/verify/data-pipeline-st-position-groups-1004.ts` — canonical shape audit + cohort⇄group parity + bidirectional back-stamp checks + real-data live-join probe (`get_equity_tax_lots` per member symbol, `get_option_positions`).
- `functions/scripts/verify/paper-trading-signal-order-564.ts` — end-to-end group assertions (minted id, retry stability, member coverage, trade/ticket stamps) + group-doc cleanup.
- Registrations: `test:st-position-groups` script, `functions/tsconfig.json`, verify READMEs (root + functions), `scripts/verify/run-all.ts`, `paper-trading-signal-order-564.md` guide.
- Tests: `tests/functions/position-groups/` (writer 12 + join 8 + mapper 7 specs), `signal-order.test.ts` group-path specs (spyGroups seam over `EmitPositionGroupInput`/`buildGroupDoc`).

## Spec coverage (issue #1004 + IMPL-BE Phase 3 + TEST)

| Criterion | Status |
|---|---|
| "Accept creates {SYM}-{YYMMDD}-grp-{NN}; tickets/trades stamped positionGroupId" | **MET** — group minted before emits; `pap_{tradeId}` member tickets carry `origin.positionGroupId`; equity + pending trades stamped via ledger dims; response returns it; verify-564 asserts end-to-end on prod (22 checks green). |
| "9 cohorts migrated; memberTradeIds carried" | **MET (code)** — mapper + script verified; prod dry-run: 9/9 groups, 27 trade + 9 ticket back-stamps, 0 malformed/failed. `--apply` is the QA/operator step. |
| "Live join via tax_lots.order_id / option_id-chain_id" | **MET (helper + probe)** — pure join implemented and exercised against real RH tax lots/positions in the audit. Live-group creation/attachment (callers of `addMembers`) is deferred — live accepts don't exist yet; the join surface is delivered. |
| IMPL 3.2 "carry signalId" (cohort→group) | **MET with caveat** — `origin.signalId` resolves from member-ticket `origin.signalId` (canonical occurrence id), not `cohort.signalId` (legacy gallery id) — deliberate; unresolvable → bare `{type:'signal'}` + audit WARN. |

## Review axes

### Standards — findings

| Finding | Severity | Resolution |
|---|---|---|
| Manual-origin adoption bug — `sameOrigin` alone can't distinguish a second distinct manual accept (no signalId/instanceId) → wrong group stamped | **Major** | **Fixed** — adoption requires same origin AND members-covered (⊆); distinct-accepts + superset-adoption specs added |
| Lifecycle-open statuses defined 3× and *disagreeing* (mapper PENDING/OPEN/ASSIGNED, rebuild OPEN-only, audit raw strings) → audit would WARN on its own fresh writes; rebuild hardcoded `status:'open'` | **Major** | **Fixed** — `LIFECYCLE_OPEN_TRADE_STATUSES` exported from shared contracts; all three consumers use it; rebuild derives `status` from openCount; fresh-create rollup `openCount = memberTradeIds.length` |
| Unguarded adoption re-read — `ref.get()` inside ALREADY_EXISTS could throw into the accept path | Major | **Fixed** — wrapped fail-soft (log + null) |
| Seq bound 99 vs the st-ids roll-over contract | Minor | **Fixed** — bound raised to 999 (`nn()` pads ≥2) |
| `as unknown as` in migration; `as never`/`as PaperTrade`/`as StOrderTicket[]` type-erased fixtures in new tests | Minor | **Fixed** — `{...group}` spread; `signalTrade()` factory hoisted to file scope; spy typed on `EmitPositionGroupInput`/`StPositionGroup`; `Parameters<typeof …>` fixture type |
| `isAlreadyExists`/`union` duplicated across writers + migration | Minor | **Fixed** — `functions/src/common/firestore-utils.ts`; both writers + migration consume it |
| Writer header drift (adoption rule) | Nit | **Fixed** — docstring matches members-covered semantics |
| `callables.ts` ~1,010 lines | Minor | **Accepted** — pre-existing trajectory (#1003 review noted same at ~930); a signal-order/lookup split is a #1013-cleanup candidate, not worth churn mid-soak. `buildPositionGroupDoc` was still pulled out into the writer (`buildGroupDoc`) so doc construction has one home |
| `EmitPositionGroupInput.status`/`brokerOrderIds` never supplied by the only create caller | Nit | **Accepted** — the live-mode callers need them; removing would pre-shrink the API the join lands on |

### Spec — findings

| Finding | Severity | Resolution |
|---|---|---|
| Migration rerun "unchanged" was unreachable — `updatedAt` always fresh → every rerun reported `updated` + rewrote | **Major** | **Fixed** — unchanged comparison excludes `updatedAt` |
| Migration `set(merge:true)` could clobber a live-created group's member arrays | **Major** | **Fixed** — merge-doc unions all three id arrays, preserves `createdAt`, merges `origin`/keeps `status`/preserves `rollups.realizedPnl` on existing docs |
| Rebuild could reference phantom `pap_{tradeId}` tickets (a fail-softed emit) | Minor | **Accepted** — the audit's missing-member FAIL is exactly the detection surface for that condition; a rebuilt group with a phantom ref is more diagnosable than no group |
| AC3 live-half — nothing creates live groups or calls `addMembers` yet | — | **Accepted/deferred** — live accepts don't exist in the system today; join helpers + real-data probe deliver the AC's mechanism; flag on the QA issue |

### Thermo-nuclear — findings

| Finding | Severity | Resolution |
|---|---|---|
| Group-doc construction in 3 places (writer internals, callables `buildPositionGroupDoc`, mapper) | **Major** | **Fixed** — `buildGroupDoc(id, PositionGroupDocFields)` exported from the writer (id-vs-mint split via `EmitPositionGroupInput extends PositionGroupDocFields`); callables rebuild consumes it; mapper retains its different-source builder by design |
| `sameMembers` strict set-equality latent breakage — a group that gained `brokerOrderIds` via `addMembers` would fail equality on retry → sibling grp-02 | Major | **Fixed** — subset semantics (`membersCovered`), Set-based, superset-adoption spec added |
| `get()` the only throwing method — breaks uniform fail-soft | Minor | **Fixed** — try/catch → null + warn |
| Migration ticket maps keyed by `t.id` (data field) not `d.id` (path) — contradicts its own path-authoritative comment | Minor | **Fixed** — path id used |
| Merged `rollups`/`origin`/`status` on existing docs could drop `realizedPnl`/richer origin fields | Minor | **Fixed** — existing-scalars preserved on the merge path |
| Audit hand-built `expectedId` instead of `stPositionGroupId`; `OPEN_STATUSES` raw strings | Minor | **Fixed** — builder + shared set |
| Audit "empty shell" comment modeled the wrong orphan (writer always writes declared members) | Nit | **Fixed** — header documents declared-members reality (missing-member FAIL is the detection) |
| `setEq` duplicate-sensitive | Nit | **Fixed** — subsumed by Set-based `membersCovered` |
| `extras.userId` redundant with mapper fallback | Nit | **Accepted** — harmless dual path; caller may supply a resolved uid |
| `stPositionGroupId` lacks symbol-dash guard | Nit | **Accepted** — `#999` contract surface; symbols are uppercase tickers |
| refId back-stamp 1:N-unsafe (a refId shared across cohorts → last group wins) | Nit | **Accepted** — prod data shows 1 refId-ticket per cohort; theoretical edge, documented here |
| Coverage gaps: adoption-read-failure, non-ALREADY_EXISTS create, seq-exhaustion | Nit | **Partial** — subset-adoption spec added; error branches remain covered by fail-soft log paths, not dedicated specs |

## Round 2 — remediation verification pass (2026-10-20)

Post-remediation re-check of the scoped diff: writer refactor (`buildGroupDoc` extraction, `membersCovered`, `get()` guard), callables rebuild rewiring (`createdAt` provenance preserved via `PositionGroupDocFields.createdAt`), migration merge-doc + unchanged fix, shared `LIFECYCLE_OPEN_TRADE_STATUSES` adoption in all three consumers, shared `firestore-utils` now consumed by the shipped #1002 ticket writer (import swap only, behavior identical). No regressions observed; `test:st-order-tickets` confirms the ticket writer refactor is behavior-neutral.

## Round 3 — fresh-eyes re-review of the post-remediation diff (2026-10-20)

Two axes (Standards + adversarial/Spec) on the full scoped change set. One major, several minors — all remediated and re-verified.

| Finding | Severity | Resolution |
|---|---|---|
| **Seq-divergence clobber in migration** — `cohortToGroup` maps by cohort seq and merges/stamps unconditionally; a stranded group (accept died post-create) or unmappable cohort desyncs cohort-seq vs group-seq, so a later `--apply` unions foreign members into the wrong group and overwrites trade stamps | **Major** | **Fixed** — member-trade stamps are authoritative: unanimous stamp retargets the merge to the stamped id; split stamps → `conflicted` + skip; existing-group origin conflict → `conflicted` + skip; a stamp pointing at a different group is never overwritten (warn + leave). Prod dry-run: `conflicted: 0` |
| Mirror can wipe `origin.positionGroupId` — `set(merge:true)` replaces the origin map wholesale on soak rewrites | Minor | **Fixed** — `order-intents-mirror` carries the existing `origin.positionGroupId` forward; spec added |
| Audit has no reverse-direction check — dangling stamps pass silently | Minor | **Fixed** — grp-shaped stamps on trades/tickets are checked for a live group doc + member-list inclusion. Immediately surfaced the mgmt-lineage over-match (below) |
| Audit aborts on a hostile cohort id (`cohort-…-00` → `nn()` throws) | Minor | **Fixed** — per-cohort try around `stPositionGroupId`, `fail()` + continue |
| Rebuild membership unfiltered by `cohortId` — same-signal non-cohort trades (auto-paper ingest) would join the rebuilt group | Minor | **Fixed** — rebuild filters `existing` to `t.cohortId === cohortId` (all accept-created trades carry the stamp); exclusion spec added |
| Stamp-absent retry gap — group create failing soft before any stamp is undetectable on retry | Minor | **Fixed** — comment names `migrate-cohorts-1004.ts` as the healer; fail-soft spec pins the unstamped-accept outcome |
| `chain_id` join is chain-wide, not leg-precise — a caller passing chain ids would join other groups' positions | Minor | **Fixed** — dormant-path comments name the over-match trap; `option_id` documented as the leg-precise join |
| New audit FAILs on mgmt-lineage `origin.positionGroupId` (e.g. `broker-position-SCHB`) — pre-#1004 use of the field, not a group id | — (self-found on first run) | **Fixed** — reverse check scoped to `GROUP_ID_RE`-shaped stamps |
| `grp-\d{2}` regex in verify-564 false-fails on `grp-100+` | Nit | **Fixed** — `\d{2,}` |
| `cohortToGroup` could emit `createdAt: undefined` | Nit | **Fixed** — `?? extras.now` |
| `ticketsById` keyed by data-id vs path-id inconsistency; probe `t.terms` unguarded; brokerOrderId-less option legs excluded from live-join inputs | Nit | **Fixed** — path id keys, `?.` guards, leg-only tickets included |
| `membersCovered` per-element `Set` alloc; empty-want degenerate adoption | Nit | **Fixed** — hoisted `haveSet`; comment documents the empty-members case |
| `cohort.symbol` vs parsed-id symbol drift undetected | Nit | **Fixed** — warning line on mismatch |
| Test gaps: `create`→null accept path; rebuilt-doc content assertion | Minor | **Fixed** — fail-soft spec (unstamped accept, cohort still written) + ensure-doc content spec + cohort-exclusion spec (3 new specs) |
| `ensure()` silent success on a different existing doc | Nit | **Accepted** — no-overwrite restore is the contract; a divergent doc at a known id is exactly the state `ensure` must not clobber |
| YYMMDD derivation duplicated between mapper and audit | Nit | **Accepted** — both derive from `parseCohortId` output; drift surface is one formula |
| refId 1:N stamp flap on rerun | Nit | **Accepted** — the foreign-stamp guard now prevents overwrites entirely (warn + leave), so reruns can no longer flap |
| README/run-all diffs bundle #1052 rows | — | **Noted for ship** — deliberate commit split (same files, different tasks) |

### Round-3 test results

- `test:paper-trading` — **242/242** (+2 specs: fail-soft create, cohort-scoped rebuild)
- `test:st-order-tickets` — **82/82** (+1 spec: mirror origin carry-forward)
- `test:st-position-groups` — **27/27** · `npx tsc --noEmit` clean · `npm run build` clean
- Prod dry-run — 9 created / 27 trades + 9 tickets stamped / `conflicted: 0` / 0 malformed / 0 failed
- Prod audit — 9 expected pre-apply FAILs only; live-join probe now collects 54 live tickets (leg-only tickets included), 7 option leg ids

## Test results

- `npm run test:st-position-groups` — **27/27** (incl. distinct-manual + superset-adoption specs)
- `npm run test:paper-trading` — **240/240** (signal-order group specs green)
- `npm run test:st-order-tickets` — **81/81** (shared-helper refactor behavior-neutral)
- `npm run test:st-signals` — 34/34 · `test:st-run-completion` — 7/7 · `test:sds` — 81/81 · rh-agent-mcp suites — all pass
- `npx tsc --noEmit` — clean · `npm run build` — esbuild clean
- Prod migration dry-run — 9 groups, 27 trades + 9 tickets stamped, 0 malformed/failed
- Prod audit (pre-apply) — 9 expected "no canonical counterpart" FAILs + live-join probe executed (15 real tax lots scanned, 50 live member orders, 0 open-position matches — closed legs)
- `verify-564` live — **22/22 checks**, incl. group mint/retry/member-coverage/stamps + cleanup
- Jest full sweep — 2 failing suites (`screenshot-capture-contracts`, `order.component.spec`) confirmed **pre-existing stale specs** from earlier shipped commits; unrelated to this diff

## Verdict

**PASS** (round 3 confirmed) — all majors remediated and re-verified; accepted findings are documented above and summarized on the QA issue.
