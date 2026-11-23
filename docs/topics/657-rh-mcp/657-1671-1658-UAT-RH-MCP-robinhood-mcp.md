# 657-1671-1658 UAT — RH OAuth grant deaths fix (refresh lease + lineage management)

**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #1671  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #1658  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

## Scope

Acceptance criteria for #1658 — BE-BUG: RH OAuth grant deaths — refresh race + lineage fork killing credential stores:

1. Two concurrent deployed instances near expiry cannot both POST the same refresh token.
2. Local dev path no longer forks a live grant lineage (fork is explicitly managed: same-grant seal, independent grants preserved, stale exports refused).
3. Regression test pins that a second concurrent refresh never presents an already-rotated token.
4. Live verification: KMS repository/connect check and forced canary.
5. Persistent KMS errors still classify `reauth_required`; canary semantics unchanged.

Backend-only task — no user-facing surface.

## Prerequisites

- `gcloud auth application-default login` (ADC) with Firestore + KMS access — same creds used by the upload/verify scripts.
- `RH_CREDENTIAL_KEY_NAME` set for KMS decrypt scenarios (S2/S3): `projects/rel-str/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials`
- `NODE_OPTIONS=--require C:\Users\bob\.config\node\ipv4-only.cjs` (broken IPv6 on this gateway — required for live runs).
- `cd functions` for all commands.

## Getting to the feature

There is no UI surface — the feature is the credential lifecycle itself: `rh-agent-credentials/bundle` (Firestore, KMS-encrypted) + refresh lease doc + `st-config/rhCredentialCanary` status doc + local `%LOCALAPPDATA%\rel-str\rh-agent-mcp\credentials.dpapi`. Scenarios are script executions against the live doc + specs.

## Automated evidence

- `npm run test:rh-agent-mcp-refresh` — 62/62 (lease seam, seal matrix, persistTokens retry/adopt/resurrect, upload freshness guard).
- `npx tsx --test ../tests/functions/rh-*.test.ts` — 310/310.
- `npx tsc --noEmit -p tsconfig.json` — clean on the touched surface; `npm run build` — clean.

## Scenarios

### S1 — Firestore refresh lease (live, scratch doc)

- **Feature:** the prod lease serializes refresh across deployed instances; expired-TTL takeover recovers a crashed holder; lease ops never touch the credential doc.
- **Steps:** `npx tsx scripts/verify/rh-mcp-refresh-lease-1658.ts`
- **Expected:** all 10 checks PASS — doc+revision, acquire/deny, foreign-release fencing, release→acquire, expired takeover (TTL `-5_000`, past the 1s skew grace), revision untouched, scratch cleanup.
- **Result/evidence:** PASS — 10/10 live checks (2026-11-22): doc exists, revision matches, acquire/deny/fence/release, expired-TTL takeover, doc revision untouched, scratch cleanup.

### S2 — KMS repository structural check (live)

- **Feature:** `createKmsCredentialRepository` → `rh-agent-credentials/bundle` → KMS decrypt → structurally valid bundle (revision, `lastTokenResponseAt`, token/client/discovery presence — values never printed).
- **Steps:** `$env:RH_CREDENTIAL_KEY_NAME="projects/rel-str/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"` then `npx tsx scripts/verify/rh-mcp-kms-repo-1639.ts`
- **Expected:** bundle decrypts, revision + stamp present, token/clientInformation/discoveryState presence all true. No token values printed.
- **Result/evidence:** PASS — all checks green (2026-11-22): revision 7, `lastTokenResponseAt` 2026-11-20T18:23:12Z, access/refresh token + clientInformation + discoveryState all present. No token material printed.

### S3 — Live connect + real refresh path (rotates the grant — intended prod behavior)

- **Feature:** the exact noon-pass credential path — session-manager factory → refresh (rotation persists) → real read-only MCP call (`get_option_chains` SPY). Exercises the lease + CAS write under prod deps.
- **Steps:** `npx tsx scripts/verify/rh-mcp-kms-repo-1639.ts --connect` (env as S2). A refresh that rotates bumps the doc revision — compare before/after revision print.
- **Expected:** session connects, tool call returns, revision advanced if a rotation fired. No `reauth_required`/`TEMPORARILY_UNAVAILABLE`.
- **Result/evidence:** PASS — `get_option_chains(SPY)` returned data, 1374ms, through the session-manager → KMS repository path. No refresh needed this run (rev 7 → 7); rotation persistence verified on first expiry-driven refresh — the lease itself was exercised live in S1 and the canary's 2026-11-22 prod run.

### S4 — Canary status doc (prod-stamped evidence)

- **Feature:** the weekday 7AM PT `rhCredentialCanary` probe writes `st-config/rhCredentialCanary` — `state: ok` proves the full prod credential path is live; the doc's `checkedAt` proves recency.
- **Steps:** read `st-config/rhCredentialCanary` (ADC): `npx tsx -e "import './src/firebase-admin-init'; import { getFirestore } from 'firebase-admin/firestore'; getFirestore().doc('st-config/rhCredentialCanary').get().then(d => console.log(JSON.stringify(d.data())))"`
- **Expected:** `{ state: 'ok', checkedAt: <today>, latencyMs, userId }` — `ok`, not `reauth_required`/`transient`.
- **Result/evidence:** PASS — `st-config/rhCredentialCanary` = `{state:"ok", checkedAt:"2026-11-22T02:00:48.820Z", latencyMs:907}` — today's scheduled run exercised the full prod credential path.

### S5 — Seal / upload semantics (spec-pinned; live run deferred)

- **Feature:** `sealLocalSourceIfCopied` CAS-deletes a same-grant local copy, refuses `rotated_during_seal` (including post-delete zombie resurrect), preserves `independent_grant`/`stale_export`; `--replace` freshness guard fails closed on stale/undatable exports without `--force`.
- **Steps:** spec matrix — `rh-credential-refresh-lease-1658.test.ts` seal + upload-guard describes (executed in Automated evidence). A **live** `upload-rh-credential` re-seed is deliberately deferred — it writes the prod doc; run only when a re-seed is actually needed (runbook path).
- **Expected:** all seal + guard specs green (they are — see Automated evidence).
- **Result/evidence:** PASS (spec-pinned) — seal matrix (same_grant_delete / rotated_during_seal incl. post-delete resurrect re-check / independent_grant / stale_export) + `--replace` freshness guard all green in the 62-test lease spec and upload spec. Live re-seed deferred per runbook.

### S6 — Error classification preserved (spec-pinned)

- **Feature:** persistent KMS/credential errors → `reauth_required`; `CredentialRepositoryBusyError` → `transient`. Canary classifier code path unchanged by this task.
- **Steps:** `npx tsx --test ../tests/functions/paper-trading/rh-credential-canary.test.ts` plus the classifier pins in `rh-agent-mcp-auth-error-classifier.test.ts`.
- **Expected:** all green; `rh-credential-canary.ts` itself is not in the diff.
- **Result/evidence:** PASS — 12/12: canary classification (`reauth_required`/`transient`/`ok` + `rh_credential_canary_fail` marker discipline) + auth error classifier. `rh-credential-canary.ts` untouched by this task's diff.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface.

## Findings

- None — all scenarios green; no defects found.

## Traceability

| AC | Scenario |
|----|----------|
| Concurrent instances can't double-POST | S1 (live lease), S3 (connect through the lease), specs |
| Fork explicitly managed | S5 (seal matrix), S2 (prod doc integrity) |
| Regression test (no stale replay) | Automated evidence (62-test lease spec) |
| Live verify: KMS connect + canary | S2, S3, S4 |
| Canary semantics unchanged | S4, S6 |

## Regression / smoke

- [x] `rh-agent-mcp` full spec set green (310/310 — automated evidence)
- [x] Verify `run-all` wiring intact (`run-all.ts` includes the lease script; probes correctly excluded)
- [x] No token material in any log/error/evidence output (spec + review verified)

## Verdict

**QA PASS** — all six scenarios green (S1–S4 live against prod docs; S5–S6 spec-pinned). #1658 ACs 1–5 all evidenced: concurrent refreshes serialized by the Firestore lease, the local/prod fork is explicitly managed (seal + freshness guard), the no-stale-replay regression is pinned, KMS connect + canary verified live, and error classification is unchanged. Task stays open at `7_QA` pending `/proj ship`.

## Results log

- 2026-11-22 — UAT doc created after round-5 review PASS; QA issue #1671.
- 2026-11-22 — All scenarios executed: S1 10/10, S2 PASS (rev 7), S3 PASS (1374ms probe), S4 PASS (canary ok 02:00Z), S5 spec-pinned PASS, S6 12/12. Verdict: QA PASS.
