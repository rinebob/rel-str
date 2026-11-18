**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1597  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1529  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete    
**Created:** 2026-11-17  
**Last Updated:** 2026-11-17  

# UAT — `updateIssueLabels` + `manageRepoLabel` write callables (#1529)

## Scope

Two write callables completing the label-management surface:
`updateIssueLabels` — `remove` → DELETE per name (missing label is a
no-op), `add` → mint missing names (`POST /labels`, `ededed` default)
then `POST /issues/{n}/labels`; stage labels (`/^[1-8]_/`) rejected in
both directions before any transport call. `manageRepoLabel` —
create/update/delete; delete returns the label's issue-usage count
(`issues?labels={name}&state=all`, paged) for the FE confirm dialog;
`isSystemLabel` targets and rename-into-taxonomy rejected. Both declare
`secrets: ['GITHUB_WRITE_TOKEN']`, same envelope as the read sibling:
auth → `resolveSupportedRepo` → `internalGuard` → `mapLabelError`
(404→not-found; 422→already-exists *only* on create paths, elsewhere
`invalid-argument`).

Review-round remediations this UAT also confirms: `conflictOn422`
scoping, non-empty-name validation, `newName`/`color`/`description`
type checks, `needsGhWrite` run-all gate, `gh issue close` hardening.

## ⚠ Deploy gate (#1526)

`firebase deploy --only functions` must wait for `GITHUB_WRITE_TOKEN`
to exist in Secret Manager — the write exports declare the binding
and Firebase validates secrets at deploy. `gh auth token` carries repo
write scope, so the verify script runs live **before** the secret is
minted; the callable can't *deploy* until it is.

## Prerequisites

- Repo: `rinebob/rel-str` working tree on branch `prod`.
- `GITHUB_WRITE_TOKEN` env, **or** `gh auth token` fallback (the gh
  CLI token has Issues+Labels write scope — used for this run).
- The verify script **writes to the real repo** — self-contained:
  creates a `uat-verify-1529` scratch issue via `gh issue create`,
  exercises the callables, deletes every scratch label, closes the
  issue. A failed mid-run exits non-zero after best-effort cleanup.
- No dev server or browser needed — no UI surface in this task (the
  FE label picker is #1521).

## Getting to the feature

The feature is two callables, not a page: `updateIssueLabels` +
`manageRepoLabel` in `functions/src/gh-lifecycle/label-callables.ts`,
exercised through `handleUpdateIssueLabels`/`handleManageRepoLabel`
with `ghLabelWriteDeps()` — same deps-injection seam as
`listRepoLabels`. Entry points for verification: the live verify
script (S1) and the node:test spec file (S2). Both onCall exports land
in `functions/src/index.ts` at ship; no UI consumes them yet.

## Automated evidence (executed this session)

- `npx tsx scripts/verify/dev-tools-gh-lifecycle-1529-labels-write.ts`
  — **ALL CHECKS PASSED** (live: scratch issue created → mint+attach →
  `usageCount===1` delete → detach → rename→delete → self-cleaned)
- `npm run test:gh-lifecycle` (from `functions/`) — **65/65** across
  the three spec files
- `npx jest --coverage=false` — **317 suites / 5,885 tests**
- `cd functions && npm run build` — clean

## Scenarios

### S1 — Live write round-trips on a real issue

- **Confirms:** AC1 (attach/detach + create-new-name on a real issue),
  AC3's usage count on a real in-use delete, real `ghLabelWriteDeps`
  wiring, self-cleanup.
- **Steps:** run
  `npx tsx scripts/verify/dev-tools-gh-lifecycle-1529-labels-write.ts`.
- **Expected:** `ALL CHECKS PASSED`, exit 0. Required PASS lines:
  `scratch issue created`, `response carries the scratch label`,
  `created lists the minted name`, `usageCount counts the scratch
  issue` (=1), `scratch label detached`,
  `renamed label deleted with zero usage` (=0). `finally` deletes all
  three scratch labels + closes the issue.
- **Result:** ☒ PASS — live write-verify ALL CHECKS PASSED — scratch #1600: mint+attach, `usageCount=1` in-use delete, detach, rename→delete(0), fully self-cleaned. First attempt read `usageCount=0`: GitHub issues?labels index lag >5s — script now polls the index (≤60s) before deleting; 2026-11-17

### S2 — Spec coverage: validation, flows, error mapping

- **Confirms:** AC2 (stage labels rejected in `add` AND `remove`, zero
  transport calls), AC3's error mapping, AC4 (injected transport, no
  network), and the review remediations.
- **Steps:** run `npm run test:gh-lifecycle` from `functions/` — or
  focused: `npx tsx --test tests/functions/gh-lifecycle/label-callables.test.ts`.
- **Expected:** `pass 65` / `fail 0` for the suite
  (`label-callables.test.ts` alone: 26). Key specs: stage-label reject
  both directions with `fx.calls.length===0`; empty/whitespace names
  rejected; `newName` malformed → `invalid-argument`; mint→attach
  ordering + `created` contents; 422-on-create race still attaches;
  non-create 422 → `invalid-argument`; 404 detach no-op; delete counts
  usage BEFORE DELETE; remove-success `finalLabels` from DELETE
  response; combined add+remove ordering.
- **Result:** ☒ PASS — `test:gh-lifecycle` 65/65 — stage guards + mint/attach + usage-count-before-delete + conflict-scoped 422s + review remediations; 2026-11-17

### S3 — Guard order: validation precedes every transport call

- **Confirms:** unauthenticated + unsupported-repo reject on BOTH
  write handlers with zero transport calls; system-label ops never
  reach the wire.
- **Steps:** spec-file evidence in S2's validation describe —
  `unauthenticated → unauthenticated on all three`,
  `unsupported repo → invalid-argument on all three`, and the
  manageRepoLabel system-label spec assert `fx.calls.length === 0`.
  If eyeballing the code: `label-callables.ts` handlers run
  `auth` → `resolveSupportedRepo` → `validate*` before any `call()`.
- **Expected:** all three "all three" guard specs pass inside the
  65-count suite; source order matches the envelope.
- **Result:** ☒ PASS — guard-order specs inside the 65: unauth/unsupported-repo on all 3 handlers + system-label ops with `fx.calls.length===0`; source order auth→repo→validate→call verified; 2026-11-17

### S4 — Regression: read path + lifecycle tree unaffected

- **Confirms:** the shared `call`/`collectPages`/`mapLabelError`
  machinery changes (conflictOn422, validator additions) did not
  regress `listRepoLabels` or `getLifecycleTree`.
- **Steps:** run
  `npx tsx scripts/verify/dev-tools-gh-lifecycle-1528-labels-read.ts`
  and `npx tsx scripts/verify/dev-tools-gh-lifecycle-640-callable.ts`.
- **Expected:** both `ALL CHECKS PASSED` — read list still 68 labels
  count-matched, v2 shape + `no legacy sections key` + auth mapping.
- **Result:** ☒ PASS — 1528-labels-read ALL CHECKS PASSED (68-count match) + 640-callable ALL CHECKS PASSED (v2 shape + auth mapping); 2026-11-17

## Manual UI/UX refinement pass

- Not applicable — no user-facing surface. The callables have no UI
  consumer until the FE label picker (#1521). Deploy-side behavior is
  exercised by `ghLabelWriteDeps()` in S1.
- **Result:** ☒ N/A — BE callables, no UI

## Findings

- None.

## Traceability

| Acceptance criterion | Scenario |
|---|---|
| AC1 — attach/detach round-trips on a real issue; create-new-name | S1 (live #1596 scratch: mint+attach, detach, rename+delete) |
| AC2 — `add` with `5_IMPLEMENT` → `invalid-argument` server-side | S2/S3 (stage guard both directions, zero transport calls) |
| AC3 — delete returns usage count; 422→`already-exists`, 404→`not-found` | S1 (`usageCount` 1 and 0 live), S2 (conflict-scoped mapping specs) |
| AC4 — specs via injected `githubRest`, no network | S2 (`fxRest` recorded-call fixtures) |
| Deploy gate carried from review M1 | Prerequisites section + #1526 |

## Regression / smoke

- `npm run test:gh-lifecycle` runs all three spec files — the sibling
  `github-client.test.ts` + `callables.test.ts` stay green inside the
  same 65-count suite.
- S4 re-runs both read verifies live.
- Deploy note for ship: only after #1526 (`GITHUB_WRITE_TOKEN`).

## Verdict

**Result:** QA PASS — S1–S4 green, manual pass N/A (no UI), deploy gate on #1526 carried

## Results log

| Date | Run | Outcome |
|---|---|---|
| 2026-11-17 | S1–S4 executed in QA (session gh-issues-ui-labels) | QA PASS — write-verify ALL CHECKS PASSED (scratch #1599 index-lag run → #1600 pass after poll fix); 65/65; both read regressions green |
