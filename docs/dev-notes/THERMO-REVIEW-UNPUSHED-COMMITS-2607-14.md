# Thermo-Nuclear Review: Seven Unpushed Commits

**Review date:** 2026-07-14

## Scope and Method

Each commit was reviewed independently against its direct parent using the repository's thermo-nuclear review standard, with emphasis on structural simplicity, ownership boundaries, concurrency, atomicity, and maintainability.

- `git diff --check` passes for all seven commits.
- No changed file crosses the 1,000-line threshold.
- None of the seven commits adds or updates tests.
- No code was changed as part of this review.

---

## 1. `d383280` — Persist triage clear to Firestore

**Verdict: Request changes**

### Findings

#### [High] Clear has conflicting local and persistence scopes

The commit clears all local statuses but writes `PENDING` only for `REVIEW` and `ACCEPT`. Persisted `CONSIDER`, `REJECT`, `WATCH`, and other statuses consequently disappear in the immediate UI and reappear from Firestore after a later reload.

This is a partial-update design: a broad local reset is paired with a narrower persistence operation.

**Required direction:** define one explicit operation:

- Clear only review/accepted items locally and remotely, leaving other statuses visible; or
- Reset every affected local status and persist that same complete set.

#### [Medium] Snapshot rollback can overwrite newer actions

The error path restores the entire pre-clear `statuses` and persisted-status snapshot. If the user makes another status change while the clear write is in flight, a late failure can erase that newer change.

**Required direction:** use an operation/version token or rollback only the symbols changed by the clear operation.

### Structural assessment

Moving persistence out of a local-only reset is the right intent. The resulting operation is still too broad locally and too narrow remotely; the state transition needs an explicit, uniform scope.

---

## 2. `2a22161` — Decouple review flags from ACR

**Verdict: Request changes**

### Findings

#### [High] Startup loading can resurrect a flag the user removed

Review flags load asynchronously and merge into the current local state. If a user unflags a symbol before the initial read resolves, the stale response can merge that symbol back into `reviewFlags`.

**Required direction:** establish a load/mutation boundary:

- Complete initial hydration before mutations are available; or
- Track locally mutated symbols and prevent old load responses from overwriting them; or
- Use a correctly scoped reactive source.

#### [High] Whole-map optimistic rollbacks can erase unrelated concurrent actions

`markGroupForReview` and `clearReviewFlags` capture the entire review-flags map, optimistically replace it, and restore the complete snapshot on failure. A failed request can erase a flag change made after that request began.

**Required direction:** rollback only the symbols owned by the failed request, conditional on no newer mutation for each symbol.

#### [Medium] Failed single-symbol flagging leaves an inactive key

On failure, `markForReview` sets the symbol to `false` rather than restoring its prior existence/value. This makes the state record attempted operations, not only active flags.

**Required direction:** preserve and restore the prior key state, deleting the key when it did not exist before the attempted mutation.

### Structural assessment

Separating “review this chart” from ACR status is a strong simplification. The persistence concurrency policy is still spread across individual store methods; it should be consolidated into one mutation strategy.

---

## 3. `0d997ad` — Delegate viewport and fix navigation

**Verdict: Request changes**

### Findings

#### [High] Date-scoped decision hydration was removed from chart review

The prior page initialization loaded persisted decisions using the active run's market date as the current date. This commit removes that call and relies on store initialization, which loads a decision cache but does not populate the active status map for the selected run date.

The chart-review page can therefore show `PENDING` for a symbol with a persisted ACR decision when reviewing an existing or historical run.

**Required direction:** retain route-level, date-scoped status synchronization or establish a single active-market-date source that drives status synchronization whenever the selected run changes.

### Structural assessment

Using one viewport-symbol source for sidebar, auto-selection, index, and prev/next navigation removes a real split-brain navigation bug. The refactor accidentally removes responsibility for date-scoped decision state, which must be restored explicitly.

---

## 4. `fa848c1` — Rename `clearTriage` to `clearReviewFlags`

**Verdict: Approve**

### Findings

No substantive finding.

### Structural assessment

The rename is focused and accurately describes the behavior. It removes a misleading API name rather than adding an abstraction.

**Test gap:** no component event-wiring test was added. This is low risk for a mechanical rename.

---

## 5. `83c9b86` — Fix order removal for dateless review flags

**Verdict: Request changes**

### Findings

#### [High] Return-to-review is a coupled workflow implemented as two independent writes

Removing an order row resets the ACR status to `PENDING`, separately creates a review flag, and immediately removes the local trade row. Either Firestore write can fail independently:

- `PENDING` without a review flag makes the symbol vanish from both order and review.
- A review flag without a completed reset leaves an accepted symbol in the review queue.

**Required direction:** add one domain operation such as `returnAcceptedSymbolToReview(symbol, marketDate)` at the triage persistence boundary. It should write both documents in one Firestore batch and expose one coherent optimistic/revert policy.

### Structural assessment

The behavioral model correctly distinguishes a dateless review flag from a date-scoped ACR status. Coordination of those two concepts has leaked into the page component and belongs in the persistence/domain boundary.

---

## 6. `96b7f61` — Atomic `moveToList` batch write

**Verdict: Request changes**

### Findings

#### [High] The “atomic move” is not concurrency-safe

The service reads each list, derives replacement arrays locally, and then commits a batch. A concurrent tab/device update after the reads but before the commit can be overwritten by the stale replacement arrays.

A Firestore batch makes its final writes all-or-nothing; it does not protect the reads used to derive those writes.

**Required direction:** use a Firestore transaction for this multi-document read-modify-write invariant.

#### [Medium] The list-membership invariant is split across contradictory APIs

The new store path defines list membership as exclusive. Existing public service methods still support membership in multiple lists, and service documentation describes lists as independent.

**Required direction:** choose one invariant and enforce it in the service—the persistence boundary. If membership is exclusive, remove or restrict multi-list mutation methods rather than retaining competing paths.

#### [Medium] The service trusts caller-supplied list names

`moveToList` accepts both an unchecked target list and a caller-supplied canonical list set. A target omitted from the provided set results in no target write.

**Required direction:** type the target with the list-name enum and derive the canonical list set in the service.

### Structural assessment

Replacing separate writes with one operation is a genuine improvement. The core invariant remains split across layers and only write-atomic, rather than transaction-safe.

---

## 7. `9b39193` — Parallelize `moveToList` reads and remove merge

**Verdict: Request changes**

### Findings

#### [High] Removing merge makes changed list writes destructive to unknown fields

The batch now replaces changed list documents with only known fields: `name`, `symbols`, `userId`, `updatedAt`, and `createdAt`. Any existing metadata or future document field is silently removed.

The assertion that all fields are written only holds for the current known interface, not for persisted documents over time.

**Required direction:** retain merge semantics unless the schema explicitly guarantees these are the only allowed document fields and replacement is an intentional contract.

### Structural assessment

Parallelizing independent reads removes needless latency, and length-only comparison is valid for this add/remove transform. The merge removal broadens the write destructively and weakens forward compatibility.

---

## Risk and Likelihood Assessment

| Finding area | Likelihood | Why |
| --- | --- | --- |
| Date-scoped status hydration regression | High | Deterministic when chart review opens against persisted decisions for an active historical run. |
| Incomplete clear scope | Medium to high | Occurs whenever a clear action happens while `CONSIDER`, `REJECT`, or `WATCH` statuses exist; its impact can be delayed until reload. |
| Two-write return-to-review | Medium | Requires a failed/interrupted Firestore request, but produces an inconsistent workflow state when it occurs. |
| Optimistic rollback and startup-load races | Low to medium | Requires slow/offline persistence plus overlapping user actions or startup interaction. |
| `moveToList` concurrent read-modify-write race | Low for one user/tab; medium with tabs/devices | Requires competing clients updating symbol lists between reads and commit. |
| Destructive non-merge write | Low-frequency, high latent cost | Occurs when documents gain additional fields or contain metadata outside the current interface. |

## Overall Status

- **Approved:** `fa848c1`
- **Request changes:** `d383280`, `2a22161`, `0d997ad`, `83c9b86`, `96b7f61`, `9b39193`

The dominant concerns are state-transition scope, stale optimistic rollback, and multi-document list updates presented as atomic despite non-transactional reads. These are not all equally likely in normal single-user use, but the status-hydration regression and incomplete clear scope are direct functional issues; the remaining findings are reliability and future-maintainability risks that can be prioritized by expected usage.

---

# Reproduction and Runtime Detection Guide

## Safety and Scope

Run destructive checks only against the Firebase emulator or a dedicated non-production test account/project. Do not add test fields, deny writes, or deliberately create conflicting state in production data.

Some review findings apply only to an earlier point in the local commit stack. They cannot be reproduced at `HEAD` because a later unpushed commit replaced the relevant behavior. Those are marked **commit-only** below.

## What Requires Fast UI Interaction?

Most findings do **not** require a user to click unusually fast:

| Finding | Requires fast/repeated interaction? | Practical likelihood in normal one-tab use |
| --- | --- | --- |
| Historical chart-review status hydration | No | High if historical runs with persisted decisions are reviewed. |
| Clear scope in `d383280` | No | Medium to high when non-review ACR statuses exist; commit-only. |
| Return accepted symbol to review | No for normal behavior; failure needs an interrupted write | Low in stable connectivity; important if the app is used offline or on unreliable networks. |
| Review-flag load/rollback races | Yes, or slow startup/network | Low in ordinary use. |
| Exclusive list write race | No fast clicking required, but needs two concurrent clients | Low with one tab/device; higher with multiple tabs or devices. |
| Destructive non-merge write | No | Does not occur until documents have additional fields; deterministic once they do. |

Do not treat the overlap cases as urgent defects unless they can be reproduced in your expected operating conditions. Treat them as reliability debt with a known trigger.

## 1. `d383280` — Clear scope mismatch

**Applies:** **commit-only.** `2a22161` replaces this clear behavior with review-flag clearing, so this exact issue is not reachable at current `HEAD`.

### Reproduce

1. In a disposable environment checked out at `d383280`, create persisted ACR decisions for one market date:
   - one `REVIEW` or `ACCEPT` symbol;
   - one `WATCH`, `CONSIDER`, or `REJECT` symbol.
2. Load the page so both statuses are visible.
3. Invoke **Clear**.
4. Reload the page or navigate away and back.

### Detect an effect

- Immediately after clear, all local statuses should disappear.
- After reload, inspect the Firestore decision documents for that market date.
- If the non-`REVIEW`/`ACCEPT` decision remains and reappears in the UI, the local clear and remote persistence scopes differ.

### Interpretation

This needs no split-second interaction. It only matters if Clear was intended to erase all displayed status state. If the intended meaning was always “clear review and accepted queues only,” the behavior is a specification/UI-label issue rather than a reliability incident.

## 2. `2a22161` — Review-flag load and rollback races

**Applies:** current `HEAD`.

### Reproduce: stale startup load

1. Use a test account with at least one existing review-flag document.
2. In browser DevTools, enable a strong network throttle before loading the app. A custom high-latency profile is preferable to offline mode.
3. Navigate to the review flow and, before the initial review-flag load completes, remove that same symbol from review.
4. Wait for startup loading to finish.
5. Reload once to compare the UI with Firestore.

### Detect an effect

- The symbol reappearing in the review sidebar after the delayed load finishes is the stale-load symptom.
- Confirm Firestore has no review-flag document for the symbol. If the document is absent but the sidebar contains the symbol, the client state was resurrected by the stale load.

### Reproduce: rollback overwriting a later action

1. Use a test environment that can reject a Firestore review-flag batch write, such as the emulator or a test-project rules configuration.
2. Start a group flag or clear action that will fail.
3. Before the failure reaches the browser, make a different review-flag change.
4. Allow the original action to fail.

### Detect an effect

- Compare the sidebar state before and after the failure notification.
- If the later, unrelated flag change disappears, the whole-map rollback overwrote it.

### Interpretation

These are genuine but low-probability in stable one-tab use. DevTools offline mode alone is not conclusive because Firestore offline persistence may queue a write rather than fail it; use an emulator or controlled test-project rejection for a reliable failure case.

## 3. `0d997ad` — Historical chart-review status hydration

**Applies:** current `HEAD`.

### Reproduce

1. Choose a run whose `marketDate` is not today and create or identify a persisted ACR decision for one of its symbols.
2. Confirm the Firestore decision document contains that symbol, the chosen market date, and a non-`PENDING` status.
3. Select that run in the application.
4. Open chart review for the affected symbol.

### Detect an effect

- Compare the selected symbol's status controls or displayed status with the Firestore decision document.
- If Firestore says `ACCEPT`, `WATCH`, `CONSIDER`, or `REJECT` but chart review displays `PENDING`, the regression is reproduced.
- Repeat with today’s active run. If today works but a historical run does not, that further confirms missing date-scoped hydration rather than missing data.

### Interpretation

This requires no fast clicking, slow network, or failure injection. It is the most practical item to verify first.

## 4. `fa848c1` — Rename only

**Applies:** current `HEAD`.

### Reproduce

1. In signal review, invoke the button labeled for clearing review flags.
2. Confirm it clears review flags and does not claim to clear unrelated ACR/order state.

### Detect an effect

- Verify the UI action reaches the expected clear behavior.
- There is no identified defect; this is a smoke test for the renamed output binding.

## 5. `83c9b86` — Return an accepted symbol to review

**Applies:** current `HEAD`.

### Normal-flow check

1. Use an accepted symbol visible in the order page.
2. Remove it from the order page.
3. Reload the order page and then open chart review.

### Detect an effect

- Expected steady state: the symbol is absent from accepted/order symbols, has a `PENDING` decision for the active market date, and has a review-flag document.
- Inspect both Firestore documents in the test environment: the date-scoped decision and dateless review flag.

### Failure-path reproduction

1. Use the emulator or a dedicated test project where one of the two writes can be denied while the other remains allowed.
2. Remove an accepted symbol from order.
3. Reload both order and chart review.

### Detect an effect

- `PENDING` plus no review-flag document means the symbol can disappear from both workflows.
- `ACCEPT` plus a review-flag document means it appears in review while remaining accepted.

### Interpretation

Normal use will not trigger the inconsistency. It needs a failed or interrupted write. Verify it only if offline/retrying behavior or data consistency after partial failures matters for this workflow.

## 6. `96b7f61` — Exclusive list update race and conflicting APIs

**Applies:** current `HEAD`.

### Reproduce: concurrent-client race

1. Open two independent browser sessions for the same test account: two profiles, two browsers, or a browser plus a second device.
2. Put the same symbol in a known starting list state.
3. In session A, move it to one target list; in session B, move it to a different target list at nearly the same time.
4. Repeat the experiment several times. Network throttling can widen the read-to-commit window, but is not necessary.
5. Reload both sessions after every attempt.

### Detect an effect

- Inspect all canonical list documents in Firestore.
- Expected exclusive invariant: the symbol exists in exactly one target list matching the last intended operation.
- A missing symbol, a symbol in an unexpected list, or loss of unrelated list members is evidence of stale read-modify-write replacement.

### Reproduce: API-invariant drift

1. Search for callers of `addToList`, `removeFromList`, and `toggleInList` outside the exclusive move path.
2. From a UI path that calls `addToList`, add the same symbol to two different lists.

### Detect an effect

- If both lists retain the symbol, the persistence API permits a state the exclusive store path prohibits.

### Interpretation

The race requires multiple concurrent clients, not a user clicking quickly. If the product is intentionally single-user and effectively single-device, this is low urgency. The conflicting API contract is easier to verify and is architectural rather than timing-dependent.

## 7. `9b39193` — Non-merge write deletes unknown fields

**Applies:** current `HEAD`.

### Reproduce

1. In the emulator or dedicated test project, select a symbol-list document that will change during a list move.
2. Add a harmless sentinel field that the application does not model, for example `reviewSentinel: "keep-me"`.
3. Record the full document fields.
4. Use the UI to move a symbol so that this list document is written.
5. Re-read the document.

### Detect an effect

- If `reviewSentinel` is absent after the list operation, the full replacement write removed an unknown field.
- If it remains, verify that the operation actually changed that exact document; no-op lists are intentionally not written.

### Interpretation

This is deterministic once an extra document field exists. It is not a current user-interaction issue; it is a schema-evolution and data-preservation check.

## Evidence Checklist

For every reproduction attempt, capture:

1. The selected account/environment and the active market date.
2. Screenshots before the action, immediately after it, and after reload.
3. The relevant Firestore document values before and after.
4. Browser console errors and the exact snackbar text, if any.
5. For timing tests, the network-throttling setting and action order.

A reproduction that survives a reload and is confirmed against Firestore is strong evidence. A transient UI-only observation without a document comparison should be treated as a lead, not proof.
