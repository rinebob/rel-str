**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #816  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #805  
**Domain:** RH-MCP  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# UAT — #805: KMS provisioning + IAM + RH_OWNER_UID + rules deny

Infrastructure/config task. Acceptance = live cloud state queries + the
credential-repository live verify re-run. No UI surface.

## Prerequisites

- `gcloud` authenticated as the owner account, project `rel-str`.
- ADC (`gcloud auth application-default login`) for the verify script.

## Scenarios

1. **Key exists.** `gcloud kms keys describe credentials --keyring=rh-agent
   --location=us-central1 --project=rel-str` → name resolves, purpose ENCRYPT_DECRYPT, rotation period set. *Result: PASS — key exists, ENCRYPT_DECRYPT, rotationPeriod 7776000s (90d), nextRotation 2027-01-04.*
2. **IAM binding.** `gcloud kms keys get-iam-policy credentials …` →
   `cryptoKeyEncrypterDecrypter` includes
   `serviceAccount:rel-str-partner-caller-prod@rel-str.iam.gserviceaccount.com`
   (the functions SA per `setGlobalOptions` in `functions/src/init.ts`)
   and the owner user (local verify/seed). *Result: PASS — both principals bound.*
3. **Env config.** `functions/.env` contains `RH_CREDENTIAL_KEY_NAME` and
   `RH_OWNER_UID` (gitignored; staged for all functions at next deploy). *Result: PASS — both vars present.*
4. **Rules deny deployed.** Live ruleset release contains the
   `rh-agent-credentials` explicit deny block.
   *Result: PASS — released via `firebase deploy --only firestore:rules`
   (compiled + released output); block present in the deployed ruleset
   content.*
5. **Live credential pipeline.** `cd functions`,
   `$env:RH_CREDENTIAL_KEY_NAME="projects/rel-str/locations/us-central1/keyRings/rh-agent/cryptoKeys/credentials"`,
   `npx tsx scripts/verify/rh-mcp-kms-repository-804.ts` → 13/13 PASS,
   exit 0.
   *Result: PASS — 13/13 re-run 2026-10-05 (real KMS + real Firestore).*
6. **Fail-closed guards.** Script still refuses the live bundle path and
   missing env (exit 2) — regression check on the guardrails.
   *Result: PASS — live-path refusal exit 2 re-observed.*

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| key exists + function SA can encrypt/decrypt | 1, 2, 5 |
| RH_OWNER_UID set on function config | 3 |
| rules deny block; no client path | 4 |
| live verify script passes (re-scoped from #804) | 5, 6 |

## Refinement pass

Not applicable — no user-facing surface.

