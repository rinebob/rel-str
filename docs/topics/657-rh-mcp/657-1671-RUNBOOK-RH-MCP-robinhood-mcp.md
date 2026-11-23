# 657-1671 Runbook — RH credential operations playbook

**Topic:** Robinhood MCP  
**Topic Slug:** rh-mcp  
**Thread:** Production RH API  
**Thread Slug:** production-rh-api  
**Issue:** #1671  
**Thread Parent:** #795  
**Topic Parent:** #657  
**Task:** #1658  
**Domain:** RH-MCP  
**Type:** RUNBOOK  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

> Living ops doc — update as the credential architecture evolves (prod
> in-app mint, file-lease simplification). The frozen history is the
> companion inquest: `657-1671-POSTMORTEM-RH-MCP-robinhood-mcp.md`.

## Mental model

1. A Robinhood OAuth grant stays alive by **rotating** its refresh
   token — the app periodically exchanges the current token for a new
   one, and each exchange burns the old token.
2. **Presenting a burned token gets `invalid_grant`** — and retrying
   with it risks revoking the whole grant.
3. **Two copies of the same token = a fork.** Whichever side refreshes
   first burns the other's copy. Never copy a live grant between
   stores to "share" it.
4. **Concurrent refreshes on one store are serialized by a lease** —
   the loser reloads and adopts the winner's rotated bundle instead of
   insisting with its stale token.
5. **Correct steady state: one grant per store**, minted independently
   — prod in Firestore/KMS, local in the Windows DPAPI file. Verified:
   independent grants coexist.

Domain term for all of this: CONTEXT.md → *Grant Lineage*.

## Store map

| Store | Location | Contents | Guard |
|---|---|---|---|
| Prod credential doc | Firestore `rh-agent-credentials/bundle` | KMS-encrypted OAuth bundle + `schemaVersion`, `revision`, `lastTokenResponseAt` | CAS revision; client reads denied |
| Prod refresh lease | Firestore `rh-agent-credentials/refresh-lease` | `{holderId, expiresAt}` — transient | Transactional acquire/release; TTL + 1s skew grace; self-heals on crash |
| Local credential file | `%LOCALAPPDATA%\rel-str\rh-agent-mcp\credentials.dpapi` | DPAPI-protected bundle | Store lock + `.refresh.lock` lease dir |
| Canary status | `st-config/rhCredentialCanary` | `{state, checkedAt, latencyMs, userId}` — client-readable | Overwritten each run (weekday 7 AM PT) |

## Detection

- **Canary doc** — `st-config/rhCredentialCanary.state`:
  `ok` / `transient` (retry next run — network, busy) /
  `reauth_required` (**alarm** — grant is dead or KMS is misconfigured).
- **Log markers** — `rh_credential_canary` every run;
  `rh_credential_canary_fail` **only** on alarm states — a log-based
  alert on the fail marker won't fire on transients.
- **Read the doc:** `cd functions && npx tsx -e "import './src/firebase-admin-init'; import { getFirestore } from 'firebase-admin/firestore'; getFirestore().doc('st-config/rhCredentialCanary').get().then(d => console.log(JSON.stringify(d.data())))"`

## Diagnosis tree

```
canary = reauth_required?
├─ first sighting → re-run the doc read in ~1h; could be a transient
│  classified wrong. Persistent (≥2 runs) → grant is dead → RECOVERY.
├─ transient → retry/no action; escalate only if it sticks >1 day.
└─ ok → credential path is fine; look elsewhere (MCP outage, quota).

Grant dead — which store?
├─ prod (canary fires, noon pass fails) → re-mint PROD grant
└─ local (local tooling fails, canary ok) → re-mint LOCAL grant only.
   Do NOT touch prod for a local death.
```

Quick health probes before assuming death:
```powershell
cd functions
$env:NODE_OPTIONS="--require C:\Users\bob\.config\node\ipv4-only.cjs"   # broken IPv6 on this gateway
npx tsx scripts/verify/rh-mcp-refresh-lease-1658.ts                     # lease ops on real doc — 10 checks
$env:RH_CREDENTIAL_KEY_NAME="<from functions/.env>"
npx tsx scripts/verify/rh-mcp-kms-repo-1639.ts --connect                # decrypt + session + real MCP call
```
The `--connect` run prints the doc revision before/after — a refresh
that rotates bumps it. `reauth_required` here = grant truly dead.

## Recovery

### Prod grant dead — re-mint (current path, until in-app mint exists)

1. On the local machine with DPAPI access + ADC:
   `cd functions && npx tsx scripts/local-oauth-bootstrap.ts`
   (interactive browser login + MFA — mints a fresh LOCAL grant).
2. Upload to prod: `npx tsx scripts/upload-rh-credential.ts --replace`
   - The **freshness guard** compares `lastTokenResponseAt` — refuses
     stale/undatable exports. Only `--force` when you're certain the
     export is newer than the doc's last refresh.
   - **Seal** then CAS-deletes the local copy **iff** both stores held
     the same refresh token (`same_grant_delete`). Outcomes:
     - `sealed` — local copy removed; prod is the sole lineage owner.
     - `rotated_during_seal` — a refresh rotated the copy mid-seal
       (or a zombie resurrected post-delete) → local copy survives;
       it is now an *independent* lineage — leave it.
     - `independent_grant` / `stale_export` — nothing deleted; local
       grant is already divergent. Correct — do not force it.
   - `--keep-source` skips sealing deliberately (e.g., keeping a
     known-independent local grant).
3. Verify: `rh-mcp-kms-repo-1639.ts --connect` → probe passes; next
   canary run stamps `ok`.

### Local grant dead — local re-mint only

`npx tsx scripts/local-oauth-bootstrap.ts` — writes DPAPI only.
Prod is unaffected; do NOT upload afterward (that's the fork path).

### Corrupted/wrong prod doc

`upload-rh-credential.ts --replace` with a **fresh** export; the guard
blocks stale ones. `--force` only when the stored doc is provably
older (check `lastTokenResponseAt` via the kms-repo verify).

## Safe-ops matrix

| Operation | Verdict |
|---|---|
| Mint a fresh grant per store (independent grants) | **Safe** — verified concurrent coexistence (probe, 2026-11-22) |
| Copy a live grant local→prod via upload + seal | **Managed** — allowed only as migration; seal must confirm same lineage |
| Copy a live grant and *keep* both copies | **FORBIDDEN** — guaranteed fork death on next refresh |
| `--replace` with an older/undatable export | **Blocked** by freshness guard (`--force` override = last resort) |
| Two prod instances refreshing concurrently | **Safe** — lease serializes; loser adopts |
| Interactive re-auth while another grant exists | **Safe** — independent lineages coexist |

## Verify scripts

| Script | Needs | Writes | Proves |
|---|---|---|---|
| `verify/rh-mcp-refresh-lease-1658.ts` | ADC | scratch lease doc (cleaned up) | Lease acquire/deny/fence/release, expired-TTL takeover, doc untouched |
| `verify/rh-mcp-kms-repo-1639.ts [--connect]` | ADC + `RH_CREDENTIAL_KEY_NAME` | prod doc (rotation — intended) | Decrypt, bundle shape, full connect + real MCP probe |
| `verify/rh-oauth-design-probes-1658.ts` | interactive login | probe temp files (cleaned) + RH-side client registration | `https` redirect support; two-grant coexistence |

## Residual risks

- **TTL zombie** — a holder alive past TTL can be overtaken; two
  POSTs may race inside the expiry window. Adopt-on-conflict catches
  it; a repeated canary death pattern would be the symptom.
- **Undocumented RH policy** — session caps/revocation rules aren't
  officially documented; the canary is the tripwire if RH changes.
- **Lease doc orphaned on crash** — self-heals via TTL takeover;
  a stuck `refresh-lease` doc past its `expiresAt` is normal recovery,
  not a bug.

## When it breaks again — first five minutes

1. Read `st-config/rhCredentialCanary` — `reauth_required`?
2. Run `rh-mcp-kms-repo-1639.ts --connect` — dead, or transient?
3. Check doc revision + `lastTokenResponseAt` — did rotation stall
   (fork suspicion: is a *local* copy alive and refreshing)?
4. Re-mint per the recovery section — prod and local independently.
5. If deaths recur within days, suspect a live fork or a TTL zombie —
   check for a second store holding the same lineage before re-minting
   again (re-minting into a fork just re-arms the kill).
