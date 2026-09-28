# Verification Guide — #639 BE lifecycle GraphQL fetch shell

## Scope

The `functions/src/gh-lifecycle/` fetch shell: `SUPPORTED_REPOS` config,
`fetchLifecycleData` (paginated topic-root search → level-batched `nodes()`
expansion → per-node `subIssues` pagination → Status decode), and
`fetchFileText` (raw repo file). Exercised against real GitHub — no mocks.

## Scripts

### `dev-tools-gh-lifecycle-639-fetch.ts`

```bash
npx tsx scripts/verify/dev-tools-gh-lifecycle-639-fetch.ts
```

**Credentials:** `GITHUB_READ_TOKEN` env var, else falls back to
`gh auth token` (works when `gh` is authenticated). Read-only.

**Pass:** `ALL CHECKS PASSED`, exit 0. Confirms: rel-str repo entry exists;
roots found with `truncatedNodes === 0`; topic #619 has thread #621 under
it; all roots carry number/title/state/url; `statusOf` decodes project
statuses; inventory doc fetched; transforms emit non-empty sections.

**Fail:** any `FAIL` line names the broken stage. `truncatedNodes > 0`
means the pagination guard tripped — investigate the walk, do not ignore.
GitHub 401/403 means the token lacks Issues/Projects read on rel-str.
