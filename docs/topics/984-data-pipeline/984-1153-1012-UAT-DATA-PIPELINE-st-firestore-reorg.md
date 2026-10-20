**Topic:** ST Firestore Reorg  
**Topic Slug:** st-firestore-reorg  
**Thread:** Data Plane Consolidation  
**Thread Slug:** data-plane-consolidation  
**Issue:** #1153  
**Thread Parent:** #985  
**Topic Parent:** #984  
**Task:** #1012  
**Domain:** DATA-PIPELINE  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-20  
**Last Updated:** 2026-10-20  

# UAT — #1012 firestore rules + indexes for st-* paths

## Scope

Security rules for all 13 canonical `st-*` roots and composite indexes for
st-signals / st-order-tickets / trades-items / st-position-groups /
st-symbols / st-symbol-lists / st-backtest-permutations. Acceptance is
file-level coverage + live rule enforcement in the Firestore emulator.

## Prerequisites

- Repo checkout at rel-str root; `functions/node_modules` installed.
- Firebase CLI on PATH; `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs`.
- No GCP credentials needed — all checks are local (spec + emulator).

## Scenarios

### S1 — Content spec green

Run `cd functions && npx tsx --test ../tests/functions/firestore-rules-indexes-1012.test.ts`
(or `npm run test:st-rules-indexes`).

Expected: 13/13 pass — every canonical root has a match block, policy
shapes verified, default-deny is last, all 17 new indexes present with
exact field ordering/direction/arrayConfig.

### S2 — Rules file compiles

Run `firebase emulators:exec --only firestore --project demo-rel-str "echo ok"`.

Expected: emulator starts cleanly; no rules parse errors in output.

### S3 — Live rule enforcement matrix

Start the firestore + auth emulators (`firebase emulators:start --only
auth,firestore --project demo-rel-str`, or reuse a running firestore
emulator + start only auth), then run the probe:

`FIRESTORE_EMULATOR_HOST=127.0.0.1:8088 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9100 GCLOUD_PROJECT=demo-rel-str node .devin/tmp/qa-rules-1012.mjs`

(The probe script is a QA artifact in `.devin/tmp/` — it seeds fixtures via
admin SDK and exercises every rule block as unauthed / authed-A /
cross-user-B. If the file is gone after a tmp cleanup, recreate it from
this session's history — the scenario list below mirrors its assertions.)

Expected — all 37 probes pass:

| Probe group | Expected |
|---|---|
| unauthed read st-signals / st-order-tickets | denied |
| authed read st-signals, st-runs (+jobs), st-paper-trading items | allowed |
| authed write st-signals / st-runs job / st-paper-trading item+nested sub | denied |
| cross-user ticket read/update/delete | denied |
| own ticket create/update; create with foreign userId | allowed / denied |
| st-config/status + autoPaper read | allowed; write denied |
| st-config/{uid} cross-user read | denied; own read/update allowed |
| bare (no-userId) symbol-list read + delete | allowed (legacy rekey escape) |
| st-position-groups own read / any write | allowed / denied |
| st-backtest-runs archive+updatedAt update | allowed; other-field edit denied |
| st-portfolio missing-doc get probe | allowed (transaction-probe pattern) |
| st-portfolio bogus anchor create | denied |
| uncovered root read | denied (default deny) |

### S4 — Index JSON integrity

`firestore.indexes.json` parses as JSON; zero duplicate
(collectionGroup, scope, fields) entries; `st-*` index set =
15 entries + 2 new `items` entries.

## Traceability

| Criterion | Scenario |
|---|---|
| Rules cover all new st- collections | S1 (coverage test) + S3 (live matrix) |
| Indexes: st-signals (marketDate,status); tickets (mode,state,origin); trades (positionGroupId,contract) | S1 (index assertions) + S4 |
| Compile/deploy safety | S2 |
| Legacy policy parity (no mid-soak drift) | S3 cross-user/deny probes |

## Regression

- Legacy `savant-trader/data/*` rules untouched — same soak-window policy.
- Existing `items`-group indexes unchanged (new entries append only).
- `test:st-rules-indexes` joins the functions test suite registration.

## Results log

| Scenario | Result | Evidence |
|---|---|---|
| S1 spec | PASS | 13/13 `test:st-rules-indexes` |
| S2 compile | PASS | emulator booted clean, rules parsed |
| S3 enforcement | PASS | 37/37 live probes vs emulator |
| S4 index JSON | PASS | 52 total entries, 0 dupes, parses |
| Regression | PASS | no legacy rules touched; diff additive-only |

**Result: PASS — ship-eligible.**
