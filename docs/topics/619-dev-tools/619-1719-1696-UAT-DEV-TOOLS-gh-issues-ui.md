**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1719  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1696  
**Domain:** DEV-TOOLS  
**Type:** UAT  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-24  

# UAT — #1696: FE digit-query → issue-map resolution + ancestor expand + highlight

## Scope

Task `#1696` makes the Topic Viewer's search box resolve **any issue
number** to its owning Topic — not just Topic roots. Pure-digit queries
(`154`, `#154`) that miss every visible root consult the backend
`issueMap` (issue → root Topic); on a hit the owning Topic is selected,
its subtree fetched, the target's ancestors auto-expanded, and the row
highlighted with a `.resolved` style distinct from the query `.match`
tint. On a map miss or stale entry, the `resolveLifecycleIssue`
callable walks the GitHub parent chain once; issues with no `Topic:`
ancestor report an honest not-in-tree note, nonexistent numbers a
not-found note — never a bare generic empty list.

## Prerequisites

- Angular dev server already running at `http://localhost:4200` (this
  session's `npm start`; watches the working tree, which contains the
  `#1696` changes — uncommitted).
- Signed-in GitHub-authenticated session (the page is behind
  `authGuard`; use the account already configured for this app).
- **Backend deployed:** `resolveLifecycleIssue` and the
  `issueMap`-emitting `getLifecycleTopicIndex` must be live —
  `firebase deploy --only functions` from the `#1695` commits
  (`b3bf5206`/`f10954af`/`681cd84c`/`fbd36c0c`). Verify with
  `firebase functions:list | grep resolveLifecycleIssue`.
- Seeded map doc: `gh-lifecycle-issue-map/rinebob-rel-str` contains
  ~1,418 entries (seeded live during `#1695` QA).

Concrete test data (verified 2026-11-23 against GitHub):

| Query | Expected root | Why |
|-------|---------------|-----|
| `1696` | `#619` — TOPIC: GitHub read-only issue UI | in the seeded issueMap |
| `1719` | `#619` | created after the seed → guaranteed map miss → resolver path |
| `1453` | none | "BUG: st-cloud-function endpoints accept unauthenti…" — no parent → not-in-tree |
| `999999` | none | does not exist → not-found |
| `1695` | `#619` | CLOSED issue → closed-hidden note when Show closed off |
| `2`-style root numbers | root itself | stays on index predicate — no deep resolution |

## Getting to the feature

1. Open `http://localhost:4200/tools/topic-viewer` in the signed-in
   browser (nav: sidebar → Topic Viewer — `account_tree` icon, under
   the tools group).
2. Surface: left pane lists topic rows; right pane shows the selected
   topic's issue tree; search input sits above the left pane next to
   the Show closed / Show all toggles.
3. Repository selector (top of left pane) defaults to
   `rinebob/rel-str` — all scenarios below use it.

## Automated evidence

- `npx jest src/app/features/topic-viewer` — **5/5 suites, 149/149
  specs** (2026-11-23). Covers: map hit, miss→resolver hit, pathless
  not-in-tree, not-found, stale→exactly-once (asserted both
  directions), debounce-once, debounce-kill on supersede, in-flight
  supersession, repo-switch epoch, visible-root skip, retype no-op,
  closed-hidden note, root pull-in (single + all-topics), suppression
  lift, tree-fetch failure, no-phantom-root.
- `npx tsc --noEmit` — clean on all topic-viewer files.
- `npx jest` full suite — **332/332 suites, 6,348/6,348** at
  implementation close.
- Code review `619-1694-1696-CODE-REVIEW-DEV-TOOLS-gh-issues-ui.md` —
  PASS, all majors remediated in-gate.

## Scenarios

### S1 — Map hit resolves + expands + highlights

**Feature:** `issueMap` fast path (no callable).
**Steps:** clear the search box → type `1696` → wait ~0.5 s.
**Expected:** a scoped note shows "Resolving #1696…" briefly; the left
pane keeps root `#619` visible (it doesn't match "1696" textually but
stays because it owns the resolution); the tree selects #619, expands
`#1609` → `#1694`, and the `#1696` row carries the resolved highlight
(visibly different tint/ring from search-match rows); note becomes
"Resolved #1696" or clears.
**Evidence:**

### S2 — Map miss → resolver fallback lands identically

**Feature:** `resolveLifecycleIssue` path + self-heal.
**Steps:** clear the box → type `1719` → wait.
**Expected:** resolving note → tree lands on `#1719` under
`#619`/`#1609`/`#1694`/`#1696` ancestors expanded. (The resolver walks
the live GitHub parent chain; the map self-heals for next time.)
**Evidence:**

### S3 — Not-in-tree honest note

**Feature:** pathless resolver response.
**Steps:** clear → type `1453` → wait.
**Expected:** note reads `Issue #1453 — BUG: st-cloud-function
endpoints accept unauthenti… — isn't in a lifecycle tree`; no root is
pulled into the list; left pane may show the generic filtered-empty
state beneath the note.
**Evidence:**

### S4 — Not-found honest note

**Feature:** resolver `not-found` error mapping.
**Steps:** clear → type `999999` → wait.
**Expected:** note reads `Issue #999999 doesn't exist in
rinebob/rel-str` — not a bare empty list, not an error banner.
**Evidence:**

### S5 — Closed-hidden honest hint

**Feature:** resolved-but-hidden messaging.
**Steps:** ensure **Show closed is OFF** → clear → type `1695` → wait.
**Expected:** tree selects `#619`; note reads `Issue #1695 is closed —
enable Show closed to see it` (or "sits under a closed ancestor");
toggle Show closed ON → the `#1695` row appears resolved-highlighted.
**Evidence:**

### S6 — Superseding keystroke kills pending resolution

**Feature:** debounce + seq guard (the AC6 review fix).
**Steps:** clear → type `169` → **quickly** (inside ~0.35 s) append `x`
so the box reads `169x` → wait 1 s.
**Expected:** no resolution fires — no root switch, no note, no
resolved row. The pending debounce was cancelled by the superseding
non-digit query.
**Evidence:**

### S7 — Visible-root numbers stay on index matching

**Feature:** root-number matching unchanged (no deep resolution when a
visible root matches).
**Steps:** type a real visible root number shown in the left pane
(e.g. `619` while #619 is listed — or any root number displayed).
**Expected:** normal search-filter behavior only — the root matches
textually; no resolving note ever appears.
**Evidence:**

### S8 — Match counts and list behavior unchanged

**Feature:** no regression to filtering/counting.
**Steps:** type `QA` (a label/title substring) → observe filtered list
and any match-count display → type `abc` (matches nothing) → list
empties normally.
**Expected:** ordinary filtering identical to pre-feature behavior;
no resolution notes for non-digit queries.
**Evidence:**

### S9 — Repo switch mid-resolution discards landing (if second repo enabled)

**Feature:** epoch guard across `selectRepo`.
**Steps:** start typing `1719` → immediately switch the repository
selector to `av-proxy-api` before the landing completes.
**Expected:** no stale landing into the new repo's view; resolution
state cleared. (If the repo selector is disabled/single-repo, mark
N/A — spec-covered.)
**Evidence:**

### S10 — Stale map entry self-heals (scripted probe)

**Feature:** stale-entry → resolver once → heal.
**Setup:** using the Firestore admin path used by the `#1695` verify
scripts, set `gh-lifecycle-issue-map/rinebob-rel-str` entry `1696` to
point at root `4` (a wrong root), then in the UI type `1696`.
**Expected:** the fetched `#4` tree lacks #1696 → resolver fires once
→ lands under `#619`; a doc re-read shows `1696 → 619` healed.
(Skip if no safe write path — spec-covered: `stale map entry →
resolver once` + `toHaveBeenCalledTimes(1)`.)
**Evidence:**

## Manual UI/UX refinement pass

- [ ] The scoped resolution note is readable in both light/dark theme,
      positioned near the search box, and does NOT block interaction
      with the left pane while resolving.
- [ ] `.resolved` highlight is visibly distinct from `.match` tint on a
      real tree — run S1, then search `QA` and compare a match row.
- [ ] Note copy is honest per phase (resolving / resolved /
      not-in-tree / not-found / error / hidden-under-closed).
- [ ] No layout jank: the resolved root's pull-in doesn't shift the
      list erratically; tree scroll keeps the resolved row visible.
- [ ] Keyboard: typing/deleting quickly never triggers a visible
      flicker of wrong-root selection.

## Findings

- None yet.

## Traceability

| AC | Scenario(s) |
|----|-------------|
| AC1 issueMap memoized lookup (repo-keyed, epoch-guarded) | S1, S9 |
| AC2 digit query → select+fetch+walk+expand+highlight | S1, S2 |
| AC3 resolved highlight distinct from match | S1 + refinement pass |
| AC4 miss → resolver; not-in-tree/not-found honest notes | S2, S3, S4 |
| AC5 stale entry → resolver once | S10 (or spec evidence) |
| AC6 responsive, scoped indicator, supersession | S6, S9 |
| AC7 spec coverage listed | Automated evidence |
| Note: root-number matching unchanged | S7, S8 |
| Note: match-count semantics unchanged | S8 |

## Regression / smoke

- [ ] Ordinary substring search (`QA`, title fragments) filters as
      before — S8.
- [ ] Root-number query (`619`) uses index predicate — S7.
- [ ] Topic selection/expansion by clicking rows unchanged.
- [ ] Show closed toggle behaves as before for non-resolution flows.
- [ ] Show all topics progressive fetch unaffected by resolution
      state.
- [ ] Labels/label management UI untouched (task `#1533` remains
      deferred — no regression expected).

## Verdict

{PASS | FAIL | BLOCKED} — {summary}

## Results log

| Date | Scenario | Result | Evidence |
|------|----------|--------|----------|
| 2026-11-23 | Backend deploy + data | PASS | `firebase functions:list` shows `resolveLifecycleIssue` v2 callable live; unauthenticated POST → `UNAUTHENTICATED` (auth gate enforced). Map doc `gh-lifecycle-issue-map/rinebob-rel-str` read via admin SDK: 1,418 entries — `1696→619`, `1695→619` (closed), `154→137`, `619→619`, `1719` ABSENT (resolver-miss case), `1453` ABSENT (not-in-tree case). |
| 2026-11-24 | S1–S9 + refinement pass | PASS (user-verified) | Live walkthrough at `http://localhost:4200/tools/topic-viewer` — map-hit land + highlight (`1696`), resolver-miss land (`1719`), not-in-tree note (`1453`), not-found note (`999999`), closed-hidden hint (`1695`), debounce supersession (`169x`), self-root predicate (`619`), substring regression, repo-switch discard — all green. |
| 2026-11-24 | F1 — note placement | FIXED | Resolution note rendered inline in the controls header — it pushed `Grouped`/`Issue #`/`Labels`/`Show closed` onto a new line on appearance. Moved to its own row below the controls (banner-style); controls no longer shift. Verified live + 40/40 page specs. |
| 2026-11-24 | S10 — stale-map retry | SKIPPED | Requires a deliberate stale map-doc write; behavior pinned by `topic-viewer-deep-resolve.spec.ts` (one-retry spec). |
