**Topic:** GitHub read-only issue UI  
**Topic Slug:** gh-issues-ui  
**Thread:** Topic Viewer UI polish & misc fixes  
**Thread Slug:** topic-viewer-polish  
**Issue:** #1553  
**Thread Parent:** #697  
**Topic Parent:** #619  
**Task:** #1524  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-15  
**Last Updated:** 2026-11-15  

# UAT — SHARED: Retrofit GitHub native sub-issues (#1524)

## Scope

One-time ops script that repairs native GitHub sub-issue links on legacy
Topics whose hierarchy existed only as body markdown. Covers PRD US-1 /
task #1524 ACs: anchor enumeration (`^Topic:` roots), structural-section
parse → declared edges, live-parentage diff (proposed / already-correct /
conflict / blocked / unresolved / superseded), dry-run default, `--apply`
linking with closed-parent transient reopen + `stateReason` restore,
idempotency, report-only conflicts. Already applied repo-wide: 39 edges
linked (36 rel-str + 3 av-proxy-api), 0 failures.

## Prerequisites

- `gh` CLI authenticated for `rinebob` (script uses it for all reads/writes).
- Node deps installed (`npx tsx` resolves — devDependency).
- `.devin/tmp/` writable (gitignored report output; created on demand).
- No emulator, credentials, or seed data — every scenario hits prod GitHub.

## Getting to the feature

- **Script (primary surface):** `npx tsx scripts/retrofit-gh-subissues.ts`
  from the repo root — no route; it is a CLI.
- **UI surface (effect check):** route `/tools/topic-viewer` — Sidenav →
  **Topic Viewer** → select `137: Topic: Strategy Builder UI` in the left
  pane → the right pane's tree now shows the stage issues that were
  missing (was: only #154).

## Test scenarios

### S1 — Full dry-run, both repos (read-only)

1. `npx tsx scripts/retrofit-gh-subissues.ts`
   - **Expect:** two `=== owner/repo ===` blocks; rel-str shows
     `anchors scanned: 43`, `intended` ≈ 520+, `proposed: 0` (post-apply
     steady state), non-zero `conflicts`, `blocked-cycles`, `superseded`,
     `unresolved` (5 dead refs under #108); exit code 2 (conflicts
     present); a `.devin/tmp/retrofit-gh-subissues-*.json` report per
     repo whose bucket counts sum to `intended`.
   - **Result:** PASS — last run: 43 anchors · 523 intended · proposed 0 ·
     conflicts 109 · blocked 4 · unresolved 5 · superseded 14 · exit 2;
     reports written; `buckets === intended` verified by the verify script.

### S2 — Scoped dry-run on #137

1. `npx tsx scripts/retrofit-gh-subissues.ts --repo rinebob/rel-str --only 137`
   - **Expect:** `anchors scanned: 1` · intended ≈ 32 · `proposed: 0` ·
     3 CONFLICT lines (#142→#145, #143→#146, #144→#149 — inverted
     blueprint↔task pairs) · 3 BLOCKED lines · `unresolved: 0`.
   - **Result:** PASS — observed exactly this.

### S3 — Apply idempotency (no-op apply)

1. `npx tsx scripts/retrofit-gh-subissues.ts --repo rinebob/rel-str --apply`
   - **Expect:** plan identical to S1, then `applied: 0 · failed: 0` —
     nothing left to link (all safe edges applied earlier).
   - **Result:** PASS — `applied: 0` on the post-remediation run
     (`applied: 36 + 3` happened at implementation time; evidence in the
     report files).

### S4 — Permanent verify script

1. `npx tsx scripts/verify/dev-tools-retrofit-subissues-1524.ts`
   - **Expect:** every line `PASS` — dry-run exit ≤2, fresh reports per
     repo, `buckets === intended`, `proposed: 0` both repos, live-parentage
     spot-checks, #137 `subIssues` contains #138/#141/#153/#155/#158; exit 0.
   - **Result:** PASS — 17/17 checks green.

### S5 — #137 native sub-issues (GraphQL ground truth)

1. `gh api graphql -f query='query { repository(owner:"rinebob",name:"rel-str") { issue(number:137) { subIssues(first:100) { nodes { number } } } } }'`
   - **Expect:** nodes include 138, 141, 153, 154, 155, 158, 1510 — the
     stage issues + thread that were body-only before.
   - **Result:** PASS — all 7 present (verified at apply time and again
     via the verify script).

### S6 — Closed parents restored with original `stateReason`

1. `gh api graphql -f query='query { repository(owner:"rinebob",name:"rel-str") { issue(number:144) { state stateReason } issue(number:221) { state stateReason } } }'`
   - **Expect:** parents that received links stay `CLOSED` and their
     `stateReason` is a real close reason (`COMPLETED`/`NOT_PLANNED`),
     not clobbered — the re-close echoes the fetched value.
   - **Result:** PASS (partial) — #144 CLOSED·COMPLETED, #221 CLOSED·COMPLETED.
     Note: exact pre-apply reasons weren't recorded; the verify proves the
     restore mechanism via spec (`close:P2:NOT_PLANNED` ordering) and no
     parent was left open.

### S7 — Report-only categories never mutate

1. Inspect S1's report JSON: `conflicts`, `blocked`, `superseded`,
   `unresolved` lists are populated — and GitHub state for those issues
   is unchanged (e.g. `#142`'s parent is still #145, the conflict it
   reported).
   - **Result:** PASS — `#142.parent == #145` confirmed by live spot-check
     inside the verify script (the alreadyCorrect/conflict partitioning
     reads live parentage).

### S8 — Topic Viewer effect check (manual)

1. `npm start` → `/tools/topic-viewer` → select `137: Topic: Strategy
   Builder UI` → expand.
   - **Expect:** the tree shows #138 (Idea), #141 (Plan), #153/#155/#158
     (QAs), thread #1510, #154 — versus only #154 before the retrofit.
   - **Result:** PASS — user-confirmed 2026-11-15: all linked issues
     visible (#138, #141, #153, #155, #158, #1510, #154). Note: several
     disappear when "show closed" is unchecked — expected: #153/#155/#158
     are closed QAs; the closed-state filter hides them by design.

## Traceability

| AC | Scenario |
|---|---|
| Dry-run lists full declared edge set, writes nothing | S1, S2 |
| `--apply` links; re-run proposes zero | S3, S4, S5 |
| Already-parented-elsewhere → conflict, never reparented | S1, S7 |
| Closed parent → reopen/link/re-close in order | S6 (+ spec) |
| Injected transport; specs cover parse/diff/conflict/closed-parent | S4 (suite: 32/32) |
| Both repos | S1, S4 |

## Regression / smoke

- [x] `npx jest` — 312/312 suites, 5608 tests green.
- [x] `npx tsc --noEmit` on touched files — clean.
- [x] No app code touched — topic-viewer reads the same contract; only
      GitHub metadata changed (the fix's whole point).

## Findings

- 132 conflicts + 14 superseded + 5 unresolved + 4 blocked — all
  report-only, documented in the review doc and #1524's completion
  comment. Reparenting policy is an open decision (follow-up scope).
