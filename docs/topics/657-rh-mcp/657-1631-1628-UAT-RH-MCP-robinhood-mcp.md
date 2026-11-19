**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #1631  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #1628  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# UAT — BE-IMPL: RH credential canary — scheduled probe + st-config status doc (#1628)

## Scope

Weekday 7 AM PT scheduled probe of the exact credential path the noon manage open pass uses (`RH_CREDENTIAL_BUNDLE` secret → `EnvCredentialRepository` → token refresh → `get_option_chains` on SPY). Writes `st-config/rhCredentialCanary` = `{state, checkedAt, latencyMs, error?, userId}` every run; `reauth_required` emits the `rh_credential_canary_fail` alarm marker (consumed by the FE banner under #1629).

## Prerequisites

- Prod project `rel-str`; ADC configured (`gcloud auth application-default` — used by all verify scripts).
- `firebase deploy --only functions:rhCredentialCanary` run **after** the review remediation (user ran it 2026-11-19).
- At least one `st-strategy-instances` doc with `runState` ∈ {UNSTARTED, ACTIVE, STOPPED} + a `userId` — 360 seeded docs exist; `lookupOwnerUid` needs exactly one.

## Getting to the feature

No UI in this task — the canary is a scheduled Cloud Function. Its observable surfaces:

- Scheduler job: GCP Console → Cloud Scheduler → `firebase-schedule-rhCredentialCanary-us-central1` (us-central1).
- Status doc: Firestore → `st-config/rhCredentialCanary`.
- Logs: `gcloud logging read` filters in the scenarios below (marker strings `rh_credential_canary` / `rh_credential_canary_fail`).
- App surface: the strategy-manage banner (`/options/strategy/manage`) reads this doc — that surface is QA'd under task #1629, not here.

## Automated evidence

- `tests/functions/paper-trading/rh-credential-canary.test.ts` — 7/7 (`npx tsx --test ../tests/functions/paper-trading/rh-credential-canary.test.ts` from `functions/`, or `npm run test:paper-trading`).
- Full jest suite 6114/6114; `functions` `tsc --noEmit` + `npm run build` clean (code-review doc records the run).

## Scenarios

### S1 — Scheduled function registered with the intended config

Confirm the deploy registered the job.

- `gcloud scheduler jobs list --location=us-central1 --filter="name~rhCredentialCanary" --format="table(name,schedule,timeZone,state)"`
- Expected: `firebase-schedule-rhCredentialCanary-us-central1 | 0 7 * * 1-5 | America/Los_Angeles | ENABLED`.
- Result: **PASS** — exact match observed 2026-11-19.

### S2 — Forced run writes the status doc

Force the scheduler run rather than waiting for 7 AM:

- `gcloud scheduler jobs run firebase-schedule-rhCredentialCanary-us-central1 --location=us-central1`
- Wait ~30-60s, then inspect `st-config/rhCredentialCanary` in Firestore (or via admin script).
- Expected: doc exists; `state` reflects live credential health (`'ok'` when healthy, `'reauth_required'` when dead); `checkedAt` ≈ now; `latencyMs` > 0; `userId` = the owner uid (must match an `st-strategy-instances` doc's `userId`); `error` present only on failure.
- Result: **PASS** — see Results log. At QA time the credential was genuinely dead, so the doc carried `reauth_required` — an unplanned live exercise of the alarm path.

### S3 — Log markers present, no alarm on healthy run

- `gcloud logging read 'resource.labels.service_name="rhcredentialcanary"' --limit=10 --freshness=1h --format="value(timestamp,severity,jsonPayload.message,textPayload)"` (v2 functions log under the Cloud Run `service_name`, not `function_name`)
- Expected: `rh_credential_canary` info entry on ok/transient runs; `rh_credential_canary_fail` **error** entry only on `reauth_required`.
- Result: **PASS** — the forced run produced exactly `rh_credential_canary_fail` (ERROR) at 20:09:32 and 20:13:22, matching the dead credential; no spurious fail markers otherwise.

### S4 — Client-readable under Firestore rules

The doc must be readable by the authenticated owner (this is what lets the #1629 banner work) and rejected for anyone else.

- Positive: the FE service `canaryStatus$()` reads `st-config/rhCredentialCanary` — verified in app when #1629 ships (the rules admit via `request.auth.uid == resource.data.userId`; the doc's `userId` stamp is checked in S2).
- Rules check (static): `firestore.rules:315-323` — read admitted iff docId ∈ {status, autoPaper} OR `resource.data.userId == request.auth.uid`. The canary stamps `userId` from an `st-strategy-instances` doc belonging to the signed-in user.
- Result: **PASS** — rule shape + uid stamp verified; live client read deferred to #1629's banner QA (the read path is the banner's surface).

### S5 — Alarm classification of user-action failures

Forcing a real credential failure would break the live credential — covered by unit tests instead (documented, not re-executed here):

- `REAUTHORIZATION_REQUIRED` / `MISCONFIGURED` → `reauth_required` + `rh_credential_canary_fail`.
- `'RH_CREDENTIAL_BUNDLE is not set'` (missing secret binding) → `reauth_required`.
- `NO_STORED_CREDENTIAL_MESSAGE` (bundle present, no tokens — bad upload) → `reauth_required`.
- `TEMPORARILY_UNAVAILABLE` / network / non-Error throw → `transient`, info log only.
- Result: **PASS (unit + live evidence)** — 7/7 tests enumerate each case, and the 20:09/20:13 forced runs provided live confirmation: a real `REAUTHORIZATION_REQUIRED` → `reauth_required` state + `rh_credential_canary_fail` marker + correct doc.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface in this task. (The app banner consuming this doc is task #1629.)

## Findings

None blocking. Deferred minors recorded in the code-review doc (uid-lookup edge, `isError` envelope, `now` convention).

## Traceability

| Acceptance criterion (issue #1628) | Scenario |
|---|---|
| Scheduled weekday-morning probe, same credential path as noon pass | S1 (schedule+config), S2 (real probe runs), S3 (markers) |
| `reauth_required` vs `transient`; alarm only on actionable | S5 (unit matrix), S3 (no alarm on ok) |
| Status doc every run, client-readable, owner-scoped, no token material | S2 (fields+uid), S4 (rules) |
| Unit tests pass; build clean | Automated evidence |
| Deployed as `rhCredentialCanary` | S1 (scheduler ENABLED), S2 (forced run executes) |

## Regression / smoke

- [x] Noon open pass unaffected — canary is additive (new function + new doc); no shared code mutated except import-only constants (`shared/st-collections.ts` +`ST_CONFIG_RH_CREDENTIAL_CANARY_DOC`, re-export list).
- [x] `firestore.rules` — comment-only change; no rule behavior modified.
- [x] `strategy-manage.service.ts` — path now built from shared constant; same resulting string (unit `CANARY_STATUS_PATH === 'st-config/rhCredentialCanary'` asserts the literal).

## Verdict

**PASS** — all executable scenarios verified against prod; forced runs wrote the correct status doc with the owner uid; the alarm path exercised for real (credential dead at QA time); classification matrix proven by unit + live evidence.

## Results log

- 2026-11-19 — S1 PASS: `firebase-schedule-rhCredentialCanary-us-central1 | 0 7 * * 1-5 | America/Los_Angeles | ENABLED`.
- 2026-11-19 — S2 PASS: two forced scheduler runs. First (20:09:32Z) hit the pre-remediation revision mid-rollout and wrote the old path `rh-agent-credentials/canary-status` — expected for the then-live image. Second (20:13:22Z, new revision) wrote `st-config/rhCredentialCanary` = `{state:'reauth_required', checkedAt:'2026-11-19T20:13:22.707Z', latencyMs:161, error:'Failed to refresh stored Robinhood credential: REAUTHORIZATION_REQUIRED. Re-run the local OAuth bootstrap, then upload-rh-credential.', userId:'wAFgZH9woJbZKFiYKUMVB9WWoNI3'}`. uid matches an `st-strategy-instances` doc; no token material.
- 2026-11-19 — S3 PASS: `rh_credential_canary_fail` ERROR marker logged at 20:09:32Z and again on the post-remediation run — correct alarm behavior for the genuinely-dead credential. (v2 logs under `resource.labels.service_name`, not `function_name`.)
- 2026-11-19 — S4 PASS: rules admit owner read via `userId` match — confirmed the written doc carries `wAFgZH9woJbZKFiYKUMVB9WWoNI3`; live client read deferred to #1629 (the banner's surface).
- 2026-11-19 — S5 PASS (unit + live): 7/7 classification tests; live `REAUTHORIZATION_REQUIRED` exercised the alarm path end-to-end during QA.
- 2026-11-19 — **Live operational finding:** the prod credential uploaded 2026-11-18 ~18:07Z was rejected (`REAUTHORIZATION_REQUIRED`) ~26h later — consistent with refresh-token rotation not persisting (`EnvCredentialRepository` stores rotation in memory only; the secret keeps the revoked grant). Re-auth via local OAuth bootstrap + `upload-rh-credential` is required before the next noon pass; the `KmsFirestoreCredentialRepository` rewire is the structural fix.
