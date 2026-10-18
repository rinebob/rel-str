**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1070  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1004  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — BE-IMPL: st-position-groups (#1004)

## Scope

Canonical position-group lifecycle for paper accepts, cohort backfill,
and the live-position join:

- `StPositionGroupWriter` — `create()` allocates `{SYM}-{YYMMDD}-grp-{NN}`
  via `create()`+ALREADY_EXISTS; adoption on same-origin + member-id
  subset coverage (retried accept) vs seq advance (distinct group);
  `ensure()` restores a missing known-id doc without overwriting;
  `addMembers()` txn union; `get()` — all fail-soft.
- `handlePaperSignalOrder` — group minted **before** member ticket emits;
  `origin.positionGroupId` on every `pap_{tradeId}` ticket;
  `positionGroupId` on equity + pending trade dims; `positionGroupId` in
  the callable response; retry path returns the stored id and restores a
  missing group (cohort-scoped members, derived rollups/status).
- `legacy-cohorts.ts` mapper — `cohort-{YYMMDD}-{SYM}-{NN}` → group;
  `origin.signalId` via member-ticket lineage; `userId`/rollups/status
  from member trades.
- `migrate-cohorts-1004.ts` — dry-run default; stamp-aware target
  resolution (unanimous member-trade stamp wins over cohort-derived id;
  split stamps / foreign-origin → `conflicted` skip); merge-safe unions;
  `updatedAt`-insensitive idempotency; trade/ticket back-stamps never
  overwrite foreign stamps.
- `live-position-join.ts` — pure join: `tax_lots[].order_id ∈
  brokerOrderIds`; `option_id` (leg-precise) / `chain_id` (chain-wide —
  documented trap) vs member leg identities.
- `order-intents-mirror.ts` — carries `origin.positionGroupId` forward
  through soak rewrites (merge:true would otherwise wipe it).
- `data-pipeline-st-position-groups-1004.ts` — canonical shape audit +
  cohort⇄group parity + bidirectional stamps (incl. reverse-direction
  dangling-stamp check, grp-shaped values only) + real-data RH live-join
  probe.

Acceptance criteria (from #1004): accept creates
`{SYM}-{YYMMDD}-grp-{NN}` with tickets/trades stamped; 9 cohorts migrated
with memberTradeIds carried; live join via `tax_lots.order_id` /
`option_id`-`chain_id`. Blocker #1002 shipped.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, `functions/node_modules` installed.
- ADC (`gcloud auth application-default login`) for prod reads/writes.
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`.
- S6/S7 additionally need a live-run-free window — run when no PDR/ST/
  nightly pipeline is in flight so `--apply` doesn't race an active write.
- S5 needs `firebase deploy` permission on the rel-str project.

## Scenarios

### S1 — Spec suites

**Confirms:** writer seq-allocation/adoption/ensure/addMembers
(incl. distinct-manual-accept and superset-adoption cases); live-join
matching + diagnostics; cohort→group mapper edge cases; accept-path
group mint/stamps/retry/fail-soft; mirror `origin.positionGroupId`
carry-forward.

```
cd functions && npm run test:st-position-groups
cd functions && npx tsx --test ../tests/functions/paper-trading/signal-order.test.ts
cd functions && npm run test:st-order-tickets
```

**Expected:** 27/27, 25/25, 82/82.

**Result:** PASS — 27/27 + 25/25 + 82/82 (2026-10-20, post-round-3).

### S2 — Build + typecheck + paper-trading sweep

**Confirms:** callables/ledger/mirror changes compile; all 242
paper-trading specs still pass.

```
cd functions && npx tsc --noEmit -p tsconfig.json && npm run build && npm run test:paper-trading
```

**Expected:** tsc clean, esbuild bundle green, 242/242.

**Result:** PASS — tsc clean, `lib\index.js` ~1.9mb, 242/242.

### S3 — Migration dry-run (prod, read-only)

**Confirms:** 9 cohorts map to groups; member-trade join resolves
userId/rollups; refId join resolves member tickets + canonical
signalId; zero conflicts in current prod data.

```
cd functions && npx tsx scripts/migrate-cohorts-1004.ts
```

**Expected:** `created: 9`, `tradesStamped: 27`, `ticketsStamped: 9`,
`malformed/failed/conflicted: 0`.

**Result:** PASS — exact expected counts, `conflicted: 0` (2026-10-20).

### S4 — Pre-apply audit (prod, read-only)

**Confirms:** the audit executes and correctly reports the pre-migration
state — every legacy cohort FAILs "no canonical counterpart"; the
live-join probe reaches real RH data.

```
cd functions && npx tsx scripts/verify/data-pipeline-st-position-groups-1004.ts
```

**Expected (pre-apply):** exit 1, 9 FAILs all `no canonical counterpart`;
live-join probe logs fetched lots/positions; reverse-direction check
finds no grp-shaped dangling stamps (mgmt-lineage values like
`broker-position-SCHB` are correctly skipped).

**Result:** PASS — 9 expected FAILs, 0 WARN; probe fetched 15 tax lots /
0 option positions for 54 live tickets (7 leg ids), 50 unmatched member
orders all closed/unfilled legs (2026-10-20).

### S5 — Deploy functions (prod — needs operator window)

**Confirms:** the deployed runtime carries the group-mint accept path and
the mirror carry-forward fix.

Steps (operator):

```
cd functions && firebase deploy --only functions
```

**Expected:** deploy completes; `paperSignalOrder` and
`orderIntentsMirror` redeploy (no Eventarc issue expected — the mirror
trigger exists since #1003).

**Result:** PASS — deployed 2026-10-20 (all functions including
`paperSignalOrder` + `orderIntentsMirror` "Successful update operation";
one transient 429 quota retry on `stGetSymbolSignalHistory` recovered
cleanly).

### S6 — verify-564 live accept probe (prod writes, self-cleaning)

**Confirms:** end-to-end accept mints a group before ticket emission;
member tickets + trades stamped; retry returns the same id; cleanup
removes ticket, trades, cohort, AND the group doc.

```
cd functions && npx tsx scripts/verify/paper-trading-signal-order-564.ts
```

**Expected:** all checks OK incl. group assertions
(`QQQM-…-grp-01`-shaped id, retry-stable, member coverage); cleanup
leaves no canonical orphans.

**Result:** PASS — 22/22 checks (2026-10-20): `QQQM-261017-grp-01`
minted, retry returned the same id, group covers all member trades +
`pap_` tickets, trades + ticket origins stamped, no broker mutation
calls, cleanup removed all verification docs (incl. the group). The
`Bucket name not specified` lifecycle-capture warn is the documented
local-ADC limitation (storage bucket only resolves in the deployed
runtime; fail-soft, trade path unaffected).

### S7 — Migration `--apply` + post-apply audit (prod writes)

**Confirms:** the real backfill lands, is idempotent, and post-state
audits clean.

Steps (operator, outside live-run windows):

```
cd functions && npx tsx scripts/migrate-cohorts-1004.ts --apply
cd functions && npx tsx scripts/migrate-cohorts-1004.ts          # rerun → all 'unchanged'
cd functions && npx tsx scripts/verify/data-pipeline-st-position-groups-1004.ts
```

**Expected:** `--apply` → `created: 9`, 27 trades + 9 tickets stamped,
0 malformed/failed/conflicted; rerun → `unchanged: 9`, zero
creates/updates/stamps; audit exits 0 (0 FAIL; WARNs allowed only for
documented classes — unresolved signalIds, empty shells, stale rollups).

**Result:** PASS — `--apply` (2026-10-20): `created:9 updated:0
unchanged:0 malformed:0 failed:0 conflicted:0 tradesStamped:27
ticketsStamped:9`. Idempotent rerun: `unchanged:9`, zero
creates/updates/stamps. Post-apply audit: `9 groups / 9 cohorts audited:
0 FAIL, 0 WARN`, AUDIT PASS — every migrated group resolved its
canonical `origin.signalId` via the member-ticket join.

### S8 — Console spot check (post-apply)

**Confirms:** migrated docs match the canonical contract on inspection.

Spot-check 2–3 `st-position-groups` docs in the Firestore console:
`{SYM}-{YYMMDD}-grp-{NN}` id, `origin.type:'signal'` + occurrence
`signalId`, `memberTradeIds`/`memberTicketIds`/`brokerOrderIds` arrays,
`rollups`, `status`, `userId`. And one stamped member trade
(`positionGroupId`) + member ticket (`origin.positionGroupId`).

**Expected:** docs match the contract; member ids resolve.

**Result:** PASS — programmatic spot check (2026-10-20). Sampled
`AAMI-260930-grp-01` / `ADPT-260927-grp-01` / `ARM-261005-grp-01`:
canonical ids, `origin{type:'signal', signalId: canonical occurrence id}`,
`memberTradeIds` = full cohort set, `memberTicketIds` = the migrated
`pap_{intentId}` order ticket (pre-#1002 cohorts have no `pap_{tradeId}`
lifecycle tickets — correct), `userId` resolved from member trades,
`rollups` consistent, `createdAt` = cohort `acceptedAt` provenance.
Back-stamps bidirectional: trade `260930-sig-AAMI-EQ` →
`positionGroupId:'AAMI-260930-grp-01'`; ticket
`pap_AAMI-BUY-260930-WED-1640PT` → `origin.positionGroupId` matching.

### S9 — Regression/smoke checklist

| Check | Result |
|---|---|
| `test:st-signals` still passes | PASS — 34/34 |
| `test:st-run-completion` still passes | PASS — 7/7 |
| `test:sds` still passes | PASS — 81/81 |
| Legacy cohort write still occurs on accept | covered — dual-write preserved; verify-564 asserts cohort doc |
| #1003 mirror unaffected by carry-forward change | covered — 82/82 ticket specs incl. new carry-forward spec |
| No new deploy/runtime errors | PASS — deploy clean; 429 quota retry recovered |

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| Accept creates `{SYM}-{YYMMDD}-grp-{NN}`; tickets/trades stamped | S1 (specs) + S6 (live accept probe) |
| 9 cohorts migrated; memberTradeIds carried | S1 (mapper specs) + S3 (dry-run) + S7 (apply + audit) + S8 |
| Live join via tax_lots.order_id / option_id-chain_id | S1 (join specs) + S4/S7 (real-data probe in audit) |
| Idempotent accept retries / migration reruns | S1 + S6 (retry stable) + S7 (rerun → unchanged) |
| Soak integrity — legacy cohort write preserved, no legacy breakage | S1 + S9 |
| No corruption on diverged state (stranded groups, foreign stamps) | S1 (writer/migration specs) + S7 (`conflicted` count) |

## Residuals / known limitations (accepted in review)

- Live-group attachment has no production caller yet — `addMembers` is
  the API surface for it; live accepts don't exist in the system. The
  live-join helpers + real-data probe deliver the AC3 mechanism.
- Stamp-absent retry case (group create failed soft before any trade
  stamp) is healed by `migrate-cohorts-1004.ts`, not the retry path —
  documented in `callables.ts`.
- A rebuilt group may reference a `pap_{tradeId}` ticket a fail-softed
  emit never wrote — the audit's missing-member FAIL is the detection.
- refId shared across cohorts: tickets now warn + keep foreign stamps
  rather than flapping per rerun.
