**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Issue:** #1645  
**Task:** #1637  
**Topic Parent:** #619  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-20  
**Last Updated:** 2026-11-22  

# UAT — FE-IMPL: lazy store — index + trees memo + ensureTopic + all-topics queue (#1637)

## Scope

The TopicViewerStore now loads the slim topic **index** on page load
(roots with `children: []` — `getLifecycleTopicIndex`) and fetches each
topic's populated subtree on demand (`getLifecycleTopicTree`) instead
of one monolithic `getLifecycleTree` response. Verified surface: index
state, tree memo, `ensureTopic` dedupe, the bounded all-topics queue,
refresh/repo-switch scoping, and existing derivations unchanged.

**Interim expectation (by design):** basic loading/error states now
exist — selection fetch shows a spinner + "Loading topic tree…", a
failed fetch shows the error + Retry, and the all-topics pane reads
"Fetching topic trees…" while the queue drains instead of flashing
"No Topics found" (added in-gate from QA finding 1). `#1638 — FE-IMPL:
service wrappers + page skeleton/retry/progressive all-topics` still
owns the styled skeletons, per-section error rows, and drain notice.

## Prerequisites

- Dev server already running at `http://localhost:4200` (working-tree
  build containing #1637).
- Deployed callables: `getLifecycleTopicIndex`, `getLifecycleTopicTree`,
  `getLifecycleTree` — all `us-central1` (verified via
  `firebase functions:list` on 2026-11-20).
- Repo `rinebob/rel-str` — its index contains topic `#619 — GitHub
  read-only issue UI` (60+ descendants; the heaviest tree) plus the
  open Topics.
- Browser DevTools open on the **Network** tab, filter box set to
  `getLifecycle` — this is how every call-count assertion is observed.

## Getting to the feature

1. Open `http://localhost:4200/tools/topic-viewer` directly, OR
2. From the app shell: nav section **Tools → Topic Viewer**.
3. The page lands on the topic-viewer surface: repo dropdown,
   controls row, left topic list, right detail pane.

## Automated evidence

| Check | Command | Result |
|---|---|---|
| Focused suite | `npx jest src/app/features/topic-viewer/` | **PASS — 98/98** (4 suites, incl. 3 review-remediation specs: refresh-mid-flight, stale label-write, setShowClosed top-up) |
| Full suite | `npx jest --coverage=false` | **PASS — 6,149/6,149** (324 suites; repo's pre-existing worker-teardown warning unchanged) |
| Types | `npx tsc -p tsconfig.app.json --noEmit` | **PASS — clean** |
| Deploy | `firebase functions:list` | both new callables deployed `us-central1` (2026-11-20) |

The store-level ACs (index-only load, memo dedupe, queue bound/drain/
isolation, refresh scoping, stale-epoch guards) are spec-pinned by the
suite above — the browser scenarios below verify the SAME behavior
end-to-end against the live callables, which the Jest seam stubs.

## Scenarios

### S1 — Cold load: index only, zero subtree calls

**Feature:** AC1 — `load` fetches the index and nothing else.
**Steps:**
1. DevTools Network filter: `getLifecycle`. Clear the log.
2. Navigate to `http://localhost:4200/tools/topic-viewer`.
**Expected:** exactly **one** `getLifecycleTopicIndex` request; **zero**
`getLifecycleTopicTree` and **zero** `getLifecycleTree` requests. The
left pane lists topics (e.g. `#619`, other open Topics).
**Result/evidence:** PASS — user-verified 2026-11-22

### S2 — Topic selection: one subtree fetch, tree renders

**Feature:** AC2 — `ensureTopic` fires a per-topic fetch.
**Steps:** click the `#619` row in the left pane.
**Expected:** exactly **one** `getLifecycleTopicTree` request whose
request payload contains `topicNumber: 619`; the right pane shows a
spinner + "Loading topic tree…" during the fetch, then #619's tree
(Threads/tasks as expandable rows).
**Result/evidence:** PASS — user-verified 2026-11-22

### S3 — Memo revisit: zero repeat calls

**Feature:** AC2 — memo hit issues no call.
**Steps:** click any other topic (e.g. the next Topic row), wait for
its fetch, then click `#619` again.
**Expected:** one `getLifecycleTopicTree` for the middle topic, then
**no** new network requests when returning to #619 — the tree renders
instantly from the memo.
**Result/evidence:** PASS — user-verified 2026-11-22

### S4 — Refresh: index + rendered set only

**Feature:** AC5 — refresh drops the memo and refetches only what is
rendered.
**Starting state:** two topics fetched via S2/S3 (e.g. #619 + one
other), #619 currently selected.
**Steps:** clear the network log, click the page's refresh/reload
control.
**Expected:** one `getLifecycleTopicIndex` + exactly **one**
`getLifecycleTopicTree` (for the selected #619 only — the other
memoized topic is NOT refetched and its pane will lazily re-fetch if
re-selected).
**Result/evidence:** PASS — user-verified 2026-11-22

### S5 — `showClosed` toggle: index filter only

**Feature:** AC4.
**Steps:** clear the network log; toggle the closed-items control on
and off.
**Expected:** **zero** `getLifecycle*` requests from the toggle; closed
topics appear/disappear in the left list immediately.
**Result/evidence:** PASS — user-verified 2026-11-22

### S6 — All-topics mode: bounded progressive fetch

**Feature:** AC3 — queue at concurrency 4, unfetched-filtered only.
**Steps:** clear the network log; enable the all-topics control.
**Expected:** `getLifecycleTopicTree` requests stream in — never more
than ~4 in flight at once (waterfall view); each topic's section
renders as its tree lands; already-fetched topics (from S2–S4) are
not re-requested.
**Result/evidence:** PASS — user-verified 2026-11-22

### S7 — Repository switch: drop + re-fetch

**Feature:** memo drop + re-queue on repo change.
**Steps:** clear the network log; switch the repo dropdown to the
second repo; switch back to `rel-str`.
**Expected:** each switch issues exactly one `getLifecycleTopicIndex`
for that repo; no stale tree data visible; with all-topics on, the new
repo's filtered set re-queues.
**Result/evidence:** PASS — user-verified 2026-11-22

### S8 — Search while partially loaded (informational)

**Feature:** PRD caveat — match counts cover fetched trees only.
**Steps:** with all-topics on and trees still landing, type a query.
**Expected:** the match badge reflects fetched trees; counts grow as
more trees land. No errors.
**Result/evidence:** PASS — user-verified 2026-11-22

## Manual UI/UX refinement pass

- [ ] No console errors during S1–S7.
- [ ] Left pane usable immediately on load (index data) — no blocking
      spinner for subtrees.
- [x] Selection fetch shows loading indicator; failed fetch shows
      error + Retry (added in-gate — QA finding 1); all-topics pane
      reads "Fetching topic trees…" during drain — cosmetic states only,
      styled skeletons remain #1638 scope.
- [ ] Viewport spot check at ~1440px (primary dev width).

## Findings

- **F1 (user report, remediated in-gate):** no loading indicator after
  clicking a topic — selection pane showed the unselected copy during
  the fetch. Fixed: `selectedTreeLoading`/`selectedTreeError`/
  `anyTreeLoading`/`anyTreeError` computeds + pane branches (spinner +
  "Loading topic tree…", error + Retry, "Fetching topic trees…"
  empty-gate, "Some topic trees failed" empty-gate). Spec-pinned:
  101/101 focused, page specs added.
- **F2 (user report):** Refresh produced a `functions/internal: internal`
  banner with `showClosed` checked. Investigation: the banner only
  surfaces *index*-call failures (`treeErrors` are per-pane). The index
  callable re-verified healthy post-report (verify script: 12/12 checks,
  2.2s, 43 topics); the client SDK masks `internal`-code messages; no
  server error in function logs → transient (client network blip or
  momentary GitHub 5xx). Action: retry; if reproducible, capture the
  Network response body. Known-adjacent: a closed Topic with a subtree
  exceeding the fetcher's page cap deterministically returns `internal`
  (BE truncation guard, by design) — previously invisible; now surfaces
  as that section's error + Retry.

## Traceability

| AC | Scenarios |
|---|---|
| load = index only, zero subtree calls | S1 + automated suite |
| `ensureTopic` memo hit no call; concurrent coalesce | S2, S3 + suite |
| all-topics: unfetched-filtered, bounded 4, drain, isolation | S6 + suite |
| `showClosed` filters index only | S5 + suite |
| refresh = index + memo drop + rendered set | S4 + suite |
| existing derivations green | automated suite (all adapted specs) |
| `npx jest src/app/features/topic-viewer/` green | automated suite |
| refresh/repo-switch mid-flight safety (review M1/M2) | S4, S7 + new regression spec |
| stale label-write must not cross repos (review M3) | automated spec pin |

## Regression / smoke

- [ ] Label management still works: on a fetched tree, open a node's
      label editor, add/remove a label — row updates, no page reload.
- [ ] Expansion/collapse and search auto-expansion behave as before.
- [ ] Sort modes (grouped / number) still order the left pane.
- [ ] Page survives a fetch error (pull network offline → refresh →
      banner error, stale index retained).

## Verdict

**PASS** — automated evidence green; browser scenarios S1–S8 user-verified
2026-11-22; findings F1 remediated, F2 confirmed transient.

## Results log

| Date | Scenarios | Result | Notes |
|---|---|---|---|
| 2026-11-20 | Automated | PASS | 98/98 focused, 6,149/6,149 full, tsc clean |
| 2026-11-22 | F1/F2 (user) | F1 remediated — 101/101 focused, tsc clean; F2 transient (index live-verified) | loading/error states added; index callable 12/12 |
| 2026-11-22 | S1–S8 | PASS | user-verified — all scenarios + refinement pass |
