**Topic:** GitHub read-only issue UI  
**Topic Slug:** `gh-issues-ui`  
**Thread:** Lifecycle tree fetch performance & caching  
**Thread Slug:** `lazy-loading`  
**Issue:** #1694  
**Thread Parent:** #1609  
**Topic Parent:** #619  
**Task:** #1696  
**Domain:** DEV-TOOLS  
**Type:** CODE-REVIEW  
**Status:** Complete  
**Created:** 2026-11-23  
**Last Updated:** 2026-11-24  

# Code Review — #1696: FE-IMPL digit-query → issue-map resolution + ancestor expand + highlight

Gate review of the frontend deep issue-number search: index-emitted
`issueMap` consumption, `topic-viewer-deep-resolve.ts` orchestration
module (map hit → select+fetch+walk+expand+highlight; miss/stale →
single `resolveLifecycleIssue` fallback; `resolving`/`resolved`/
`not-in-tree`/`not-found`/`error` phases), `resolveSeq` supersession,
`.resolved` tree highlight distinct from `.match`, and the page's
scoped resolution note.

## First pass findings

Three parallel axes (Standards, Spec, Thermo-nuclear):

| Sev | Finding | Axis | Disposition |
|-----|---------|------|-------------|
| MAJOR | **AC6 supersede hole** — a debounce-armed-but-unfired resolution survived a superseding query: `scheduleResolve` bumps `resolveSeq` but leaves `issueResolution` null, so `setQuery`'s else-branch (`cur !== null \|\| resolvedNodeNumber !== null`) never cleared the timer. `'30'` → `'30x'` inside 350 ms still resolved #30 under a non-digit query | Spec (verified in-gate) | **Fixed** — else-branch now clears `debounceTimer` unconditionally and retires state when a timer was pending; regression spec `a superseding keystroke inside the debounce window kills the pending resolution` |
| MAJOR | `resolvedIssueMap` client-side overlay duplicated backend-owned map knowledge — a second `number→root` source merged over `response.issueMap` | Thermo | **Fixed (judo)** — learned path entries now fold into `response.issueMap` itself (`learnPath`), matching the `patchLabelsInResponse` precedent: one source of truth, repo-keyed/epoch-guarded for free since `response` is replaced on repo switch/refresh. Deleted the state field, two-source merge, host member, and `dropMemo` reset |
| MAJOR (letter) | `topic-viewer.store.spec.ts` reached ~1,760 lines — the change deepened a pre-existing >1k violation | Standards | **Fixed** — four #1696 describes moved to `topic-viewer-deep-resolve.spec.ts` (582 lines); shared fixtures/stubs extracted to `topic-viewer.store.testbed.ts` (84 lines), eliminating the 4× `DEEP`/`svc` duplication in the process. Store spec residual 1,115 lines remains >1k — **pre-existing violation, not deepened by this change**; the testbed now exists for a further split |
| MINOR | `IssueResolution` wasn't a discriminated union — `phase: 'resolved'` admitted `rootNumber: null`, which `resolutionCopy` could interpolate as `#null` | Thermo | **Fixed** — real DU: `resolved` requires `rootNumber: number` |
| MINOR | Dead seam surface — `DeepResolveHost.issueResolution` never read; `findPathTo` exported with no external consumer | Thermo, Standards | **Fixed** — member removed, function unexported |
| MINOR | Inlined `{ owner; repo; issueNumber }` request shape + inline `import('@lifecycle/contracts')` bypassed the canonical contract | Standards | **Fixed** — `LifecycleResolveIssueRequest`/`LifecycleResolveIssueResponse` hoisted into the type-import block |
| MINOR | `errMessage` duplicated verbatim between store and module | Standards, Thermo | **Fixed** — exported once from `topic-viewer-deep-resolve.ts`, store imports it |
| MINOR | Debounce timer never cleared on store destroy — a pending fire could patch a dead store (spec teardown, route-away) | Thermo | **Fixed** — `inject(DestroyRef).onDestroy` clears it inside the `withMethods` closure |
| MINOR | `if (!repo) return` silently abandoned the `resolving` note | Thermo | **Fixed** — patches an honest `error` phase instead (unreachable today with the constant repo list) |
| MINOR | `landOn` tree-fetch-failure `LandOutcome` untested | Thermo | **Fixed** — spec `a tree-fetch failure on the resolved root reports error, not silence` asserts phase/root/message |
| NIT | Digit grammar duplicated between `matchesQuery` and `deepResolveCandidate` | Standards | **Fixed** — `matchesQuery` reuses `deepResolveCandidate` |
| NIT | Spec indentation drift inside a `try` block | Standards | **Fixed** |
| NIT | Suppression-lift comment overstated its reach — `selectRoot` already clears suppressions when selection differs | Thermo | **Fixed** — comment narrowed to the same-root re-resolution case |

### Deferred minors (accepted, documented)

- **Resolved-root pull-in ignores `showClosed`** — a closed resolved
  root renders its section skeleton while Show closed is off. Kept:
  it anchors the "issue sits under a closed ancestor — enable Show
  closed" note that explains the hidden landing.
- **Generic `No topics match` copy coexists with the not-found note** —
  the scoped note is the honest state AC4 requires; the empty-list copy
  beneath it is standard filtered-empty behavior. Cosmetic.
- **`selectRoot` before `ensureTopic` on a stale map hit** — a stale
  entry momentarily selects the wrong root until the callable fallback
  corrects it. Transient and self-correcting.

## Second pass findings

Serial re-check over the remediated diff and the union of all three
axes' coverage:

- Verified the AC6 fix through the real seam — the new spec drives
  `setQuery('30')` → `setQuery('30x')` inside fake timers and asserts
  the callable never fires. The earlier post-fire supersession spec
  still guards the in-flight path.
- Verified `learnPath` ordering: both call sites patch `response` only
  *after* the `resolveSeq` re-check, so a superseded continuation
  cannot clobber current state — same invariant the overlay had.
- Verified learned-entry epoch semantics are unchanged: `response` is
  replaced on `selectRepo`/`refresh`, which is exactly when
  `dropMemo` used to clear the overlay.
- Verified no spec was lost in the file split (149 = 147 + 2 new
  regression specs; one `it` dropped during fixture dedup was caught
  by the count check and restored).
- Verified no `resolvedIssueMap` references remain; the module is 270
  lines, the store 975 lines — both under the 1k ceiling.
- No new findings.

## Test results

- `npx jest src/app/features/topic-viewer` — **5/5 suites, 149/149
  specs** (was 147 pre-review + 2 remediation regressions).
- `npx jest` full suite — **332/332 suites, 6,348/6,348 specs**
  (run at implementation close; the remediation delta is confined to
  topic-viewer, re-run green).
- `npx tsc --noEmit` — clean on all topic-viewer files; pre-existing
  errors elsewhere in the repo unchanged.
- Coverage: every AC has dedicated specs — map hit, resolving
  indicator, miss→resolver hit, pathless not-in-tree, not-found, infra
  error, stale→exactly-once (asserted `toHaveBeenCalledTimes(1)` both
  directions), debounce-once, debounce-kill on supersede, in-flight
  supersession, repo-switch epoch, visible-root skip, retype no-op,
  closed-hidden note, root pull-in (single + all-topics), suppression
  lift, tree-fetch failure, no-phantom-root on not-found.

## Verdict

**PASS** — all critical/major findings remediated in-gate and
re-verified green; remaining minors deferred and documented above.

Pass sequence: first pass → 3 majors + minors across axes → in-gate
remediation → second pass → no new findings, remediations verified →
converged.
