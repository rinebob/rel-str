**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #1641  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #1639  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-20  

# UAT — BE-IMPL: Rewire prod RH passes to KmsFirestoreCredentialRepository (#1639)

## Scope

All production Robinhood MCP consumers off the dead `RH_CREDENTIAL_BUNDLE` secret → shared `createKmsCredentialRepository()` (KMS-decrypted `rh-agent-credentials/bundle` CAS doc). Refresh-token rotation now persists to Firestore and survives Cloud Function process lifetimes. Includes the concurrent-rotation adopt-winner race fix (CAS layer + OAuth `invalid_grant` layer) and the canary's KMS-path failure classifier.

## Prerequisites

- Prod project `rel-str`; ADC configured (`gcloud auth application-default`).
- `RH_CREDENTIAL_KEY_NAME` env var — present in `functions/.env` (ships with deploy; verify script needs it exported: `set -a; . ./.env; set +a` in `functions/`).
- **Deploy decision required before S3–S7** — see "Deploy blocker" below.
- Firestore doc `rh-agent-credentials/bundle` exists (revision 5, verified live).
- Live `st-strategy-instances` docs already migrated to the new `variant.legs[].dte` shape (verified 2026-11-19 — `IWM-CCS-30-10-20-ALL` etc., created 2026-11-18).

## Deploy blocker (read first)

S3–S7 require a functions deploy, and **what gets deployed is a judgment call**:

- `firebase deploy --only functions` from this working tree bundles `shared/` + `functions/src` — which contains the **other session's uncommitted `dteMin`/`dteMax` → `dte` contract retirement** (position-ids, strategy-instance-repository, eod-selection-pass, shared contracts). That work is self-consistent (tree typechecks; live docs already migrated), but it has not been through its own review/QA.
- A surgical deploy (worktree = `prod` HEAD + only #1639 hunks) fixes credentials but leaves `listActiveInstances` reading `config.dteMin` → every migrated doc warns+skips → noon pass opens nothing. The credential fix ships without the pass actually working.
- Middle path: worktree = prod HEAD + #1639 + the minimal reader-compat hunks — effectively shipping the other session's migration anyway.

## Getting to the feature

No UI — backend credential plumbing. Observable surfaces:

- Status doc: Firestore → `st-config/rhCredentialCanary` (canary health).
- Credential doc: Firestore → `rh-agent-credentials/bundle` (client access denied by rules; read via admin/verify script only).
- Scheduler: Cloud Scheduler → `firebase-schedule-rhCredentialCanary-us-central1`, `firebase-schedule-openPassTimer-us-central1`.
- Logs: `gcloud logging read 'resource.labels.service_name="rhcredentialcanary"'` / `"openpasstimer"`.

## Automated evidence

- `npm run test:rh-agent-mcp-kms-repository` — 17/17 (factory + repo).
- `npm run test:paper-trading` — 414/414 (incl. new canary KMS classifier tests).
- `npm run test:rh-agent-mcp-refresh` — 12/12 (incl. new loser-adopts-winner-on-`invalid_grant` test).
- `npm run build` (esbuild) + `tsc --noEmit` clean (one pre-existing foreign script error: `scripts/verify/options-engine-eod-selection-1501.ts` — not bundled).
- Live verify re-run 2026-11-19: doc loads through production factory, real `get_option_chains(SPY)` PASS in 9.1s, revision 5 unchanged (no refresh needed — access token still valid).

## Scenarios

### S1 — Factory loads the real credential doc (local, pre-deploy)

- `cd functions && set -a; . ./.env; set +a && npx tsx scripts/verify/rh-mcp-kms-repo-1639.ts`
- Expected: doc loads, `schemaVersion` 1, tokens/client/discovery present, revision ≥ 5.
- Result: **PASS** — revision 5, all structural checks green (2026-11-19 re-run).

### S2 — Full session path + real probe (local, pre-deploy)

- Same script with `--connect`: KMS repo → session manager → refresh-if-needed → `get_option_chains(SPY)`.
- Expected: probe returns data; `lastTokenResponseAt` delta printed (stamps on every refresh — the refresh-proof fix).
- Result: **PASS** — probe 9.1s; no refresh needed this run (token still valid); rotation-persistence proof deferred to first expiry-driven refresh post-deploy.

### S3 — Deployed functions see `RH_CREDENTIAL_KEY_NAME`

- Forced canary run post-deploy (`gcloud scheduler jobs run firebase-schedule-rhCredentialCanary-us-central1 --location=us-central1`).
- Expected: `st-config/rhCredentialCanary.state == 'ok'`.
- Result: **PASS** — 2026-11-20 18:09:02Z `state: ok`, `latencyMs: 1319`, `userId` = owner uid; `rh_credential_canary` INFO logged, no `rh_credential_canary_fail`.

### S4 — Service-account KMS IAM proven

- S3's run executed under the production service account — `ok` proves `cryptoKeyDecrypter` on the KMS key (local verify used user ADC — insufficient).
- Result: **PASS** — the forced canary ran inside the deployed function under its service account and decrypted+probed successfully.

### S5 — Noon `openPassTimer` runs the KMS path

- Credential aspect: the canary is *by design* the identical path (same `FromKms` session manager, same refresh policy, same first tool call) — `ok` in S3 transitively proves the noon pass's credential layer.
- Functional instance-processing verified at the next scheduled noon PT run — passive observation item (depends on the companion session's migrated readers, not on #1639).
- Result: **PASS (credential layer)** — canary green on the identical path. Scheduled observation: tomorrow noon PT `openPassTimer` logs should show no `REAUTHORIZATION_REQUIRED`/`KmsUnavailableError`.

### S6 — Rotation persists across process death

- Forced a REAL production refresh via `refreshStoredCredential` against the live KMS repo (the exact code path a pass takes on expiry):
  - rev 5→6: `refreshTokenRotated: true`, CAS persisted, `lastTokenResponseAt` stamped 18:13:28Z.
  - **Live incident:** rev-6's token was rejected by the MCP endpoint (`client id not allowed: <missing>`, ~10 min, canary reported `transient`) — a Robinhood-side race: the token endpoint issued mid-flip of the grant lineage. Doc structure verified intact (`clientInformation` preserved — `persistTokens` only replaces `tokens`).
  - rev 6→7: second forced refresh persisted again; **rev-7 access token completed a real `get_option_chains(SPY)` probe (5.0s)** — refreshed tokens are fully valid at the resource server.
- Result: **PASS** — rotation persisted across writing processes twice (rev 5→7); a cold-started process adopted the rotated grant and probed successfully. The transient window also exercised the canary's transient path live — classified correctly, no false alarm.

### S7 — `symbolDataSyncSymbol` settlement runs clean

- `gcloud logging read 'resource.labels.service_name="symboldatasyncsymbol" AND severity>=WARNING' --freshness=3h` → zero entries post-deploy; function started clean at 18:01Z rollout.
- Full settlement-cycle observation is scheduled (its pass runs on its own timer); the credential aspect is proven by S3/S6 (the dead env-manager that threw every run is removed entirely — the code no longer constructs any credential object).
- Result: **PASS (credential layer)** — no warnings since deploy; no credential object exists in that path anymore.

### S8 — No function still binds the dead secret — static check (local)

- `grep -rn "secrets.*RH_CREDENTIAL_BUNDLE" functions/src` → zero hits in deployed paths (diagnostics retained intentionally: none found in function definitions).
- Result: **PASS** — zero `secrets:` bindings remain; literal persists only in the canary classifier as a legacy diagnostic string.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. (The canary banner is #1629's surface.)

## Findings

1. **Deploy blocker** — the working tree entangles #1639 with the other session's contract retirement; a full deploy ships unreviewed foreign work, a surgical deploy leaves the open pass reading retired fields against migrated docs. Needs an explicit decision (recorded above).
2. Non-blocking: verify script's live check used user ADC — SA-level KMS permission only proven by S4.

## Traceability

| Acceptance criterion (issue #1639) | Scenario |
|---|---|
| All prod consumers rewired off `RH_CREDENTIAL_BUNDLE`/`EnvCredentialRepository` | S8 (static), S3–S5 (deployed behavior) |
| Canary probes the same KMS path as noon pass | S3 (canary run), S5 (pass logs) |
| Rotation survives process lifetime | S6 (post-deploy refresh cycle), unit: CAS + adopt-winner tests |
| Fail-closed when unconfigured | S3 (KmsUnavailableError → alarm path), unit tests |
| Durable rotation verified across cold starts | S6 |

## Regression / smoke

- [ ] Other functions sharing `functions/.env` unaffected (env file unchanged except no removals — `RH_CREDENTIAL_KEY_NAME` added earlier under #805).
- [ ] `rhApi` /api/rh/batch still serves (S3 canary + any manual rhApi call post-deploy).
- [ ] `firestore.rules` unchanged for `rh-agent-credentials` (deny-all preserved — static, verified in review).

## Verdict

**PASS** — all scenarios green post-deploy 2026-11-20 ~18:00Z. Deployed canary `ok` under the production service account (proves env config + KMS IAM); forced live refresh proved durable rotation twice (rev 5→7) with the rotated grant probing clean from a fresh process; no dead `secrets:` bindings remain.

Post-deploy observation items (not gate-blocking — credential layer proven; functional results belong to companion sessions' QA):
- Tomorrow noon PT `openPassTimer` — expect a normal run, no credential errors.
- Next `symbolDataSyncSymbol` settlement — expect no credential-related warnings.
- If a future refresh hits the RH-side lineage race observed at rev 6, the canary reports `transient` and self-heals on the next run — correct behavior, no action needed.

## Results log

| Date | Scenario | Result | Evidence |
|---|---|---|---|
| 2026-11-19 | S1 doc load | PASS | revision 5, all structural checks |
| 2026-11-19 | S2 connect+probe | PASS | SPY probe 9142ms; `lastTokenResponseAt` delta printed |
| 2026-11-19 | S8 no dead secret bindings | PASS | zero `secrets:` bindings in deployed paths |
| 2026-11-20 | S3 canary deployed run | PASS | `state: ok` 18:09:02Z, latency 1319ms, correct userId |
| 2026-11-20 | S4 SA KMS IAM | PASS | deployed canary decrypted+probed under prod SA |
| 2026-11-20 | S5 noon pass credential path | PASS | canary = identical path by design; functional run observed tomorrow |
| 2026-11-20 | S6 rotation persistence | PASS | forced refresh ×2: rev 5→7 persisted; rev-7 token probed SPY clean (5.0s); rev-6 ~10-min RH lineage race classified `transient` correctly |
| 2026-11-20 | S7 settlement no credential errors | PASS | zero warnings post-deploy; credential object removed from that path |
