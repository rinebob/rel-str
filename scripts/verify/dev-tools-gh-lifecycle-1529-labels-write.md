# Verification Guide — #1529 BE label write callables

## Scope

`functions/src/gh-lifecycle/label-callables.ts`: `updateIssueLabels` +
`manageRepoLabel` onCall — add (mint-then-attach) / remove (idempotent
404) / create / rename / delete-with-usageCount.

## Scripts

### `dev-tools-gh-lifecycle-1529-labels-write.ts`

```bash
npx tsx scripts/verify/dev-tools-gh-lifecycle-1529-labels-write.ts
```

**Credentials:** `GITHUB_WRITE_TOKEN` env, else `gh auth token` fallback
(the gh CLI token has repo write scope). **Writes to the real repo** —
self-contained: creates a `uat-verify-1529` scratch issue via `gh issue
create`, exercises the callables, then deletes every scratch label and
closes the issue. A failed mid-run exits non-zero after best-effort
cleanup; leftover `uat-verify-1529*` labels/issues are safe to delete
manually.

**Pass:** `ALL CHECKS PASSED`, exit 0 — add mints+attaches `uat-verify-1529`
(`created` lists it); delete on the in-use label returns `usageCount === 1`;
remove detaches; create→rename→delete on `uat-verify-1529-b` round-trips
with `usageCount === 0`.

**Fail:** FAIL lines name the broken op. `permission-denied` means the
token lacks Issues write. `already-exists` on create means a prior
run's scratch label survived — delete `uat-verify-1529*` labels and
re-run.

**Caveat:** `usageCount` is counted via `issues?labels=` — eventually
consistent (~seconds behind an attach). The script sleeps 5s between
attach and the in-use delete for this reason.
