# Verification Guide — #640 BE getLifecycleTree callable

## Scope

`functions/src/gh-lifecycle/callables.ts`: `getLifecycleTree` onCall —
auth guard, `SUPPORTED_REPOS` validation, fetch → shared transforms →
`LifecycleTreeResponse`, error mapping.

## Scripts

### `dev-tools-gh-lifecycle-640-callable.ts`

```bash
npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts
```

**Credentials:** `GITHUB_READ_TOKEN` env, else `gh auth token` fallback.
Runs the real `ghLifecycleDeps()` wiring — exercises everything except the
HTTP onCall transport wrapper (deployed-callable coverage is task #641).

**Pass:** `ALL CHECKS PASSED`, exit 0 — response parses to the
`LifecycleTreeResponse` (flat `topics` + `fetchedAt`; group fields
removed in #1667); topic #619 → thread #621 nested; every node has
number/title/state/url; unsupported repo → `invalid-argument`; missing
auth → `unauthenticated`.

**Fail:** FAIL lines name the broken stage. `permission-denied` means the
token lacks Issues/Projects read scope on rel-str.
