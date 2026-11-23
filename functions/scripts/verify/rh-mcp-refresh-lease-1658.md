# rh-mcp-refresh-lease-1658

**Task:** #1658 — BE-BUG: RH OAuth grant deaths — refresh race + lineage fork killing credential stores (Thread #795)

**What it verifies:** the `RefreshLeasePort` implementation on
`TransactionalCredentialDocumentBackend` against real Firestore —
acquire/deny/release round-trip, holder fencing (a mismatched release
cannot free the slot), expired-TTL takeover (crashed-holder recovery),
and `currentRevision()` reading the real `bundle` doc without
decrypting. Also asserts lease ops never move the credential doc
revision.

**Lease doc:** all acquire/release ops target the scratch doc
`rh-agent-credentials/verify-lease-scratch` — the live `refresh-lease`
doc and the `bundle` doc are never written. Cleanup runs in a
`finally` — a failed check still deletes the scratch doc.

**Bounded guarantee:** the lease is TTL'd, not fenced — a holder whose
critical section (load → refresh POST → CAS write) outlives the TTL can
be taken over mid-flight. The default 60s TTL must comfortably exceed
that window; it does — a refresh POST completes in ~1s. Liveness is
evaluated on the reader's clock with a 1s skew grace
(`CLOCK_SKEW_GRACE_MS`) — an expired lease reads as live until
`expiresAt + 1s`, so takeover checks must use TTLs expired by more
than a second (the script uses `-5_000`).

**Mode:** real Firestore via `FirestoreDocStore` — needs ADC
(`gcloud auth application-default login`) with Firestore access. No
`RH_CREDENTIAL_KEY_NAME` — nothing is decrypted. Not safe for
`run-all` in environments without ADC (fails as an environment gap,
like the other ADC-needing scripts).

## Usage

```bash
cd functions
npx tsx scripts/verify/rh-mcp-refresh-lease-1658.ts
```

## Pass

Exit 0 — 10 `PASS` lines ending with `All checks passed.`

## Fail

Exit 1 — each failed check prints `FAIL — {detail}`:
- `currentRevision` mismatches → lease port reads the wrong doc/revision.
- denied-while-live fails → lease doc isn't serializing (would allow
  duplicate refresh POSTs — the D2 bug).
- fencing fails → any caller can release any holder's slot.
- takeover fails → a crashed holder deadlocks refresh until manual cleanup.
- scratch doc still present → release didn't delete the lease doc.

Related: `rh-mcp-kms-repo-1639.ts --connect` covers the doc load/decrypt
and session path end-to-end; this script covers only the lease doc
semantics #1658 added.
