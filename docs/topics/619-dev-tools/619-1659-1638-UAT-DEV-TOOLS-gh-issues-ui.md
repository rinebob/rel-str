**Topic:** DEV-TOOLS: GitHub issue UI  
**Topic Slug:** dev-tools  
**Thread:** FE Blueprint: topic-viewer lazy loading  
**Thread Slug:** topic-viewer-lazy  
**Issue:** #1659  
**Thread Parent:** #1634  
**Topic Parent:** #619  
**Task:** #1638  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-22  
**Last Updated:** 2026-11-22  

# UAT — #1638 service wrappers + page skeleton/retry/progressive all-topics

## Scope

- Right-pane tree states: unselected placeholder, loading skeleton,
  loaded tree, error + Retry (`data-testid="tree-error-retry"`).
- Progressive all-topics: every filtered topic gets a section block
  (`loading`/`error`/`ready`), sections populate as tree fetches land,
  per-section Retry.
- Refresh button disabled while the index or any subtree is loading.
- Rate-limit drain notice (`data-testid="allsec-drain"`) + Resume
  (`data-testid="allsec-resume"`) re-arms the bounded queue.
- Match-count badge counts fetched trees only.
- `CallableName` parity vs `functions/src/index.ts` (spec-verified).

## Prerequisites

- Dev server already serving the current working tree at
  `http://localhost:4200` (the one you normally keep running).
- Chrome/Edge DevTools available (Network panel throttling dropdown).
- Real data the scenarios reference:
  - `#619` — open Topic, appears in the left pane of `rinebob/rel-str`.
  - `#114` — *Topic: Options Strategy Engine — Hybrid Quote Provider* —
    the repo's only **closed** Topic; appears in the left pane only when
    **Show closed** is checked.

## Getting to the feature

1. Open `http://localhost:4200/tools/topic-viewer` directly, OR
2. From the app shell: nav section **Tools → Topic Viewer**.
3. The page lands on the topic-viewer surface: repo dropdown,
   controls row (search, sort toggle, **All topics**, **Show closed**,
   **Refresh**), left topic list, right detail pane.

## Automated evidence

| Check | Command | Result |
|---|---|---|
| Focused suite | `npx jest src/app/features/topic-viewer/` | **PASS — 115/115** (4 suites) |
| Types | `npx tsc -p tsconfig.app.json --noEmit` | **PASS — clean** |
| Review | `docs/topics/619-dev-tools/619-1634-1638-CODE-REVIEW-DEV-TOOLS-gh-issues-ui.md` | **PASS** — all three axes |

The store-level guarantees (memo dedupe, queue bound/drain, epoch
guards, error isolation) are spec-pinned by the suite above; the browser
scenarios below verify the *rendered* states the suite stubs behind
fixtures.

## Scenarios

### S1 — Selection loading state (fresh fetch)

**Feature:** right pane shows the standard `dse-spinner` + "Loading
topic tree…" while a topic's first fetch is in flight — not the
unselected placeholder.
**Starting state:** page just loaded (memo empty — reload the tab first
so `#619` is not already cached).
**Steps:**
1. Reload `http://localhost:4200/tools/topic-viewer`.
2. Click the `#619` row in the left pane.
**Expected:** the right pane immediately shows a centered spinner +
"Loading topic tree…", then the #619 tree renders. No "Select a Topic
to view its lifecycle tree" flash.
**Result/evidence:** PASS — user-verified 2026-11-22 ("the page works
great"); spinner centered in-gate post-report

### S2 — Selection error + Retry (deterministic, via offline throttle)

**Feature:** a failed `getLifecycleTopicTree` fetch shows an inline
error + Retry in the right pane; Retry refetches.
**Steps:**
1. DevTools → **Network** panel → throttling dropdown (says "No
   throttling", top toolbar) → select **Offline**.
2. With the page loaded, click `#619` (or any unfetched topic).
3. Observe the error block; then switch throttling back to **No
   throttling** and click **Retry**.
**Expected:** the right pane shows `#619 — functions/internal` (or a
network-error message) plus a **Retry** button — the left pane and
header stay healthy. After going back online, one Retry re-fetches and
the tree renders.
**Cleanup:** restore "No throttling".
**Result/evidence:** BLOCKED — user could not locate request blocking;
scenario not executed (error path remains spec-pinned by
`topic-viewer-page.component.spec.ts` tree-error/retry specs).

### S3 — All-topics: progressive per-section rendering

**Feature:** enabling **All topics** renders group headers + a section
block for every filtered topic immediately; each section flips
loading → tree as its own fetch lands.
**Starting state:** DevTools throttling on "No throttling".
**Steps:**
1. Reload the page.
2. Check the **All topics** checkbox in the controls row.
**Expected:** the right pane immediately shows group section headers
(e.g. the same group names the left pane shows under "Grouped" sort)
with a small spinner under each unfetched topic row — all filtered
topics get a block up front. Sections then populate with real trees
progressively, roughly 4 at a time, in left-pane order. Topics already
fetched (any you clicked earlier) render instantly.
**Result/evidence:** PASS — user-verified 2026-11-22 (progressive
sections observed; noted the group names themselves are outdated —
tracked as #1667)

### S4 — All-topics: per-section error isolation + retry

**Feature:** tree failures isolate to their own section; one section's
Retry touches only that topic.
**Steps:**
1. DevTools → **Network** → throttling dropdown → **Offline**.
2. Check **All topics**.
3. Observe the sections; restore **No throttling**; click **Retry** on
   exactly one section (e.g. `#619`'s).
**Expected:** every unfetched section shows its own
`#N — functions/internal` block + Retry — failures do not collapse the
page or poison other sections. The retried section alone re-fetches
and renders its tree; sibling sections remain errored until their own
Retry.
**Cleanup:** restore "No throttling", uncheck **All topics**.
**Result/evidence:** BLOCKED — same as S2 (offline path not executed;
per-section error isolation remains spec-pinned).

### S5 — Rate-limit drain + Resume (conditional)

**Feature:** a `resource-exhausted` class error drains the queue and
surfaces a notice + Resume.
**Note:** this requires a *real* GitHub API rate-limit trip — request
blocking produces `internal`, which correctly does NOT drain. If no
rate-limit event occurs during your session, mark this **N/A**; the
behavior is spec-pinned by `topic-viewer.store.spec.ts`
(rate-limit drain + `resumeAllTopics` re-arm specs).
**Expected if observed:** the queue stops dispatching; a notice reading
"Fetching paused — GitHub rate limit hit" appears above the sections
with a **Resume** button; already-fetched trees stay rendered; Resume
re-arms the queue and remaining sections fill in.
**Result/evidence:** N/A — no real rate-limit event during the session;
spec-pinned

### S6 — Refresh gated while loading

**Feature:** the **Refresh** button is disabled while the index or any
subtree fetch is in flight.
**Steps:** during S3 (all-topics fetching) — or immediately after
clicking **Refresh** — observe the button.
**Expected:** **Refresh** is visibly disabled until all outstanding
fetches settle, then re-enables.
**Result/evidence:** PASS — user-verified 2026-11-22

### S7 — Closed topics + match-count honesty (regression)

**Feature:** **Show closed** surfaces closed Topics; match counts cover
fetched trees only.
**Steps:**
1. Uncheck **All topics**. Check **Show closed**.
2. Scroll the left pane to find `#114` — *Options Strategy Engine —
   Hybrid Quote Provider* — rendered with closed styling
   (dimmed/italic).
3. Click `#619`, let its tree load, then type `qa` in the search field
   and note the match-count badge.
**Expected:** `#114` appears only while **Show closed** is checked —
this is the repo's one closed Topic; unchecking the box removes it.
The match badge counts matches inside `#619`'s fetched tree only —
unfetched topics never inflate the count.
**Result/evidence:** PASS — user-verified 2026-11-22 (#114 confirmed
via Show closed)

## Manual UI/UX refinement pass

- Loading spinner matches the app-standard `dse-spinner` treatment
  seen elsewhere — no bespoke loading pattern on this surface.
- Per-section error blocks sit cleanly inside their sections; Retry
  buttons are reachable and legible at your normal viewport.
- Loading → tree transition has no layout jump; group headers stay
  stable while sections populate.
- Drain banner (if S5 observed) reads as a notice, not a fatal error.

## Findings

- **Spinner alignment** — selection-loading block rendered top-left
  instead of centered; fixed in-gate (`.topic-state.column` → centered).
- **Outdated grouping data** — all-topics group names/assignment are
  stale with no maintenance path; captured as #1667 — *Topic Viewer:
  revisit topic grouping — stale groupOrder data, no CRUD/maintenance
  path*.
- **S2/S4 scenario ergonomics** — DevTools request blocking not
  discoverable enough; scenarios rewritten to the Network throttling
  dropdown.

## Traceability

| Acceptance criterion | Scenario(s) |
|---|---|
| CallableName parity vs `functions/src/index.ts` | Automated evidence (service spec) |
| Right pane: unselected / loading / loaded / error+retry | S1, S2 |
| All-topics: skeletons, independent sections, per-section retry | S3, S4 |
| Refresh disabled while loading | S6 |
| Match badge counts fetched trees only | S7 |
| Rate-limit drain + resume | S5 |
| jest + tsc green | Automated evidence |

## Regression / smoke

- Query filtering, sort toggle (Grouped | Issue #), expand/collapse,
  Labels button + label writes, repo switching — covered by S7 smoke
  plus the 115-spec focused suite (untouched behaviors pinned).

## Verdict

**PASS** — S1, S3, S6, S7 user-verified; S2/S4 error-path scenarios
BLOCKED by tooling discoverability (error states stay spec-pinned by
the 115-spec focused suite); S5 N/A (no rate-limit event). No functional
defects found; one polish finding (spinner alignment) fixed in-gate.

## Results log

- 2026-11-22 — Automated: focused 115/115, tsc clean (gate evidence).
- 2026-11-22 — Doc rewritten per proj-qa template after user feedback:
  concrete topics (#619, #114), deterministic request-blocking error
  trigger, `### S{N}` blocks, template section order restored.
- 2026-11-22 — Skeleton-shimmer loading treatment reverted to the
  app-standard `dse-spinner` (unannounced pattern deviation; a
  shimmer-skeleton standardization task is filed under Thread #1101 —
  Widget Layer). S1/S3 expectations updated.
- 2026-11-22 — UAT verdict PASS recorded (user pass + in-gate spinner
  fix); #1667 filed for stale groupOrder/grouping maintenance.
