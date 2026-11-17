# Verification Guide — #1528 BE listRepoLabels callable

## Scope

`functions/src/gh-lifecycle/label-callables.ts`: `listRepoLabels` onCall —
auth guard, `SUPPORTED_REPOS` validation, paged `GET
/repos/{o}/{r}/labels` to completion, `RepoLabel[]` shape.

## Scripts

### `dev-tools-gh-lifecycle-1528-labels-read.ts`

```bash
npx tsx scripts/verify/dev-tools-gh-lifecycle-1528-labels-read.ts
```

**Credentials:** `GITHUB_READ_TOKEN` env, else `gh auth token` fallback.
Read-only — runs the real `ghLabelReadDeps()` wiring against live
GitHub REST.

**Pass:** `ALL CHECKS PASSED`, exit 0 — rel-str labels page returns
non-empty with `name` + 6-hex `color` per label; the workflow taxonomy
(`INTERNAL`, `5_IMPLEMENT`, `DEV-TOOLS`, `FEATURE`) is present; the
handler's label count equals an independent `gh label list` count on
both repos; av-proxy-api fetches without error.

**Coverage honesty:** auth/`invalid-argument` rejection and the
multi-page (>100 labels) path are **unit-spec** evidence
(`label-callables.test.ts`), not live — both supported repos carry
<100 labels today (68 / 49), so real paging never exercises page 2.
If either repo crosses 100 labels, this script's count check becomes
the live paging proof automatically.

**Fail:** FAIL lines name the broken check. `unauthenticated`/`permission-denied`
means the token lacks Issues read on the repo.
