**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1054  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1002  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-16  
**Last Updated:** 2026-10-16  

# UAT — BE-IMPL: st-order-tickets canonical writer + emission wiring (#1002)

## Scope

Canonical `st-order-tickets` emission across the three BE action paths
(dual-write window — legacy `order-intents` and PENDING trades untouched):

- `StOrderTicketWriter` — atomic `emit()` (`create()` + ALREADY_EXISTS no-op),
  deterministic `{liv|pap}_{idSeed}` ids, txn-guarded lifecycle transitions
  (`submitted`/`cancel_pending`/`cancelled`/`filled`/`failed`/`expired`),
  `filled` heals `failed` and beats cancel, terminals can't re-open,
  fail-soft everywhere. `StOrderTicketEmitter` is the shared dep seam.
- Auto-paper ingest — `signal`/`auto:true`/`paper` ticket BEFORE the ledger
  fill, `idSeed = tradeId`, filled/failed on outcome.
- Open-pass — `program`/`auto:true` ticket before the brokerage order,
  mode from the instance config, `idSeed = positionId`, filled/failed on
  outcome; writer hoisted once per timer tick.
- `paperSignalOrder` — equity ticket resolved with its ledger fill + one
  staged ticket per expression template carrying `terms.expressionTemplate`;
  origin `signal` (canonical occurrence id) or `manual` from legacy
  signalContext; `signalContext` omitted when absent.
- `cancelPaperTrade` — `pap_{tradeId}` → `cancelled` post-ledger, fail-soft,
  single timestamp.
- `functions/scripts/verify/data-pipeline-st-order-tickets-1002.ts` —
  read-only shape audit (id↔mode, axes, terms, state↔field coherence;
  `submittedAt` required only for post-submission states and live-mode
  terminals — paper `staged→terminal` is legal).

Acceptance criteria (from #1002 + IMPL Phase 2): all of the above, plus
no live-submit/management emission (deferred to #1003/#1015), no
expression-fill consumption of staged tickets (#1005), no order-intents
migration (#1003), and tests covering emission order, idempotency,
fail-soft, lifecycle transitions, dedupe, and cancellation.

## Prerequisites

- Repo at `C:\aa\projects\rel-str`, node_modules installed.
- S5 requires Application Default Credentials (`gcloud auth
  application-default login`) — the audit is read-only.

## Scenarios

### S1 — Writer spec suite

**Confirms:** emit shape + atomic idempotency, all six transitions,
txn-guarded allowed-from sets, `failed→filled` heal, fill-beats-cancel,
terminal re-open rejection, brokerOrderId/reviewSnapshot/fillSummary/
lastError stamping, and both fail-soft modes (invalid input, write/txn
failure → logged, never thrown).

```
cd functions && npm run test:st-order-tickets
```

**Expected:** 19/19 pass.

**Result:** PASS — 19/19.

### S2 — Paper-trading suite (emission wiring)

**Confirms:** auto-paper emit-before-fill ordering, `idSeed = tradeId`,
filled on dedupe/success, failed on error; open-pass program ticket with
`mode` honored (`pap_` default, `liv_` when the instance carries
`mode: 'live'`), `idSeed = positionId`, failed on brokerage/position
errors, no emit on skip; `paperSignalOrder` equity + per-template staged
tickets with `idSeed` equal to the minted pending trade ids;
`cancelPaperTrade` ticket cancellation.

```
cd functions && npm run test:paper-trading
```

**Expected:** 236/236 pass.

**Result:** PASS — 236/236 (auto-paper 35, open-pass 11 incl. live-mode
spec, signal-order, cancel-paper-trade).

### S3 — ST signals regression

**Confirms:** the writer wiring doesn't break the signal write paths
upstream of auto-paper.

```
cd functions && npm run test:st-signals
```

**Expected:** 34/34 pass.

**Result:** PASS — 34/34.

### S4 — Build + typecheck + functions-tree sweep

**Confirms:** BE compiles through the new `order-tickets/` module and no
regression across the whole `tests/functions` tree.

```
cd functions && npm run build && npx tsc --noEmit -p tsconfig.json
cd functions && npx tsx --test "../tests/functions/**/*.test.ts"
```

**Expected:** esbuild bundle green, `tsc` clean; sweep passes except the
two documented pre-existing `stats-repository.test.ts` failures.

**Result:** PASS — bundle green (`lib\index.js` 1.9mb), typecheck clean;
sweep **1013/1015**, both failures the known pre-existing
cumulative-P&L baseline in `options-strategy-engine/stats-repository.test.ts`
(same failures recorded in the #1000 UAT; untouched by this task).

### S5 — Production shape audit (read-only)

**Confirms:** the audit runs against prod and applies the corrected
`submittedAt` contract (post-submission states + live terminals require
it; paper `staged→terminal` does not).

```
cd functions && npx tsx scripts/verify/data-pipeline-st-order-tickets-1002.ts
```

**Expected (pre-deploy):** `st-order-tickets` is empty — AUDIT PASS with
0 docs; it starts auditing real tickets after the next functions deploy.

**Result:** PASS — `0 doc(s)`, `0 FAIL / 0 WARN`, AUDIT PASS.

### S6 — Scope check

**Confirms:** no order-intents migration, reader cutover, FE writes, or
expression-fill rewiring crept into the diff; legacy paths operational.

```
git status --short && git diff --stat
```

**Expected:** changes confined to `order-tickets/` writer, the three
emit-path files + timer, `callables.ts`, the verify script, tests, and
`package.json` script entries. (`order-intents` writes unchanged —
#1003; PENDING trades still minted — #1005.)

**Result:** PASS — diff is confined to the listed files; unrelated
working-tree edits (Angular gallery/chain, design-system docs, MCP
files) are a separate workstream and not part of this task.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| `emit()` deterministic `{liv|pap}_{idSeed}`, atomic, idempotent | S1 |
| Lifecycle transitions txn-guarded + lifecycle fields stamped | S1 |
| `failed→filled` heal; fill beats cancel; terminals closed | S1 |
| Auto-paper `signal`/`auto`/`paper` ticket before fill, outcome-marked | S2 |
| Open-pass `program`/`auto` ticket, mode from instance, outcome-marked | S2 |
| `paperSignalOrder` staged tickets + `cancelPaperTrade` cancellation | S2 |
| Legacy `order-intents` + PENDING trades preserved (dual-write window) | S2, S6 |
| Fail-soft everywhere (canonical writes never break the legacy path) | S1, S2 |
| Read-only prod audit delivered + consistent with emitted shapes | S5 |
| No live-submit/management/cutover scope creep | S6 |

## Refinement pass

Not applicable — no user-facing surface (backend writer + audit script).

## Findings

None blocking. Accepted residuals carried as documented watch items:

- `refId` is shared across the tickets minted by one `paperSignalOrder`
  call — harmless for paper; revisit when #1015 wires live submission.
- Staged expression tickets are inert until #1005 rewires expression-fill
  to consume them (PENDING trades remain the live mechanism meanwhile).
- Open-pass live `accountTarget` resolves from `paperAccountId` — moot
  until #1006 migrates `st-strategy-instances` docs carrying `mode`.
- Pre-#1002 trades never get tickets — by design (fail-soft forward-only
  emission; not a backfill).
