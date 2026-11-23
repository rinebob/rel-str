**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1698  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1695  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-23  

# UAT — #1695: BE-IMPL issue-map doc + seed + tree-upsert + index emit + resolveIssue

## Scope

The issueNumber → Topic-root map behind digit-query deep search:

- `gh-lifecycle-issue-map/{owner}-{repo}` Firestore doc, shape
  `{ entries: { "<issueNumber>": <rootTopicNumber> }, updatedAt }`.
- Seed script `functions/scripts/seed-gh-lifecycle-issue-map.ts`
  (monolith BFS inversion, `--dry` census default, `--apply` merge +
  stale-entry prune, truncation refusal).
- `getLifecycleTopicTree` syncs each fetched subtree into the map
  (transactional upsert + stale delete, gated on `truncatedNodes === 0`,
  non-fatal on failure).
- `getLifecycleTopicIndex` emits `issueMap` on the response; a map-read
  failure omits the field rather than failing the index.
- `resolveLifecycleIssue` — `{owner, repo, issueNumber}` →
  `{issue:{number,title,state,url,labels}, path?}` via `Issue.parent`
  chain walk; not-found for unknown issues; no `path` when no `Topic:`
  ancestor; a `Topic:` root resolves to itself; every resolved chain
  number is upserted.

The FE consumer (digit-query resolution, expand, highlight) is task
#1696 — out of scope here.

## Prerequisites

- Repo checkout on `prod` with this task's uncommitted changes.
- `cd functions`.
- `GITHUB_READ_TOKEN` — not set in this shell; substitute
  `GITHUB_READ_TOKEN=$(gh auth token)` (equivalent read scope).
- ADC with Firestore access for the live doc checks
  (`gcloud auth application-default login` already in place).
- Deployed-callable surface is NOT yet live — the onCall deploy happens
  at `/proj ship`. All checks run the same handler code + production
  dep wiring locally; post-ship smoke is in S7.

## Getting to the feature

There is no UI surface in this task — the surface is the callable
handlers and the Firestore doc, exercised by the verify script and
targeted probes. The consuming UI for context: route
`/tools/topic-viewer` (app nav → **Topic Viewer**); the map emitted on
`getLifecycleTopicIndex` is what that page will search against once
#1696 lands.

Firestore doc (Firebase console → Firestore):
`gh-lifecycle-issue-map / rinebob-rel-str` → field `entries` (map of
`"issueNumber": rootNumber`) + `updatedAt`.

## Automated evidence

| Check | Command | Result |
|---|---|---|
| tsx gh-lifecycle suite | `cd functions && npm run test:gh-lifecycle` | 130/130 |
| functions typecheck | `cd functions && npx tsc --noEmit` | clean (pre-existing foreign #1501 error excluded) |
| FE parity spec | `npx jest src/app/features/topic-viewer/topic-viewer.service.spec.ts` | 15/15 |
| Jest full suite | `npx jest --coverage=false` | 6,276/6,276 |

## Scenarios

### S1 — DRY verification suite (fixture-level checks)

Feature: index emit + degrade, non-blocking tree sync, resolver edges.
Steps:
```
cd functions
npx tsx scripts/verify/gh-lifecycle-issue-map-1695.ts
```
Expected: `=== 11 passed, 0 failed ===` covering: issueMap emitted on
the index response; read failure omits the field but still returns
topics; tree sync invoked on a successful fetch and non-fatal on
failure; resolver path root→issue + chain upsert; no-ancestor and
non-Topic-top → no path; unknown issue → not-found.
Result/evidence: **PASS** — `=== 11 passed, 0 failed ===` (2026-11-23).

### S2 — Live parent-chain resolution

Feature: `resolveLifecycleIssue` against real GitHub GraphQL.
Steps:
```
cd functions
GITHUB_READ_TOKEN=$(gh auth token) npx tsx scripts/verify/gh-lifecycle-issue-map-1695.ts --live
```
Expected: `=== 15 passed, 0 failed ===`, including `#1696` resolving
through `#1694 → #1609` to Topic `#619`, and the live doc read
reporting ~1,417 entries with a deep issue mapping to `#619`.
Result/evidence: **PASS** — `=== 15 passed, 0 failed ===` (2026-11-23):
`#1696 resolves`, `ancestor chain ends at Topic #619`, `map doc populated
(1417 entries)`, `map knows a deep issue → #619`.

### S3 — Live tree-fetch sync heals and prunes the doc (transactional)

Feature: `getLifecycleTopicTree` map maintenance against real Firestore.
This mutates `gh-lifecycle-issue-map/rinebob-rel-str` — the same writes
production performs; both mutations self-heal inside the check.
Steps — run this probe (`scripts/tmp-probes/sync-heal-probe.ts`, see
Appendix):
1. Delete `entries."1696"` and add bogus `entries."999999"=619` to the
   doc.
2. Call `handleGetLifecycleTopicTree` with `ghLifecycleDeps()` for
   `topicNumber: 619`.
3. Re-read the doc.
Expected: `1696` is restored → `619` (tree upsert healed the delete),
and `999999` is gone (stale entry pointing at 619 was pruned).
Result/evidence: **PASS** — probe output:
`before: 1696 → undefined | 999999 → 619` → real tree fetch
(`tree topics: 1`) → `after: 1696 → 619 | 999999 → undefined` →
`HEAL+PRUNE OK`. Transactional sync performed both mutations against the
live doc; `db.runTransaction` confirmed on real Firestore.

### S4 — Seed dry-run census + truncation guard

Feature: seed script inversion over the real monolith BFS.
Steps:
```
cd functions
GITHUB_READ_TOKEN=$(gh auth token) npx tsx scripts/seed-gh-lifecycle-issue-map.ts
```
Expected: per-repo census lines — `rel-str`: ~43 roots, ~1,417 mapped
issues, `truncatedNodes: 0`; `av-proxy-api` either seeds (empty/no
topics) or logs a skip warning; final `DRY — no write` line. No doc
write occurs.
Result/evidence: **PASS** — `rel-str`: 43 roots · 1,418 issues mapped ·
`truncatedNodes: 0`; `av-proxy-api`: 17 roots · 242 issues ·
`truncatedNodes: 0`; final line `DRY — no write.` (2026-11-23).

### S5 — Idempotent re-seed + prune (already applied)

Feature: `--apply` merge semantics + stale-entry prune.
Evidence: the initial seed wrote 1,417 entries; a re-run is a no-op for
unchanged entries (nested merge) and deletes stored keys absent from
the fresh census. Verified in review — re-apply is optional; skip
unless S4 reports a changed census.
Result/evidence: **PASS** — S4 did report a changed census, so
`--apply` ran: `WROTE 1418 entries (pruned 0 stale) →
gh-lifecycle-issue-map/rinebob-rel-str` and `WROTE 242 entries
(pruned 0 stale) → gh-lifecycle-issue-map/rinebob-av-proxy-api`
(2026-11-23). The rel-str delta was QA issue `#1698` joining the #619
tree; av-proxy-api was seeded for the first time.

### S6 — Regression: existing lifecycle callables unaffected

Feature: monolith `getLifecycleTree`, index, and per-topic handlers
behave identically except the added emit/sync seams.
Evidence: the 130-spec tsx suite covers all three handlers' auth,
validation, error mapping, truncation behavior; S2's live tree fetch
returns a well-formed `LifecycleTreeResponse`.
Result/evidence: **PASS** — `npm run test:gh-lifecycle` 130/130;
`npx jest --coverage=false` 6,276/6,276 (full suite, post-review-fix
run); parity spec 15/15.

### S7 — Post-ship smoke (deployed surface)

Not executable pre-ship — the onCall deploy is the `/proj ship` action.
After `firebase deploy --only functions` (or the auto-deploy on commit),
run `--live` again: the deployed `getLifecycleTopicIndex` response
should carry `issueMap` and `resolveLifecycleIssue` should be a
registered callable. Recorded here so the ship step owns it.

## Manual UI/UX refinement pass

Not applicable — no user-facing surface. The only UI-affecting artifact
is the `issueMap` payload consumed by #1696.

## Findings

- None blocking. Noted (informational, not defects): `av-proxy-api` has
  its own lifecycle hierarchy (17 roots / 242 issues) — discovered and
  seeded during S4/S5. `resolveLifecycleIssue` is unauthenticated-shape
  standard (auth guard) but unthrottled — single-user app, accepted at
  review.

## Traceability

| Task AC | Scenario |
|---|---|
| `gh-lifecycle-issue-map/{repo}` doc + shape | S3, S5 |
| Seed: monolith inversion, idempotent, `--dry` census | S4, S5 |
| Tree upsert, batched, non-blocking failure | S1, S3 |
| Index emits `issueMap` | S1 (DRY), S7 (deployed) |
| `resolveIssue` chain walk → root/path/meta; not-found; not-in-tree; upserts | S1 (edges), S2 (live chain) |
| Stale-entry correction on tree fetch | S3 |
| Callable registered + parity spec | Automated evidence (jest parity) |
| Specs for all areas | Automated evidence (130-spec suite) |

## Regression / smoke

- [x] `npm run test:gh-lifecycle` green — 130/130
- [x] `npx jest src/app/features/topic-viewer/` green — 15/15
- [x] `--live` verify green end-to-end — 15/15

## Verdict

**PASS** — S1–S6 all green with live evidence; S7 deferred to the ship
step by design (the onCall deploy is the ship action). No findings.

## Results log

- 2026-11-23 — gate run: S1 11/11 · S2 15/15 live · S3 heal+prune live ·
  S4 census 43+17 roots · S5 --apply wrote 1,418 + 242 · S6 unit suites
  green · verdict PASS.

## Appendix — S3 probe script

`functions/scripts/tmp-probes/sync-heal-probe.ts` (delete after use):

```ts
import { FieldValue } from 'firebase-admin/firestore';
import { handleGetLifecycleTopicTree, ghLifecycleDeps } from '../../src/gh-lifecycle/callables';
import { readIssueMap } from '../../src/gh-lifecycle/issue-map';
import type { CallableRequest } from 'firebase-functions/v2/https';

(async () => {
  const { db } = await import('../../src/firebase-admin-init');
  const doc = db.collection('gh-lifecycle-issue-map').doc('rinebob-rel-str');
  // 1. break the doc: delete a real entry, inject a stale one
  await doc.set(
    { entries: { '1696': FieldValue.delete(), '999999': 619 } },
    { merge: true },
  );
  const before = await readIssueMap(db, { owner: 'rinebob', repo: 'rel-str', projectNumber: 1 });
  console.log('before:', before[1696], before[999999]);
  // 2. real tree fetch → sync txn
  const req = {
    data: { owner: 'rinebob', repo: 'rel-str', topicNumber: 619 },
    auth: { uid: 'uat' },
  } as unknown as CallableRequest<never>;
  const res = await handleGetLifecycleTopicTree(req, ghLifecycleDeps());
  console.log('tree topics:', res.topics.length);
  // 3. verify heal + prune
  const after = await readIssueMap(db, { owner: 'rinebob', repo: 'rel-str', projectNumber: 1 });
  console.log('after: 1696 →', after[1696], '| 999999 →', after[999999]);
  console.log(after[1696] === 619 && after[999999] === undefined ? 'HEAL+PRUNE OK' : 'FAIL');
})().catch(e => { console.error(e); process.exit(1); });
```

Run: `cd functions && GITHUB_READ_TOKEN=$(gh auth token) npx tsx scripts/tmp-probes/sync-heal-probe.ts`
