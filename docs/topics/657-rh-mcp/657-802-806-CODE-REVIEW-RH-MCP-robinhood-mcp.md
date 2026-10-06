**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #806  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-10-06  
**Last Updated:** 2026-10-06  

# Code Review — #806: upload-rh-credential script + initial seed

Review surface: 7 new files + 3 wiring edits (package.json test script,
run-all registration, verify index row). Diff vs `prod` HEAD
(9a8f0022 + working tree), all #806-owned.

## Standards

No hard violations. Judgement calls noted and dispositioned:

- Dead defensive `?? '∅'` fallbacks in the verify script's
  token-in-evidence check — kept: `access_token` is required by schema but the
  check intent is "no token material serialized", and the fallback keeps the
  check well-formed if the type ever loosens. Trivial.
- `check()`/`argValue()` harness duplicated from #804's verify script —
  established convention across ~15 verify scripts; extracting a shared
  harness is out of scope.
- `memoryRepository()` test fake re-implements the revision CAS — same seam
  convention as the neighboring `memoryBackend`; mirrors the real contract.

## Spec

All three acceptance criteria met:

- ciphertext doc at `rh-agent-credentials/bundle` revision 1 — MET (live
  seed executed during implementation; doc keys verified
  `ciphertext,revision,updatedAt`).
- reload through the repository returns equivalent bundle — MET (enforced by
  `UploadRoundTripError`; strengthened to full-field compare — see below).
- no token values printed or logged — MET (`describeBundle` structural
  projection; asserted in unit tests and live verify).

Scope extension on record: `--replace` flag covers the PRD's
reauthorization re-seed flow (CAS-guarded); documented in the guide and the
issue comment for #811's runbook.

## Thermo-nuclear

Two majors, both remediated:

- **Major (fixed):** `reloadedEquivalent` compared only
  revision + access/refresh tokens — a store dropping `clientInformation` or
  `discoveryState` would pass the proof and break reauthorization later. Now
  compares every top-level field of stored vs reloaded; on mismatch the error
  names the differing field (not its value).
- **Major (fixed):** the CLI never exited after success — the admin SDK's
  gRPC channel keeps the process alive, leaving an operator staring at a hung
  prompt while the plaintext export still sits on disk. Added explicit
  `process.exit(0)`.

Minors remediated:

- Three copies of the structural-bundle projection (export diagnostic,
  cloud-credential proof, upload evidence) → extracted `describeBundle` into
  `credential-bundle-codec.ts`; all three call sites rewired.
- Ad-hoc arg parsing silently swallowed typo'd flags (`--repalce` → seed
  mode) and accepted a flag as another flag's value → strict flag sets on both
  scripts; `argValue` rejects `--`-prefixed values.
- `--replace` on an unexpectedly-empty doc silently seeded — now warns
  (`--replace found no existing doc — seeded at revision 1`).

Nits dispositioned (not fixed):

- `InvalidCredentialBundleError` thrown messageless by the codec — the CLI
  prints `error.name` when the message is empty, which is sufficient
  diagnostics for an ops script; widening the error payload is a #811-adjacent
  polish item, not needed here.
- Malformed fixture exercises only the schemaVersion branch — `parseBundle`'s
  other rejection paths are covered by the codec/repository test suites.

New tests added during remediation: round-trip error names the dropped field;
CAS race inside `--replace` propagates `CredentialRevisionConflictError`.

## Test results

- `rh-agent-mcp-upload-credential` — 9/9 green
- Credential surface regression (`upload` + `kms-repository` +
  `credential-repository`) — 29/29 green; wider surface (43 tests incl.
  refresh + boundary) green on the same run
- `tsc --noEmit` — clean
- Live verify `rh-mcp-upload-806.ts` — 11/11 PASS, re-run after remediation
- Production seed — `rh-agent-credentials/bundle` at revision 1,
  ciphertext-only, reload round-trip proven by the upload itself

## Verdict

**PASS** — no remaining critical/major findings.
