**Topic:** Robinhood MCP  
**Topic Slug:** robinhood-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #802  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #1628  
**Domain:** RH-MCP  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-19  
**Last Updated:** 2026-11-19  

# Code Review — BE-IMPL: RH credential canary — scheduled probe + st-config status doc (#1628)

## Verdict: PASS

## Pass sequence

```text
First pass complete — 3 majors (classification gap: missing-secret/no-tokens failures silenced to transient; hardcoded literals duplicating shared constants; orphaned test file), 6 minors, 4 nits — all three majors remediated in-gate
Second pass complete — re-verified remediated diff: imports resolve (tsc + esbuild), `in` query under Firestore limit, timeout → transient correct, single-owner assumption documented; no new findings
Convergence: PASS — majors fixed and re-verified, remaining minors are documented deferrals, clean second pass
```

## Scope reviewed

- `functions/src/paper-trading/engine/passes/rh-credential-canary.ts` (NEW)
- `functions/src/index.ts` (one export block, lines ~159-163)
- `tests/functions/paper-trading/rh-credential-canary.test.ts` (NEW — moved from `tests/functions/` root during remediation)
- Adjacent touched for shared-constant remediation: `shared/st-collections.ts` (+`ST_CONFIG_RH_CREDENTIAL_CANARY_DOC`), `functions/src/common/st-collections.ts` (re-export), `src/app/features/savant-trader/services/strategy-manage.service.ts` (path now via `stConfigDocPath` — the FE reader is sibling task #1629's scope, the constant migration landed here), `firestore.rules` (st-config comment update), `functions/package.json` (test wiring)

## Standards axis

- `onSchedule` v2 options, `secrets: ['RH_CREDENTIAL_BUNDLE']`, DI-style `runCredentialCanary(deps)`, node:test conventions, logger marker discipline — all match peer passes (`manageOpenPassTimer`, `ManageExitScanDeps`).
- `classifyProbeError` message-matching verified *sound, not a hack*: `RobinhoodMcpConnectionError` carries only `message`; the wrapped OAuth code is lost upstream — the state-name regex + verbatim-message checks are the only classification channel available.
- No token material reaches logs or the status doc.
- Firestore path `st-config/rhCredentialCanary` valid; `firestore.rules:315-323` admits the read via `request.auth.uid == resource.data.userId`.

### Remediated in-gate

1. **MAJOR — classification gap** (`classifyProbeError`): missing secret (`'RH_CREDENTIAL_BUNDLE is not set'`) and empty-tokens bundle (`NO_STORED_CREDENTIAL_MESSAGE`) — both user-action failures — classified `transient`, suppressing the alarm on the exact failure class the canary exists to catch. Fixed: both verbatim messages now map to `reauth_required`. Note: the remedy phrase `upload-rh-credential` alone is NOT a discriminator (TEMPORARILY_UNAVAILABLE embeds it too) — classifier uses state names + the two verbatim literals. New test covers both.
2. **MAJOR — hardcoded literals** duplicating shared single-source constants: `'st-config/rhCredentialCanary'` (both BE writer and FE reader), `'st-strategy-instances'`, `['UNSTARTED','ACTIVE','STOPPED']`. Fixed: `ST_CONFIG_RH_CREDENTIAL_CANARY_DOC` added to `shared/st-collections.ts`; path built via `stConfigDocPath` on both sides; `ST_STRATEGY_INSTANCES_ROOT` + `INSTANCE_RUN_STATES` used in `lookupOwnerUid`.
3. **MAJOR — orphaned test**: `rh-credential-canary.test.ts` ran via no npm script and sat outside the `tests/functions/paper-trading/` domain convention. Fixed: moved to `tests/functions/paper-trading/` and appended to `test:paper-trading`.

### Deferred minors (accepted, documented)

- `lookupOwnerUid` failure (no instance docs at all) skips the run's status write — narrow edge; a uid-less doc fails the read rule anyway.
- `prodProbe` doesn't inspect the MCP envelope's `isError` — codebase convention treats an answered session as liveness; credential death is caught at connect/refresh, not the tool layer.
- `now` dep is epoch-ms vs sibling `Date` convention — locally consistent, tested.

## Spec axis (vs issue #1628 acceptance criteria)

| AC | Verdict | Evidence |
|---|---|---|
| Same env-secret → refresh → tool-call path as noon pass | **MET** | Same `secrets` binding + `createRobinhoodMcpSessionManagerFromEnv` + `get_option_chains` SPY — the literal first call the noon pass makes |
| `reauth_required` vs `transient`; alarm only on actionable | **MET (post-remediation)** | `rh_credential_canary_fail` only on `reauth_required`; transient `logger.info` only; now covers missing-secret/no-tokens |
| Status doc every run, client-readable, owner-scoped, no token material | **MET** | `st-config/rhCredentialCanary` `{state, checkedAt, latencyMs, error?, userId}`; rules admit via uid match; FE type is field-identical |
| Unit tests pass; build clean | **MET** | 7/7 node:test; functions `tsc --noEmit` + esbuild clean; full jest suite 6114/6114 |
| Deployed as `rhCredentialCanary` | **MET (needs redeploy)** | `firebase functions:list` shows it live; the in-gate remediations require a redeploy before they take effect in prod |

Doc-completeness: `657-795-798-IMPL-rh-mcp-BE-…` and `…-TEST-…` predate the canary — recommend a short addendum at ship time (component, status path, log markers).

## Thermo-nuclear axis

No additional findings beyond the consolidated list above. Dep-injection seam (`probe`/`writeDoc`/`uid`/`now`) is appropriately minimal for a single-producer function; tests assert external behavior (emitted doc + classification), not internals.

## Test results

- `tests/functions/paper-trading/rh-credential-canary.test.ts` — **7/7 pass** (incl. new missing-credential/missing-secret alarm test)
- Full jest suite — **6114/6114 pass** (pre-existing worker-teardown warning, unrelated)
- Functions `tsc --noEmit` clean; `npm run build` (esbuild) clean
- Root `tsc -p tsconfig.json` — no errors in touched files (unrelated pre-existing errors in `scripts/bulk-swing-sweep.ts`, `portfolio-dashboard.store.spec.ts`)

## Operational notes

- The deployed `rhCredentialCanary` predates this remediation — **redeploy required** for the classification fix to take effect in prod (`firebase deploy --only functions:rhCredentialCanary`).
- `firestore.rules` comment updated (rhCredentialCanary is a backend-written, userId-scoped doc, not a {uid}-id config doc).
