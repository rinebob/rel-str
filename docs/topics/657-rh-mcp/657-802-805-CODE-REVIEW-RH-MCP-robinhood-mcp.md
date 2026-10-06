**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #805  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-05  
**Last Updated:** 2026-10-05  

# CODE REVIEW — #805: KMS provisioning + IAM + RH_OWNER_UID + rules deny

Gate review per `/proj review 657 805`. Config task — repo diff is the
firestore.rules deny block only; the rest is verified live infrastructure.

## Scope

- `firestore.rules` — explicit `rh-agent-credentials` deny block.
- Live provisioning (verified during implementation): keyring `rh-agent` @
  us-central1, key `credentials` (symmetric, 90d rotation, API enabled);
  `cryptoKeyEncrypterDecrypter` on the key → functions SA
  `rel-str-partner-caller-prod` + owner user (ADC-local verify/seed);
  `RH_CREDENTIAL_KEY_NAME` + `RH_OWNER_UID` in `functions/.env`; rules
  deployed; live verify script 13/13 PASS.

## Standards — clean

Deny semantics correct (`read, write: if false` covers list too; subcollection
paths fall to the root catch-all). Placement/naming/comment style match
convention; no rule weakening elsewhere; admin SDK bypasses rules, matching
the "functions SA only" comment.

## Spec — all 6 criteria MET

1. Keyring + key @ us-central1 — MET (90d rotation is extra hardening;
   cipher is rotation-safe since decrypt uses the embedded key version).
2. Key-level `cryptoKeyEncrypterDecrypter` → functions SA — MET (SA
   confirmed via `setGlobalOptions` in `functions/src/init.ts`; owner-user
   binding is required for ADC-local verify/#806 seed — record for #811).
3. `RH_OWNER_UID` configured — MET via the canonical `.env` mechanism
   (applies to all functions at next deploy; rhApi consumer lands in
   #807/#810 — the only possible interpretation pre-#807).
4. Explicit rules deny — MET and deployed.
5. Runbook capture — deferred to #811 per the AC; provisioning record now
   lives on the #805 issue body (commands, bindings, rationale, revocation
   semantics, `.env` caveats).
6. Live verify — 13/13 PASS observed.

## Findings — remediated

- **Minor (fixed):** provisioning commands existed only in shell history →
  full record appended to #805 body as the #811 runbook source.
- **Nit (fixed):** new deny block sat under the "Legacy RH Agent" group
  header → added a production-collections group header line.
- **Nit (fixed):** DESIGN doc conflated rotation with version destroy →
  corrected (rotation safe; `cryptoKeyVersions.destroy` is the bricking op).
- **Nit (fixed):** verify guide's "malformed-doc fail-closed" → names
  `InvalidCredentialBundleError` precisely.
- **Info:** `.env` vars attach to every function on next deploy — noted in
  the #805 provisioning record for the runbook.

## Verdict

**PASS** — no critical or major findings. All findings remediated or queued
for the runbook (#811).
